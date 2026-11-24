/**
 * Data access for users. Storage only: no business rules.
 * Maps snake_case columns to camelCase objects.
 *
 * @author: tgibbons via Claude
 */
import User from '../model/user_model.js';

const USER_COLUMNS = `id, team_id, email, first_name, last_name, active,
    password_changed_at, created_at, updated_at`;

/**
 * Turns a database row into a User.
 */
function toUser(row) {
    return new User({
        id: row.id,
        teamId: row.team_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        active: row.active,
        passwordChangedAt: row.password_changed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}

/**
 * Creates the user api on a database pool.
 */
export function createUserApi(pool) {
    return {
        /**
         * Returns { user, passwordHash } for the email, or null. Only the login check uses the hash.
         */
        async findCredentialsByEmail(email) {
            const { rows } = await pool.query(
                `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
            return rows[0] ? { user: toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
        },

        /**
         * Returns the user with this ID, or null.
         */
        async findUserById(id) {
            const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
            return rows[0] ? toUser(rows[0]) : null;
        }
    };
}
