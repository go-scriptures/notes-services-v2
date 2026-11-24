/**
 * Business rules for authentication: logging in, and turning a token into a caller identity.
 * Throws typed errors and knows nothing about HTTP.
 *
 * @author: tgibbons via Claude
 */
import { hashPassword, verifyPassword } from '../util/password.js';
import ValidationError from '../error/validation_error.js';
import UnauthorizedError from '../error/unauthorized_error.js';

// One message for every login failure, so a caller cannot learn which emails exist.
const LOGIN_FAILED = 'invalid email or password';
const TOKEN_INVALID = 'invalid or expired token';

/**
 * Creates the auth manager with the user api and the token service.
 */
export function createAuthManager({ userApi, tokenService }) {
    // Checked against when the email is unknown, so an unknown email takes as long as a wrong password.
    const dummyHash = hashPassword('dummy password for timing');

    return {
        /**
         * Checks the email and password and returns an access token.
         * An unknown email, a wrong password and a deactivated user all fail the same way.
         */
        async login(input = {}) {
            const details = [];
            if (typeof input.email !== 'string' || input.email.trim() === '') {
                details.push('email is required');
            }
            if (typeof input.password !== 'string' || input.password === '') {
                details.push('password is required');
            }
            if (details.length > 0) {
                throw new ValidationError('Invalid login', details);
            }

            const credentials = await userApi.findCredentialsByEmail(input.email.trim().toLowerCase());
            const passwordMatches = await verifyPassword(input.password, credentials?.passwordHash ?? await dummyHash);
            if (!credentials || !passwordMatches || !credentials.user.active) {
                throw new UnauthorizedError(LOGIN_FAILED);
            }

            const { user } = credentials;
            return {
                accessToken: await tokenService.issue({ userId: user.id, teamId: user.teamId }),
                tokenType: 'Bearer',
                expiresIn: tokenService.ttlSeconds
            };
        },

        /**
         * Returns the caller's identity { userId, teamId } for a valid token.
         * The user is read on every request, so deactivating a user or changing their
         * password takes effect at once rather than when their token expires.
         */
        async authenticate(token) {
            let claims;
            try {
                claims = await tokenService.verify(token);
            } catch {
                throw new UnauthorizedError(TOKEN_INVALID);
            }

            const user = await userApi.findUserById(claims.sub);
            const issuedBeforePasswordChange = user
                && claims.iat < Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
            if (!user || !user.active || issuedBeforePasswordChange) {
                throw new UnauthorizedError(TOKEN_INVALID);
            }
            return { userId: user.id, teamId: user.teamId };
        },

        /**
         * Returns the authenticated caller's user record. Reached only with a valid token,
         * so a successful answer confirms that authentication works.
         */
        async testAuthentication(identity) {
            return userApi.findUserById(identity.userId);
        }
    };
}
