const RustPlus = require('@liamcottle/rustplus.js');
const { serverIp, serverPort, playerId, playerToken } = require('../Core/config');

const rustplus = new RustPlus(serverIp, serverPort, playerId, playerToken);

const timeout = setTimeout(() => {
    console.error('Timed out waiting for Rust+ connection');
    process.exit(1);
}, 10000);

rustplus.on('connected', () => {
    clearTimeout(timeout);
    rustplus.sendTeamMessage('Hello from rustplus.js!');
    process.exit(0);
});

rustplus.on('error', (error) => {
    clearTimeout(timeout);
    console.error(error.message);
    process.exit(1);
});

rustplus.connect();
