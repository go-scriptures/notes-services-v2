/**
 * Central error handler: turns typed errors into JSON { error, details }.
 * Anything without a status is a 500: logged in full with the request ID,
 * and reported to the caller without details.
 *
 * @author: tgibbons via Claude
 */

/**
 * Express error-handling middleware (four arguments).
 */
export function errorHandler(err, req, res, next) {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) {
        req.log.error('unhandled error', { error: err.message, stack: err.stack });
        return res.status(status).json({ error: 'internal server error', requestId: req.id });
    }
    const body = { error: err.message };
    if (err.details) {
        body.details = err.details;
    }
    res.status(status).json(body);
}
