/**
 * Raised when a request breaks a business rule. Maps to 400 and lists every problem found.
 *
 * @author: tgibbons via Claude
 */
export default class ValidationError extends Error {
    /**
     * Creates the error with a summary message and the list of individual problems.
     */
    constructor(message, details = []) {
        super(message);
        this.name = 'ValidationError';
        this.status = 400;
        this.details = details;
    }
}
