/**
 * Unit tests for the note manager's rules: validation, defaults, and who may see a note.
 * Uses an in-memory fake of the note api, so no database or HTTP is needed.
 *
 * @author: tgibbons via Claude
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createNoteManager } from '../manager/note_manager.js';
import Note from '../model/note_model.js';
import ValidationError from '../error/validation_error.js';
import NotFoundError from '../error/not_found_error.js';
import ForbiddenError from '../error/forbidden_error.js';
import ConflictError from '../error/conflict_error.js';

// Sam and Mike are seahawks; Drake is a patriot.
const SAM = { userId: 'u-sam', teamId: 't-seahawks' };
const MIKE = { userId: 'u-mike', teamId: 't-seahawks' };
const DRAKE = { userId: 'u-drake', teamId: 't-patriots' };
const TEAM_OF = { 'u-sam': 't-seahawks', 'u-mike': 't-seahawks', 'u-drake': 't-patriots' };

let notes;
let activity;
let manager;

/**
 * An in-memory note api with the same methods as the real one. It records activity
 * alongside each change, as the real one does.
 */
function fakeNoteApi() {
    let nextId = 1;
    return {
        async createNote(fields) {
            const sequence = nextId++;
            const at = new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
            const note = new Note({
                ...fields, id: `n-${String(sequence).padStart(4, '0')}`, teamId: TEAM_OF[fields.createdBy],
                locked: false, version: 1, createdAt: at, updatedAt: at
            });
            notes.set(note.id, note);
            activity.push({ noteId: note.id, userId: fields.createdBy, action: 'created' });
            return new Note({ ...note });
        },
        async findNoteById(id) {
            return notes.has(id) ? new Note({ ...notes.get(id) }) : null;
        },
        async listNotes({ teamId, viewerId, authorId, limit, offset }) {
            return [...notes.values()]
                .filter(note => note.teamId === teamId)
                .filter(note => note.createdBy === viewerId || note.viewAccess === 'team')
                .filter(note => authorId === undefined || note.createdBy === authorId)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
                .slice(offset, offset + limit)
                .map(note => new Note({ ...note }));
        },
        async editNote({ id, version, editorId, changes }) {
            const note = notes.get(id);
            if (!note || note.version !== version || note.locked) {
                return null;
            }
            Object.assign(note, changes, { version: note.version + 1, updatedAt: new Date().toISOString() });
            activity.push({ noteId: id, userId: editorId, action: 'edited' });
            return new Note({ ...note });
        }
    };
}

beforeEach(() => {
    notes = new Map();
    activity = [];
    manager = createNoteManager({ noteApi: fakeNoteApi() });
});

// Creating a note
describe('Create', () => {
    // A title alone gets the defaults: no body, author-only access, unlocked, version 1.
    test('applies the defaults', async () => {
        const note = await manager.createNote(SAM, { title: 'First' });
        assert.equal(note.body, null);
        assert.equal(note.viewAccess, 'author');
        assert.equal(note.editAccess, 'author');
        assert.equal(note.locked, false);
        assert.equal(note.version, 1);
        assert.equal(note.createdBy, 'u-sam');
    });

    // The access scopes given are stored; unknown fields and a caller-supplied author are ignored.
    test('stores access scopes and ignores other fields', async () => {
        const note = await manager.createNote(SAM, { title: 'T', viewAccess: 'team', editAccess: 'team', createdBy: 'u-drake', locked: true });
        assert.equal(note.viewAccess, 'team');
        assert.equal(note.editAccess, 'team');
        assert.equal(note.createdBy, 'u-sam');
        assert.equal(note.locked, false);
    });

    // Edit may not be wider than view: no one can edit what they cannot see.
    test('rejects edit access wider than view access', async () => {
        const err = await manager.createNote(SAM, { title: 'T', viewAccess: 'author', editAccess: 'team' }).catch(error => error);
        assert.ok(err instanceof ValidationError);
        assert.deepEqual(err.details, ['editAccess cannot be wider than viewAccess']);
    });

    // Every problem is reported at once.
    test('reports every problem', async () => {
        const err = await manager.createNote(SAM, { body: 5, viewAccess: 'everyone', editAccess: 'TEAM' }).catch(error => error);
        assert.ok(err instanceof ValidationError);
        assert.equal(err.details.length, 4);
    });

    // No request body at all is a validation error, not a crash.
    test('rejects a missing request body', async () => {
        await assert.rejects(manager.createNote(SAM, undefined), ValidationError);
    });

    // Creating a note records a 'created' activity entry by its author.
    test('records the creation in the activity log', async () => {
        const note = await manager.createNote(SAM, { title: 'Logged' });
        assert.deepEqual(activity, [{ noteId: note.id, userId: 'u-sam', action: 'created' }]);
    });
});

