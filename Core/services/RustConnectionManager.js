const RustPlus = require('@liamcottle/rustplus.js');
const { writeServerLog } = require('../utils');

class RustConnectionManager {
    constructor({ store, eventBus, rateLimitCoordinator }) {
        this.store = store;
        this.eventBus = eventBus;
        this.rateLimitCoordinator = rateLimitCoordinator;
        this.connections = new Map();
        this.cameraRecords = new Map();
        // Map image cache: serverId -> { data, cachedAt }  (5-min TTL, 5 tokens to fetch)
        this.mapImageCache = new Map();
        this.mapImageCacheTTL = 5 * 60 * 1000; // 5 minutes
        // Server info cache: serverId -> { data, cachedAt } (5-min TTL, 1 token to fetch)
        this.serverInfoCache = new Map();
        this.serverInfoCacheTTL = 5 * 60 * 1000; // 5 minutes
        // Team info cache: serverId -> { data, cachedAt } (5-min TTL, 1 token to fetch)
        this.teamInfoCache = new Map();
        this.teamInfoCacheTTL = 5 * 60 * 1000; // 5 minutes
    }

    async start() {
        const activeServer = this.store.getActiveServer();

        if (activeServer && this.#hasConnectionInfo(activeServer)) {
            await this.ensureServerConnection(activeServer.id);
        }
    }

    getConnectionStates() {
        return this.store.getState().servers.map((server) => {
            const record = this.connections.get(server.id);

            return {
                serverId: server.id,
                status: record ? record.status : 'idle',
                lastError: record ? record.lastError : null
            };
        });
    }

    getRequestStates() {
        return this.rateLimitCoordinator.getState();
    }

    async ensureServerConnection(serverId) {
        const existing = this.connections.get(serverId);

        if (existing) {
            return existing.readyPromise;
        }

        const server = this.store.getServer(serverId);

        if (!server) {
            throw new Error(`Unknown server: ${serverId}`);
        }

        if (!this.#hasConnectionInfo(server)) {
            // Check if the server is an undefined/default server profile which is missing connection info because the user hasn't set it up yet, and if so throw a more specific error message
            if (server.id === "default-server") {
                this.eventBus.emit('no-servers-modal:show');
                return;
            }
            const isDefaultProfile = !server.host && !server.port && !server.playerId && !server.playerToken;
            if (isDefaultProfile && this.store.getState().servers.length === 1) {
                // Emit the no servers modal event for the UI to handle since this is likely the default profile that was auto-created and the user just needs to enter their server details
                this.eventBus.emit('no-servers-modal:show');
                throw new Error('No server connection info found. Please enter your server details to connect.');
            }
            throw new Error('Server profile is incomplete. Add host, port, player ID, and player token first.');
        }

        const client = new RustPlus(server.host, server.port, server.playerId, server.playerToken);
        const record = {
            client,
            status: 'connecting',
            lastError: null,
            primedEntities: new Set(),
            readyPromise: null,
            resolveReady: null,
            rejectReady: null
        };

        record.readyPromise = new Promise((resolve, reject) => {
            record.resolveReady = resolve;
            record.rejectReady = reject;
        });

        this.connections.set(serverId, record);
        this.#emitStatus(serverId, record);

        client.on('connected', () => {
            record.status = 'connected';
            record.lastError = null;
            record.resolveReady();
            record.resolveReady = null;
            record.rejectReady = null;
            this.#emitStatus(serverId, record);
        });

        client.on('disconnected', () => {
            record.status = 'disconnected';
            this.#emitStatus(serverId, record);
        });

        client.on('error', (error) => {
            record.status = 'error';
            record.lastError = error.message;
            if (record.rejectReady) {
                record.rejectReady(error);
                record.resolveReady = null;
                record.rejectReady = null;
            }
            this.#emitStatus(serverId, record);
        });

        client.on('message', (message) => {
            this.#handleMessage(serverId, message);
        });

        client.connect();

        return this.#waitForConnection(record.readyPromise);
    }

