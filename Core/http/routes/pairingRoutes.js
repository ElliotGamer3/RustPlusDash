const path = require('path');
const { writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['POST /api/pairing/import-config', (request, response, url, body, application) => {
            const session = application.pairingService.importRustPlusConfig(body.configPath || path.join(process.cwd(), 'rustplus.config.json'));
            return writeJson(response, 201, session);
        }],
        ['POST /api/pairing/server', (request, response, url, body, application) => {
            const result = application.pairingService.pairServerManual(body);
            return writeJson(response, 201, result);
        }],
        ['POST /api/pairing/device', async (request, response, url, body, application) => {
            const result = await application.pairingService.pairDeviceManual(body);
            return writeJson(response, 201, result);
        }],
        ['GET /api/pairing/listener/status', (request, response, url, body, application) => {
            return writeJson(response, 200, application.pairingListenerService.getStatus());
        }],
        ['POST /api/pairing/listener/start', async (request, response, url, body, application) => {
            const result = await application.pairingListenerService.start({
                configPath: body.configPath,
                autoPair: body.autoPair
            });
            return writeJson(response, 200, result);
        }],
        ['POST /api/pairing/listener/stop', async (request, response, url, body, application) => {
            const result = await application.pairingListenerService.stop();
            return writeJson(response, 200, result);
        }],
        ['POST /api/pairing/listener/ingest', async (request, response, url, body, application) => {
            const payload = body.payload && typeof body.payload === 'object'
                ? body.payload
                : body;
            const result = await application.pairingListenerService.ingestPayload(payload, {
                autoPair: body.autoPair
            });
            return writeJson(response, 201, result);
        }],
    ],
    dynamic: []
};
