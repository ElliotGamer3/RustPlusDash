const { writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['POST /api/team/messages', async (request, response, url, body, application) => {
            const result = await application.teamMessageService.sendMessage(body);
            return writeJson(response, 201, result);
        }],
        ['POST /api/team/messages/history', async (request, response, url, body, application) => {
            const messages = await application.teamMessageService.getMessageHistory(body);
            return writeJson(response, 200, { messages });
        }],
    ],
    dynamic: []
};
