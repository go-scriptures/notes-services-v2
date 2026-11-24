/**
 * Gives every request an ID and a logger that carries it, and writes one log line
 * when the response finishes: method, path, status and duration.
 *
 * The ID comes from an incoming X-Request-Id header when a caller or gateway sets one,
 * so a request can be traced across services; otherwise a new UUID is generated.
 * It is returned in the X-Request-Id response header.
 *
 * @author: tgibbons via Claude
 */
import { randomUUID } from 'node:crypto';

const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Creates the middleware with the service's base logger.
 */
export function requestContext(logger) {
    return (req, res, next) => {
        const incoming = req.get('X-Request-Id');
        const requestId = incoming && incoming.length <= MAX_REQUEST_ID_LENGTH ? incoming : randomUUID();
        const start = process.hrtime.bigint();

        req.id = requestId;
        req.log = logger.child({ requestId });
        res.set('X-Request-Id', requestId);

        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
            req.log.info('request', {
                method: req.method,
                path: req.originalUrl,
                status: res.statusCode,
                durationMs: Math.round(durationMs * 10) / 10
            });
        });
        next();
    };
}
