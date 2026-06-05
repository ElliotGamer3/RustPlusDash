const { serveFile, writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['GET /', (request, response, url, body, application, { guiPaths }) => {
            return serveFile(response, guiPaths.indexFile, 'text/html; charset=utf-8');
        }],
        ['GET /app.js', (request, response, url, body, application, { guiPaths }) => {
            return serveFile(response, guiPaths.appFile, 'application/javascript; charset=utf-8');
        }],
        ['GET /api/state', (request, response, url, body, application) => {
            return writeJson(response, 200, application.getPublicState());
        }],
        ['GET /api/events', (request, response, url, body, application, { sseClients }) => {
            response.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });
            response.write(`event: state\ndata: ${JSON.stringify(application.getPublicState())}\n\n`);
            sseClients.add(response);
            request.on('close', () => sseClients.delete(response));
        }],
        ['GET /health', (request, response) => {
            return writeJson(response, 200, { ok: true });
        }],
    ],
    dynamic: []
};
