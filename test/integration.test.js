/**
 * Integration tests: the whole service over HTTP against a real PostgreSQL database.
 * They prove what the unit tests' fakes cannot: the SQL itself, including the one-statement
 * activity writes, the version check under concurrent edits, the lock, and the database constraints.
 *
 * Runs only when TEST_DATABASE_URL is set (see `make test-integration`); skipped otherwise.
 * The test database is emptied before each test.
 *
 * @author: tgibbons via Claude
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createLogger } from '../util/logger.js';
import { createPool } from '../util/db.js';
import { migrate } from '../util/migrate.js';
import { createTokenService } from '../util/token.js';
import { hashPassword } from '../util/password.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const PASSWORD = 'integration-test-password';

describe('Integration', { skip: !databaseUrl && 'TEST_DATABASE_URL is not set' }, () => {
    let pool;
    let server;
    let baseUrl;
    const tokens = {};

    before(async () => {
        const logger = createLogger({ level: 'error' });
        pool = createPool(databaseUrl, logger);
        await migrate(pool, logger);
        const tokenService = createTokenService({
            secret: 'integration-secret-at-least-thirty-two-bytes', issuer: 'notes-service', audience: 'notes-api', ttlSeconds: 300
        });
        server = createApp({ pool, logger, tokenService }).listen(0);
        await new Promise(resolve => server.once('listening', resolve));
        baseUrl = `http://localhost:${server.address().port}`;
    });

    after(async () => {
        server.closeAllConnections();
        server.close();
        await pool.end();
    });

    // A clean database for every test: two teams; ann and bob on one, cal on the other.
    beforeEach(async () => {
        await pool.query('TRUNCATE activity, notes, users, teams');
        const hash = await hashPassword(PASSWORD);
        await pool.query(`INSERT INTO teams (name) VALUES ('alpha'), ('beta')`);
        for (const [email, team] of [['ann@test.local', 'alpha'], ['bob@test.local', 'alpha'], ['cal@test.local', 'beta']]) {
            await pool.query(
                `INSERT INTO users (team_id, email, first_name, last_name, password_hash)
                 SELECT id, $1, 'Test', 'User', $2 FROM teams WHERE name = $3`, [email, hash, team]);
            tokens[email.split('@')[0]] = (await call('POST', '/auth/login', null, { email, password: PASSWORD })).body.accessToken;
        }
    });

    /**
     * Sends a request as the named user (or no one) and returns the status and parsed body.
     */
    async function call(method, path, as, body) {
        const headers = { 'Content-Type': 'application/json' };
        if (as) {
            headers.Authorization = `Bearer ${tokens[as]}`;
        }
        const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body && JSON.stringify(body) });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : null };
    }

    /**
     * Returns the actions recorded for a note, oldest first, read straight from the database.
     */
    async function actionsFor(noteId) {
        const { rows } = await pool.query('SELECT action FROM activity WHERE note_id = $1 ORDER BY created_at, id', [noteId]);
        return rows.map(row => row.action);
    }

    // Creating a note writes its 'created' activity row in the same statement.
    test('creating a note records its activity', async () => {
        const created = await call('POST', '/notes', 'ann', { title: 'Plan' });
        assert.equal(created.status, 201);
        assert.deepEqual(await actionsFor(created.body.id), ['created']);
    });

    // Two simultaneous edits of the same version: exactly one succeeds, the other is a conflict.
    test('concurrent edits of one version: exactly one wins', async () => {
        const note = (await call('POST', '/notes', 'ann', { title: 'Plan', viewAccess: 'team', editAccess: 'team' })).body;
        const results = await Promise.all([
            call('PATCH', `/notes/${note.id}`, 'ann', { body: 'from ann', version: 1 }),
            call('PATCH', `/notes/${note.id}`, 'bob', { body: 'from bob', version: 1 })
        ]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        const current = (await call('GET', `/notes/${note.id}`, 'ann')).body;
        assert.equal(current.version, 2);
        assert.equal(current.body, results.find(result => result.status === 200).body.body);
        assert.deepEqual(await actionsFor(note.id), ['created', 'edited']);
    });

    // A lock blocks text edits, not attribute changes; unlocking allows edits again.
    test('a lock blocks text edits only', async () => {
        const note = (await call('POST', '/notes', 'ann', { title: 'Final' })).body;
        assert.equal((await call('PUT', `/notes/${note.id}/lock`, 'ann')).body.locked, true);
        assert.equal((await call('PATCH', `/notes/${note.id}`, 'ann', { title: 'x', version: 1 })).status, 409);
        assert.equal((await call('PATCH', `/notes/${note.id}/attributes`, 'ann', { viewAccess: 'team' })).status, 200);
        await call('PUT', `/notes/${note.id}/unlock`, 'ann');
        assert.equal((await call('PATCH', `/notes/${note.id}`, 'ann', { title: 'Final 2', version: 1 })).status, 200);
        assert.deepEqual(await actionsFor(note.id), ['created', 'locked', 'attributes_changed', 'unlocked', 'edited']);
    });

    // Visibility across users and teams, through the real queries.
    test('visibility: teammates see team notes, another team sees nothing', async () => {
        const shared = (await call('POST', '/notes', 'ann', { title: 'Shared', viewAccess: 'team' })).body;
        const secret = (await call('POST', '/notes', 'ann', { title: 'Secret' })).body;
        assert.equal((await call('GET', `/notes/${shared.id}`, 'bob')).status, 200);
        assert.equal((await call('GET', `/notes/${secret.id}`, 'bob')).status, 404);
        assert.equal((await call('GET', `/notes/${shared.id}`, 'cal')).status, 404);
        assert.deepEqual((await call('GET', '/notes', 'bob')).body.items.map(item => item.title), ['Shared']);
        assert.deepEqual((await call('GET', '/notes', 'cal')).body.items, []);
    });

    // The list reads one extra row to set hasNextPage.
    test('the list pages with hasNextPage', async () => {
        for (const title of ['one', 'two', 'three']) {
            await call('POST', '/notes', 'ann', { title });
        }
        const first = (await call('GET', '/notes?pageSize=2', 'ann')).body;
        assert.deepEqual(first.items.map(item => item.title), ['three', 'two']);
        assert.equal(first.paging.hasNextPage, true);
        const second = (await call('GET', '/notes?pageSize=2&pageNumber=2', 'ann')).body;
        assert.deepEqual(second.items.map(item => item.title), ['one']);
        assert.equal(second.paging.hasNextPage, false);
    });

    // Deleting removes the note but keeps its activity, which its author still sees.
    test('a delete keeps the activity, visible in the author\'s own activity', async () => {
        const note = (await call('POST', '/notes', 'ann', { title: 'Bye' })).body;
        assert.equal((await call('DELETE', `/notes/${note.id}`, 'ann')).status, 204);
        assert.equal((await call('GET', `/activity/notes/${note.id}`, 'ann')).status, 404);
        assert.deepEqual(await actionsFor(note.id), ['created', 'deleted']);
        const me = (await call('GET', '/auth/test', 'ann')).body;
        const mine = (await call('GET', `/activity/users/${me.id}`, 'ann')).body;
        assert.deepEqual(mine.items.map(entry => entry.action), ['deleted', 'created']);
    });

    // The database itself refuses edit access wider than view access, whatever the code does.
    test('the database enforces edit no wider than view', async () => {
        await assert.rejects(pool.query(
            `INSERT INTO notes (created_by, title, view_access, edit_access)
             SELECT id, 'x', 'author', 'team' FROM users LIMIT 1`), /notes_edit_within_view/);
    });
});
