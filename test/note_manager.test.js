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
