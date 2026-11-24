/**
 * The actions recorded in the activity log. Changes only, never views.
 *
 * @author: tgibbons via Claude
 */
export const Action = Object.freeze({
    CREATED: 'created',
    EDITED: 'edited',
    ATTRIBUTES_CHANGED: 'attributes_changed',
    LOCKED: 'locked',
    UNLOCKED: 'unlocked',
    DELETED: 'deleted'
});
