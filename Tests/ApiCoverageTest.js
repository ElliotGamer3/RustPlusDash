const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    createTempDir,
    removeDir,
    randomPort,
    waitForServerReady,
    spawnServer,
    requestJson
} = require('./_testHarness');

async function run() {
    const repoRoot = path.join(__dirname, '..');
    const tempDir = createTempDir('rust-game-api-coverage-');
    const dataFilePath = path.join(tempDir, 'state.json');
    const configPath = path.join(tempDir, 'rustplus.config.json');
    const port = randomPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    fs.writeFileSync(configPath, JSON.stringify({
        fcm_credentials: { gcm: { androidId: '1', securityToken: '2' }, fcm: { token: 'x' } },
        rustplus_auth_token: 'token'
    }, null, 2));

    const child = spawnServer({
        cwd: repoRoot,
        port,
        dataFilePath,
        skipRustConnect: true
    });

    const cleanup = {
        serverIds: [],
        deviceIds: [],
        groupIds: [],
        requirementIds: []
    };

    try {
        await waitForServerReady(child, baseUrl);

        const state = await requestJson(`${baseUrl}/api/state`, 'GET');
        assert.ok(state.settings, 'state endpoint should return settings');

        const addedServer = await requestJson(`${baseUrl}/api/servers`, 'POST', {
            name: 'Coverage Server',
            host: '10.1.1.1',
            port: '28083',
            playerId: '111',
            playerToken: '222',
            isDefault: false
        });
        cleanup.serverIds.push(addedServer.id);

        await requestJson(`${baseUrl}/api/servers/active`, 'POST', { serverId: 'default-server' });
        await requestJson(`${baseUrl}/api/servers/default`, 'POST', { serverId: 'default-server' });
        await requestJson(`${baseUrl}/api/settings/user-default-server`, 'POST', { userId: 'coverage-user', defaultServerId: 'default-server' });

        const imported = await requestJson(`${baseUrl}/api/pairing/import-config`, 'POST', { configPath });
        assert.equal(imported.type, 'import-config', 'pairing import should create session');

        const listenerStatus = await requestJson(`${baseUrl}/api/pairing/listener/status`, 'GET');
        assert.equal(listenerStatus.status, 'stopped', 'pairing listener should be stopped by default');

        const ingestedServer = await requestJson(`${baseUrl}/api/pairing/listener/ingest`, 'POST', {
            payload: {
                data: {
                    type: 'server',
                    name: 'Listener Pair Server',
                    ip: '10.9.9.9',
                    port: '28111',
                    playerId: '9991',
                    playerToken: '9992'
                }
            }
        });
        assert.equal(ingestedServer.type, 'server', 'listener ingest should handle server pairing');
        cleanup.serverIds.push(ingestedServer.server.id);

        const ingestedEntity = await requestJson(`${baseUrl}/api/pairing/listener/ingest`, 'POST', {
            payload: {
                data: {
                    type: 'entity',
                    name: 'Listener Pair Server',
                    ip: '10.9.9.9',
                    port: '28111',
                    playerId: '9991',
                    playerToken: '9992',
                    entityId: '8888',
                    entityType: 'SmartSwitch',
                    entityName: 'Listener Smart Switch'
                }
            }
        });
        assert.equal(ingestedEntity.type, 'entity', 'listener ingest should handle entity pairing');
        cleanup.deviceIds.push(ingestedEntity.device.id);

        const pairedServer = await requestJson(`${baseUrl}/api/pairing/server`, 'POST', {
            name: 'Pair Server',
            host: '10.2.2.2',
            port: '28084',
            playerId: '333',
            playerToken: '444',
            isDefault: false
        });
        cleanup.serverIds.push(pairedServer.server.id);

        const types = [
            { type: 'switch', entityId: '1001' },
            { type: 'alarm', entityId: '1002' },
            { type: 'storage-monitor', entityId: '1003' },
            { type: 'camera', cameraId: 'OILRIG1' },
            { type: 'turret', cameraId: 'TURRET1' }
        ];

        const devices = [];
        for (const entry of types) {
            const device = await requestJson(`${baseUrl}/api/devices`, 'POST', {
                serverId: 'default-server',
                type: entry.type,
                name: `Coverage ${entry.type}`,
                entityId: entry.entityId || null,
                cameraId: entry.cameraId || null
            });
            cleanup.deviceIds.push(device.id);
            devices.push(device);
        }

        await requestJson(`${baseUrl}/api/devices/${devices[0].id}`, 'PATCH', { name: 'Coverage switch updated' });

        const switchGroup = await requestJson(`${baseUrl}/api/groups`, 'POST', {
            serverId: 'default-server',
            type: 'switch-group',
            name: 'Switch Group',
            deviceIds: [devices[0].id]
        });
        cleanup.groupIds.push(switchGroup.id);

        const alarmGroup = await requestJson(`${baseUrl}/api/groups`, 'POST', {
            serverId: 'default-server',
            type: 'alarm-group',
            name: 'Alarm Group',
            deviceIds: [devices[1].id]
        });
        cleanup.groupIds.push(alarmGroup.id);

        const storageGroup = await requestJson(`${baseUrl}/api/groups`, 'POST', {
            serverId: 'default-server',
            type: 'storage-group',
            name: 'Storage Group',
            deviceIds: [devices[2].id]
        });
        cleanup.groupIds.push(storageGroup.id);

        const cameraGroup = await requestJson(`${baseUrl}/api/groups`, 'POST', {
            serverId: 'default-server',
            type: 'camera-group',
            name: 'Camera Group',
            deviceIds: [devices[3].id]
        });
        cleanup.groupIds.push(cameraGroup.id);

        const turretGroup = await requestJson(`${baseUrl}/api/groups`, 'POST', {
            serverId: 'default-server',
            type: 'turret-group',
            name: 'Turret Group',
            deviceIds: [devices[4].id]
        });
        cleanup.groupIds.push(turretGroup.id);

        await requestJson(`${baseUrl}/api/groups/${storageGroup.id}`, 'PATCH', {
            config: { note: 'patched' }
        });

        await requestJson(`${baseUrl}/api/groups/${alarmGroup.id}/alarm-consolidation`, 'POST', {
            enabled: true,
            windowMs: 2500,
            excludedDeviceIds: []
        });

        await requestJson(`${baseUrl}/api/groups/${storageGroup.id}/storage/subtotals`, 'POST', {
            subtotals: [{ id: 'core', name: 'Core', excludedCategories: ['weapons'] }]
        });

        await requestJson(`${baseUrl}/api/groups/${storageGroup.id}/storage/delta`, 'POST', {
            enabled: true,
            includeItems: ['sulfur_ore'],
            includeCategories: ['resources']
        });

        const metrics = await requestJson(`${baseUrl}/api/groups/${storageGroup.id}/storage/metrics`, 'GET');
        assert.equal(metrics.groupId, storageGroup.id, 'storage metrics should return group id');

        const graph = await requestJson(`${baseUrl}/api/groups/${storageGroup.id}/storage/graph?item=sulfur_ore&minutes=60`, 'GET');
        assert.equal(graph.groupId, storageGroup.id, 'storage graph should return group id');

        await requestJson(`${baseUrl}/api/groups/${cameraGroup.id}/rotation/start`, 'POST', { intervalMs: 2000 });
        await requestJson(`${baseUrl}/api/groups/${cameraGroup.id}/rotation/pause`, 'POST', {});
        await requestJson(`${baseUrl}/api/groups/${cameraGroup.id}/rotation/resume`, 'POST', {});
        await requestJson(`${baseUrl}/api/groups/${cameraGroup.id}/rotation/select`, 'POST', { deviceId: devices[3].id });

        const view = await requestJson(`${baseUrl}/api/groups/${cameraGroup.id}/view`, 'GET');
        assert.equal(view.groupId, cameraGroup.id, 'group view should return requested group');

        const requirement = await requestJson(`${baseUrl}/api/requirements`, 'POST', {
            groupId: storageGroup.id,
            target: { scope: 'group' },
            condition: { operator: 'above', value: 1000 },
            actions: [{ type: 'notify', message: 'Coverage notification' }],
            etaEnabled: true,
            enabled: true
        });
        cleanup.requirementIds.push(requirement.id);

        await requestJson(`${baseUrl}/api/requirements/${requirement.id}`, 'PATCH', {
            condition: { operator: 'below', value: 500 }
        });

        const estimate = await requestJson(`${baseUrl}/api/requirements/${requirement.id}/estimate`, 'POST', { mode: 'instant' });
        assert.ok(Object.prototype.hasOwnProperty.call(estimate, 'estimateSeconds'), 'estimate response should include estimateSeconds');

        const notifications = await requestJson(`${baseUrl}/api/notifications?limit=100`, 'GET');
        assert.ok(Array.isArray(notifications), 'notifications should return array');

        console.log('API coverage test passed');
    } finally {
        for (const id of cleanup.requirementIds) {
            try {
                await requestJson(`${baseUrl}/api/requirements/${id}`, 'DELETE');
            } catch (error) {
                // ignore
            }
        }

        for (const id of cleanup.groupIds) {
            try {
                await requestJson(`${baseUrl}/api/groups/${id}`, 'DELETE');
            } catch (error) {
                // ignore
            }
        }

        for (const id of cleanup.deviceIds) {
            try {
                await requestJson(`${baseUrl}/api/devices/${id}`, 'DELETE');
            } catch (error) {
                // ignore
            }
        }

        for (const id of cleanup.serverIds) {
            try {
                await requestJson(`${baseUrl}/api/servers/${id}`, 'DELETE');
            } catch (error) {
                // ignore
            }
        }

        child.kill();
        removeDir(tempDir);
    }
}

run().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
