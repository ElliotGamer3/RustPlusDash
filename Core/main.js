const fs = require('fs');
const path = require('path');
const { appHost, appPort, dataFilePath } = require('./config');
const Application = require('./app/Application');
const createHttpServer = require('./http/server');

const PROTO_ERROR_LOG = path.resolve(__dirname, '../proto-decode-errors.jsonl');

// Prevent protobuf decode errors (e.g. stale 'required' field mismatches) from
// crashing the process. These are non-fatal — the offending message is simply dropped.
// The partial object is appended to proto-decode-errors.jsonl for patch analysis.
process.on('uncaughtException', (err) => {
    if (err && (err.name === 'CustomError' || String(err.message).includes('missing required'))) {
        const entry = {
            timestamp: new Date().toISOString(),
            error: err.message,
            instance: err.instance ?? null,
        };
        try {
            fs.appendFileSync(PROTO_ERROR_LOG, JSON.stringify(entry) + '\n');
        } catch {
            // If logging fails, console log the error but continue running
            console.warn('[proto] Failed to write decode error to log:', err.message);
        }
        console.warn('[proto] Decode error (saved to proto-decode-errors.jsonl):', err.message);
        return;
    }
    console.error('[uncaughtException]', err);
    process.exitCode = 1;
    process.exit(1);
});

async function main() {
	const skipRustConnect = process.env.SKIP_RUST_CONNECT === '1' || process.env.SKIP_RUST_CONNECT === 'true';
    const enableAppLogging = process.env.ENABLE_APP_LOGGING === '1' || process.env.ENABLE_APP_LOGGING === 'true';
    if (enableAppLogging) {
        console.log('Application logging is enabled and will log to application.log');
    }
    

	const application = new Application({
		host: appHost,
		port: appPort,
		dataFilePath,
		skipRustConnect
	});

	await application.start();

	const server = createHttpServer(application);
	server.listen(appPort, appHost, () => {
		console.log(`Rust+ companion listening at http://${appHost}:${appPort}`);
	});
}

main().catch((error) => {
	console.error('Failed to start application', error);
	process.exitCode = 1;
});