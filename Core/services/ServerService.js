class ServerService {
    constructor({ store, eventBus}) {
        this.store = store;
        this.eventBus = eventBus;
    }

    addServer({ name, host, port, playerId, playerToken, isDefault = false }) {
        // Move server stuff here from store
        const server = this.store.addServer({ name, host, port, playerId, playerToken, isDefault});
        this.eventBus.emit('server:added', server);
        return server;
    }

    updateServer(serverId, { name, host, port, playerId, playerToken }) {
        const server = this.store.getServer(serverId);
        if (!server) {
            throw new Error('Server not found');
        }
        const updatedServer = this.store.updateServer(serverId, { name, host, port, playerId, playerToken });
        this.eventBus.emit('server:updated', updatedServer);
        return updatedServer;
    }

    deleteServer(serverId) {
        const server = this.store.getServer(serverId);
        if (!server) {
            throw new Error('Server not found');
        }
        this.store.deleteServer(serverId);
        this.eventBus.emit('server:deleted', serverId);
    }

    exportServer(serverId) {
        const server = this.store.getServer(serverId);
        if (!server) {
            throw new Error('Server not found');
        }
        // Get the server details, sanitized of user specific information like playerId and playerToken
        const exportServer = {
            name: server.name,
            host: server.host,
            port: server.port,
            // Do not include playerId and playerToken in the export for security reasons
        };
        return exportServer;
    }
    
    sanitizedServerInfo(serverId) {
        const server = this.store.getServer(serverId);
        if (!server) {
            throw new Error('Server not found');
        }
        // Return server info without sensitive data like playerId and playerToken
        return {
            id: server.id,
            name: server.name,
            host: server.host,
            port: server.port,
            isDefault: server.isDefault
        };
    }

    setDefaultServer(serverId) {
        const server = this.store.getServer(serverId);
        if (!server) {
            throw new Error('Server not found');
        }
        // Unset previous default server
        const currentDefault = this.store.getDefaultServer();
        if (currentDefault) {
            this.store.updateServer(currentDefault.id, { isDefault: false });
        }
        // Set new default server
        this.store.updateServer(serverId, { isDefault: true });
        this.eventBus.emit('server:defaultChanged', serverId);
    }
}

module.exports = ServerService;