    async logInvokableMethods(serverId) {
        const record = await this.#getReadyConnection(serverId);
        // Get all of the defined protobuf methods that the Rust+ client can invoke based on the proto definition
        const invokables = Object.keys(Object.getPrototypeOf(record.client)).filter((key) => {
            return typeof record.client[key] === 'message' && key !== 'constructor';
        });
        return invokables;
    }

    async primeEntity(serverId, entityId) {
        const record = await this.#getReadyConnection(serverId);
        const normalizedId = String(entityId);

        if (record.primedEntities.has(normalizedId)) {
            return null;
        }

        const response = await this.rateLimitCoordinator.enqueue(serverId, 1, () => {
            return this.#invoke(record.client.getEntityInfo.bind(record.client), [normalizedId]);
        });
        record.primedEntities.add(normalizedId);
        return response;
    }

    async turnSmartSwitchOn(serverId, entityId) {
        const record = await this.#getReadyConnection(serverId);
        return this.rateLimitCoordinator.enqueue(serverId, 1, () => {
            return this.#invoke(record.client.turnSmartSwitchOn.bind(record.client), [Number(entityId)]);
        });
    }

    async turnSmartSwitchOff(serverId, entityId) {
        const record = await this.#getReadyConnection(serverId);
        return this.rateLimitCoordinator.enqueue(serverId, 1, () => {
            return this.#invoke(record.client.turnSmartSwitchOff.bind(record.client), [Number(entityId)]);
        });
    }

