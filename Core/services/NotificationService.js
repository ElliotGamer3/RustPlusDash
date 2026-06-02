class NotificationService {
    constructor({ store, eventBus }) {
        this.store = store;
        this.eventBus = eventBus;
    }

    log(record) {
        const entry = this.store.addNotification(record);
        this.eventBus.emit('notification:logged', entry);
        return entry;
    }

    notify(record) {
        const entry = this.log({
            ...record,
            visible: record.visible !== false
        });

        if (entry.visible) {
            this.eventBus.emit('notification:visible', entry);
        }

        return entry;
    }

    getRecent(limit = 200) {
        const state = this.store.getState();
        return state.notifications.slice(-Math.max(1, Number(limit) || 200));
    }
}

module.exports = NotificationService;
