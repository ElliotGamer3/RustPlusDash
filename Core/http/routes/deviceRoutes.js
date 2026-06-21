const { writeJson, writeLog } = require('../helpers');

module.exports = {
    exact: [
        [`POST /api/devices/export`, async (request, response, url, body, application) => {
            const devices = await application.deviceService.getDevices();
            let normalizedDevices = [];
            if (!devices) {
                return writeJson(response, 500, { error: 'Failed to retrieve devices' });
            }
            if (!Array.isArray(devices)) {
                for (const key in devices) {
                    if (devices.hasOwnProperty(key)) {
                        normalizedDevices.push(devices[key]);
                    }
                }
            } else {
                normalizedDevices = devices;
            }
            writeLog('info','[deviceRoutes]','Devices to export: ' + JSON.stringify(devices));
            writeLog('info','[deviceRoutes]','Normalized devices: ' + JSON.stringify(normalizedDevices));
            let exportData = { "devices": normalizedDevices };
            // Filter based on serverId
            const serverId = body.serverId;
            const types = body.types;
            if (serverId) {
                exportData.devices = exportData.devices.filter(d => d.serverId === serverId);
            }
            if (types && Array.isArray(types)) {
                // Filter devices by type if types array is provided and make the result an array of devices with only the specified types
                exportData.devices = exportData.devices.filter(d => types.includes(d.type)).map(d => {
                    const filteredDevice = { id: d.id, name: d.name, type: d.type };
                    if (d.serverId) {
                        filteredDevice.serverId = d.serverId;
                    }
                    return filteredDevice;
                });
            }
            // Export the devices in an array under the "devices" key, along with a timestamp and serverId
            exportData = {
                server: application.serverService.sanitizedServerInfo(serverId),
                exportedAt: new Date().toISOString(),
                devices: exportData.devices
            };
            writeLog('info','[deviceRoutes]','Exporting devices: ' + JSON.stringify(exportData));
            return writeJson(response, 200, exportData);
        }],

        [`POST /api/devices/import`, async (request, response, url, body, application) => {
            const devices = body.devices;
            const serverObject = body.server;
            // Check if server with same ip already exists, if so use that server's id for the imported devices, otherwise create a new server and use its id
            let serverId = null;
            if (serverObject && serverObject.ip) {
                const existingServer = application.store.getServers().find(s => s.ip === serverObject.ip);
                if (existingServer) {
                    serverId = existingServer.id;
                } else {
                    const newServer = application.store.addServer({
                        name: serverObject.name || `Imported Server ${Date.now()}`,
                        ip: serverObject.ip,
                        port: serverObject.port || 8080,
                        token: serverObject.token || null
                    });
                    serverId = newServer.id;
                }
            }
            const exportedServerId = body.serverId;
            if (!devices || !Array.isArray(devices)) {
                return writeJson(response, 400, { error: 'devices array is required' });
            }
            const importedDevices = [];
            for (const deviceData of devices) {
                const device = await application.deviceService.addDevice(deviceData);
                importedDevices.push(device);
            }
            writeLog('info','[deviceRoutes]','Imported devices: ' + JSON.stringify(importedDevices));
            // add/update the server with devices
            if (serverId) {
                const server = application.store.getServer(serverId);
                if (server) {
                    server.devices = server.devices || [];
                    for (const device of importedDevices) {
                        if (!server.devices.includes(device.id)) {
                            server.devices.push(device.id);
                        }
                    }
                    application.store.updateServer(serverId, server);
                }
            }
            return writeJson(response, 200, { importedDevices });
        }],
        ['GET /api/devices', (request, response, url, body, application) => {
            const devices = application.deviceService.getDevices();
            // If a serverId is provided, filter devices by that serverId
            if (url.searchParams.has('serverId')) {
                const serverId = url.searchParams.get('serverId');
                return writeJson(response, 200, devices.filter(d => d.serverId === serverId));
            }
            return writeJson(response, 200, devices);
        }],
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
