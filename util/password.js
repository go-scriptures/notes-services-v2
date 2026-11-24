/**
 * Password hashing with Node's built-in scrypt. Passwords are hashed, never encrypted:
 * a hash cannot be reversed, only checked.
 *
 * A stored hash is one self-describing string: scrypt$N$r$p$salt$hash (salt and hash in base64).
 * The cost settings travel with the hash, so they can be raised later without breaking
 * passwords hashed under the old settings.
 *
 * @author: tgibbons via Claude
 */
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const COST = { N: 16384, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Returns the stored form of a password, with a new random salt.
 */
export async function hashPassword(password) {
    const salt = randomBytes(SALT_BYTES);
    const key = await scryptAsync(password, salt, KEY_BYTES, COST);
    return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Returns true when the password matches the stored hash.
 * The comparison takes the same time however many bytes match.
 */
export async function verifyPassword(password, stored) {
    const [scheme, N, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt') {
        throw new Error(`Unknown password hash scheme ${scheme}`);
    }
    const expected = Buffer.from(hash, 'base64');
    const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length,
        { N: Number(N), r: Number(r), p: Number(p) });
    return timingSafeEqual(actual, expected);
}
