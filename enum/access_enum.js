/**
 * Access scopes for viewing and editing a note, from narrowest to widest.
 * The list is ordered, so "edit is never wider than view" is a comparison of positions,
 * and a wider scope (for example 'everyone') can be added at the end.
 *
 * @author: tgibbons via Claude
 */
export const Access = Object.freeze({
    AUTHOR: 'author',
    TEAM: 'team'
});

const ORDER = [Access.AUTHOR, Access.TEAM];

/**
 * Returns true when the value is one of the Access scopes (case-sensitive).
 */
export function isValidAccess(value) {
    return ORDER.includes(value);
}

/**
 * Returns true when scope a is wider than scope b.
 */
export function isWider(a, b) {
    return ORDER.indexOf(a) > ORDER.indexOf(b);
}
