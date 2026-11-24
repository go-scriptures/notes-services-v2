/**
 * Data access for the activity log. Storage only: no business rules.
 * Entries are written by the note api, in the same statement as each change; this api reads them.
 *
 * @author: tgibbons via Claude
 */
import Activity from '../model/activity_model.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns a database row into an Activity entry.
 */
function toActivity(row) {
    return new Activity({
        id: row.id,
        noteId: row.note_id,
        userId: row.user_id,
        action: row.action,
        createdAt: row.created_at
    });
}

/**
 * Creates the activity api on a database pool.
 */
export function createActivityApi(pool) {
    /**
     * Returns one page of entries where the given column equals the value, newest first.
     * A value that is not a UUID cannot match, so it returns an empty page.
     */
    async function listBy(column, value, limit, offset) {
        if (!UUID_PATTERN.test(value)) {
            return [];
        }
        const { rows } = await pool.query(
            `SELECT * FROM activity WHERE ${column} = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [value, limit, offset]
        );
        return rows.map(toActivity);
    }

    return {
        /**
         * Returns one page of a note's activity, newest first.
         */
        async listByNote({ noteId, limit, offset }) {
            return listBy('note_id', noteId, limit, offset);
        },

        /**
         * Returns one page of a user's activity across all notes, newest first.
         */
        async listByUser({ userId, limit, offset }) {
            return listBy('user_id', userId, limit, offset);
        }
    };
}
