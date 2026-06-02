class SmartSwitchService {
    constructor({ store, deviceService, connectionManager, eventBus }) {
        this.store = store;
        this.deviceService = deviceService;
        this.connectionManager = connectionManager;
        this.eventBus = eventBus;

        this.eventBus.on('rust:entityChanged', (event) => {
            this.#syncDeviceFromEntityEvent(event);
        });
    }

    async addSwitch({ serverId, name, entityId }) {
        return this.deviceService.addDevice({
            serverId,
            type: 'switch',
            name,
            entityId,
            metadata: {}
        });
    }

    removeSwitch(deviceId) {
        this.store.removeDevice(deviceId);
    }

    async turnOn(deviceId) {
        const device = this.#requireDevice(deviceId);
        await this.connectionManager.turnSmartSwitchOn(device.serverId, device.entityId);
        return this.store.updateDeviceState(device.id, { lastKnownState: true });
    }

    async turnOff(deviceId) {
        const device = this.#requireDevice(deviceId);
        await this.connectionManager.turnSmartSwitchOff(device.serverId, device.entityId);
        return this.store.updateDeviceState(device.id, { lastKnownState: false });
    }

    async setValueByEntity(serverId, entityId, value) {
        await this.connectionManager.setEntityValue(serverId, entityId, value);
        const device = this.deviceService.findByEntity(serverId, entityId, 'switch');
        if (device) {
            this.store.updateDeviceState(device.id, {
                lastKnownState: Boolean(value)
            });
        }
    }

    async primeExistingSwitches() {
        const state = this.store.getState();

        for (const device of state.devices.filter((item) => item.type === 'switch')) {
            await this.connectionManager.primeEntity(device.serverId, device.entityId);
        }
    }

    #syncDeviceFromEntityEvent({ serverId, entityId, payload }) {
        const state = this.store.getState();
        const device = state.devices.find((item) => item.serverId === serverId && item.entityId === entityId && item.type === 'switch');

        if (!device) {
            return;
        }

        this.store.updateDeviceState(device.id, {
            lastKnownState: Boolean(payload.value)
        });
    }

    #requireDevice(deviceId) {
        const device = this.deviceService.findDevice(deviceId);

        if (device.type !== 'switch') {
            throw new Error(`Unknown smart switch: ${deviceId}`);
        }

        return device;
    }
}

module.exports = SmartSwitchService;