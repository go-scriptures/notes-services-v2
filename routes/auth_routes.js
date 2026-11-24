/**
 * HTTP routes for authentication. HTTP only: reads the request, calls the manager, sends the status.
 *
 * POST /auth/login is a local stand-in for an identity provider: it exists so the service
 * can be run and tested end to end. GET /auth/test confirms a token is valid and returns
 * the authenticated user; it is useful to clients and for checking a new install.
 *
 * @author: tgibbons via Claude
 */
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';

/**
 * Creates the auth routes with the auth manager.
 */
export function authRoutes(authManager) {
    const router = Router();

    // Log in with email and password: 200 with an access token.
    router.post('/login', async (req, res) => {
        res.json(await authManager.login(req.body));
    });

    // Confirms the token is valid and returns the authenticated user.
    router.get('/test', authenticate(authManager), async (req, res) => {
        res.json(await authManager.testAuthentication(req.identity));
    });

    return router;
}
