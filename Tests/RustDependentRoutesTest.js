const assert = require('assert');
const path = require('path');
const {
    createTempDir,
    removeDir,
    randomPort,
    waitForServerReady,
    spawnServer,
    requestJson
} = require('./_testHarness');

async function fetchJson(url, method, body) {
    const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    return {
        status: response.status,
        payload
    };
}

async function run() {
    const repoRoot = path.join(__dirname, '..');
    const tempDir = createTempDir('rust-game-rust-routes-');
    const dataFilePath = path.join(tempDir, 'state.json');
    const port = randomPort(4100, 600);
    const baseUrl = `http://127.0.0.1:${port}`;

    const child = spawnServer({
        cwd: repoRoot,
        port,
        dataFilePath,
        skipRustConnect: true
    });

    let switchDeviceId = null;
    let switchGroupId = null;
    let cameraDeviceId = null;
    let badServerId = null;

    try {
        await waitForServerReady(child, baseUrl);

        const badServer = await requestJson(`${baseUrl}/api/servers`, 'POST', {
            name: 'Unreachable Server',
            host: '203.0.113.1',
            port: '1',
            playerId: '999',
            playerToken: '999'
        });
        badServerId = badServer.id;

        const switchCreate = await fetchJson(`${baseUrl}/api/switches`, 'POST', {
            serverId: badServerId,
            name: 'Rust Route Switch',
            entityId: '9991'
        });
        assert.equal(switchCreate.status, 500, 'switch creation on unreachable server should fail');

        const stateAfterSwitchCreate = await requestJson(`${baseUrl}/api/state`, 'GET');
        const persistedSwitch = stateAfterSwitchCreate.devices.find((device) => {
            return device.serverId === badServerId && device.type === 'switch' && device.entityId === '9991';
        });

        assert.ok(persistedSwitch, 'switch record should persist even if prime fails');
        switchDeviceId = persistedSwitch.id;

        const switchGroup = await requestJson(`${baseUrl}/api/groups`, 'POST', {
            serverId: badServerId,
            type: 'switch-group',
            name: 'Rust Route Switch Group',
            deviceIds: [switchDeviceId]
        });
        switchGroupId = switchGroup.id;

        const cameraDevice = await requestJson(`${baseUrl}/api/devices`, 'POST', {
            serverId: badServerId,
            type: 'camera',
            name: 'Rust Route Camera',
            cameraId: 'OILRIG1'
        });
        cameraDeviceId = cameraDevice.id;

        const responses = await Promise.all([
            fetchJson(`${baseUrl}/api/team/messages`, 'POST', { serverId: badServerId, message: 'offline check' }),
            fetchJson(`${baseUrl}/api/switches/${switchDeviceId}/on`, 'POST', {}),
            fetchJson(`${baseUrl}/api/groups/${switchGroupId}/on`, 'POST', {}),
            fetchJson(`${baseUrl}/api/cameras/${cameraDeviceId}/subscribe`, 'POST', {})
        ]);

        for (const response of responses) {
            assert.equal(response.status, 500, 'offline Rust-dependent route should return 500');
            assert.ok(response.payload && response.payload.error, 'error payload should include message');
        }

        console.log('Rust-dependent routes test passed');
    } finally {
        try {
            if (switchGroupId) {
                await requestJson(`${baseUrl}/api/groups/${switchGroupId}`, 'DELETE');
            }
        } catch (error) {
            // ignore
        }

        try {
            if (switchDeviceId) {
                await requestJson(`${baseUrl}/api/devices/${switchDeviceId}`, 'DELETE');
            }
        } catch (error) {
            // ignore
        }

        try {
            if (cameraDeviceId) {
                await requestJson(`${baseUrl}/api/devices/${cameraDeviceId}`, 'DELETE');
            }
        } catch (error) {
            // ignore
        }

        if (badServerId) {
            try {
                await requestJson(`${baseUrl}/api/servers/${badServerId}`, 'DELETE');
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
