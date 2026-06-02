const RustPlus = require('@liamcottle/rustplus.js');

class RustConnectionManager {
    constructor({ store, eventBus, rateLimitCoordinator }) {
        this.store = store;
        this.eventBus = eventBus;
        this.rateLimitCoordinator = rateLimitCoordinator;
        this.connections = new Map();
        this.cameraRecords = new Map();
    }

    async start() {
        const activeServer = this.store.getActiveServer();

        if (activeServer) {
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
        return this.rateLimitCoordinator.enqueue(serverId, 2, () => {
            return this.#invoke(record.client.sendTeamMessage.bind(record.client), [message]);
        });
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
    }

    #invoke(method, args) {
        return new Promise((resolve, reject) => {
            try {
                method(...args, (message) => resolve(message));
            } catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = RustConnectionManager;