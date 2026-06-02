class GroupService {
    constructor({ store, smartSwitchService, deviceService }) {
        this.store = store;
        this.smartSwitchService = smartSwitchService;
        this.deviceService = deviceService;
    }

    addSwitchGroup({ serverId, name, deviceIds }) {
        return this.addGroup({
            serverId,
            type: 'switch-group',
            name,
            deviceIds,
            config: {
                rotation: null
            }
        });
    }

    addGroup({ serverId, type, name, deviceIds = [], config = {} }) {
        const targetServerId = serverId || this.store.getActiveServer().id;
        return this.store.addGroup({
            type,
            serverId: targetServerId,
            name,
            deviceIds,
            config
        });
    }

    async turnGroupOn(groupId) {
        const group = this.#requireGroup(groupId);

        if (group.type !== 'switch-group') {
            throw new Error(`Group ${groupId} does not support switch actions`);
        }

        for (const deviceId of group.deviceIds) {
            await this.smartSwitchService.turnOn(deviceId);
        }

        return group;
    }

    async turnGroupOff(groupId) {
        const group = this.#requireGroup(groupId);

        if (group.type !== 'switch-group') {
            throw new Error(`Group ${groupId} does not support switch actions`);
        }

        for (const deviceId of group.deviceIds) {
            await this.smartSwitchService.turnOff(deviceId);
        }

        return group;
    }

    setRotationConfig(groupId, rotationConfig) {
        const group = this.#requireGroup(groupId);
        return this.store.updateGroup(group.id, {
            config: {
                ...(group.config || {}),
                rotation: {
                    enabled: Boolean(rotationConfig.enabled),
                    intervalMs: Number(rotationConfig.intervalMs) || 5000,
                    paused: Boolean(rotationConfig.paused),
                    activeDeviceId: rotationConfig.activeDeviceId || group.deviceIds[0] || null,
                    pausedByUser: Boolean(rotationConfig.pausedByUser)
                }
            }
        });
    }

    setAlarmConsolidation(groupId, consolidation) {
        const group = this.#requireGroup(groupId);

        if (group.type !== 'alarm-group') {
            throw new Error(`Group ${groupId} is not an alarm group`);
        }

        return this.store.updateGroup(group.id, {
            config: {
                ...(group.config || {}),
                consolidation: {
                    enabled: consolidation.enabled !== false,
                    windowMs: Number(consolidation.windowMs) || 2000,
                    excludedDeviceIds: Array.from(new Set(consolidation.excludedDeviceIds || []))
                }
            }
        });
    }

    setStorageDefinitions(groupId, definitionConfig) {
        const group = this.#requireGroup(groupId);

        if (group.type !== 'storage-group') {
            throw new Error(`Group ${groupId} is not a storage group`);
        }

        return this.store.updateGroup(group.id, {
            config: {
                ...(group.config || {}),
                subtotals: definitionConfig.subtotals || [],
                deltaTracking: definitionConfig.deltaTracking || {
                    enabled: false,
                    includeItems: [],
                    includeCategories: []
                }
            }
        });
    }

    removeGroup(groupId) {
        this.store.removeGroup(groupId);
    }

    getSummaries() {
        const state = this.store.getState();

        return state.groups.map((group) => {
            const devices = state.devices.filter((device) => group.deviceIds.includes(device.id));
            const onCount = devices.filter((device) => device.lastKnownState === true).length;
            const offCount = devices.filter((device) => device.lastKnownState === false).length;
            const unknownCount = devices.length - onCount - offCount;

            return {
                ...group,
                deviceCount: devices.length,
                onCount,
                offCount,
                unknownCount,
                devices
            };
        });
    }

    getGroup(groupId) {
        return this.#requireGroup(groupId);
    }

    #requireGroup(groupId) {
        const state = this.store.getState();
        const group = state.groups.find((item) => item.id === groupId);

        if (!group) {
            throw new Error(`Unknown group: ${groupId}`);
        }

        return group;
    }
}

module.exports = GroupService;