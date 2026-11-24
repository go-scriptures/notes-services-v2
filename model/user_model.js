/**
 * A user: belongs to exactly one team. Never carries the password hash.
 *
 * @author: tgibbons via Claude
 */
export default class User {
    /**
     * Creates a user from its fields.
     */
    constructor({ id, teamId, email, firstName, lastName, active, passwordChangedAt, createdAt, updatedAt }) {
        this.id = id;
        this.teamId = teamId;
        this.email = email;
        this.firstName = firstName;
        this.lastName = lastName;
        this.active = active;
        this.passwordChangedAt = passwordChangedAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }
}
