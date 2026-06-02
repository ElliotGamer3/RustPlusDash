class RateLimitCoordinator {
    constructor({ eventBus, maxTokens = 25, replenishPerSecond = 3 }) {
        this.eventBus = eventBus;
        this.maxTokens = maxTokens;
        this.replenishPerSecond = replenishPerSecond;
        this.queues = new Map();
    }

    enqueue(scopeId, cost, task) {
        const queue = this.#getQueue(scopeId);

        return new Promise((resolve, reject) => {
            queue.items.push({ cost, task, resolve, reject });
            this.#emitState(scopeId);
            this.#process(scopeId).catch((error) => {
                this.eventBus.emit('rate-limit:error', {
                    scopeId,
                    error: error.message
                });
            });
        });
    }

    getState() {
        return Array.from(this.queues.entries()).map(([scopeId, queue]) => {
            this.#refill(queue);
            return {
                scopeId,
                queued: queue.items.length,
                tokens: Number(queue.tokens.toFixed(2)),
                processing: queue.processing
            };
        });
    }

    #getQueue(scopeId) {
        if (!this.queues.has(scopeId)) {
            this.queues.set(scopeId, {
                items: [],
                tokens: this.maxTokens,
                lastRefillAt: Date.now(),
                processing: false
            });
        }

        return this.queues.get(scopeId);
    }

    #refill(queue) {
        const now = Date.now();
        const elapsedMs = now - queue.lastRefillAt;

        if (elapsedMs <= 0) {
            return;
        }

        const replenishedTokens = (elapsedMs / 1000) * this.replenishPerSecond;
        queue.tokens = Math.min(this.maxTokens, queue.tokens + replenishedTokens);
        queue.lastRefillAt = now;
    }

    async #process(scopeId) {
        const queue = this.#getQueue(scopeId);

        if (queue.processing) {
            return;
        }

        queue.processing = true;
        this.#emitState(scopeId);

        while (queue.items.length > 0) {
            const nextJob = queue.items[0];
            this.#refill(queue);

            if (queue.tokens < nextJob.cost) {
                const deficit = nextJob.cost - queue.tokens;
                const waitMs = Math.max(100, Math.ceil((deficit / this.replenishPerSecond) * 1000));
                await wait(waitMs);
                continue;
            }

            queue.items.shift();
            queue.tokens -= nextJob.cost;
            this.#emitState(scopeId);

            try {
                const result = await nextJob.task();
                nextJob.resolve(result);
            } catch (error) {
                nextJob.reject(error);
            }
        }

        queue.processing = false;
        this.#emitState(scopeId);
    }

    #emitState(scopeId) {
        this.eventBus.emit('rate-limit:state', {
            scopeId,
            queues: this.getState()
        });
    }
}

function wait(durationMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs);
    });
}

module.exports = RateLimitCoordinator;