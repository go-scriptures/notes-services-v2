/**
 * Raised when the caller is not authenticated: no token, a bad token, or failed login. Maps to 401.
 *
 * @author: tgibbons via Claude
 */
export default class UnauthorizedError extends Error {
    /**
     * Creates the error with its message.
     */
    constructor(message) {
        super(message);
        this.name = 'UnauthorizedError';
        this.status = 401;
    }
}
