/**
 * Raised when a note's current state prevents a change: it is locked, or it has changed
 * since the version the caller edited. Maps to 409.
 *
 * @author: tgibbons via Claude
 */
export default class ConflictError extends Error {
    /**
     * Creates the error with its message.
     */
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
        this.status = 409;
    }
}
