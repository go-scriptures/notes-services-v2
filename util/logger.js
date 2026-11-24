/**
 * Structured logger: one JSON object per line on stdout, so a log platform can search
 * and graph the fields. A child logger carries extra fields (such as a request ID)
 * on every line it writes.
 *
 * @author: tgibbons via Claude
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Creates a logger that writes messages at or above the given level.
 * fields are added to every line; write is the output function (stdout by default).
 */
export function createLogger({ level = 'info', fields = {}, write = line => process.stdout.write(line + '\n') } = {}) {
    if (!(level in LEVELS)) {
        throw new Error(`Unknown log level ${level}; use one of ${Object.keys(LEVELS).join(', ')}`);
    }
    const threshold = LEVELS[level];

    /**
     * Writes one log line when the message's level is at or above the threshold.
     */
    function log(messageLevel, message, extra = {}) {
        if (LEVELS[messageLevel] < threshold) {
            return;
        }
        write(JSON.stringify({ time: new Date().toISOString(), level: messageLevel, message, ...fields, ...extra }));
    }

    return {
        debug: (message, extra) => log('debug', message, extra),
        info: (message, extra) => log('info', message, extra),
        warn: (message, extra) => log('warn', message, extra),
        error: (message, extra) => log('error', message, extra),
        // Returns a logger that adds these fields to every line, as well as this logger's own.
        child: childFields => createLogger({ level, fields: { ...fields, ...childFields }, write })
    };
}
