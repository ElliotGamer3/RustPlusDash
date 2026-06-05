const { writeJson, writeLog } = require('../helpers');

module.exports = {
    exact: [
        ['GET /api/map', async (request, response, url, body, application) => {
            const activeServer = application.store.getActiveServer();
            if (!activeServer) return writeJson(response, 400, { error: 'No active server' });
            const mapData = await application.connectionManager.getMap(activeServer.id);
            if (!mapData) return writeJson(response, 503, { error: 'Map data unavailable' });
            const jpgBase64 = Buffer.from(mapData.jpgImage).toString('base64');
            // Log map data without the image to avoid bloating logs
            const { jpgImage, ...mapDataWithoutImage } = mapData;
            writeLog('info', 'mapRoutes', `Fetched map data for server ${activeServer.id}: ${JSON.stringify(mapDataWithoutImage)}`);
            const markers = await application.connectionManager.getMapMarkers(activeServer.id);
            writeLog('info', 'mapRoutes', `Served map data for server ${activeServer.id} with ${markers.length} markers`);
            //TODO: The 4250 number should get moved to be a pre-server setting that can be overridden by the user.
            const mapSize = Math.max(mapData.width, mapData.height, 4250);
            const mapBody = {
                width: mapData.width,
                height: mapData.height,
                oceanMargin: mapData.oceanMargin,
                mapSize,
                background: mapData.background || '',
                monuments: (mapData.monuments || []).map(m => ({ token: m.token, x: m.x, y: m.y })),
                jpgBase64
            };
            writeLog('info', 'mapRoutes', `mapBody for details: ${JSON.stringify(mapBody)}`);
            return writeJson(response, 200, mapBody);
        }],
        ['GET /api/map/markers', async (request, response, url, body, application) => {
            const activeServer = application.store.getActiveServer();
            if (!activeServer) return writeJson(response, 400, { error: 'No active server' });
            const markers = await application.connectionManager.getMapMarkers(activeServer.id);
            return writeJson(response, 200, { markers });
        }],
    ],
    dynamic: []
};
