const { appHost, appPort, dataFilePath } = require('./config');
const Application = require('./app/Application');
const createHttpServer = require('./http/server');

async function main() {
	const skipRustConnect = process.env.SKIP_RUST_CONNECT === '1' || process.env.SKIP_RUST_CONNECT === 'true';

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