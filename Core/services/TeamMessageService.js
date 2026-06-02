class TeamMessageService {
    constructor({ store, connectionManager }) {
        this.store = store;
        this.connectionManager = connectionManager;
    }

    async sendMessage({ serverId, message }) {
        const targetServerId = serverId || this.store.getActiveServer().id;
        const trimmedMessage = String(message || '').trim();

        if (!trimmedMessage) {
            throw new Error('Team message cannot be empty');
        }

        await this.connectionManager.sendTeamMessage(targetServerId, trimmedMessage);

        return {
            serverId: targetServerId,
            message: trimmedMessage,
            sentAt: new Date().toISOString()
        };
    }
}

module.exports = TeamMessageService;