    async sendTeamMessage(serverId, message) {
        const record = await this.#getReadyConnection(serverId);
        const response = await this.rateLimitCoordinator.enqueue(serverId, 2, () => {
            return this.#invoke(record.client.sendTeamMessage.bind(record.client), [message]);
        });

        const appError = response?.response?.error;
        if (appError) {
            throw new Error(this.#formatAppError(appError, 'Failed to send team message'));
        }

        return response;
    }

    async getTeamMessageHistory(serverId) {
        const record = await this.#getReadyConnection(serverId);
        const response = await this.rateLimitCoordinator.enqueue(serverId, 1, () => {
            return this.#invoke(record.client.getTeamChat.bind(record.client), []);
        });
    }

    async getTeamInfo(serverId, { forceRefresh = false } = {}) {
        const cached = this.teamInfoCache.get(serverId);
        if (!forceRefresh && cached && Date.now() - cached.cachedAt < this.teamInfoCacheTTL) {
            return cached.data;
        }
        
        const record = await this.#getReadyConnection(serverId);
        const response = await this.rateLimitCoordinator.enqueue(serverId, 1, () => {
            return this.#invoke(record.client.getTeamInfo.bind(record.client), []);
        });
        const data = response?.response || null;
        this.teamInfoCache.set(serverId, { data, cachedAt: Date.now() });
        return data;
    }

    async getTeamMembers(serverId) {
        const teamInfo = await this.getTeamInfo(serverId);
        return teamInfo?.members || [];
    }

    async getMap(serverId, { forceRefresh = false } = {}) {
        const cached = this.mapImageCache.get(serverId);
        if (cached && Date.now() - cached.cachedAt < this.mapImageCacheTTL && !forceRefresh) {
            return cached.data;
        }
        const record = await this.#getReadyConnection(serverId);
        const message = await this.rateLimitCoordinator.enqueue(serverId, 5, () => {
            return this.#invoke(record.client.getMap.bind(record.client), []);
        });
        const data = message.response?.map || null;
        this.mapImageCache.set(serverId, { data, cachedAt: Date.now() });
        return data;
    }

    async getMapMarkers(serverId) {
        const record = await this.#getReadyConnection(serverId);
        const message = await this.rateLimitCoordinator.enqueue(serverId, 1, () => {
            return this.#invoke(record.client.getMapMarkers.bind(record.client), []);
        });
        return message.response?.mapMarkers?.markers || [];
    }

    async getServerInfo(serverId, { forceRefresh = false } = {}) {
        const cached = this.serverInfoCache.get(serverId);
        if (!forceRefresh && cached && Date.now() - cached.cachedAt < this.serverInfoCacheTTL) {
            return cached.data;
        }

        const record = await this.#getReadyConnection(serverId);
        try {
            const requestPromise = this.rateLimitCoordinator.enqueue(serverId, 1, () => {
                return this.#invoke(record.client.getInfo.bind(record.client), []);
            });
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('getInfo request timed out')), 4000);
            });
            const message = await Promise.race([requestPromise, timeoutPromise]);
            const data = message.response?.info || null;
            this.serverInfoCache.set(serverId, { data, cachedAt: Date.now() });
            return data;
        } catch (error) {
            return null;
        }
    }

    async checkServerConnection(serverId) {
        try {
            if(serverId === "default-server") {
                return {
                    ok: false,
                    status: 'idle',
                    lastError: null,
                    warning: null,
                    info: null
                };
            }
            await this.ensureServerConnection(serverId);
            const info = await this.getServerInfo(serverId, { forceRefresh: true });
            const record = this.connections.get(serverId);
            const isConnected = record?.status === 'connected';
            const warning = !info && isConnected
                ? 'Connected, but server info request did not return data yet.'
                : null;

            return {
                ok: Boolean(info) || isConnected,
                status: record?.status || 'idle',
                lastError: record?.lastError || null,
                warning,
                info
            };
        } catch (error) {
            const record = this.connections.get(serverId);
            return {
                ok: false,
                status: record?.status || 'error',
                lastError: error.message,
                warning: null,
                info: null
            };
        }
    }

    async setEntityValue(serverId, entityId, value) {
        const record = await this.#getReadyConnection(serverId);
        return this.rateLimitCoordinator.enqueue(serverId, 1, () => {
            return this.#invoke(record.client.setEntityValue.bind(record.client), [Number(entityId), Boolean(value)]);
        });
    }

    async subscribeCamera(serverId, cameraId) {
        const record = await this.#getReadyConnection(serverId);
        const key = `${serverId}:${cameraId}`;

        let cameraRecord = this.cameraRecords.get(key);

        if (cameraRecord && cameraRecord.subscribed) {
            return cameraRecord;
        }

        if (!cameraRecord) {
            const camera = record.client.getCamera(String(cameraId));
            cameraRecord = {
                camera,
                subscribed: false,
                subscribeError: null,
                latestFrameBase64: null,
                latestFrameAt: null
            };

            camera.on('render', (buffer) => {
                cameraRecord.latestFrameBase64 = buffer.toString('base64');
                cameraRecord.latestFrameAt = new Date().toISOString();
                this.eventBus.emit('camera:frame', {
                    serverId,
                    cameraId: String(cameraId),
                    frameBase64: cameraRecord.latestFrameBase64,
                    timestamp: cameraRecord.latestFrameAt
                });
            });

            this.cameraRecords.set(key, cameraRecord);
        }

        await this.rateLimitCoordinator.enqueue(serverId, 1, async () => {
            await cameraRecord.camera.subscribe();
        });

        cameraRecord.subscribed = true;
        cameraRecord.subscribeError = null;
        return cameraRecord;
    }

    async unsubscribeCamera(serverId, cameraId) {
        const key = `${serverId}:${cameraId}`;
        const record = this.cameraRecords.get(key);

        if (!record) {
            return;
        }

        await record.camera.unsubscribe();
        this.cameraRecords.delete(key);
    }

    async clearServerDevices(serverId, devices = []) {
        const cameraDevices = devices.filter((device) => ['camera', 'turret'].includes(device.type) && device.cameraId);

        await Promise.allSettled(cameraDevices.map((device) => {
            return this.unsubscribeCamera(serverId, device.cameraId);
        }));

        const record = this.connections.get(serverId);
        if (record) {
            record.primedEntities.clear();
        }
    }

    async cameraMove(serverId, cameraId, buttons, x, y) {
        const cameraRecord = await this.subscribeCamera(serverId, cameraId);
        return this.rateLimitCoordinator.enqueue(serverId, 0.01, async () => {
            await cameraRecord.camera.move(Number(buttons), Number(x), Number(y));
        });
    }

    async cameraShoot(serverId, cameraId) {
        const cameraRecord = await this.subscribeCamera(serverId, cameraId);
        return this.rateLimitCoordinator.enqueue(serverId, 0.01, async () => {
            await cameraRecord.camera.shoot();
        });
    }

    async cameraReload(serverId, cameraId) {
        const cameraRecord = await this.subscribeCamera(serverId, cameraId);
        return this.rateLimitCoordinator.enqueue(serverId, 0.01, async () => {
            await cameraRecord.camera.reload();
        });
    }

    async cameraZoom(serverId, cameraId) {
        const cameraRecord = await this.subscribeCamera(serverId, cameraId);
        return this.rateLimitCoordinator.enqueue(serverId, 0.01, async () => {
            await cameraRecord.camera.zoom();
        });
    }

    getLatestCameraFrame(serverId, cameraId) {
        const record = this.cameraRecords.get(`${serverId}:${cameraId}`);
        if (!record) {
            return null;
        }
        return {
            frameBase64: record.latestFrameBase64,
            timestamp: record.latestFrameAt
        };
    }

    async #getReadyConnection(serverId) {
        await this.ensureServerConnection(serverId);
        return this.connections.get(serverId);
    }

    async #waitForConnection(readyPromise) {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timed out while connecting to Rust+ server')), 10000);
        });

        return Promise.race([readyPromise, timeoutPromise]);
    }

    #emitStatus(serverId, record) {
        this.eventBus.emit('connection:status', {
            serverId,
            status: record.status,
            lastError: record.lastError
        });
    }

    #hasConnectionInfo(server) {
        return Boolean(
            String(server?.host || '').trim() &&
            String(server?.port || '').trim() &&
            String(server?.playerId || '').trim() &&
            String(server?.playerToken || '').trim()
        );
    }

    #handleMessage(serverId, message) {
        const broadcast = message && message.broadcast;
        const entityChanged = broadcast && broadcast.entityChanged;

        if (!entityChanged) {
            return;
        }

        this.eventBus.emit('rust:entityChanged', {
            serverId,
            entityId: String(entityChanged.entityId),
            payload: entityChanged.payload || {}
        });
        writeServerLog('info', serverId, `Entity ${entityChanged.entityId} changed: ${JSON.stringify(entityChanged.payload)}`);

    }

    #invoke(method, args) {
        return new Promise((resolve, reject) => {
            try {
                writeServerLog('info', 'Invoke', `Invoking method with args: ${method.name}, ${JSON.stringify(args)}`);
            } catch (error) {
                console.warn('Failed to log method invocation:', error.message);
            }
            try {
                method(...args, (message) => resolve(message));
            } catch (error) {
                writeServerLog('error', 'InvokeError', `Method invocation failed: ${error.message}`);
                reject(error);
            }
        });
    }

    #formatAppError(appError, fallbackMessage) {
        if (!appError) {
            return fallbackMessage;
        }

        if (typeof appError === 'string') {
            return appError;
        }

        const message = String(appError?.message || '').trim();
        const code = appError?.code;

        writeServerLog('error', 'AppError', `Error code: ${code}, message: ${message}`);

        if (message && code !== undefined && code !== null) {
            return `${message} (code ${code})`;
        }

        if (message) {
            return message;
        }

        if (code !== undefined && code !== null) {
            return `${fallbackMessage} (code ${code})`;
        }

        return fallbackMessage;
    }
}

module.exports = RustConnectionManager;