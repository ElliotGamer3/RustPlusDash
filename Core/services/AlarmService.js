class AlarmService {
    constructor({ store, eventBus, deviceService, groupService, notificationService }) {
        this.store = store;
        this.eventBus = eventBus;
        this.deviceService = deviceService;
        this.groupService = groupService;
        this.notificationService = notificationService;
        this.pendingConsolidations = new Map();

        this.eventBus.on('rust:entityChanged', (event) => {
            this.#onEntityChanged(event);
        });
    }

    async addAlarmDevice(payload) {
        return this.deviceService.addDevice({
            ...payload,
            type: 'alarm'
        });
    }

    configureGroup(groupId, config) {
        return this.groupService.setAlarmConsolidation(groupId, config);
    }

    #onEntityChanged({ serverId, entityId, payload }) {
        const alarm = this.deviceService.findByEntity(serverId, entityId, 'alarm');

        if (!alarm) {
            return;
        }

        const triggered = Boolean(payload.value);
        this.store.updateDevice(alarm.id, {
            lastKnownState: triggered,
            lastPayload: payload
        });

        if (!triggered) {
            return;
        }

        const groups = this.store.getGroups(serverId).filter((group) => {
            return group.type === 'alarm-group' && group.deviceIds.includes(alarm.id);
        });

        if (groups.length === 0) {
            this.notificationService.notify({
                category: 'alarm',
                serverId,
                deviceId: alarm.id,
                message: `Alarm triggered: ${alarm.name}`
            });
            return;
        }

        for (const group of groups) {
            this.#processGroupedAlarm(group, alarm);
        }
    }

    #processGroupedAlarm(group, alarm) {
        const consolidation = group.config?.consolidation || {
            enabled: true,
            windowMs: 2000,
            excludedDeviceIds: []
        };

        this.notificationService.log({
            category: 'alarm',
            visible: false,
            serverId: group.serverId,
            groupId: group.id,
            deviceId: alarm.id,
            message: `Alarm event logged: ${alarm.name}`
        });

        const isExcluded = consolidation.excludedDeviceIds.includes(alarm.id);

        if (!consolidation.enabled || isExcluded) {
            this.notificationService.notify({
                category: 'alarm',
                serverId: group.serverId,
                groupId: group.id,
                deviceId: alarm.id,
                message: `Alarm triggered: ${alarm.name}`
            });
            return;
        }

        const existing = this.pendingConsolidations.get(group.id);

        if (!existing) {
            const windowMs = Math.max(200, Number(consolidation.windowMs) || 2000);
            const record = {
                devices: [alarm],
                timerId: null
            };
            record.timerId = setTimeout(() => {
                this.#flushConsolidation(group.id);
            }, windowMs);
            this.pendingConsolidations.set(group.id, record);
            return;
        }

        existing.devices.push(alarm);
    }

    #flushConsolidation(groupId) {
        const pending = this.pendingConsolidations.get(groupId);

        if (!pending) {
            return;
        }

        this.pendingConsolidations.delete(groupId);
        clearTimeout(pending.timerId);
        const uniqueNames = Array.from(new Set(pending.devices.map((item) => item.name)));

        this.notificationService.notify({
            category: 'alarm',
            groupId,
            message: `Consolidated alarms: ${uniqueNames.join(', ')}`,
            details: {
                deviceCount: pending.devices.length,
                devices: pending.devices.map((item) => item.id)
            }
        });
    }
}

module.exports = AlarmService;
