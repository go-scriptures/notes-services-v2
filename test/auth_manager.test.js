/**
 * Unit tests for the auth manager's rules: login, token checks, deactivation and password change.
 * Uses an in-memory fake of the user api, so no database or HTTP is needed.
 *
 * @author: tgibbons via Claude
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthManager } from '../manager/auth_manager.js';
import { createTokenService } from '../util/token.js';
import { hashPassword } from '../util/password.js';
import User from '../model/user_model.js';
import ValidationError from '../error/validation_error.js';
import UnauthorizedError from '../error/unauthorized_error.js';

const TOKEN_SETTINGS = { secret: 'test-secret-at-least-thirty-two-bytes', issuer: 'notes-service', audience: 'notes-api', ttlSeconds: 60 };
const PASSWORD = 'right password';
const passwordHash = await hashPassword(PASSWORD);

let users;
let auth;
let tokenService;

/**
 * An in-memory user api with the same methods as the real one.
 */
function fakeUserApi() {
    return {
        async findCredentialsByEmail(email) {
            const user = [...users.values()].find(candidate => candidate.email === email);
            return user ? { user: new User(user), passwordHash } : null;
        },
        async findUserById(id) {
            return users.has(id) ? new User(users.get(id)) : null;
        }
    };
}

beforeEach(() => {
    users = new Map([['u-ann', {
        id: 'u-ann', teamId: 't-red', email: 'ann@example.com', firstName: 'Ann', lastName: 'Archer',
        active: true, passwordChangedAt: new Date(Date.now() - 60_000).toISOString()
    }]]);
    tokenService = createTokenService(TOKEN_SETTINGS);
    auth = createAuthManager({ userApi: fakeUserApi(), tokenService });
});

// Logging in
describe('Login', () => {
    // The right email and password return a bearer token for the user and team.
    test('returns a token for the right password', async () => {
        const result = await auth.login({ email: 'ann@example.com', password: PASSWORD });
        assert.equal(result.tokenType, 'Bearer');
        assert.equal(result.expiresIn, 60);
        const claims = await tokenService.verify(result.accessToken);
        assert.equal(claims.sub, 'u-ann');
        assert.equal(claims.teamId, 't-red');
    });

    // The email is matched in lower case, as it is stored.
    test('matches the email in any case', async () => {
        const result = await auth.login({ email: '  Ann@Example.COM ', password: PASSWORD });
        assert.ok(result.accessToken);
    });

    // An unknown email, a wrong password and a deactivated user fail with the same message.
    test('fails the same way for every bad login', async () => {
        const unknown = await auth.login({ email: 'nobody@example.com', password: PASSWORD }).catch(err => err);
        const wrong = await auth.login({ email: 'ann@example.com', password: 'wrong' }).catch(err => err);
        users.get('u-ann').active = false;
        const inactive = await auth.login({ email: 'ann@example.com', password: PASSWORD }).catch(err => err);
        for (const err of [unknown, wrong, inactive]) {
            assert.ok(err instanceof UnauthorizedError);
            assert.equal(err.message, 'invalid email or password');
        }
    });

    // A missing email and password are both reported.
    test('requires email and password', async () => {
        const err = await auth.login({}).catch(error => error);
        assert.ok(err instanceof ValidationError);
        assert.equal(err.details.length, 2);
    });
});

// Turning a token into an identity
describe('Authenticate', () => {
    // A valid token gives the caller's user and team.
    test('returns the identity for a valid token', async () => {
        const { accessToken } = await auth.login({ email: 'ann@example.com', password: PASSWORD });
        assert.deepEqual(await auth.authenticate(accessToken), { userId: 'u-ann', teamId: 't-red' });
    });

    // A token that is not a JWT is rejected.
    test('rejects a malformed token', async () => {
        await assert.rejects(auth.authenticate('not-a-token'), UnauthorizedError);
    });

    // A token signed with another secret is rejected.
    test('rejects a token signed with another secret', async () => {
        const other = createTokenService({ ...TOKEN_SETTINGS, secret: 'another-secret-at-least-thirty-two-bytes' });
        const forged = await other.issue({ userId: 'u-ann', teamId: 't-red' });
        await assert.rejects(auth.authenticate(forged), UnauthorizedError);
    });

    // A token for another audience is rejected.
    test('rejects a token for another audience', async () => {
        const other = createTokenService({ ...TOKEN_SETTINGS, audience: 'another-api' });
        const token = await other.issue({ userId: 'u-ann', teamId: 't-red' });
        await assert.rejects(auth.authenticate(token), UnauthorizedError);
    });

    // An expired token is rejected.
    test('rejects an expired token', async (t) => {
        const { accessToken } = await auth.login({ email: 'ann@example.com', password: PASSWORD });
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 61_000 });
        await assert.rejects(auth.authenticate(accessToken), UnauthorizedError);
    });

    // Deactivating a user takes effect at once, before their token expires.
    test('rejects the token of a user deactivated since', async () => {
        const { accessToken } = await auth.login({ email: 'ann@example.com', password: PASSWORD });
        users.get('u-ann').active = false;
        await assert.rejects(auth.authenticate(accessToken), UnauthorizedError);
    });

    // Changing a password logs out every token issued before the change.
    test('rejects a token issued before a password change', async () => {
        const { accessToken } = await auth.login({ email: 'ann@example.com', password: PASSWORD });
        users.get('u-ann').passwordChangedAt = new Date(Date.now() + 2_000).toISOString();
        await assert.rejects(auth.authenticate(accessToken), UnauthorizedError);
    });
});