// Reading one note
describe('Read one', () => {
    // The author reads their own author-only note.
    test('the author reads their own note', async () => {
        const note = await manager.createNote(SAM, { title: 'Mine' });
        assert.equal((await manager.getNote(SAM, note.id)).id, note.id);
    });

    // A teammate reads a team-visible note.
    test('a teammate reads a team note', async () => {
        const note = await manager.createNote(SAM, { title: 'Shared', viewAccess: 'team' });
        assert.equal((await manager.getNote(MIKE, note.id)).id, note.id);
    });

    // A teammate cannot see an author-only note: not found, so it is not revealed.
    test('a teammate gets not found for an author-only note', async () => {
        const note = await manager.createNote(SAM, { title: 'Private' });
        await assert.rejects(manager.getNote(MIKE, note.id), NotFoundError);
    });

    // Another team never sees a note, even a team note.
    test('another team gets not found for a team note', async () => {
        const note = await manager.createNote(SAM, { title: 'Shared', viewAccess: 'team' });
        await assert.rejects(manager.getNote(DRAKE, note.id), NotFoundError);
    });

    // An ID that does not exist.
    test('an unknown id is not found', async () => {
        await assert.rejects(manager.getNote(SAM, 'no-such-id'), NotFoundError);
    });
});

// Listing notes
describe('List', () => {
    let samPrivate, samTeam, mikePrivate, mikeTeam;

    beforeEach(async () => {
        samPrivate = await manager.createNote(SAM, { title: 'sam private' });
        samTeam = await manager.createNote(SAM, { title: 'sam team', viewAccess: 'team' });
        mikePrivate = await manager.createNote(MIKE, { title: 'mike private' });
        mikeTeam = await manager.createNote(MIKE, { title: 'mike team', viewAccess: 'team' });
        await manager.createNote(DRAKE, { title: 'drake team', viewAccess: 'team' });
    });

    /**
     * Returns the IDs of a list result, in the order returned.
     */
    function ids(result) {
        return result.items.map(note => note.id);
    }

    // By default: my notes plus teammates' team notes, newest first, page 1 of 25.
    test('lists what I can see, newest first, page 1 of 25', async () => {
        const result = await manager.listNotes(SAM);
        assert.deepEqual(ids(result), [mikeTeam.id, samTeam.id, samPrivate.id]);
        assert.deepEqual(result.paging, { pageNumber: 1, pageSize: 25, hasNextPage: false });
    });

    // A teammate sees their own private notes, never mine.
    test('a teammate sees their own private notes but not mine', async () => {
        const result = await manager.listNotes(MIKE);
        assert.deepEqual(ids(result), [mikeTeam.id, mikePrivate.id, samTeam.id]);
    });

    // author narrows the list to one author; my own ID gives my notes.
    test('author narrows the list, including to my own notes', async () => {
        assert.deepEqual(ids(await manager.listNotes(SAM, { author: 'u-mike' })), [mikeTeam.id]);
        assert.deepEqual(ids(await manager.listNotes(SAM, { author: 'u-sam' })), [samTeam.id, samPrivate.id]);
    });

    // hasNextPage is true when another page exists, and false on the last page.
    test('pages through the notes with hasNextPage', async () => {
        const first = await manager.listNotes(SAM, { pageSize: '2' });
        assert.deepEqual(ids(first), [mikeTeam.id, samTeam.id]);
        assert.deepEqual(first.paging, { pageNumber: 1, pageSize: 2, hasNextPage: true });
        const second = await manager.listNotes(SAM, { pageSize: '2', pageNumber: '2' });
        assert.deepEqual(ids(second), [samPrivate.id]);
        assert.equal(second.paging.hasNextPage, false);
    });

    // Bad paging values are all reported at once; pageSize may be at most 100.
    test('rejects invalid paging values', async () => {
        const err = await manager.listNotes(SAM, { pageNumber: '0', pageSize: '101' }).catch(error => error);
        assert.ok(err instanceof ValidationError);
        assert.equal(err.details.length, 2);
        await manager.listNotes(SAM, { pageSize: '100' });
    });

    // An author given twice arrives as a list, and is rejected.
    test('rejects a repeated author', async () => {
        await assert.rejects(manager.listNotes(SAM, { author: ['u-sam', 'u-mike'] }), ValidationError);
    });
});

