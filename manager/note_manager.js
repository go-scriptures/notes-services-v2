/**
 * Business rules for notes: validation, and who may see and edit a note.
 * Throws typed errors and knows nothing about HTTP.
 *
 * Every function takes the caller's identity: { userId, teamId }.
 *
 * @author: tgibbons via Claude
 */
import { Access, isValidAccess, isWider } from '../enum/access_enum.js';
import ValidationError from '../error/validation_error.js';
import NotFoundError from '../error/not_found_error.js';

const ACCESS_RULE = `must be one of ${Object.values(Access).join(', ')}`;
const DEFAULT_PAGE_NUMBER = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Reads a whole-number query parameter. Returns the default when it is missing,
 * or null when it is not a whole number between min and max.
 */
export function readWholeNumber(value, defaultValue, min, max) {
    if (value === undefined) {
        return defaultValue;
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        return null;
    }
    const number = Number(value);
    return number >= min && number <= max ? number : null;
}

/**
 * Reads pageNumber and pageSize from a query, adding a problem to details for each invalid value.
 * Returns { pageNumber, pageSize, limit, offset }, where limit reads one extra row to learn
 * whether another page exists.
 */
export function readPaging(query, details) {
    const pageNumber = readWholeNumber(query.pageNumber, DEFAULT_PAGE_NUMBER, 1, Number.MAX_SAFE_INTEGER);
    if (pageNumber === null) {
        details.push('pageNumber must be a whole number of 1 or more');
    }
    const pageSize = readWholeNumber(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    if (pageSize === null) {
        details.push(`pageSize must be a whole number from 1 to ${MAX_PAGE_SIZE}`);
    }
    return { pageNumber, pageSize, limit: pageSize + 1, offset: (pageNumber - 1) * pageSize };
}

/**
 * Turns the rows read with readPaging's limit into { items, paging }.
 */
export function toPage(rows, { pageNumber, pageSize }) {
    return {
        items: rows.slice(0, pageSize),
        paging: { pageNumber, pageSize, hasNextPage: rows.length > pageSize }
    };
}

/**
 * Returns true when the value is a string with at least one non-space character.
 */
function isNonBlankString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns true when an access scope lets the caller in: 'author' allows only the note's author;
 * 'team' allows everyone in the author's team. A wider scope is added here as one more case.
 */
function scopeAllows(scope, note, identity) {
    switch (scope) {
        case Access.AUTHOR:
            return note.createdBy === identity.userId;
        case Access.TEAM:
            return note.teamId === identity.teamId;
        default:
            return false;
    }
}

/**
 * Returns true when the caller may see the note.
 */
export function canView(note, identity) {
    return scopeAllows(note.viewAccess, note, identity);
}

/**
 * Returns true when the caller may edit the note's text (the lock is checked separately).
 */
export function canEdit(note, identity) {
    return scopeAllows(note.editAccess, note, identity);
}

/**
 * Checks a viewAccess and editAccess pair, adding a problem to details for each invalid value,
 * and for an edit scope wider than the view scope.
 */
function checkAccess(viewAccess, editAccess, details) {
    if (!isValidAccess(viewAccess)) {
        details.push(`viewAccess ${ACCESS_RULE}`);
    }
    if (!isValidAccess(editAccess)) {
        details.push(`editAccess ${ACCESS_RULE}`);
    }
    if (isValidAccess(viewAccess) && isValidAccess(editAccess) && isWider(editAccess, viewAccess)) {
        details.push('editAccess cannot be wider than viewAccess');
    }
}

/**
 * Creates the note manager with the note api.
 */
export function createNoteManager({ noteApi }) {
    /**
     * Returns the note when the caller may see it; otherwise throws NotFoundError,
     * so a note the caller cannot see is indistinguishable from one that does not exist.
     */
    async function findVisibleNote(identity, id) {
        const note = await noteApi.findNoteById(id);
        if (!note || !canView(note, identity)) {
            throw new NotFoundError(`Note ${id} not found`);
        }
        return note;
    }

    return {
        /**
         * Creates a note written by the caller. title is required; body is optional;
         * viewAccess and editAccess default to author, and edit may not be wider than view.
         * A new note is unlocked. Unknown fields are ignored. Every problem is reported at once.
         */
        async createNote(identity, input = {}) {
            const details = [];
            if (!isNonBlankString(input.title)) {
                details.push('title is required and must be a non-blank string');
            }
            if (input.body !== undefined && input.body !== null && typeof input.body !== 'string') {
                details.push('body must be a string');
            }
            const viewAccess = input.viewAccess ?? Access.AUTHOR;
            const editAccess = input.editAccess ?? Access.AUTHOR;
            checkAccess(viewAccess, editAccess, details);
            if (details.length > 0) {
                throw new ValidationError('Invalid note', details);
            }

            return noteApi.createNote({
                createdBy: identity.userId,
                title: input.title,
                body: input.body ?? null,
                viewAccess,
                editAccess
            });
        },

        /**
         * Returns one note the caller may see; 404 otherwise.
         */
        async getNote(identity, id) {
            return findVisibleNote(identity, id);
        },

        /**
         * Lists one page of the notes the caller can see in their team, newest first.
         * author (a user ID) narrows the list to one author; the caller's own notes are author={own ID}.
         * pageNumber defaults to 1 and pageSize to 25 (at most 100).
         */
        async listNotes(identity, query = {}) {
            const details = [];
            if (query.author !== undefined && typeof query.author !== 'string') {
                details.push('author may be given only once');
            }
            const paging = readPaging(query, details);
            if (details.length > 0) {
                throw new ValidationError('Invalid list query', details);
            }

            const rows = await noteApi.listNotes({
                teamId: identity.teamId,
                viewerId: identity.userId,
                authorId: query.author,
                limit: paging.limit,
                offset: paging.offset
            });
            return toPage(rows, paging);
        }
    };
}
