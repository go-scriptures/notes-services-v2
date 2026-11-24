/**
 * Loads the demo teams and users. Safe to run more than once: existing rows are left alone.
 *
 * There is no registration API; in production an identity provider owns users.
 * Every demo user has the password in SEED_PASSWORD.
 *
 * @author: tgibbons via Claude
 */
import '../util/check_node_version.js';
import { loadConfig } from '../util/config.js';
import { createLogger } from '../util/logger.js';
import { createPool } from '../util/db.js';
import { migrate } from '../util/migrate.js';
import { hashPassword } from '../util/password.js';

const TEAMS = ['seahawks', 'patriots'];
const USERS = [
    { email: 'sdarnold@seahawks.com', firstName: 'Sam', lastName: 'Darnold', team: 'seahawks' },
    { email: 'mmacdonald@seahawks.com', firstName: 'Mike', lastName: 'Macdonald', team: 'seahawks' },
    { email: 'kwalker@seahawks.com', firstName: 'Kenneth', lastName: 'Walker', team: 'seahawks' },
    { email: 'dmaye@patriots.com', firstName: 'Drake', lastName: 'Maye', team: 'patriots' },
    { email: 'mvrabel@patriots.com', firstName: 'Mike', lastName: 'Vrabel', team: 'patriots' },
    { email: 'rstevenson@patriots.com', firstName: 'Rhamondre', lastName: 'Stevenson', team: 'patriots' }
];

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
const pool = createPool(config.databaseUrl, logger);
const password = process.env.SEED_PASSWORD;
if (!password) {
    throw new Error('SEED_PASSWORD is required');
}

try {
    await migrate(pool, logger);
    for (const name of TEAMS) {
        await pool.query('INSERT INTO teams (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    }
    for (const user of USERS) {
        const result = await pool.query(
            `INSERT INTO users (team_id, email, first_name, last_name, password_hash)
             SELECT id, $2, $3, $4, $5 FROM teams WHERE name = $1
             ON CONFLICT (email) DO NOTHING`,
            [user.team, user.email, user.firstName, user.lastName, await hashPassword(password)]
        );
        logger.info(result.rowCount ? 'user seeded' : 'user already present', { email: user.email, team: user.team });
    }
} finally {
    await pool.end();
}
