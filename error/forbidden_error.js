/**
 * Raised when the caller can see a note but is not allowed to change it. Maps to 403.
 *
 * @author: tgibbons via Claude
 */
export default class ForbiddenError extends Error {
    /**
     * Creates the error with its message.
     */
    constructor(message) {
        super(message);
        this.name = 'ForbiddenError';
        this.status = 403;
    }
}
