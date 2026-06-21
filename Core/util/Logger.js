const fs = require('fs');
const path = require('path');

class Log {
    constructor(owner, logFile, options = {}) {
        this.owner = owner;
        this.logFile = logFile;
        this.options = options;
    }

    /**
     * Create the log file if it doesn't exist and set up any necessary configurations based on options.
     */
    async initialize() {
        if (process.env.ENABLE_APP_LOGGING === 'true') {
            console.log(`[Logger] Initializing log for ${this.owner} at ${this.logFile}`);
        }
        if (!fs.existsSync(this.logFile)) {
            fs.writeFileSync(this.logFile, '');
        }
        if (this.options.clearOnStart) {
            fs.writeFileSync(this.logFile, '');
        }
    }

    async write(level, message, data = null) {
        return new Promise((resolve, reject) => {
            try {
                this._write(level, message, data);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    _write(level, message, data = null) {
        const timestamp = new Date().toISOString();
        if (data) { message += ` | Data: ${JSON.stringify(data)}`; }
        const logEntry = `[${timestamp}] [${level.toUpperCase()}] [${this.owner}] ${message}\n`;
        if (process.env.ENABLE_APP_LOGGING === 'true') {
            fs.appendFileSync(this.logFile, logEntry.trim());
        }
    }

    info(message, data = null) {
        return this.write('info', message, data);
    }

    warn(message, data = null) {
        return this.write('warn', message, data);
    }

    error(message, data = null) {
        return this.write('error', message, data);
    }
}

/**
 * Logger has a Log
 */
class Logger {
    // Make singleton instance of Logger available as a static property
    static instance = this.instance || null;
    constructor(options = {}) {
        if (Logger.instance) {
            return Logger.instance;
        }
        this.logs = {};
        this.options = options;
        Logger.instance = this;
    }
    async getLog(owner) {
        if (!this.logs[owner]) {
            const logFile = path.join(__dirname, '..', 'logs', `${owner}.log`);
            const log = new Log(owner, logFile, this.options);
            await log.initialize();
            this.logs[owner] = log;
        }
        return this.logs[owner];
    }

    async writeLog(owner, level, message, data = null) {
        const log = await this.getLog(owner);
        await log.write(level, message, data);
    }
}