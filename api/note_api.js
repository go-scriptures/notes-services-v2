/**
 * Data access for notes. Storage only: no business rules.
 * Maps snake_case columns to camelCase objects. A note's team is read through its author.
 *
 * Every change writes its activity entry in the same SQL statement as the change itself,
 * so the log can never miss a change or record one that did not happen.
 *
 * @author: tgibbons via Claude
 */
import Note from '../model/note_model.js';
import { Action } from '../enum/action_enum.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The text fields an edit may change, mapped to their columns.
const TEXT_COLUMNS = { title: 'title', body: 'body' };

/**
 * Turns a database row (a note joined with its author's team_id) into a Note.
 */
function toNote(row) {
    return new Note({
        id: row.id,
        createdBy: row.created_by,
        teamId: row.team_id,
        title: row.title,
        body: row.body,
        viewAccess: row.view_access,
        editAccess: row.edit_access,
        locked: row.locked,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}

/**
 * Creates the note api on a database pool.
 */
export function createNoteApi(pool) {
    return {
        /**
         * Stores a new note and its 'created' activity entry, and returns the note with its author's team.
         */
        async createNote({ createdBy, title, body, viewAccess, editAccess }) {
            const { rows } = await pool.query(
                `WITH inserted AS (
                     INSERT INTO notes (created_by, title, body, view_access, edit_access)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING *
                 ), logged AS (
                     INSERT INTO activity (note_id, user_id, action)
                     SELECT id, created_by, $6 FROM inserted
                 )
                 SELECT inserted.*, users.team_id
                 FROM inserted JOIN users ON users.id = inserted.created_by`,
                [createdBy, title, body, viewAccess, editAccess, Action.CREATED]
            );
            return toNote(rows[0]);
        },

        /**
         * Returns the note with this ID, with its author's team, or null.
         * An ID that is not a UUID cannot exist, so it returns null rather than a database error.
         */
        async findNoteById(id) {
            if (!UUID_PATTERN.test(id)) {
                return null;
            }
            const { rows } = await pool.query(
                `SELECT notes.*, users.team_id
                 FROM notes JOIN users ON users.id = notes.created_by
                 WHERE notes.id = $1`,
                [id]
            );
            return rows[0] ? toNote(rows[0]) : null;
        },

        /**
         * Returns one page of a team's notes, newest first, matching the filters the manager chose:
         *   viewerId: only notes this user may see (their own, plus notes the team may see);
         *   authorId: only notes by this author (optional).
         * The filters run in the query, not afterwards, so every page is full and correctly ordered.
         * An authorId that is not a UUID cannot match, so it returns an empty page.
         */
        async listNotes({ teamId, viewerId, authorId, limit, offset }) {
            if (authorId !== undefined && !UUID_PATTERN.test(authorId)) {
                return [];
            }
            const params = [teamId, viewerId, limit, offset];
            let authorFilter = '';
            if (authorId !== undefined) {
                params.push(authorId);
                authorFilter = `AND notes.created_by = $${params.length}`;
            }
            const { rows } = await pool.query(
                `SELECT notes.*, users.team_id
                 FROM notes JOIN users ON users.id = notes.created_by
                 WHERE users.team_id = $1
                   AND (notes.created_by = $2 OR notes.view_access = 'team')
                   ${authorFilter}
                 ORDER BY notes.created_at DESC, notes.id DESC
                 LIMIT $3 OFFSET $4`,
                params
            );
            return rows.map(toNote);
        },

        /**
         * Changes a note's text (title and/or body) and records the 'edited' activity entry,
         * in one statement, only if the note is still at the given version and unlocked.
         * Increments the version. Returns the note with its author's team, or null when
         * nothing was changed (the note is gone, locked, or at another version).
         */
        async editNote({ id, version, editorId, changes }) {
            const params = [id, version, editorId, Action.EDITED];
            const assignments = Object.entries(changes).map(([field, value]) => {
                params.push(value);
                return `${TEXT_COLUMNS[field]} = $${params.length}`;
            });
            const { rows } = await pool.query(
                `WITH updated AS (
                     UPDATE notes
                     SET ${assignments.join(', ')}, version = version + 1, updated_at = now()
                     WHERE id = $1 AND version = $2 AND NOT locked
                     RETURNING *
                 ), logged AS (
                     INSERT INTO activity (note_id, user_id, action)
                     SELECT id, $3, $4 FROM updated
                 )
                 SELECT updated.*, users.team_id
                 FROM updated JOIN users ON users.id = updated.created_by`,
                params
            );
            return rows[0] ? toNote(rows[0]) : null;
        }
    };
}
