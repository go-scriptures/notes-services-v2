/**
 * Unit tests for the activity manager's rules: a note's activity follows the note's current
 * visibility, and a user can read only their own activity. Uses in-memory fakes, so no database is needed.
 *
 * @author: tgibbons via Claude
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createActivityManager } from '../manager/activity_manager.js';
import Note from '../model/note_model.js';
import Activity from '../model/activity_model.js';
import NotFoundError from '../error/not_found_error.js';
import ForbiddenError from '../error/forbidden_error.js';
import ValidationError from '../error/validation_error.js';

// Sam and Mike are seahawks; Drake is a patriot.
const SAM = { userId: 'u-sam', teamId: 't-seahawks' };
const MIKE = { userId: 'u-mike', teamId: 't-seahawks' };
const DRAKE = { userId: 'u-drake', teamId: 't-patriots' };

let notes;
let entries;
let manager;

/**
 * Adds an activity entry, numbered so newer entries sort first.
 */
function log(noteId, userId, action) {
    const sequence = entries.length + 1;
    entries.push(new Activity({
        id: `a-${String(sequence).padStart(4, '0')}`, noteId, userId, action,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString()
    }));
}

/**
 * Returns the newest-first page of entries matching the filter, as the real api does.
 */
function page(filter, limit, offset) {
    return entries.filter(filter)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(offset, offset + limit);
}

beforeEach(() => {
    notes = new Map([['n-1', new Note({
        id: 'n-1', createdBy: 'u-sam', teamId: 't-seahawks', title: 'Plan',
        viewAccess: 'team', editAccess: 'team', locked: false, version: 2
    })]]);
    entries = [];
    log('n-1', 'u-sam', 'created');
    log('n-1', 'u-mike', 'edited');
    log('n-2', 'u-mike', 'deleted');
    const activityApi = {
        async listByNote({ noteId, limit, offset }) {
            return page(entry => entry.noteId === noteId, limit, offset);
        },
        async listByUser({ userId, limit, offset }) {
            return page(entry => entry.userId === userId, limit, offset);
        }
    };
    const noteApi = { async findNoteById(id) { return notes.get(id) ?? null; } };
    manager = createActivityManager({ activityApi, noteApi });
});

// A note's activity
describe('Note activity', () => {
    // A teammate who can see the note reads its activity, newest first.
    test('a teammate reads a visible note\'s activity, newest first', async () => {
        const result = await manager.listNoteActivity(MIKE, 'n-1');
        assert.deepEqual(result.items.map(entry => entry.action), ['edited', 'created']);
        assert.deepEqual(result.paging, { pageNumber: 1, pageSize: 25, hasNextPage: false });
    });

    // Another team cannot see the note, so cannot see its activity.
    test('another team gets not found', async () => {
        await assert.rejects(manager.listNoteActivity(DRAKE, 'n-1'), NotFoundError);
    });

    // Narrowing who can see the note hides its activity from those who lose sight of it.
    test('activity follows the note\'s current visibility', async () => {
        notes.get('n-1').viewAccess = 'author';
        notes.get('n-1').editAccess = 'author';
        await assert.rejects(manager.listNoteActivity(MIKE, 'n-1'), NotFoundError);
        assert.equal((await manager.listNoteActivity(SAM, 'n-1')).items.length, 2);
    });

    // A deleted note's activity cannot be read through the note.
    test('a deleted note\'s activity is not found through the note', async () => {
        await assert.rejects(manager.listNoteActivity(MIKE, 'n-2'), NotFoundError);
    });
});

// A user's own activity
describe('User activity', () => {
    // My activity includes every change I made, including to deleted notes.
    test('lists all my activity, including deleted notes', async () => {
        const result = await manager.listUserActivity(MIKE, 'u-mike');
        assert.deepEqual(result.items.map(entry => `${entry.noteId}:${entry.action}`), ['n-2:deleted', 'n-1:edited']);
    });

    // My activity includes notes I can no longer see.
    test('includes notes I can no longer see', async () => {
        notes.get('n-1').viewAccess = 'author';
        notes.get('n-1').editAccess = 'author';
        const result = await manager.listUserActivity(MIKE, 'u-mike');
        assert.equal(result.items.length, 2);
    });

    // Another user's activity is forbidden.
    test('another user\'s activity is forbidden', async () => {
        await assert.rejects(manager.listUserActivity(SAM, 'u-mike'), ForbiddenError);
    });

    // Paging works the same way as the notes list.
    test('pages with hasNextPage, and rejects bad paging', async () => {
        const first = await manager.listUserActivity(MIKE, 'u-mike', { pageSize: '1' });
        assert.deepEqual(first.paging, { pageNumber: 1, pageSize: 1, hasNextPage: true });
        await assert.rejects(manager.listUserActivity(MIKE, 'u-mike', { pageSize: '0' }), ValidationError);
    });
});
