class DeviceService {
    constructor({ store, connectionManager }) {
        this.store = store;
        this.connectionManager = connectionManager;
    }

    async addDevice(payload) {
        const activeServer = this.store.getActiveServer();
        const serverId = payload.serverId || activeServer.id;
        const type = String(payload.type || '').trim();

        if (!type) {
            throw new Error('Device type is required');
        }

        const device = this.store.addDevice({
            serverId,
            type,
            name: payload.name,
            entityId: payload.entityId,
            cameraId: payload.cameraId,
            metadata: payload.metadata || {}
        });

        if (device.entityId && this.#isPrimeableType(device.type)) {
            await this.connectionManager.primeEntity(serverId, device.entityId);
        }

        return device;
    }

    removeDevice(deviceId) {
        this.store.removeDevice(deviceId);
    }

    async clearDevicesForServer(serverId) {
        const devices = this.store.getDevices(serverId);
        const removed = this.store.removeDevicesByServer(serverId);

        await this.connectionManager.clearServerDevices(serverId, devices);
        return removed;
    }

    updateDevice(deviceId, partial) {
        return this.store.updateDevice(deviceId, partial);
    }

    async primeExistingDevices() {
        const state = this.store.getState();

        for (const device of state.devices) {
            if (device.entityId && this.#isPrimeableType(device.type)) {
                await this.connectionManager.primeEntity(device.serverId, device.entityId);
            }
        }
    }

    findDevice(deviceId) {
        const device = this.store.getDevice(deviceId);

        if (!device) {
            throw new Error(`Unknown device: ${deviceId}`);
        }

        return device;
    }

    findByEntity(serverId, entityId, type = null) {
        const state = this.store.getState();
        return state.devices.find((device) => {
            const sameServer = device.serverId === serverId;
            const sameEntity = String(device.entityId) === String(entityId);
            const sameType = !type || device.type === type;
            return sameServer && sameEntity && sameType;
        }) || null;
    }

    listByType(serverId, type) {
        return this.store.getDevices(serverId).filter((device) => device.type === type);
    }

    #isPrimeableType(type) {
        return ['switch', 'alarm', 'storage-monitor'].includes(type);
    }
}

module.exports = DeviceService;
