class StorageMonitorService {
    constructor({ store, eventBus, deviceService, groupService, notificationService }) {
        this.store = store;
        this.eventBus = eventBus;
        this.deviceService = deviceService;
        this.groupService = groupService;
        this.notificationService = notificationService;

        this.eventBus.on('rust:entityChanged', (event) => {
            this.#onEntityChanged(event);
        });
    }

    async addStorageMonitor(payload) {
        return this.deviceService.addDevice({
            ...payload,
            type: 'storage-monitor'
        });
    }

    defineSubtotals(groupId, subtotals) {
        const group = this.groupService.getGroup(groupId);

        if (group.type !== 'storage-group') {
            throw new Error(`Group ${groupId} is not a storage group`);
        }

        return this.groupService.setStorageDefinitions(groupId, {
            ...(group.config || {}),
            subtotals
        });
    }

    setDeltaTracking(groupId, deltaTracking) {
        const group = this.groupService.getGroup(groupId);

        if (group.type !== 'storage-group') {
            throw new Error(`Group ${groupId} is not a storage group`);
        }

        return this.groupService.setStorageDefinitions(groupId, {
            ...(group.config || {}),
            subtotals: group.config?.subtotals || [],
            deltaTracking: {
                enabled: Boolean(deltaTracking.enabled),
                includeItems: deltaTracking.includeItems || [],
                includeCategories: deltaTracking.includeCategories || []
            }
        });
    }

