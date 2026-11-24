# Notes Service

## Overview

A back-end REST service where several small teams capture notes and work on them together. A note's author decides who can see it, who can edit it, and whether it is locked, and every change is recorded in an activity log.

## Getting Started

Requires Docker (with Compose) and Node 20 or later. Every routine task is a Make target; `make help` lists them.

```
make install   # install Node dependencies
make up        # build and start PostgreSQL and the service; waits until both are healthy
make test      # run the tests
make down      # stop (data is kept)
```

The service listens on http://localhost:3000; PostgreSQL is on host port 5433.

## Validating a New Install

After `make up`, run these in order:

1. `make seed`: load the demo teams and users (safe to repeat).
2. `make health`: the service and its database answer.
3. `make login`: log in (default Sam Darnold; any user with `EMAIL=...`) and save the token.
4. `make auth-test`: the saved token is accepted, and shows who it belongs to.

Demo users, all with the password `notes-demo-password`:

| Team | User | Email |
|---|---|---|
| seahawks | Sam Darnold | sdarnold@seahawks.com |
| seahawks | Mike Macdonald | mmacdonald@seahawks.com |
| seahawks | Kenneth Walker | kwalker@seahawks.com |
| patriots | Drake Maye | dmaye@patriots.com |
| patriots | Mike Vrabel | mvrabel@patriots.com |
| patriots | Rhamondre Stevenson | rstevenson@patriots.com |

## Project Structure

```
app.js, server.js     build the app; start it (graceful shutdown on SIGTERM and SIGINT)
routes/               HTTP only
middleware/           request IDs and logging, error handling
error/                typed errors, each mapped to an HTTP status
util/                 configuration, logging, database pool (operational, outside the tiers)
test/                 tests, using Node's built-in runner
```

## Design Decisions

### Separate View and Edit Access, at Extendable Scopes

Sharing has two meanings, so a note has two permissions: who can see it and who can edit it. Each is set at one of the scopes `author` or `team`. Edit access can never be wider than view access, because no one can edit what they cannot see, so the valid combinations are: author sees and edits (private); team sees, author edits (shared to read); team sees and edits (shared to work on together).

The scopes are an extendable list rather than a yes/no flag, so a wider scope such as `everyone` can be added later as one new value and its rule, without redesigning the schema.

### Concurrent Edits Are Rejected, Not Lost

Several people can edit the same note, so two edits at the same time are normal, not an edge case. See Resolving Concurrent Edits below. In short: each note carries a version; an edit to its text must state the version it was based on, and an edit based on a stale copy is rejected with 409 so the editor can reload, rather than silently overwriting someone else's work.

### An Activity Log, Separate From the Notes

Every change to a note is recorded in an activity log: who, when, which note, and the action. The log is read through its own paged endpoints, not returned inside notes, because it grows without limit and most views of a note do not need it. It answers two questions: what happened to this note, and what have I been working on.

## Functional Rules

- **Every note records its author** (`createdBy`, a user ID).
- **A note has two attributes,** and only its author can change them:
  - **`viewAccess`, who can see it:** `author` or `team`.
  - **`editAccess`, who can edit it:** `author` or `team`, never wider than `viewAccess`.
- **The author can lock and unlock a note.** Locking is separate from the attributes. When locked, no one can edit the note's text (its title and body), the author included; to edit the text, the author unlocks the note first.
- **Locking applies only to the note's text.** While a note is locked, the author can still change its attributes and can still delete it. An edit to a locked note's text returns 409 Conflict ("note is locked"): the note's state, not the caller, prevents the change.
- **Text and attributes are changed through separate endpoints,** because their rules differ: the text by anyone with edit access, unless the note is locked; the attributes by the author only, whether or not the note is locked.
- **Versions apply only to the note's text.** An edit to the title or body states, in the request body, the version it was based on, and is rejected if the note has changed since. Changing the attributes, locking and unlocking do not use the version: they are the author's alone. Deleting does not need a version either: only the author can delete, and a delete removes the note whatever it currently says.
- **Locking and unlocking use `PUT /notes/{id}/lock` and `PUT /notes/{id}/unlock`.** `PUT` acts on a note that must already exist, and setting the same state twice leaves it unchanged.
- **The notes list shows every note the caller can see in their team,** newest first, and can be narrowed to one author with `author={userId}`. A caller's own notes are `author={their own user ID}`, so no separate "mine" filter is needed.
- **Only the author can delete a note.** A contributor who regrets a contribution edits it back out of the note.
- **The activity log records changes, not views.** Each entry holds who, when, which note, and the action, never the note's title or content. Locking and unlocking are their own actions, distinct from changing the attributes.
- **A note's activity follows the note's current visibility.** `GET /activity/notes/{noteId}` returns the activity only to users who can see the note now, and 404 otherwise. If the author narrows who can see a note, users who lose sight of the note also lose sight of its activity.
- **Your own activity is always yours.** `GET /activity/users/{userId}` returns every change you made, across all notes, including notes you can no longer see and notes since deleted. Asking for another user's activity returns 403.

## Resolving Concurrent Edits

Given the time available, we chose a simple, provably correct algorithm: **optimistic concurrency with a version number.**

