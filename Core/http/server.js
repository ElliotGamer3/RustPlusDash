const fs = require('fs');
const http = require('http');
const path = require('path');
const { getGuiPaths } = require('../gui');

function createHttpServer(application) {
    const { eventBus } = application.getRouterContext();
    const guiPaths = getGuiPaths();
    const sseClients = new Set();

    function broadcast(eventName, payload) {
        const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const response of sseClients) {
            response.write(packet);
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

            if (request.method === 'GET' && url.pathname === '/') {
                return serveFile(response, guiPaths.indexFile, 'text/html; charset=utf-8');
            }

            if (request.method === 'GET' && url.pathname === '/app.js') {
                return serveFile(response, guiPaths.appFile, 'application/javascript; charset=utf-8');
            }

            if (request.method === 'GET' && url.pathname === '/api/state') {
                return writeJson(response, 200, application.getPublicState());
            }

            if (request.method === 'GET' && url.pathname === '/api/events') {
                response.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive'
                });
                response.write(`event: state\ndata: ${JSON.stringify(application.getPublicState())}\n\n`);
                sseClients.add(response);
                request.on('close', () => sseClients.delete(response));
                return;
            }

            if (request.method === 'POST' && url.pathname === '/api/servers') {
                const server = application.store.addServer(body);
                return writeJson(response, 201, server);
            }

            if (request.method === 'POST' && url.pathname === '/api/servers/active') {
                application.store.setActiveServer(body.serverId);
                await application.connectionManager.ensureServerConnection(body.serverId);
                return writeJson(response, 200, application.getPublicState());
            }

            if (request.method === 'POST' && url.pathname === '/api/servers/default') {
                application.store.setDefaultServer(body.serverId);
                return writeJson(response, 200, application.getPublicState());
            }

            if (request.method === 'DELETE' && /^\/api\/servers\/[^/]+$/.test(url.pathname)) {
                const serverId = url.pathname.split('/').filter(Boolean)[2];
                application.store.removeServer(serverId);
                return writeJson(response, 204, null);
            }

            if (request.method === 'POST' && url.pathname === '/api/settings/user-default-server') {
                const preference = application.store.upsertUserPreference(body);
                return writeJson(response, 200, preference);
            }

            if (request.method === 'POST' && url.pathname === '/api/pairing/import-config') {
                const session = application.pairingService.importRustPlusConfig(body.configPath || path.join(process.cwd(), 'rustplus.config.json'));
                return writeJson(response, 201, session);
            }

            if (request.method === 'POST' && url.pathname === '/api/pairing/server') {
                const result = application.pairingService.pairServerManual(body);
                return writeJson(response, 201, result);
            }

            if (request.method === 'POST' && url.pathname === '/api/pairing/device') {
                const result = await application.pairingService.pairDeviceManual(body);
                return writeJson(response, 201, result);
            }

            if (request.method === 'GET' && url.pathname === '/api/pairing/listener/status') {
                return writeJson(response, 200, application.pairingListenerService.getStatus());
            }

            if (request.method === 'POST' && url.pathname === '/api/pairing/listener/start') {
                const result = await application.pairingListenerService.start({
                    configPath: body.configPath,
                    autoPair: body.autoPair
                });
                return writeJson(response, 200, result);
            }

            if (request.method === 'POST' && url.pathname === '/api/pairing/listener/stop') {
                const result = await application.pairingListenerService.stop();
                return writeJson(response, 200, result);
            }

            if (request.method === 'POST' && url.pathname === '/api/pairing/listener/ingest') {
                const payload = body.payload && typeof body.payload === 'object'
                    ? body.payload
                    : body;
                const result = await application.pairingListenerService.ingestPayload(payload, {
                    autoPair: body.autoPair
                });
                return writeJson(response, 201, result);
            }

            if (request.method === 'POST' && url.pathname === '/api/devices') {
                const device = await application.deviceService.addDevice(body);
                return writeJson(response, 201, device);
            }

            if (request.method === 'PATCH' && /^\/api\/devices\/[^/]+$/.test(url.pathname)) {
                const deviceId = url.pathname.split('/').filter(Boolean)[2];
                const device = application.deviceService.updateDevice(deviceId, body);
                return writeJson(response, 200, device);
            }

            if (request.method === 'DELETE' && /^\/api\/devices\/[^/]+$/.test(url.pathname)) {
                const deviceId = url.pathname.split('/').filter(Boolean)[2];
                application.deviceService.removeDevice(deviceId);
                return writeJson(response, 204, null);
            }

            if (request.method === 'POST' && url.pathname === '/api/switches') {
                const device = await application.smartSwitchService.addSwitch(body);
                return writeJson(response, 201, device);
            }

            if (request.method === 'POST' && /^\/api\/switches\/[^/]+\/(on|off)$/.test(url.pathname)) {
                const segments = url.pathname.split('/').filter(Boolean);
                const deviceId = segments[2];
                const action = segments[3];
                const device = action === 'on'
                    ? await application.smartSwitchService.turnOn(deviceId)
                    : await application.smartSwitchService.turnOff(deviceId);
                return writeJson(response, 200, device);
            }

            if (request.method === 'DELETE' && /^\/api\/switches\/[^/]+$/.test(url.pathname)) {
                const deviceId = url.pathname.split('/').filter(Boolean)[2];
                application.smartSwitchService.removeSwitch(deviceId);
                return writeJson(response, 204, null);
            }

            if (request.method === 'POST' && url.pathname === '/api/groups') {
                const group = application.groupService.addGroup(body);
                return writeJson(response, 201, group);
            }

            if (request.method === 'POST' && url.pathname === '/api/groups/switches') {
                const group = application.groupService.addSwitchGroup(body);
                return writeJson(response, 201, group);
            }

            if (request.method === 'PATCH' && /^\/api\/groups\/[^/]+$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const group = application.store.updateGroup(groupId, body);
                return writeJson(response, 200, group);
            }

            if (request.method === 'DELETE' && /^\/api\/groups\/[^/]+$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                application.groupService.removeGroup(groupId);
                return writeJson(response, 204, null);
            }

            if (request.method === 'POST' && /^\/api\/groups\/[^/]+\/(on|off)$/.test(url.pathname)) {
                const segments = url.pathname.split('/').filter(Boolean);
                const groupId = segments[2];
                const action = segments[3];
                const group = action === 'on'
                    ? await application.groupService.turnGroupOn(groupId)
                    : await application.groupService.turnGroupOff(groupId);
                return writeJson(response, 200, group);
            }

            if (request.method === 'POST' && /^\/api\/groups\/[^/]+\/rotation\/start$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const group = application.cameraTurretService.startRotation(groupId, body.intervalMs);
                return writeJson(response, 200, group);
            }

            if (request.method === 'POST' && /^\/api\/groups\/[^/]+\/rotation\/pause$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const group = application.cameraTurretService.pauseRotation(groupId, true);
                return writeJson(response, 200, group);
            }

            if (request.method === 'POST' && /^\/api\/groups\/[^/]+\/rotation\/resume$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const group = application.cameraTurretService.resumeRotation(groupId);
                return writeJson(response, 200, group);
            }

            if (request.method === 'POST' && /^\/api\/groups\/[^/]+\/rotation\/select$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const group = application.cameraTurretService.manualSelect(groupId, body.deviceId);
                return writeJson(response, 200, group);
            }

            if (request.method === 'GET' && /^\/api\/groups\/[^/]+\/view$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                return writeJson(response, 200, application.cameraTurretService.getCurrentView(groupId));
            }

            if (request.method === 'POST' && /^\/api\/groups\/[^/]+\/alarm-consolidation$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const group = application.alarmService.configureGroup(groupId, body);
                return writeJson(response, 200, group);
            }

            if (request.method === 'POST' && /^\/api\/groups\/[^/]+\/storage\/subtotals$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const group = application.storageMonitorService.defineSubtotals(groupId, body.subtotals || []);
                return writeJson(response, 200, group);
            }

            if (request.method === 'POST' && /^\/api\/groups\/[^/]+\/storage\/delta$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const group = application.storageMonitorService.setDeltaTracking(groupId, body);
                return writeJson(response, 200, group);
            }

            if (request.method === 'GET' && /^\/api\/groups\/[^/]+\/storage\/metrics$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                return writeJson(response, 200, application.storageMonitorService.getGroupMetrics(groupId));
            }

            if (request.method === 'GET' && /^\/api\/groups\/[^/]+\/storage\/graph$/.test(url.pathname)) {
                const groupId = url.pathname.split('/').filter(Boolean)[2];
                const item = url.searchParams.get('item');
                const minutes = url.searchParams.get('minutes');
                return writeJson(response, 200, application.storageMonitorService.getGraphData(groupId, item, minutes));
            }

            if (request.method === 'POST' && /^\/api\/cameras\/[^/]+\/subscribe$/.test(url.pathname)) {
                const deviceId = url.pathname.split('/').filter(Boolean)[2];
                const result = await application.cameraTurretService.subscribeDevice(deviceId);
                return writeJson(response, 200, result);
            }

            if (request.method === 'POST' && /^\/api\/cameras\/[^/]+\/control$/.test(url.pathname)) {
                const deviceId = url.pathname.split('/').filter(Boolean)[2];
                const result = await application.cameraTurretService.controlDevice(deviceId, body.command, body.payload || {});
                return writeJson(response, 200, result);
            }

            if (request.method === 'POST' && url.pathname === '/api/requirements') {
                const requirement = application.requirementService.addRequirement(body);
                return writeJson(response, 201, requirement);
            }

            if (request.method === 'PATCH' && /^\/api\/requirements\/[^/]+$/.test(url.pathname)) {
                const requirementId = url.pathname.split('/').filter(Boolean)[2];
                const requirement = application.requirementService.updateRequirement(requirementId, body);
                return writeJson(response, 200, requirement);
            }

            if (request.method === 'DELETE' && /^\/api\/requirements\/[^/]+$/.test(url.pathname)) {
                const requirementId = url.pathname.split('/').filter(Boolean)[2];
                application.requirementService.removeRequirement(requirementId);
                return writeJson(response, 204, null);
            }

            if (request.method === 'POST' && /^\/api\/requirements\/[^/]+\/estimate$/.test(url.pathname)) {
                const requirementId = url.pathname.split('/').filter(Boolean)[2];
                const estimate = application.requirementService.estimateRequirement(requirementId, body.mode || 'rolling');
                return writeJson(response, 200, estimate);
            }

            if (request.method === 'POST' && url.pathname === '/api/team/messages') {
                const result = await application.teamMessageService.sendMessage(body);
                return writeJson(response, 201, result);
            }

            if (request.method === 'GET' && url.pathname === '/api/notifications') {
                return writeJson(response, 200, application.notificationService.getRecent(Number(url.searchParams.get('limit') || 200)));
            }

            if (request.method === 'GET' && url.pathname === '/health') {
                return writeJson(response, 200, { ok: true });
            }

            return writeJson(response, 404, { error: 'Not found' });
        } catch (error) {
            return writeJson(response, 500, { error: error.message });
        }
    });
}

function serveFile(response, filePath, contentType) {
    const contents = fs.readFileSync(filePath, 'utf8');
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(contents);
}

function writeJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(payload === null ? '' : JSON.stringify(payload));
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let rawBody = '';

        request.on('data', (chunk) => {
            rawBody += chunk;
        });

        request.on('end', () => {
            if (!rawBody) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(rawBody));
            } catch (error) {
                reject(new Error('Invalid JSON request body'));
            }
        });

        request.on('error', reject);
    });
}

module.exports = createHttpServer;
