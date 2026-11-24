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
import { authRoutes } from './routes/auth_routes.js';
import { createUserApi } from './api/user_api.js';
import { createAuthManager } from './manager/auth_manager.js';
import { noteRoutes } from './routes/note_routes.js';
import { createNoteApi } from './api/note_api.js';
import { createNoteManager } from './manager/note_manager.js';
import NotFoundError from './error/not_found_error.js';

/**
 * Creates the app. pool is the database pool; logger is the base logger;
 * tokenService issues and verifies access tokens.
 */
export function createApp({ pool, logger, tokenService }) {
    const authManager = createAuthManager({ userApi: createUserApi(pool), tokenService });
    const noteManager = createNoteManager({ noteApi: createNoteApi(pool) });

    const app = express();

    // Express adds an "X-Powered-By: Express" header that advertises the framework, so it is turned off.
    app.disable('x-powered-by');
    app.use(requestContext(logger));
    app.use(express.json());

    app.use('/health', healthRoutes(pool));
    app.use('/auth', authRoutes(authManager));
    app.use('/notes', noteRoutes(noteManager, authManager));

    // Any route not handled above returns a JSON 404.
    app.use((req, res, next) => {
        throw new NotFoundError(`Route ${req.method} ${req.path} not found`);
    });
    app.use(errorHandler);

    return app;
}
