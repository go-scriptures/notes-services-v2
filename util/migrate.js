/**
 * Applies the SQL files in migrations/ that have not been applied yet, in file-name order.
 *
 * Each file runs in its own transaction and is recorded in schema_migrations, so it runs once.
 * A PostgreSQL advisory lock makes this safe when several instances start at the same time:
 * one migrates while the others wait, then find nothing left to do.
 *
 * @author: tgibbons via Claude
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
// Any fixed number shared by all instances; it names this lock.
const MIGRATION_LOCK_ID = 727001;

/**
 * Applies pending migrations and returns the names of the files applied.
 */
export async function migrate(pool, logger) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            name        text        PRIMARY KEY,
            applied_at  timestamptz NOT NULL DEFAULT now()
        )`);

        const { rows } = await client.query('SELECT name FROM schema_migrations');
        const applied = new Set(rows.map(row => row.name));
        const files = (await readdir(MIGRATIONS_DIR)).filter(file => file.endsWith('.sql')).sort();
        const pending = files.filter(file => !applied.has(file));

        for (const file of pending) {
            const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                logger.info('migration applied', { migration: file });
            } catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${file} failed: ${err.message}`);
            }
        }
        return pending;
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
        client.release();
    }
}
