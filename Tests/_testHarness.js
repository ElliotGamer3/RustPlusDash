const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function createTempDir(prefix = 'rust-game-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDir(dirPath) {
    fs.rmSync(dirPath, { recursive: true, force: true });
}

function randomPort(base = 3300, spread = 700) {
    return base + Math.floor(Math.random() * spread);
}

function waitForServerReady(child, baseUrl, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const intervalId = setInterval(async () => {
            try {
                const response = await fetch(`${baseUrl}/health`);
                if (response.ok) {
                    clearInterval(intervalId);
                    resolve();
                }
            } catch (error) {
                if (Date.now() - startedAt > timeoutMs) {
                    clearInterval(intervalId);
                    reject(new Error('Timed out waiting for server health endpoint'));
                }
            }
        }, 250);

        child.once('exit', (code) => {
            clearInterval(intervalId);
            reject(new Error(`Server exited before ready (code ${code})`));
        });
    });
}

function spawnServer({ cwd, port, dataFilePath, skipRustConnect = true }) {
    const env = {
        ...process.env,
        APP_PORT: String(port),
        DATA_FILE_PATH: dataFilePath,
        SKIP_RUST_CONNECT: skipRustConnect ? '1' : '0'
    };

    const child = spawn('node', ['Core/main.js'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk.toString());
    });

    child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk.toString());
    });

    return child;
}

async function requestJson(url, method = 'GET', body = undefined) {
    const response = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
        const error = new Error(`Request failed ${response.status} ${url}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

module.exports = {
    createTempDir,
    removeDir,
    randomPort,
    waitForServerReady,
    spawnServer,
    requestJson
};