// Editing a note's text
describe('Edit', () => {
    // A teammate with edit access changes the body; the version moves on and the edit is logged.
    test('a teammate with edit access edits, and the version moves on', async () => {
        const note = await manager.createNote(SAM, { title: 'Plan', viewAccess: 'team', editAccess: 'team' });
        const edited = await manager.editNote(MIKE, note.id, { body: 'run the ball', version: 1 });
        assert.equal(edited.body, 'run the ball');
        assert.equal(edited.title, 'Plan');
        assert.equal(edited.version, 2);
        assert.deepEqual(activity.at(-1), { noteId: note.id, userId: 'u-mike', action: 'edited' });
    });

    // A teammate who can see but not edit is forbidden.
    test('a teammate without edit access is forbidden', async () => {
        const note = await manager.createNote(SAM, { title: 'Read only', viewAccess: 'team' });
        await assert.rejects(manager.editNote(MIKE, note.id, { title: 'x', version: 1 }), ForbiddenError);
    });

    // A note the caller cannot see is not found.
    test('another team gets not found', async () => {
        const note = await manager.createNote(SAM, { title: 'Plan', viewAccess: 'team', editAccess: 'team' });
        await assert.rejects(manager.editNote(DRAKE, note.id, { title: 'x', version: 1 }), NotFoundError);
    });

    // An edit based on an old version is rejected, and the newer change survives.
    test('a stale version is a conflict, and nothing is lost', async () => {
        const note = await manager.createNote(SAM, { title: 'Plan', viewAccess: 'team', editAccess: 'team' });
        await manager.editNote(SAM, note.id, { body: 'first', version: 1 });
        const err = await manager.editNote(MIKE, note.id, { body: 'second', version: 1 }).catch(error => error);
        assert.ok(err instanceof ConflictError);
        assert.match(err.message, /changed since version 1/);
        assert.equal((await manager.getNote(SAM, note.id)).body, 'first');
    });

    // A locked note cannot be edited, even by its author.
    test('a locked note is a conflict, even for the author', async () => {
        const note = await manager.createNote(SAM, { title: 'Final' });
        notes.get(note.id).locked = true;
        const err = await manager.editNote(SAM, note.id, { title: 'x', version: 1 }).catch(error => error);
        assert.ok(err instanceof ConflictError);
        assert.equal(err.message, 'note is locked');
    });

    // The version is required, and every problem is reported before the note is looked up.
    test('requires the version and reports every problem', async () => {
        const err = await manager.editNote(SAM, 'no-such-id', { title: ' ', body: 5 }).catch(error => error);
        assert.ok(err instanceof ValidationError);
        assert.equal(err.details.length, 3);
    });

    // Attributes cannot be changed through a text edit.
    test('ignores attribute fields in a text edit', async () => {
        const note = await manager.createNote(SAM, { title: 'T' });
        const edited = await manager.editNote(SAM, note.id, { title: 'U', viewAccess: 'team', locked: true, version: 1 });
        assert.equal(edited.viewAccess, 'author');
        assert.equal(edited.locked, false);
    });
});
