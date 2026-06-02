const fs = require('fs');
const path = require('path');
const PushReceiverClient = require('@liamcottle/push-receiver/src/client');

class PairingListenerService {
    constructor({ pairingService, notificationService, eventBus }) {
        this.pairingService = pairingService;
        this.notificationService = notificationService;
        this.eventBus = eventBus;

        this.client = null;
        this.status = 'stopped';
        this.lastError = null;
        this.lastNotificationAt = null;
        this.configPath = null;
        this.autoPair = true;
    }

    async start({ configPath, autoPair = true }) {
        if (this.client) {
            return this.getStatus();
        }

        const resolvedConfigPath = path.resolve(configPath || path.join(process.cwd(), 'rustplus.config.json'));
        const config = this.#readConfig(resolvedConfigPath);
        const androidId = config.fcm_credentials && config.fcm_credentials.gcm && config.fcm_credentials.gcm.androidId;
        const securityToken = config.fcm_credentials && config.fcm_credentials.gcm && config.fcm_credentials.gcm.securityToken;

        if (!androidId || !securityToken) {
            throw new Error('Missing FCM credentials in config (fcm_credentials.gcm.androidId/securityToken)');
        }

        this.status = 'starting';
        this.lastError = null;
        this.configPath = resolvedConfigPath;
        this.autoPair = Boolean(autoPair);
        this.#emitStatus();

        const client = new PushReceiverClient(androidId, securityToken, []);
        client.on('ON_DATA_RECEIVED', async (payload) => {
            await this.#handleNotification(payload);
        });

        try {
            await client.connect();
            this.client = client;
            this.status = 'running';
            this.#emitStatus();

            this.notificationService.log({
                category: 'pairing-listener',
                visible: false,
                message: `Pairing listener started (${this.configPath})`
            });

            return this.getStatus();
        } catch (error) {
            this.status = 'error';
            this.lastError = error.message;
            this.client = null;
            this.#emitStatus();
            throw error;
        }
    }

    async stop() {
        if (this.client) {
            try {
                this.client.destroy();
            } catch (error) {
                this.lastError = error.message;
            }
        }

        this.client = null;
        this.status = 'stopped';
        this.#emitStatus();

        return this.getStatus();
    }

    async ingestPayload(payload, { autoPair } = {}) {
        const shouldAutoPair = autoPair === undefined ? true : Boolean(autoPair);
        const result = await this.pairingService.pairFromNotification(payload, {
            autoPair: shouldAutoPair,
            source: 'listener-ingest'
        });

        this.lastNotificationAt = new Date().toISOString();
        this.#emitStatus();

        return result;
    }

    getStatus() {
        return {
            status: this.status,
            configPath: this.configPath,
            autoPair: this.autoPair,
            listening: Boolean(this.client),
            lastError: this.lastError,
            lastNotificationAt: this.lastNotificationAt
        };
    }

    #emitStatus() {
        this.eventBus.emit('pairing:listener-status', this.getStatus());
    }

    #readConfig(configPath) {
        if (!fs.existsSync(configPath)) {
            throw new Error(`Pairing config not found: ${configPath}`);
        }

        const raw = fs.readFileSync(configPath, 'utf8');
        try {
            return JSON.parse(raw);
        } catch (error) {
            throw new Error(`Pairing config is not valid JSON: ${error.message}`);
        }
    }

    async #handleNotification(payload) {
        try {
            await this.pairingService.pairFromNotification(payload, {
                autoPair: this.autoPair,
                source: 'fcm-listener'
            });

            this.lastNotificationAt = new Date().toISOString();
            this.lastError = null;
            this.#emitStatus();
        } catch (error) {
            this.lastError = error.message;
            this.#emitStatus();

            this.notificationService.log({
                category: 'pairing-listener',
                visible: false,
                message: `Pairing notification handling failed: ${error.message}`
            });
        }
    }
}

module.exports = PairingListenerService;