    getGroupMetrics(groupId) {
        const group = this.groupService.getGroup(groupId);

        if (group.type !== 'storage-group') {
            throw new Error(`Group ${groupId} is not a storage group`);
        }

        const devices = group.deviceIds.map((deviceId) => this.deviceService.findDevice(deviceId));
        const grandTotal = this.#calculateTotal(devices, {
            excludedDeviceIds: [],
            excludedItems: [],
            excludedCategories: [],
            includedItems: [],
            includedCategories: []
        });

        const subtotals = (group.config?.subtotals || []).map((definition) => {
            const subtotalTotal = this.#calculateTotal(devices, definition);
            return {
                id: definition.id,
                name: definition.name,
                definition,
                total: subtotalTotal
            };
        });

        const itemHistory = this.#buildItemHistory(group.deviceIds);

        return {
            groupId,
            grandTotal,
            subtotals,
            history: itemHistory
        };
    }

    getGraphData(groupId, itemName, minutes = 60) {
        const group = this.groupService.getGroup(groupId);

        if (group.type !== 'storage-group') {
            throw new Error(`Group ${groupId} is not a storage group`);
        }

        const cutoff = Date.now() - (Math.max(1, Number(minutes) || 60) * 60 * 1000);
        const points = [];

        for (const deviceId of group.deviceIds) {
            const history = this.store.getStorageHistory(deviceId)
                .filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);

            for (const entry of history) {
                const matched = (entry.items || []).find((item) => this.#normalizeItemName(item.itemId) === this.#normalizeItemName(itemName));
                points.push({
                    timestamp: entry.timestamp,
                    value: matched ? Number(matched.quantity) : 0,
                    deviceId
                });
            }
        }

        points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return {
            groupId,
            itemName,
            points
        };
    }

    #onEntityChanged({ serverId, entityId, payload }) {
        const monitor = this.deviceService.findByEntity(serverId, entityId, 'storage-monitor');

        if (!monitor) {
            return;
        }

        const items = Array.isArray(payload.items) ? payload.items : [];
        const normalizedItems = items.map((item) => ({
            itemId: this.#normalizeItemName(item.itemId || item.name || item.shortName || 'unknown'),
            quantity: Number(item.quantity) || 0,
            category: this.#categorizeItem(item.itemId || item.name || item.shortName || 'unknown')
        }));

        const snapshot = {
            timestamp: new Date().toISOString(),
            capacity: Number(payload.capacity) || 0,
            items: normalizedItems
        };

        this.store.updateDevice(monitor.id, {
            lastKnownState: Boolean(payload.value),
            lastPayload: {
                capacity: snapshot.capacity,
                items: snapshot.items
            },
            metadata: {
                ...(monitor.metadata || {}),
                lastStorageSnapshotAt: snapshot.timestamp
            }
        });

        if (normalizedItems.length > 0) {
            this.store.appendStorageHistory(monitor.id, snapshot);
        }

        this.eventBus.emit('storage:updated', {
            serverId,
            deviceId: monitor.id,
            entityId,
            snapshot
        });

        const relevantGroups = this.store.getGroups(serverId).filter((group) => {
            return group.type === 'storage-group' && group.deviceIds.includes(monitor.id);
        });

        for (const group of relevantGroups) {
            const metrics = this.getGroupMetrics(group.id);
            this.eventBus.emit('storage:group-updated', {
                groupId: group.id,
                metrics
            });
        }
    }

    #calculateTotal(devices, definition) {
        const excludedDeviceIds = new Set(definition.excludedDeviceIds || []);
        const includedItems = new Set((definition.includedItems || []).map((item) => this.#normalizeItemName(item)));
        const excludedItems = new Set((definition.excludedItems || []).map((item) => this.#normalizeItemName(item)));
        const includedCategories = new Set((definition.includedCategories || []).map((item) => String(item).toLowerCase()));
        const excludedCategories = new Set((definition.excludedCategories || []).map((item) => String(item).toLowerCase()));

        const totals = {};

        for (const device of devices) {
            if (excludedDeviceIds.has(device.id)) {
                continue;
            }

            const items = device.lastPayload?.items || [];

            for (const item of items) {
                const itemId = this.#normalizeItemName(item.itemId);
                const category = this.#categorizeItem(itemId);

                if (includedItems.size > 0 && !includedItems.has(itemId)) {
                    continue;
                }

                if (excludedItems.has(itemId)) {
                    continue;
                }

                if (includedCategories.size > 0 && !includedCategories.has(category)) {
                    continue;
                }

                if (excludedCategories.has(category)) {
                    continue;
                }

                if (!totals[itemId]) {
                    totals[itemId] = {
                        itemId,
                        category,
                        quantity: 0,
                        delta: 0
                    };
                }

                totals[itemId].quantity += Number(item.quantity) || 0;
            }
        }

        return Object.values(totals).sort((a, b) => b.quantity - a.quantity);
    }

    #buildItemHistory(deviceIds) {
        const merged = {};

        for (const deviceId of deviceIds) {
            const history = this.store.getStorageHistory(deviceId);
            for (const entry of history) {
                for (const item of entry.items || []) {
                    const key = this.#normalizeItemName(item.itemId);
                    if (!merged[key]) {
                        merged[key] = [];
                    }
                    merged[key].push({
                        timestamp: entry.timestamp,
                        quantity: Number(item.quantity) || 0
                    });
                }
            }
        }

        const result = {};

        for (const [itemId, points] of Object.entries(merged)) {
            points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            const latest = points[points.length - 1];
            const previous = points[points.length - 2] || { quantity: latest.quantity };

            result[itemId] = {
                delta: latest.quantity - previous.quantity,
                points
            };
        }

        return result;
    }

    #normalizeItemName(name) {
        return String(name || 'unknown').trim().toLowerCase();
    }

    #categorizeItem(itemName) {
        const value = this.#normalizeItemName(itemName);

        if (value.includes('ore') || value.includes('metal') || value.includes('sulfur') || value.includes('stone')) {
            return 'resources';
        }

        if (value.includes('ammo') || value.includes('gun') || value.includes('rocket')) {
            return 'weapons';
        }

        if (value.includes('food') || value.includes('berry') || value.includes('meat') || value.includes('water')) {
            return 'consumables';
        }

        if (value.includes('wood') || value.includes('cloth') || value.includes('rope')) {
            return 'materials';
        }

        return 'other';
    }
}

module.exports = StorageMonitorService;
