const fs = require('fs');

function serveFile(response, filePath, contentType) {
    const contents = fs.readFileSync(filePath, 'utf8');
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(contents);
}

function writeJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(payload === null ? '' : JSON.stringify(payload));
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let rawBody = '';

        request.on('data', (chunk) => {
            rawBody += chunk;
        });

        request.on('end', () => {
            if (!rawBody) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(rawBody));
            } catch (error) {
                reject(new Error('Invalid JSON request body'));
            }
        });

        request.on('error', reject);
    });
}

function writeLog(level, owner, data) {
    // Check that logging is enabled in the environment variables before attempting to write to the log file
    if (process.env.ENABLE_APP_LOGGING !== '1' && process.env.ENABLE_APP_LOGGING !== 'true') { return;}
    try {
        const logEntry = `[${new Date().toISOString()}] [${level}] [${owner}] ${data}\n`;
        // Log file should be in the logs directory at project root, ensure directory exists and in the correct location
        const logDir = `${__dirname}/../../logs`;
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logFile = `${logDir}/application.log`;
        fs.appendFileSync(logFile, logEntry);
    } catch (err) {
        console.warn('Failed to write to log file:', err.message);
    }
}

function clearLogs() {
    try {
        const logDir = `${__dirname}/../../logs`;
        const logFile = `${logDir}/application.log`;
        if (fs.existsSync(logFile)) {
            fs.writeFileSync(logFile, '');
        }
    } catch (err) {
        console.warn('Failed to clear log file:', err.message);
    }
}

module.exports = { serveFile, writeJson, readJsonBody, writeLog };
