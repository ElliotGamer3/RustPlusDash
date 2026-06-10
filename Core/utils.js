import fs from 'fs';
function writeServerLog(level, owner, data) {
    // Check that logging is enabled in the environment variables before attempting to write to the log file
    if (process.env.DISABLE_SERVER_LOGGING === '1' && process.env.DISABLE_SERVER_LOGGING === 'true') { return;}
    try {
        const logEntry = `[${new Date().toISOString()}] [${level}] [${owner}] ${data}\n`;
        // Log file should be in the logs directory at project root, ensure directory exists and in the correct location
        const logDir = `../logs`;
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logFile = `${logDir}/server.log`;
        fs.appendFileSync(logFile, logEntry);
    } catch (err) {
        console.warn('Failed to write to log file:', err.message);
    }
}

export { writeServerLog };