/**
 * Starts the notes service: reads the configuration, connects the database pool,
 * applies pending migrations, listens, and shuts down gracefully on SIGTERM or SIGINT.
 *
 * Graceful shutdown stops accepting connections, lets requests in flight finish,
 * then closes the database pool. If that takes longer than the limit, the process exits anyway.
 *
 * @author: tgibbons via Claude
 */
import './util/check_node_version.js';
import { loadConfig } from './util/config.js';
import { createLogger } from './util/logger.js';
import { createPool } from './util/db.js';
import { migrate } from './util/migrate.js';
import { createApp } from './app.js';

// Shorter than Docker's 10-second grace period, so the service logs why it stopped before being killed.
const SHUTDOWN_LIMIT_MS = 8_000;

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const pool = createPool(config.databaseUrl, logger);

// The schema must be current before the first request is served; a failed migration stops the service.
try {
    await migrate(pool, logger);
} catch (err) {
    logger.error('startup failed: database migration', { error: err.message });
    process.exit(1);
}

const app = createApp({ pool, logger });

const server = app.listen(config.port, () => {
    logger.info('notes service listening', { port: config.port });
});

/**
 * Stops the server and closes the pool, exiting non-zero if it cannot finish within the limit.
 */
function shutdown(signal) {
    logger.info('shutting down', { signal });
    setTimeout(() => {
        logger.error('shutdown took too long; exiting');
        process.exit(1);
    }, SHUTDOWN_LIMIT_MS).unref();

    server.close(async () => {
        await pool.end();
        logger.info('shutdown complete');
        process.exit(0);
    });
    server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
