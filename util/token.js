/**
 * Issues and verifies JSON Web Tokens (HS256) with the jose library.
 *
 * A token carries the user's ID (sub) and team (teamId), and is checked for its signature,
 * expiry, issuer and audience. In production an identity provider would issue the tokens
 * and this service would only verify them.
 *
 * @author: tgibbons via Claude
 */
import { SignJWT, jwtVerify } from 'jose';

const ALGORITHM = 'HS256';
const MINIMUM_SECRET_BYTES = 32;

/**
 * Creates the token service. secret signs the tokens; ttlSeconds is how long a token lives.
 */
export function createTokenService({ secret, issuer, audience, ttlSeconds }) {
    const key = new TextEncoder().encode(secret);
    if (key.length < MINIMUM_SECRET_BYTES) {
        throw new Error(`The token secret must be at least ${MINIMUM_SECRET_BYTES} bytes`);
    }

    return {
        ttlSeconds,

        /**
         * Returns a signed token for the user.
         */
        async issue({ userId, teamId }) {
            return new SignJWT({ teamId })
                .setProtectedHeader({ alg: ALGORITHM })
                .setSubject(userId)
                .setIssuer(issuer)
                .setAudience(audience)
                .setIssuedAt()
                .setExpirationTime(`${ttlSeconds}s`)
                .sign(key);
        },

        /**
         * Returns the token's claims when it is valid. Throws when the signature, expiry,
         * issuer, audience or algorithm is wrong.
         */
        async verify(token) {
            const { payload } = await jwtVerify(token, key, { issuer, audience, algorithms: [ALGORITHM] });
            return payload;
        }
    };
}
