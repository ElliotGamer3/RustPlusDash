const { writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['POST /api/groups', (request, response, url, body, application) => {
            const group = application.groupService.addGroup(body);
            return writeJson(response, 201, group);
        }],
        ['POST /api/groups/switches', (request, response, url, body, application) => {
            const group = application.groupService.addSwitchGroup(body);
            return writeJson(response, 201, group);
        }],
    ],
    dynamic: [
        [/^PATCH \/api\/groups\/[^/]+$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const group = application.store.updateGroup(groupId, body);
            return writeJson(response, 200, group);
        }],
        [/^DELETE \/api\/groups\/[^/]+$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            application.groupService.removeGroup(groupId);
            return writeJson(response, 204, null);
        }],
        [/^POST \/api\/groups\/[^/]+\/(on|off)$/, async (request, response, url, body, application) => {
            const segments = url.pathname.split('/').filter(Boolean);
            const groupId = segments[2];
            const action = segments[3];
            const group = action === 'on'
                ? await application.groupService.turnGroupOn(groupId)
                : await application.groupService.turnGroupOff(groupId);
            return writeJson(response, 200, group);
        }],
        [/^POST \/api\/groups\/[^/]+\/rotation\/start$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const group = application.cameraTurretService.startRotation(groupId, body.intervalMs);
            return writeJson(response, 200, group);
        }],
        [/^POST \/api\/groups\/[^/]+\/rotation\/pause$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const group = application.cameraTurretService.pauseRotation(groupId, true);
            return writeJson(response, 200, group);
        }],
        [/^POST \/api\/groups\/[^/]+\/rotation\/resume$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const group = application.cameraTurretService.resumeRotation(groupId);
            return writeJson(response, 200, group);
        }],
        [/^POST \/api\/groups\/[^/]+\/rotation\/select$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const group = application.cameraTurretService.manualSelect(groupId, body.deviceId);
            return writeJson(response, 200, group);
        }],
        [/^GET \/api\/groups\/[^/]+\/view$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            return writeJson(response, 200, application.cameraTurretService.getCurrentView(groupId));
        }],
        [/^POST \/api\/groups\/[^/]+\/alarm-consolidation$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const group = application.alarmService.configureGroup(groupId, body);
            return writeJson(response, 200, group);
        }],
        [/^POST \/api\/groups\/[^/]+\/storage\/subtotals$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const group = application.storageMonitorService.defineSubtotals(groupId, body.subtotals || []);
            return writeJson(response, 200, group);
        }],
        [/^POST \/api\/groups\/[^/]+\/storage\/delta$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const group = application.storageMonitorService.setDeltaTracking(groupId, body);
            return writeJson(response, 200, group);
        }],
        [/^GET \/api\/groups\/[^/]+\/storage\/metrics$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            return writeJson(response, 200, application.storageMonitorService.getGroupMetrics(groupId));
        }],
        [/^GET \/api\/groups\/[^/]+\/storage\/graph$/, (request, response, url, body, application) => {
            const groupId = url.pathname.split('/').filter(Boolean)[2];
            const item = url.searchParams.get('item');
            const minutes = url.searchParams.get('minutes');
            return writeJson(response, 200, application.storageMonitorService.getGraphData(groupId, item, minutes));
        }],
    ]
};
