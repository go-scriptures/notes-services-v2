/**
 * Raised when a resource or route does not exist, or the caller is not allowed to see it. Maps to 404.
 *
 * @author: tgibbons via Claude
 */
export default class NotFoundError extends Error {
    /**
     * Creates the error with its message.
     */
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
        this.status = 404;
    }
}
