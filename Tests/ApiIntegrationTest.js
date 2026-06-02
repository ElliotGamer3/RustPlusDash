const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function waitForServerReady(child, url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const intervalId = setInterval(async () => {
            try {
                const response = await fetch(`${url}/health`);
                if (response.ok) {
                    clearInterval(intervalId);
                    resolve();
                }
            } catch (error) {
                if (Date.now() - start > timeoutMs) {
                    clearInterval(intervalId);
                    reject(new Error('Timed out waiting for server readiness'));
                }
            }
        }, 250);

        child.on('exit', (code) => {
            clearInterval(intervalId);
            reject(new Error(`Server exited before readiness check completed (exit ${code})`));
        });
    });
}

async function api(url, method, body) {
    const response = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed (${response.status}) ${url}: ${text}`);
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
}

async function run() {
    const port = 3210 + Math.floor(Math.random() * 400);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-game-api-test-'));
    const dataFile = path.join(tmpDir, 'app-state.json');
    const baseUrl = `http://127.0.0.1:${port}`;

    const child = spawn('node', ['Core/main.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            APP_PORT: String(port),
            SKIP_RUST_CONNECT: '1',
            DATA_FILE_PATH: dataFile
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk.toString());
    });

    child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk.toString());
    });

    let createdServerId = null;
    let createdDeviceId = null;
    let createdGroupId = null;
    let createdRequirementId = null;

    try {
        await waitForServerReady(child, baseUrl);

        const health = await fetch(`${baseUrl}/health`);
        assert.equal(health.status, 200, 'health endpoint should return 200');

        const state = await api(`${baseUrl}/api/state`, 'GET');
        assert.ok(state.settings, 'state should include settings');
        assert.ok(Array.isArray(state.servers), 'state should include servers');

        const paired = await api(`${baseUrl}/api/pairing/server`, 'POST', {
            name: 'Integration Server',
            host: '1.2.3.4',
            port: '28083',
            playerId: '111',
            playerToken: '222'
        });
        createdServerId = paired.server.id;

        const device = await api(`${baseUrl}/api/devices`, 'POST', {
            serverId: 'default-server',
            type: 'switch',
            name: 'Test Switch',
            entityId: '1234567'
        });
        createdDeviceId = device.id;

        const group = await api(`${baseUrl}/api/groups`, 'POST', {
            serverId: 'default-server',
            type: 'switch-group',
            name: 'Test Group',
            deviceIds: [createdDeviceId]
        });
        createdGroupId = group.id;

        const requirement = await api(`${baseUrl}/api/requirements`, 'POST', {
            groupId: createdGroupId,
            target: { scope: 'group' },
            condition: { operator: 'above', value: 10 },
            actions: [{ type: 'notify', message: 'Threshold met' }],
            enabled: true
        });
        createdRequirementId = requirement.id;

        const estimate = await api(`${baseUrl}/api/requirements/${createdRequirementId}/estimate`, 'POST', {
            mode: 'rolling'
        });
        assert.ok(Object.prototype.hasOwnProperty.call(estimate, 'estimateSeconds'), 'estimate payload should include estimateSeconds');

        const notifications = await api(`${baseUrl}/api/notifications?limit=25`, 'GET');
        assert.ok(Array.isArray(notifications), 'notifications endpoint should return an array');

        await api(`${baseUrl}/api/requirements/${createdRequirementId}`, 'DELETE');
        createdRequirementId = null;

        await api(`${baseUrl}/api/groups/${createdGroupId}`, 'DELETE');
        createdGroupId = null;

        await api(`${baseUrl}/api/devices/${createdDeviceId}`, 'DELETE');
        createdDeviceId = null;

        await api(`${baseUrl}/api/servers/${createdServerId}`, 'DELETE');
        createdServerId = null;

        console.log('API integration test passed');
    } finally {
        try {
            if (createdRequirementId) {
                await api(`${baseUrl}/api/requirements/${createdRequirementId}`, 'DELETE');
            }
        } catch (error) {
            // ignore cleanup failure
        }

        try {
            if (createdGroupId) {
                await api(`${baseUrl}/api/groups/${createdGroupId}`, 'DELETE');
            }
        } catch (error) {
            // ignore cleanup failure
        }

        try {
            if (createdDeviceId) {
                await api(`${baseUrl}/api/devices/${createdDeviceId}`, 'DELETE');
            }
        } catch (error) {
            // ignore cleanup failure
        }

        try {
            if (createdServerId) {
                await api(`${baseUrl}/api/servers/${createdServerId}`, 'DELETE');
            }
        } catch (error) {
            // ignore cleanup failure
        }

        child.kill();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

run().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
