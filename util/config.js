/**
 * Service configuration, read once from environment variables.
 * A required variable that is missing stops the service at startup with a clear message.
 *
 * @author: tgibbons via Claude
 */

/**
 * Returns the value of a required environment variable, or throws naming the variable.
 */
function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value;
}

/**
 * Reads the configuration from the environment.
 */
export function loadConfig() {
    return {
        port: Number(process.env.PORT ?? 3000),
        databaseUrl: required('DATABASE_URL'),
        logLevel: process.env.LOG_LEVEL ?? 'info'
    };
}
