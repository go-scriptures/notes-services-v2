/**
 * A note. Its team (teamId) is its author's team, read through the author rather than
 * stored on the note, so a note follows its author.
 *
 * @author: tgibbons via Claude
 */
export default class Note {
    /**
     * Creates a note from its fields. body is optional and defaults to null.
     */
    constructor({ id, createdBy, teamId, title, body = null, viewAccess, editAccess, locked, version, createdAt, updatedAt }) {
        this.id = id;
        this.createdBy = createdBy;
        this.teamId = teamId;
        this.title = title;
        this.body = body;
        this.viewAccess = viewAccess;
        this.editAccess = editAccess;
        this.locked = locked;
        this.version = version;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }
}
