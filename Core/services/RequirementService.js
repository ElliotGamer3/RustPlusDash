class RequirementService {
    constructor({ store, eventBus, groupService, storageMonitorService, notificationService, smartSwitchService, teamMessageService }) {
        this.store = store;
        this.eventBus = eventBus;
        this.groupService = groupService;
        this.storageMonitorService = storageMonitorService;
        this.notificationService = notificationService;
        this.smartSwitchService = smartSwitchService;
        this.teamMessageService = teamMessageService;

        this.eventBus.on('storage:group-updated', (event) => {
            this.#evaluateGroup(event.groupId, event.metrics).catch((error) => {
                this.notificationService.log({
                    category: 'requirement-error',
                    visible: false,
                    message: error.message,
                    groupId: event.groupId
                });
            });
        });
    }

    addRequirement(payload) {
        return this.store.addRequirement(payload);
    }

    updateRequirement(requirementId, payload) {
        return this.store.updateRequirement(requirementId, payload);
    }

    removeRequirement(requirementId) {
        return this.store.removeRequirement(requirementId);
    }

    estimateRequirement(requirementId, mode = 'rolling') {
        const requirement = this.store.getState().requirements.find((item) => item.id === requirementId);

        if (!requirement) {
            throw new Error(`Unknown requirement: ${requirementId}`);
        }

        if (mode !== 'instant' && requirement.etaEnabled !== true) {
            return {
                requirementId,
                estimateSeconds: null,
                reason: 'ETA estimation is disabled for this requirement'
            };
        }

        const metrics = this.storageMonitorService.getGroupMetrics(requirement.groupId);
        const currentValue = this.#extractTargetValue(metrics, requirement.target);
        const targetValue = Number(requirement.condition?.value) || 0;
        const history = metrics.history[requirement.target?.itemId || requirement.target?.category || '__group__'];

        if (!history || history.points.length < 2) {
            return {
                requirementId,
                estimateSeconds: null,
                reason: 'Insufficient history'
            };
        }

        const points = history.points;
        const latest = points[points.length - 1];
        const first = mode === 'instant'
            ? points[points.length - 2]
            : points[0];

        const elapsedSeconds = Math.max(1, (new Date(latest.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000);
        const deltaPerSecond = (latest.quantity - first.quantity) / elapsedSeconds;

        if (deltaPerSecond === 0) {
            return {
                requirementId,
                estimateSeconds: null,
                reason: 'No change rate'
            };
        }

        const remaining = targetValue - currentValue;
        const estimateSeconds = remaining / deltaPerSecond;

        return {
            requirementId,
            estimateSeconds: estimateSeconds < 0 ? 0 : estimateSeconds,
            currentValue,
            targetValue,
            deltaPerSecond,
            mode
        };
    }

    async #evaluateGroup(groupId, metrics) {
        const requirements = this.store.getState().requirements.filter((item) => item.groupId === groupId && item.enabled !== false);

        for (const requirement of requirements) {
            const value = this.#extractTargetValue(metrics, requirement.target);
            const shouldTrigger = this.#matchesCondition(value, requirement.condition);

            if (!shouldTrigger) {
                continue;
            }

            await this.#executeActions(requirement, value);
        }
    }

    #extractTargetValue(metrics, target) {
        const metric = target?.metric || 'quantity';

        if (!target || target.scope === 'group') {
            return metrics.grandTotal.reduce((sum, item) => sum + item.quantity, 0);
        }

        if (target.scope === 'item') {
            const normalized = String(target.itemId || '').toLowerCase();

            if (metric === 'delta') {
                return metrics.history[normalized]?.delta || 0;
            }

            const entry = metrics.grandTotal.find((item) => item.itemId === normalized);
            return entry ? entry.quantity : 0;
        }

        if (target.scope === 'category') {
            const normalized = String(target.category || '').toLowerCase();
            return metrics.grandTotal
                .filter((item) => item.category === normalized)
                .reduce((sum, item) => sum + item.quantity, 0);
        }

        if (target.scope === 'subtotal') {
            const subtotal = metrics.subtotals.find((item) => item.id === target.subtotalId);
            if (!subtotal) {
                return 0;
            }
            return subtotal.total.reduce((sum, item) => sum + item.quantity, 0);
        }

        return 0;
    }

    #matchesCondition(value, condition = {}) {
        const operator = condition.operator || 'below';
        const threshold = Number(condition.value) || 0;

        if (operator === 'below') {
            return value < threshold;
        }

        if (operator === 'above') {
            return value > threshold;
        }

        if (operator === 'belowOrEqual') {
            return value <= threshold;
        }

        if (operator === 'aboveOrEqual') {
            return value >= threshold;
        }

        return false;
    }

    async #executeActions(requirement, observedValue) {
        const actions = Array.isArray(requirement.actions) ? requirement.actions : [];

        for (const action of actions) {
            if (action.type === 'notify') {
                this.notificationService.notify({
                    category: 'requirement',
                    groupId: requirement.groupId,
                    requirementId: requirement.id,
                    message: action.message || `Requirement met for ${requirement.id}`,
                    details: {
                        observedValue
                    }
                });
                continue;
            }

            if (action.type === 'switch') {
                await this.smartSwitchService.setValueByEntity(action.serverId, action.entityId, Boolean(action.value));
                continue;
            }

            if (action.type === 'switch-group') {
                if (action.value) {
                    await this.groupService.turnGroupOn(action.groupId);
                } else {
                    await this.groupService.turnGroupOff(action.groupId);
                }
                continue;
            }

            if (action.type === 'team-message') {
                await this.teamMessageService.sendMessage({
                    serverId: action.serverId,
                    message: action.message || `Requirement met for ${requirement.id}`
                });
            }
        }
    }
}

module.exports = RequirementService;
