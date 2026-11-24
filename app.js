/**
 * Builds the Express app from its dependencies. Does not listen: server.js does that,
 * and tests build their own app with test dependencies.
 *
 * @author: tgibbons via Claude
 */
import express from 'express';
import { requestContext } from './middleware/request_context.js';
import { errorHandler } from './middleware/error_handler.js';
import { healthRoutes } from './routes/health_routes.js';
import NotFoundError from './error/not_found_error.js';

/**
 * Creates the app. pool is the database pool; logger is the base logger.
 */
export function createApp({ pool, logger }) {
    const app = express();

    // Express adds an "X-Powered-By: Express" header that advertises the framework, so it is turned off.
    app.disable('x-powered-by');
    app.use(requestContext(logger));
    app.use(express.json());

    app.use('/health', healthRoutes(pool));

    // Any route not handled above returns a JSON 404.
    app.use((req, res, next) => {
        throw new NotFoundError(`Route ${req.method} ${req.path} not found`);
    });
    app.use(errorHandler);

    return app;
}
