/**
 * Tests for the service skeleton: health check, request IDs, request logging,
 * unknown routes and the 500 path. Uses a fake database pool, so no database is needed.
 *
 * @author: tgibbons via Claude
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createLogger } from '../util/logger.js';
import { errorHandler } from '../middleware/error_handler.js';

let server;
let baseUrl;
let databaseUp = true;
const logLines = [];

// A pool whose query succeeds or fails depending on databaseUp.
const fakePool = {
    query: async () => {
        if (!databaseUp) {
            throw new Error('connection refused');
        }
        return { rows: [{ '?column?': 1 }] };
    }
};

before(async () => {
    const logger = createLogger({ write: line => logLines.push(JSON.parse(line)) });
    const app = createApp({ pool: fakePool, logger });
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
    server.closeAllConnections();
    server.close();
});

// Health check
describe('Health', () => {
    // The database answers: 200.
    test('returns 200 when the database answers', async () => {
        databaseUp = true;
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok', database: 'ok' });
    });

    // The database is down: 503, so a load balancer stops routing here.
    test('returns 503 when the database is unreachable', async () => {
        databaseUp = false;
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 503);
        databaseUp = true;
    });
});

// Request IDs and request logging
describe('Request context', () => {
    // A request without an ID gets a generated one back.
    test('generates a request ID', async () => {
        const response = await fetch(`${baseUrl}/health`);
        assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    });

    // A caller's request ID is kept, so it can be traced across services.
    test('keeps an incoming request ID', async () => {
        const response = await fetch(`${baseUrl}/health`, { headers: { 'X-Request-Id': 'trace-123' } });
        assert.equal(response.headers.get('x-request-id'), 'trace-123');
    });

    // Every request writes one JSON log line with its ID, status and duration.
    test('logs one line per request', async () => {
        await fetch(`${baseUrl}/health`, { headers: { 'X-Request-Id': 'log-check' } });
        const line = logLines.find(entry => entry.requestId === 'log-check' && entry.message === 'request');
        assert.equal(line.method, 'GET');
        assert.equal(line.path, '/health');
        assert.equal(line.status, 200);
        assert.equal(typeof line.durationMs, 'number');
    });
});

// Routes outside the service's endpoints, and unexpected errors
describe('General', () => {
    // An unknown route is a JSON 404.
    test('an unknown route returns a JSON 404', async () => {
        const response = await fetch(`${baseUrl}/nothing-here`);
        assert.equal(response.status, 404);
        assert.ok((await response.json()).error);
    });

    // The framework is not advertised.
    test('responses have no X-Powered-By header', async () => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.headers.get('x-powered-by'), null);
    });

    // A body that is not JSON is a 400 in JSON, not an HTML page.
    test('a body that is not JSON returns a JSON 400', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad'
        });
        assert.equal(response.status, 400);
        assert.ok((await response.json()).error);
    });

    // An unexpected error is a 500 with the request ID but without its details, which are logged.
    test('the error handler hides 500 details and logs them', () => {
        const logged = [];
        const req = { id: 'req-1', log: { error: (message, extra) => logged.push(extra) } };
        let sent;
        const res = { status(code) { sent = { code }; return this; }, json(body) { sent.body = body; } };
        errorHandler(new Error('secret detail'), req, res, () => {});
        assert.equal(sent.code, 500);
        assert.deepEqual(sent.body, { error: 'internal server error', requestId: 'req-1' });
        assert.equal(logged[0].error, 'secret detail');
    });
});
