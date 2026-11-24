/**
 * Requires a valid bearer token, and sets req.identity = { userId, teamId } for the routes after it.
 * HTTP only: reads the Authorization header; the auth manager decides whether the token is valid.
 *
 * @author: tgibbons via Claude
 */
import UnauthorizedError from '../error/unauthorized_error.js';

/**
 * Creates the middleware with the auth manager.
 */
export function authenticate(authManager) {
    return async (req, res, next) => {
        const [scheme, token] = (req.get('Authorization') ?? '').split(' ');
        if (scheme !== 'Bearer' || !token) {
            throw new UnauthorizedError('A bearer token is required');
        }
        req.identity = await authManager.authenticate(token);
        req.log = req.log.child({ userId: req.identity.userId });
        next();
    };
}
