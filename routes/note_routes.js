/**
 * HTTP routes for notes. HTTP only: reads the request, calls the manager, sends the status.
 * Every notes route requires a valid bearer token.
 *
 * @author: tgibbons via Claude
 */
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';

/**
 * Creates the note routes with the note manager and the auth manager.
 */
export function noteRoutes(noteManager, authManager) {
    const router = Router();
    router.use(authenticate(authManager));

    // Create a note: 201 with a Location header.
    router.post('/', async (req, res) => {
        const note = await noteManager.createNote(req.identity, req.body);
        res.status(201).location(`${req.baseUrl}/${note.id}`).json(note);
    });

    // List one page of the notes the caller can see, optionally by one author.
    router.get('/', async (req, res) => {
        res.json(await noteManager.listNotes(req.identity, req.query));
    });

    // Read one note.
    router.get('/:id', async (req, res) => {
        res.json(await noteManager.getNote(req.identity, req.params.id));
    });

    // Edit a note's text (title and/or body), stating the version being edited.
    router.patch('/:id', async (req, res) => {
        res.json(await noteManager.editNote(req.identity, req.params.id, req.body));
    });

    // Change who can see and who can edit a note (author only).
    router.patch('/:id/attributes', async (req, res) => {
        res.json(await noteManager.changeAttributes(req.identity, req.params.id, req.body));
    });

    // Lock a note's text (author only).
    router.put('/:id/lock', async (req, res) => {
        res.json(await noteManager.lockNote(req.identity, req.params.id));
    });

    // Unlock a note's text (author only).
    router.put('/:id/unlock', async (req, res) => {
        res.json(await noteManager.unlockNote(req.identity, req.params.id));
    });

    // Delete a note permanently (author only): 204 with no body.
    router.delete('/:id', async (req, res) => {
        await noteManager.deleteNote(req.identity, req.params.id);
        res.status(204).end();
    });

    return router;
}
