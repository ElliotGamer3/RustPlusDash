const path = require('path');

const config = {
    appHost: process.env.APP_HOST || '127.0.0.1',
    appPort: Number(process.env.APP_PORT || 3030),
    dataFilePath: process.env.DATA_FILE_PATH || path.join(__dirname, 'data', 'app-state.json'),
    serverIp: process.env.SERVER_IP,
    serverPort: process.env.SERVER_PORT,
    playerId: process.env.PLAYER_ID,
    playerToken: process.env.PLAYER_TOKEN
};

function createDefaultServerProfile() {
    return {
        id: 'default-server',
        name: 'Default Server',
        host: config.serverIp,
        port: String(config.serverPort),
        playerId: String(config.playerId),
        playerToken: String(config.playerToken),
        isDefault: true
    };
}

module.exports = {
    ...config,
    createDefaultServerProfile
};