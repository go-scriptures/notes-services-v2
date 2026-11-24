/**
 * One activity log entry: who (userId) did what (action) to which note (noteId), and when.
 * It never carries the note's title or content.
 *
 * @author: tgibbons via Claude
 */
export default class Activity {
    /**
     * Creates an entry from its fields.
     */
    constructor({ id, noteId, userId, action, createdAt }) {
        this.id = id;
        this.noteId = noteId;
        this.userId = userId;
        this.action = action;
        this.createdAt = createdAt;
    }
}
