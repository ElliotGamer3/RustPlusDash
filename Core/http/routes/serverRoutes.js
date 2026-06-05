const { writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['POST /api/servers', (request, response, url, body, application) => {
            const server = application.store.addServer(body);
            return writeJson(response, 201, server);
        }],
        ['POST /api/servers/active', async (request, response, url, body, application) => {
            application.store.setActiveServer(body.serverId);
            await application.connectionManager.ensureServerConnection(body.serverId);
            return writeJson(response, 200, application.getPublicState());
        }],
        ['POST /api/servers/default', (request, response, url, body, application) => {
            application.store.setDefaultServer(body.serverId);
            return writeJson(response, 200, application.getPublicState());
        }],
        ['POST /api/settings/user-default-server', (request, response, url, body, application) => {
            const preference = application.store.upsertUserPreference(body);
            return writeJson(response, 200, preference);
        }],
    ],
    dynamic: [
        [/^DELETE \/api\/servers\/[^/]+$/, (request, response, url, body, application) => {
            const serverId = url.pathname.split('/').filter(Boolean)[2];
            application.store.removeServer(serverId);
            return writeJson(response, 204, null);
        }],
        [/^DELETE \/api\/servers\/[^/]+\/devices$/, async (request, response, url, body, application) => {
            const serverId = url.pathname.split('/').filter(Boolean)[2];
            const removed = await application.deviceService.clearDevicesForServer(serverId);
            return writeJson(response, 200, { removed });
        }],
        [/^POST \/api\/servers\/[^/]+\/check-connection$/, async (request, response, url, body, application) => {
            const serverId = url.pathname.split('/').filter(Boolean)[2];
            const result = await application.connectionManager.checkServerConnection(serverId);
            return writeJson(response, 200, result);
        }],
    ]
};
