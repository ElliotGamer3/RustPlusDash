const { serveFile, writeJson, writeLog } = require('../helpers');

module.exports = {
    exact: [
        ['GET /register', async (request, response, url, body, application, { guiPaths }) => {
            return serveFile(response, guiPaths.registerHtml, 'text/html; charset=utf-8');
        }],
        ['GET /register.js', (request, response, url, body, application, { guiPaths })=> {
            return serveFile(response, guiPaths.registerFile, 'application/javascript; charset=utf-8');
        }],
        ['GET /callback', async (request, response, url, body, application, {guiPaths}) => {
            try {
                const token = url.searchParams.get('token');
                const steamId = url.searchParams.get('steamId');
                if (!token || !steamId) {
                    return writeJson(response, 400, { error: 'Missing token or steamId' });
                }
                await application.rustPlusRegisterService.writeSteamAuthToken(token, steamId).catch(err => {
                    console.error('Error writing Steam auth token to config file:', err);
                    writeLog('Error writing Steam auth token to config file: ' + err.message);
                    throw new Error('Failed to write Steam auth token to config file');
                });
                await application.rustPlusRegisterService.register().catch(err => {
                    console.error('Error during registration process:', err);
                    writeLog('Error during registration process: ' + err.message);
                    throw new Error('Failed to complete registration process');
                });
                // Pause for a moment to ensure the token is saved before broadcasting the state
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('Registration successful, redirecting to main page');
                // After successful registration, go back to the main page 
                response.writeHead(302, { Location: '/' });
                return response.end();
            } catch (error) {
                console.error('Error handling /callback:', error);
                writeLog('Error handling /callback: ' + error.message);
                return writeJson(response, 500, { error: 'Internal server error' });
            }
        }],
        ['GET /api/steam-link/status', (request, response, url, body, application) => {
            try {
                const status = application.rustPlusRegisterService.getSteamLinkStatus();
                return writeJson(response, 200, status);
            } catch (error) {
                console.error('Error getting Steam Link status:', error);
                writeLog('Error getting Steam Link status: ' + error.message);
                return writeJson(response, 500, { error: 'Internal server error' });
            }
        }]
    ],
    dynamic: []
};