1. Every note has a `version`, starting at 1, returned with every read.
2. An edit to the text sends the version it was based on: `{ "body": "...", "version": 3 }`.
3. The database checks and writes in one statement: `UPDATE notes SET ..., version = version + 1 WHERE id = $1 AND version = $2`. Because the check and the write are one step, two simultaneous edits can never both succeed.
4. If no row is updated, the note has changed since the editor read it, and the service returns **409 Conflict**. The client reloads the latest version, and the user reapplies their change.

A stale edit is **rejected, not merged**: nothing is lost silently, and nothing is combined automatically. No locks are held while people type, which suits notes, where collisions are rare.

More sophisticated algorithms could replace it, in increasing order of complexity:

- **Field-level merge:** if one person changed the title and another the body, apply both; reject only conflicting changes to the same field.
- **Text merge:** a three-way merge of the body, as git does, combining changes to different parts of the text.
- **Real-time collaboration:** live co-editing, as in Google Docs, using operational transforms or CRDTs. This is a different architecture, not an extension.

## Assumptions

- **No registration; login stands in for an identity provider.** Users are seeded. `POST /auth/login` checks a hashed password and issues a 15-minute token; every other request presents it. In production an identity provider would own registration and login, and only the token check would remain here.
- **Paging defaults to page 1 of 25, and a page holds at most 100 items.** A larger `pageSize` returns 400 rather than being silently reduced. There is no right answer for these numbers; they keep responses small, and the decision is recorded here so it can be changed deliberately. Each list reads one extra row to set `hasNextPage`, rather than counting every row.
- **Demo users share one password, on purpose.** The seed data (two teams of three users) exists so reviewers can sign in as anyone and see every rule in action; one shared password keeps that simple. It is supplied through `SEED_PASSWORD`, never stored in the code, and is for local demonstration only.

- **Only the author can change a note's attributes,** so a mistake made at creation can be corrected; no one else can change them.
- **Your own activity includes notes you can no longer see.** It is your history, so it stays visible to you; because entries never carry a note's title or content, this reveals nothing the note now holds. Opening such a note still returns 404.
- **`/activity/users/{userId}` includes the user ID for consistency.** It is not technically needed, because the endpoint is limited to the authenticated user, but it mirrors `/activity/notes/{noteId}`, and the shape would allow a later rule (for example, team leads reading their team's activity) without a new endpoint.

## Known Limitations

- **Pages can shift.** Paging uses offsets, so if a note is added or deleted while someone is paging, an item can appear on two pages or be skipped.
- **Deep pages get slower.** The database still reads past every skipped row; irrelevant at small-team scale.
- **The list's visibility rule is also expressed in SQL.** Filtering after reading a page would return short pages, so the database filters by who may see each note. The manager still decides which filters apply; adding a wider scope means updating this query as well.

- **Your activity can point to notes you can no longer open.** If an author narrows who can see a note after you changed it, the entry stays in your activity, but opening the note returns 404. See With More Time for the two ways to improve this.

## Open Questions

## API Reference

Every endpoint except `/health` and `/auth/login` needs `Authorization: Bearer <token>`. Errors are JSON: `{ "error": "...", "details": ["..."] }`.

| Method | Path | Success | Errors |
|---|---|---|---|
| `GET` | `/health` | 200; 503 when the database is unreachable | |
| `POST` | `/auth/login` (email, password) | 200 `{ accessToken, tokenType, expiresIn }` | 400, 401 |
| `GET` | `/auth/test` | 200, the authenticated user | 401 |
| `POST` | `/notes` | 201 + Location | 400, 401 |
| `GET` | `/notes?author={userId}` | 200, paged | 400, 401 |
| `GET` | `/notes/{id}` | 200 | 401, 404 |
| `PATCH` | `/notes/{id}` (title, body, version) | 200 | 400, 401, 403, 404, 409 |
| `PATCH` | `/notes/{id}/attributes` (viewAccess, editAccess) | 200 | 400, 401, 403, 404 |
| `PUT` | `/notes/{id}/lock` | 200 | 401, 403, 404 |
| `PUT` | `/notes/{id}/unlock` | 200 | 401, 403, 404 |
| `DELETE` | `/notes/{id}` | 204 | 401, 403, 404 |
| `GET` | `/activity/notes/{noteId}` | 200, paged | 401, 404 |
| `GET` | `/activity/users/{userId}` | 200, paged | 401, 403 |

## With More Time: Change, Add, Stop

- **Access for everyone.** Extend the view and edit scopes beyond the team to `everyone`, so notes can be shared across teams.
- **Viewed events in the activity log.** Record when a user views a note, so someone starting work can find "the note I was reading yesterday".
- **More detail in the activity log.** Record what specifically changed, or before and after images of the note.
- **Users changing teams.** A note's team is read through its author, not stored on the note, so a note follows its author if they change teams: the old team loses sight of it, including notes its members helped edit. With more time we would develop a more sophisticated mechanism, for example storing the team on the note so it stays with the team it was written in, or letting the author choose. There is no team-change operation today.
- **A "notes I can edit" filter.** The notes list filters by author; a filter for notes the caller can edit would help someone looking for work to contribute to.
- **Activity for notes you can no longer see.** Today your own activity lists every change you made, so you can click an entry for a note you no longer have access to and get an error. Two better options: mark such entries as "can no longer view", so a client can show them without a link; or leave them out of your activity altogether. We chose not to build either in this exercise.

## AI-Assisted Development

This documentation is intentionally brief. Questions or requests for more detail are welcome and can guide further discussion.
