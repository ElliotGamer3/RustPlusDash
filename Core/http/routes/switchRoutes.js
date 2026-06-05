const { writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['POST /api/switches', async (request, response, url, body, application) => {
            const device = await application.smartSwitchService.addSwitch(body);
            return writeJson(response, 201, device);
        }],
    ],
    dynamic: [
        [/^POST \/api\/switches\/[^/]+\/(on|off)$/, async (request, response, url, body, application) => {
            const segments = url.pathname.split('/').filter(Boolean);
            const deviceId = segments[2];
            const action = segments[3];
            const device = action === 'on'
                ? await application.smartSwitchService.turnOn(deviceId)
                : await application.smartSwitchService.turnOff(deviceId);
            return writeJson(response, 200, device);
        }],
        [/^DELETE \/api\/switches\/[^/]+$/, (request, response, url, body, application) => {
            const deviceId = url.pathname.split('/').filter(Boolean)[2];
            application.smartSwitchService.removeSwitch(deviceId);
            return writeJson(response, 204, null);
        }],
    ]
};
