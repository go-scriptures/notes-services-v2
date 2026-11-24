/**
 * Unit tests for password hashing. No database is needed.
 *
 * @author: tgibbons via Claude
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../util/password.js';

// Hashing and checking passwords
describe('Password', () => {
    // The right password matches its hash.
    test('verifies the right password', async () => {
        const stored = await hashPassword('correct horse');
        assert.equal(await verifyPassword('correct horse', stored), true);
    });

    // A wrong password does not.
    test('rejects a wrong password', async () => {
        const stored = await hashPassword('correct horse');
        assert.equal(await verifyPassword('wrong horse', stored), false);
    });

    // The same password hashes differently each time, because of the random salt.
    test('salts every hash', async () => {
        assert.notEqual(await hashPassword('same'), await hashPassword('same'));
    });

    // The stored form names its scheme and cost, and never contains the password.
    test('stores a self-describing hash without the password', async () => {
        const stored = await hashPassword('secret-value');
        assert.match(stored, /^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
        assert.ok(!stored.includes('secret-value'));
    });
});
