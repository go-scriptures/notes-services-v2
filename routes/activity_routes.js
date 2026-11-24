/**
 * HTTP routes for the activity log. HTTP only: reads the request, calls the manager, sends the status.
 * Every activity route requires a valid bearer token.
 *
 * @author: tgibbons via Claude
 */
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';

/**
 * Creates the activity routes with the activity manager and the auth manager.
 */
export function activityRoutes(activityManager, authManager) {
    const router = Router();
    router.use(authenticate(authManager));

    // One page of a note's activity, newest first.
    router.get('/notes/:noteId', async (req, res) => {
        res.json(await activityManager.listNoteActivity(req.identity, req.params.noteId, req.query));
    });

    // One page of the caller's own activity across all notes, newest first.
    router.get('/users/:userId', async (req, res) => {
        res.json(await activityManager.listUserActivity(req.identity, req.params.userId, req.query));
    });

    return router;
}
