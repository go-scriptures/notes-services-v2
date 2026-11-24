/**
 * The PostgreSQL connection pool, and a check that the database answers.
 * Domain data is reached only through the api tier; operational code (health, migrations,
 * seeding) uses the pool directly, outside the tiers.
 *
 * @author: tgibbons via Claude
 */
import pg from 'pg';

/**
 * Creates a connection pool for the given database URL.
 * A connection error on an idle client is logged rather than crashing the process.
 */
export function createPool(databaseUrl, logger) {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    pool.on('error', err => logger.error('idle database client error', { error: err.message }));
    return pool;
}

/**
 * Runs a trivial query, and throws when the database cannot be reached.
 */
export async function checkDatabase(pool) {
    await pool.query('SELECT 1');
}
