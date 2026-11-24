/**
 * Health check for operators and orchestrators. HTTP only.
 *
 * GET /health answers 200 when the service can reach its database, and 503 when it cannot,
 * so a load balancer stops sending traffic to an instance that cannot do its job.
 *
 * Operational, not domain: it has no business rules, so it does not go through
 * the manager and api tiers. The database check itself lives in util/db.js.
 *
 * @author: tgibbons via Claude
 */
import { Router } from 'express';
import { checkDatabase } from '../util/db.js';

/**
 * Creates the health routes with the database pool.
 */
export function healthRoutes(pool) {
    const router = Router();

    // Reports whether the database answers a trivial query.
    router.get('/', async (req, res) => {
        try {
            await checkDatabase(pool);
            res.json({ status: 'ok', database: 'ok' });
        } catch (err) {
            req.log.warn('health check failed', { error: err.message });
            res.status(503).json({ status: 'unavailable', database: 'unreachable' });
        }
    });

    return router;
}
