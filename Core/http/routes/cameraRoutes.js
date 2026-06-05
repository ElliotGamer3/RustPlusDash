const { writeJson } = require('../helpers');

module.exports = {
    exact: [],
    dynamic: [
        [/^POST \/api\/cameras\/[^/]+\/subscribe$/, async (request, response, url, body, application) => {
            const deviceId = url.pathname.split('/').filter(Boolean)[2];
            const result = await application.cameraTurretService.subscribeDevice(deviceId);
            return writeJson(response, 200, result);
        }],
        [/^POST \/api\/cameras\/[^/]+\/control$/, async (request, response, url, body, application) => {
            const deviceId = url.pathname.split('/').filter(Boolean)[2];
            const result = await application.cameraTurretService.controlDevice(deviceId, body.command, body.payload || {});
            return writeJson(response, 200, result);
        }],
    ]
};
