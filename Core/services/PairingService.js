const fs = require('fs');

class PairingService {
    constructor({ store, deviceService, eventBus }) {
        this.store = store;
        this.deviceService = deviceService;
        this.eventBus = eventBus;
    }

    importRustPlusConfig(configPath) {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);

        this.store.updatePairingMeta({
            importedAt: new Date().toISOString(),
            sourceConfigFile: configPath,
            fcmCredentialsPresent: Boolean(parsed.fcm_credentials),
            rustplusAuthTokenPresent: Boolean(parsed.rustplus_auth_token)
        });

        const session = this.store.addPairingSession({
            type: 'import-config',
            status: 'completed',
            details: {
                configPath,
                hasFcm: Boolean(parsed.fcm_credentials),
                hasAuthToken: Boolean(parsed.rustplus_auth_token)
            }
        });

        this.eventBus.emit('pairing:updated', session);
        return session;
    }

    pairServerManual(payload) {
        const server = this.store.addServer({
            name: payload.name,
            host: payload.host,
            port: payload.port,
            playerId: payload.playerId,
            playerToken: payload.playerToken,
            isDefault: Boolean(payload.isDefault)
        });

        const session = this.store.addPairingSession({
            type: 'manual-server-pair',
            status: 'completed',
            details: {
                serverId: server.id,
                serverName: server.name
            }
        });

        this.eventBus.emit('pairing:updated', session);

        return {
            server,
            session
        };
    }

    async pairDeviceManual(payload) {
        const device = await this.deviceService.addDevice({
            serverId: payload.serverId,
            type: payload.type,
            name: payload.name,
            entityId: payload.entityId,
            cameraId: payload.cameraId,
            metadata: {
                pairedManually: true,
                ...payload.metadata
            }
        });

        const session = this.store.addPairingSession({
            type: 'manual-device-pair',
            status: 'completed',
            details: {
                serverId: payload.serverId,
                deviceId: device.id,
                type: device.type
            }
        });

        this.eventBus.emit('pairing:updated', session);

        return {
            device,
            session
        };
    }

    async pairFromNotification(payload, options = {}) {
        const autoPair = options.autoPair !== false;
        const source = String(options.source || 'notification').trim() || 'notification';
        const normalized = this.#normalizeNotificationPayload(payload);

        if (!normalized.type) {
            throw new Error('Pairing notification is missing type');
        }

        if (!autoPair) {
            const session = this.store.addPairingSession({
                type: 'pairing-notification',
                status: 'received',
                details: {
                    source,
                    payload: normalized
                }
            });

            this.eventBus.emit('pairing:updated', session);
            return {
                applied: false,
                normalized,
                session
            };
        }

        if (normalized.type === 'server') {
            return this.#applyServerPairing(normalized, source);
        }

        if (normalized.type === 'entity') {
            return this.#applyEntityPairing(normalized, source);
        }

        throw new Error(`Unsupported pairing notification type: ${normalized.type}`);
    }

    #applyServerPairing(normalized, source) {
        const existingServer = this.#findServer(normalized);
        const server = existingServer || this.store.addServer({
            name: normalized.name || `Server ${normalized.host}:${normalized.port}`,
            host: normalized.host,
            port: normalized.port,
            playerId: normalized.playerId,
            playerToken: normalized.playerToken,
            isDefault: false
        });

        const session = this.store.addPairingSession({
            type: 'pairing-notification-server',
            status: 'completed',
            details: {
                source,
                createdServer: !existingServer,
                serverId: server.id,
                host: server.host,
                port: server.port,
                playerId: server.playerId
            }
        });

        this.eventBus.emit('pairing:updated', session);

        return {
            applied: true,
            type: 'server',
            createdServer: !existingServer,
            server,
            session
        };
    }

    async #applyEntityPairing(normalized, source) {
        const server = this.#resolveServerForEntityNotification(normalized);

        if (!server) {
            throw new Error('Entity pairing notification does not include resolvable server info');
        }

        const deviceType = this.#mapEntityType(normalized.entityType);

        if (!deviceType) {
            throw new Error(`Unsupported entity type in pairing notification: ${normalized.entityType || 'unknown'}`);
        }

        const existingDevice = this.store.getDevices(server.id).find((device) => {
            if (deviceType === 'camera' || deviceType === 'turret') {
                return String(device.cameraId || '') === String(normalized.entityId || '');
            }

            return String(device.entityId || '') === String(normalized.entityId || '')
                && device.type === deviceType;
        });

        let primeError = null;
        const baseDevicePayload = {
            serverId: server.id,
            type: deviceType,
            name: normalized.entityName || `${deviceType} ${normalized.entityId}`,
            entityId: deviceType === 'camera' || deviceType === 'turret' ? null : normalized.entityId,
            cameraId: deviceType === 'camera' || deviceType === 'turret' ? normalized.entityId : null,
            metadata: {
                pairedViaNotification: true,
                pairingEntityType: normalized.entityType || null,
                pairingSource: source
            }
        };

        let device = existingDevice;

        if (!device) {
            try {
                device = await this.deviceService.addDevice(baseDevicePayload);
            } catch (error) {
                if (!this.#isPrimeableType(deviceType)) {
                    throw error;
                }

                primeError = error.message;
                device = this.store.addDevice({
                    ...baseDevicePayload,
                    metadata: {
                        ...baseDevicePayload.metadata,
                        primePending: true,
                        primeError
                    }
                });
            }
        }

        const session = this.store.addPairingSession({
            type: 'pairing-notification-entity',
            status: 'completed',
            details: {
                source,
                createdDevice: !existingDevice,
                serverId: server.id,
                deviceId: device.id,
                entityId: normalized.entityId,
                entityType: normalized.entityType,
                primeError
            }
        });

        this.eventBus.emit('pairing:updated', session);

        return {
            applied: true,
            type: 'entity',
            createdDevice: !existingDevice,
            primeError,
            server,
            device,
            session
        };
    }

    #findServer(normalized) {
        return this.store.getState().servers.find((server) => {
            return String(server.host || '') === String(normalized.host || '')
                && String(server.port || '') === String(normalized.port || '')
                && String(server.playerId || '') === String(normalized.playerId || '');
        }) || null;
    }

    #resolveServerForEntityNotification(normalized) {
        const directMatch = this.#findServer(normalized);
        if (directMatch) {
            return directMatch;
        }

        if (normalized.host && normalized.port && normalized.playerId && normalized.playerToken) {
            return this.store.addServer({
                name: normalized.name || `Server ${normalized.host}:${normalized.port}`,
                host: normalized.host,
                port: normalized.port,
                playerId: normalized.playerId,
                playerToken: normalized.playerToken,
                isDefault: false
            });
        }

        return this.store.getActiveServer();
    }

    #mapEntityType(entityType) {
        const value = String(entityType || '').toLowerCase().trim();

        if (!value) {
            return null;
        }

        // Rust+ sends numeric entity types: 1=Switch, 2=Alarm, 3=StorageMonitor, 4=AutoTurret(?), 5=Camera(?)
        const numericMap = { '1': 'switch', '2': 'alarm', '3': 'storage-monitor', '4': 'turret', '5': 'camera' };
        if (numericMap[value]) {
            return numericMap[value];
        }

        if (value.includes('switch')) {
            return 'switch';
        }

        if (value.includes('alarm')) {
            return 'alarm';
        }

        if (value.includes('storage')) {
            return 'storage-monitor';
        }

        if (value.includes('camera')) {
            return 'camera';
        }

        if (value.includes('turret') || value.includes('auto')) {
            return 'turret';
        }

        return null;
    }

    #isPrimeableType(type) {
        return ['switch', 'alarm', 'storage-monitor'].includes(type);
    }

    #normalizeNotificationPayload(payload) {
        const source = payload && typeof payload === 'object' ? payload : {};
        const nestedData = this.#extractNestedData(source);
        const merged = {
            ...source,
            ...nestedData
        };

        const type = String(merged.type || '').trim().toLowerCase();

        return {
            type,
            id: this.#stringOrNull(merged.id),
            name: this.#stringOrNull(merged.name),
            host: this.#stringOrNull(merged.ip || merged.host),
            port: this.#stringOrNull(merged.port),
            playerId: this.#stringOrNull(merged.playerId),
            playerToken: this.#stringOrNull(merged.playerToken),
            entityId: this.#stringOrNull(merged.entityId),
            entityType: this.#stringOrNull(merged.entityType),
            entityName: this.#stringOrNull(merged.entityName)
        };
    }

    #extractNestedData(source) {
        // FCM MCS raw object: appData is [{key, value}, ...] — convert to plain object
        if (Array.isArray(source.appData) && source.appData.length > 0) {
            const fromAppData = {};
            for (const { key, value } of source.appData) {
                if (key !== undefined) fromAppData[key] = value;
            }
            // Rust+ encodes the pairing payload as JSON inside the 'body' key
            if (fromAppData.body) {
                try {
                    const parsed = JSON.parse(fromAppData.body);
                    if (parsed && parsed.type) return parsed;
                } catch (_) { /* not JSON, fall through */ }
            }
            if (fromAppData.type) return fromAppData;
        }

        const candidates = [
            source.data,
            source.Data,
            source.notification && source.notification.data,
            source.message && source.message.data,
            source.body && typeof source.body === 'object' && source.body.data,
            source.payload && source.payload.data
        ];

        for (const candidate of candidates) {
            if (candidate && typeof candidate === 'object') {
                return candidate;
            }
        }

        return {};
    }

    #stringOrNull(value) {
        if (value === null || value === undefined) {
            return null;
        }

        const normalized = String(value).trim();
        return normalized ? normalized : null;
    }
}

module.exports = PairingService;
