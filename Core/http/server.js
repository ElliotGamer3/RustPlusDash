const http = require('http');
const { getGuiPaths } = require('../gui');
const { readJsonBody, writeJson } = require('./helpers');

const coreRoutes         = require('./routes/coreRoutes');
const serverRoutes       = require('./routes/serverRoutes');
const pairingRoutes      = require('./routes/pairingRoutes');
const deviceRoutes       = require('./routes/deviceRoutes');
const switchRoutes       = require('./routes/switchRoutes');
const groupRoutes        = require('./routes/groupRoutes');
const cameraRoutes       = require('./routes/cameraRoutes');
const requirementRoutes  = require('./routes/requirementRoutes');
const teamRoutes         = require('./routes/teamRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const mapRoutes          = require('./routes/mapRoutes');

const allRouteModules = [
    coreRoutes,
    serverRoutes,
    pairingRoutes,
    deviceRoutes,
    switchRoutes,
    groupRoutes,
    cameraRoutes,
    requirementRoutes,
    teamRoutes,
    notificationRoutes,
    mapRoutes,
];

const exactRoutes  = new Map(allRouteModules.flatMap(m => m.exact));
const dynamicRoutes = allRouteModules.flatMap(m => m.dynamic);

function createHttpServer(application) {
    const { eventBus } = application.getRouterContext();
    const guiPaths = getGuiPaths();
    const sseClients = new Set();
    const ctx = { guiPaths, sseClients };

    function broadcast(eventName, payload) {
        const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const res of sseClients) {
            res.write(packet);
        }
    }

    function broadcastState() {
        broadcast('state', application.getPublicState());
    }

    eventBus.on('state:changed', broadcastState);
    eventBus.on('connection:status', (payload) => {
        broadcast('connection', payload);
        broadcastState();
    });
    eventBus.on('rate-limit:state', broadcastState);
    eventBus.on('notification:visible', (payload) => {
        broadcast('notification', payload);
        broadcastState();
    });
    eventBus.on('storage:group-updated', (payload) => {
        broadcast('storage-group-updated', payload);
        broadcastState();
    });
    eventBus.on('camera:frame', (payload) => {
        broadcast('camera-frame', payload);
    });
    eventBus.on('rotation:updated', (payload) => {
        broadcast('rotation-updated', payload);
        broadcastState();
    });
    eventBus.on('pairing:updated', (payload) => {
        broadcast('pairing-updated', payload);
        broadcastState();
    });
    eventBus.on('pairing:listener-status', (payload) => {
        broadcast('pairing-listener-status', payload);
        broadcastState();
    });

    return http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url, `http://${request.headers.host}`);
            const body = request.method === 'POST' || request.method === 'PATCH'
                ? await readJsonBody(request)
                : null;

            const key = `${request.method} ${url.pathname}`;

            const exactHandler = exactRoutes.get(key);
            if (exactHandler) return exactHandler(request, response, url, body, application, ctx);

            for (const [pattern, handler] of dynamicRoutes) {
                if (pattern.test(key)) return handler(request, response, url, body, application, ctx);
            }

            return writeJson(response, 404, { error: 'Not found' });
        } catch (error) {
            return writeJson(response, 500, { error: error.message });
        }
    });
}

module.exports = createHttpServer;
