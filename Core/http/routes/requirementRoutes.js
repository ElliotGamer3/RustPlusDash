const { writeJson } = require('../helpers');

module.exports = {
    exact: [
        ['POST /api/requirements', (request, response, url, body, application) => {
            const requirement = application.requirementService.addRequirement(body);
            return writeJson(response, 201, requirement);
        }],
    ],
    dynamic: [
        [/^PATCH \/api\/requirements\/[^/]+$/, (request, response, url, body, application) => {
            const requirementId = url.pathname.split('/').filter(Boolean)[2];
            const requirement = application.requirementService.updateRequirement(requirementId, body);
            return writeJson(response, 200, requirement);
        }],
        [/^DELETE \/api\/requirements\/[^/]+$/, (request, response, url, body, application) => {
            const requirementId = url.pathname.split('/').filter(Boolean)[2];
            application.requirementService.removeRequirement(requirementId);
            return writeJson(response, 204, null);
        }],
        [/^POST \/api\/requirements\/[^/]+\/estimate$/, (request, response, url, body, application) => {
            const requirementId = url.pathname.split('/').filter(Boolean)[2];
            const estimate = application.requirementService.estimateRequirement(requirementId, body.mode || 'rolling');
            return writeJson(response, 200, estimate);
        }],
    ]
};
