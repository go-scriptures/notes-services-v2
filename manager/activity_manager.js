/**
 * Business rules for reading the activity log. Throws typed errors and knows nothing about HTTP.
 *
 * A note's activity follows the note's current visibility. A user's own activity is always
 * theirs, including notes they can no longer see and deleted notes; entries carry no content.
 *
 * @author: tgibbons via Claude
 */
import { canView, readPaging, toPage } from './note_manager.js';
import ValidationError from '../error/validation_error.js';
import NotFoundError from '../error/not_found_error.js';
import ForbiddenError from '../error/forbidden_error.js';

/**
 * Reads the paging values, throwing a ValidationError listing every invalid one.
 */
function readValidPaging(query) {
    const details = [];
    const paging = readPaging(query, details);
    if (details.length > 0) {
        throw new ValidationError('Invalid paging', details);
    }
    return paging;
}

/**
 * Creates the activity manager with the activity api and the note api.
 */
export function createActivityManager({ activityApi, noteApi }) {
    return {
        /**
         * Lists one page of a note's activity, newest first, if the caller can see the note now; 404 otherwise.
         */
        async listNoteActivity(identity, noteId, query = {}) {
            const paging = readValidPaging(query);
            const note = await noteApi.findNoteById(noteId);
            if (!note || !canView(note, identity)) {
                throw new NotFoundError(`Note ${noteId} not found`);
            }
            const rows = await activityApi.listByNote({ noteId, limit: paging.limit, offset: paging.offset });
            return toPage(rows, paging);
        },

        /**
         * Lists one page of the caller's own activity across all notes, newest first.
         * The user ID must be the caller's own; anyone else's is 403.
         */
        async listUserActivity(identity, userId, query = {}) {
            const paging = readValidPaging(query);
            if (userId !== identity.userId) {
                throw new ForbiddenError('You can only read your own activity');
            }
            const rows = await activityApi.listByUser({ userId, limit: paging.limit, offset: paging.offset });
            return toPage(rows, paging);
        }
    };
}
