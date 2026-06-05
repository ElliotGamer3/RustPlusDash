const { writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['GET /api/notifications', (request, response, url, body, application) => {
            return writeJson(response, 200, application.notificationService.getRecent(Number(url.searchParams.get('limit') || 200)));
        }],
    ],
    dynamic: []
};
