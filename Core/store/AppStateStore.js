const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createDefaultServerProfile } = require('../config');

class AppStateStore {
    constructor({ dataFilePath, eventBus }) {
        this.dataFilePath = dataFilePath;
        this.eventBus = eventBus;
        this.state = this.#loadState();
    }

    #createInitialState() {
        const defaultServer = createDefaultServerProfile();

        return {
            version: 1,
            settings: {
                activeServerId: defaultServer.id,
                defaultServerId: defaultServer.id,
                users: []
            },
            servers: [defaultServer],
            devices: [],
            groups: [],
            requirements: [],
            notifications: [],
            pairing: {
                importedAt: null,
                sourceConfigFile: null,
                sessions: []
            },
            storageHistory: {}
        };
    }

    #withDefaults(state) {
        const baseState = this.#createInitialState();
        const merged = {
            ...baseState,
            ...state,
            settings: {
                ...baseState.settings,
                ...(state.settings || {})
            },
            pairing: {
                ...baseState.pairing,
                ...(state.pairing || {})
            },
            devices: Array.isArray(state.devices) ? state.devices : [],
            groups: Array.isArray(state.groups) ? state.groups : [],
            requirements: Array.isArray(state.requirements) ? state.requirements : [],
            notifications: Array.isArray(state.notifications) ? state.notifications : [],
            storageHistory: state.storageHistory || {}
        };

        if (!merged.servers || merged.servers.length === 0) {
            merged.servers = baseState.servers;
        }

        return merged;
    }

    #loadState() {
        if (!fs.existsSync(this.dataFilePath)) {
            const initialState = this.#createInitialState();
            this.#save(initialState);
            return initialState;
        }

        const rawContent = fs.readFileSync(this.dataFilePath, 'utf8');
        const parsedState = this.#withDefaults(JSON.parse(rawContent));

        if (!parsedState.servers || parsedState.servers.length === 0) {
            const initialState = this.#createInitialState();
            this.#save(initialState);
            return initialState;
        }

        return parsedState;
    }

    #save(nextState = this.state) {
        fs.mkdirSync(path.dirname(this.dataFilePath), { recursive: true });
        fs.writeFileSync(this.dataFilePath, JSON.stringify(nextState, null, 2));
    }

    #commit(mutator) {
        const draft = this.getState();
        const result = mutator(draft);
        this.state = draft;
        this.#save();
        this.eventBus.emit('state:changed', this.getPublicState());
        return result;
    }

    getState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    getPublicState() {
        return this.getState();
    }

    getDevices(serverId = null) {
        const devices = this.state.devices;
        if (!serverId) {
            return devices;
        }
        return devices.filter((device) => device.serverId === serverId);
    }

    getDevicesByType(serverId = null, type = null) {
        let devices = this.getDevices(serverId);
        if (type) {
            try {
                devices = devices.filter((device) => device.type === type);
            } catch (error) {
                console.error(`Returning add devices after Error filtering devices by type "${type}":`, error);
                return devices;
            }
        }
        return devices;
    }

    getGroups(serverId = null) {
        const groups = this.state.groups;
        if (!serverId) {
            return groups;
        }
        return groups.filter((group) => group.serverId === serverId);
    }

    getServer(serverId) {
        return this.state.servers.find((server) => server.id === serverId) || null;
    }

    getActiveServer() {
        return this.getServer(this.state.settings.activeServerId);
    }

    setActiveServer(serverId) {
        return this.#commit((draft) => {
            const server = draft.servers.find((item) => item.id === serverId);

            if (!server) {
                throw new Error(`Unknown server: ${serverId}`);
            }

            draft.settings.activeServerId = serverId;
            return server;
        });
    }

    setDefaultServer(serverId) {
        return this.#commit((draft) => {
            const server = draft.servers.find((item) => item.id === serverId);

            if (!server) {
                throw new Error(`Unknown server: ${serverId}`);
            }

            draft.settings.defaultServerId = serverId;
            draft.servers = draft.servers.map((item) => ({
                ...item,
                isDefault: item.id === serverId
            }));
            return server;
        });
    }

    upsertUserPreference({ userId, defaultServerId }) {
        return this.#commit((draft) => {
            const userIdKey = String(userId || '').trim();

            if (!userIdKey) {
                throw new Error('User preference update requires userId');
            }

            const server = draft.servers.find((item) => item.id === defaultServerId);

            if (!server) {
                throw new Error(`Unknown server: ${defaultServerId}`);
            }

            const existing = draft.settings.users.find((item) => item.userId === userIdKey);

            if (existing) {
                existing.defaultServerId = defaultServerId;
                return existing;
            }

            const preference = {
                userId: userIdKey,
                defaultServerId
            };

            draft.settings.users.push(preference);
            return preference;
        });
    }

    addServer({ name, host, port, playerId, playerToken, isDefault = false }) {
        return this.#commit((draft) => {
            const activeServer = draft.servers.find((server) => server.id === draft.settings.activeServerId) || null;
            const server = {
                id: randomUUID(),
                name: String(name || '').trim() || `Server ${draft.servers.length + 1}`,
                host: String(host || '').trim(),
                port: String(port || '').trim(),
                playerId: String(playerId || '').trim(),
                playerToken: String(playerToken || '').trim(),
                isDefault: Boolean(isDefault)
            };

            if (!server.host || !server.port || !server.playerId || !server.playerToken) {
                throw new Error('Server profile requires host, port, player ID, and player token');
            }

            if (server.isDefault) {
                draft.settings.defaultServerId = server.id;
                draft.servers = draft.servers.map((item) => ({
                    ...item,
                    isDefault: false
                }));
            }

            draft.servers.push(server);

            if (!draft.settings.activeServerId || !this.#hasConnectionInfo(activeServer)) {
                draft.settings.activeServerId = server.id;
            }

            return server;
        });
    }

    removeServer(serverId) {
        return this.#commit((draft) => {
            if (draft.servers.length === 1) {
                throw new Error('At least one server profile must remain');
            }

            const serverExists = draft.servers.some((server) => server.id === serverId);

            if (!serverExists) {
                throw new Error(`Unknown server: ${serverId}`);
            }

            draft.servers = draft.servers.filter((server) => server.id !== serverId);
            draft.devices = draft.devices.filter((device) => device.serverId !== serverId);
            draft.groups = draft.groups.filter((group) => group.serverId !== serverId);

            if (draft.settings.activeServerId === serverId) {
                draft.settings.activeServerId = draft.settings.defaultServerId === serverId
                    ? draft.servers[0].id
                    : draft.settings.defaultServerId;
            }

            if (draft.settings.defaultServerId === serverId) {
                draft.settings.defaultServerId = draft.servers[0].id;
                draft.servers = draft.servers.map((server, index) => ({
                    ...server,
                    isDefault: index === 0
                }));
            }
        });
    }

    addSwitchDevice({ name, entityId, serverId }) {
        return this.#commit((draft) => {
            const device = {
                id: randomUUID(),
                type: 'switch',
                name: name || `Switch ${entityId}`,
                entityId: String(entityId),
                serverId,
                lastKnownState: null,
                metadata: {},
                updatedAt: null
            };

            draft.devices.push(device);
            return device;
        });
    }

    removeDevice(deviceId) {
        return this.#commit((draft) => {
            draft.devices = draft.devices.filter((device) => device.id !== deviceId);
            draft.groups = draft.groups.map((group) => ({
                ...group,
                deviceIds: group.deviceIds.filter((id) => id !== deviceId)
            }));
            delete draft.storageHistory[deviceId];
        });
    }

    removeDevicesByServer(serverId) {
        return this.#commit((draft) => {
            const removedDeviceIds = draft.devices
                .filter((device) => device.serverId === serverId)
                .map((device) => device.id);

            draft.devices = draft.devices.filter((device) => device.serverId !== serverId);
            draft.groups = draft.groups.map((group) => ({
                ...group,
                deviceIds: group.deviceIds.filter((id) => !removedDeviceIds.includes(id))
            }));

            for (const deviceId of removedDeviceIds) {
                delete draft.storageHistory[deviceId];
            }

            return removedDeviceIds.length;
        });
    }

    addDevice({
        serverId,
        type,
        name,
        entityId = null,
        cameraId = null,
        metadata = {}
    }) {
        return this.#commit((draft) => {
            const device = {
                id: randomUUID(),
                serverId,
                type,
                name: String(name || '').trim() || `${type} ${entityId || cameraId || ''}`.trim(),
                entityId: entityId === null || entityId === undefined ? null : String(entityId),
                cameraId: cameraId === null || cameraId === undefined ? null : String(cameraId),
                metadata,
                lastKnownState: null,
                lastPayload: null,
                updatedAt: null
            };

            draft.devices.push(device);
            return device;
        });
    }

    updateDeviceState(deviceId, nextPartialState) {
        return this.#commit((draft) => {
            const device = draft.devices.find((item) => item.id === deviceId);

            if (!device) {
                return null;
            }

            Object.assign(device, nextPartialState, {
                updatedAt: new Date().toISOString()
            });

            return device;
        });
    }

    updateDevice(deviceId, nextPartialState) {
        return this.updateDeviceState(deviceId, nextPartialState);
    }

    getDevice(deviceId) {
        return this.state.devices.find((item) => item.id === deviceId) || null;
    }

    addSwitchGroup({ name, serverId, deviceIds }) {
        return this.#commit((draft) => {
            const group = {
                id: randomUUID(),
                type: 'switch-group',
                name,
                serverId,
                deviceIds: Array.from(new Set(deviceIds)),
                config: {}
            };

            draft.groups.push(group);
            return group;
        });
    }

    addGroup({ type, name, serverId, deviceIds, config = {} }) {
        return this.#commit((draft) => {
            const group = {
                id: randomUUID(),
                type,
                name: String(name || '').trim() || `${type} group`,
                serverId,
                deviceIds: Array.from(new Set(deviceIds || [])),
                config,
                createdAt: new Date().toISOString(),
                updatedAt: null
            };
            draft.groups.push(group);
            return group;
        });
    }

    updateGroup(groupId, nextPartialState) {
        return this.#commit((draft) => {
            const group = draft.groups.find((item) => item.id === groupId);

            if (!group) {
                throw new Error(`Unknown group: ${groupId}`);
            }

            Object.assign(group, nextPartialState, {
                updatedAt: new Date().toISOString()
            });

            return group;
        });
    }

    removeGroup(groupId) {
        return this.#commit((draft) => {
            draft.groups = draft.groups.filter((group) => group.id !== groupId);
            draft.requirements = draft.requirements.filter((item) => item.groupId !== groupId);
        });
    }

    addRequirement(requirement) {
        return this.#commit((draft) => {
            const record = {
                id: randomUUID(),
                enabled: true,
                createdAt: new Date().toISOString(),
                ...requirement
            };

            draft.requirements.push(record);
            return record;
        });
    }

    updateRequirement(requirementId, nextPartialState) {
        return this.#commit((draft) => {
            const record = draft.requirements.find((item) => item.id === requirementId);

            if (!record) {
                throw new Error(`Unknown requirement: ${requirementId}`);
            }

            Object.assign(record, nextPartialState, {
                updatedAt: new Date().toISOString()
            });

            return record;
        });
    }

    removeRequirement(requirementId) {
        return this.#commit((draft) => {
            draft.requirements = draft.requirements.filter((item) => item.id !== requirementId);
        });
    }

    addNotification(record) {
        return this.#commit((draft) => {
            const nextRecord = {
                id: randomUUID(),
                ...record,
                timestamp: record.timestamp || new Date().toISOString()
            };
            draft.notifications.push(nextRecord);
            if (draft.notifications.length > 10000) {
                draft.notifications.splice(0, draft.notifications.length - 10000);
            }
            return nextRecord;
        });
    }

    appendStorageHistory(deviceId, snapshot) {
        return this.#commit((draft) => {
            if (!draft.storageHistory[deviceId]) {
                draft.storageHistory[deviceId] = [];
            }

            draft.storageHistory[deviceId].push(snapshot);
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            draft.storageHistory[deviceId] = draft.storageHistory[deviceId]
                .filter((entry) => new Date(entry.timestamp).getTime() >= oneHourAgo);
        });
    }

    getStorageHistory(deviceId) {
        return this.state.storageHistory[deviceId] || [];
    }

    #hasConnectionInfo(server) {
        if (!server) {
            return false;
        }

        return Boolean(
            String(server.host || '').trim() &&
            String(server.port || '').trim() &&
            String(server.playerId || '').trim() &&
            String(server.playerToken || '').trim()
        );
    }

    addPairingSession(record) {
        return this.#commit((draft) => {
            const session = {
                id: randomUUID(),
                createdAt: new Date().toISOString(),
                ...record
            };
            draft.pairing.sessions.push(session);
            return session;
        });
    }

    updatePairingMeta(partial) {
        return this.#commit((draft) => {
            draft.pairing = {
                ...draft.pairing,
                ...partial
            };
            return draft.pairing;
        });
    }
}

module.exports = AppStateStore;