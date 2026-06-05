const { writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['POST /api/devices', async (request, response, url, body, application) => {
            const device = await application.deviceService.addDevice(body);
            return writeJson(response, 201, device);
        }],
    ],
    dynamic: [
        [/^PATCH \/api\/devices\/[^/]+$/, (request, response, url, body, application) => {
            const deviceId = url.pathname.split('/').filter(Boolean)[2];
            const device = application.deviceService.updateDevice(deviceId, body);
            return writeJson(response, 200, device);
        }],
        [/^DELETE \/api\/devices\/[^/]+$/, (request, response, url, body, application) => {
            const deviceId = url.pathname.split('/').filter(Boolean)[2];
            application.deviceService.removeDevice(deviceId);
            return writeJson(response, 204, null);
        }],
    ]
};
