# Notes Service

## Overview

A back-end REST service where several small teams capture notes and work on them together. A note's author decides who can see it, who can edit it, and whether it is locked, and every change is recorded in an activity log.

## Getting Started

Requires Docker (with Compose) and Node 20 or later. Every routine task is a Make target; `make help` lists them all.

### From Clone to Running

Run these in order from the project folder:

1. `make install`: install Node dependencies.
2. `make up`: check the prerequisites, then build and start PostgreSQL and the service; migrations run automatically, and it waits until both are healthy.
3. `make seed`: load the demo teams and users (safe to repeat).
4. `make health`: the service and its database answer.
5. `make login`, then `make auth-test`: log in (default Sam Darnold; any user with `EMAIL=...`), save the token, and confirm it is accepted.
6. `make demo`: a scripted walk-through of the rules as the demo users (sharing, a stale edit rejected, other team refused, author-only delete, the lock, the activity log), printing each step's HTTP status.
7. `make test`, then `make test-integration`: the unit tests, then every test against a separate PostgreSQL test database (see Testing).
8. `make down`: stop (data is kept); `make db-reset` starts again from an empty, seeded database.

The service listens on http://localhost:3000; PostgreSQL is on host port 5433.

### Demo Users

All with the password `notes-demo-password`:

| Team | User | Email |
|---|---|---|
| seahawks | Sam Darnold | sdarnold@seahawks.com |
| seahawks | Mike Macdonald | mmacdonald@seahawks.com |
| seahawks | Kenneth Walker | kwalker@seahawks.com |
| patriots | Drake Maye | dmaye@patriots.com |
| patriots | Mike Vrabel | mvrabel@patriots.com |
| patriots | Rhamondre Stevenson | rstevenson@patriots.com |

## Testing

Two layers, both on Node's built-in test runner:

- **Unit tests** (`make test`): the business rules in the managers, against in-memory fakes of the data tier, plus the service skeleton over HTTP. Fast, and no database needed.
- **Integration tests** (`make test-integration`, after `make up`): the whole service over HTTP against a separate `notes_test` database. They prove what fakes cannot: the SQL itself, the activity entry written with each change, the database constraints, and that two simultaneous edits of the same version produce exactly one success and one 409.

GitHub Actions runs both on every push: the unit tests on Node 20 and 22, and the integration tests against a PostgreSQL service container.

## Project Structure

```
app.js, server.js     build the app; start it (migrations, graceful shutdown on SIGTERM and SIGINT)
routes/               tier 1, HTTP only: read the request, call the manager, send the status
manager/              tier 2, business rules: who may see, edit and change what; throws typed errors
api/                  tier 3, data access only: parameterised SQL, one statement per change with its activity entry
model/, enum/         notes, users and activity entries; access scopes and activity actions
error/                typed errors, each mapped to an HTTP status
middleware/           request IDs and logging, the token check, the central error handler
util/                 operational, outside the tiers: configuration, logging, database pool, migrations, passwords, tokens
migrations/           numbered SQL files, applied at startup
scripts/              seed data and the demo walk-through (operational)
test/                 unit and integration tests, on Node's built-in runner
.github/workflows/    CI
```

File names carry their tier as a suffix (`note_routes.js`, `note_manager.js`, `note_api.js`), so an import line, editor tab or stack trace shows the tier without reading the folder.

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
- **The activity log records changes, not views.** Each entry holds who, when, which note, and the action, never the note's title or content. Locking and unlocking are their own actions, distinct from changing the attributes. A request that changes nothing (locking a locked note, or setting attributes to the values they already have) succeeds and records nothing.
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

- **Docker is the one prerequisite besides Node.** PostgreSQL and the service run in Docker Compose, as they would be run for real; `make check` stops with a clear message if Docker or Compose is missing or not running.
- **Node 20 or later.** Node 18 is past end of life. The service checks the version before anything else loads and stops with a clear message on an older one; `package.json` and `engine-strict` check it again at install. CI runs the tests on Node 20 and 22.
- **No registration; login stands in for an identity provider.** Users are seeded. `POST /auth/login` checks a hashed password and issues a 15-minute token; every other request presents it. In production an identity provider would own registration and login, and only the token check would remain here.
- **Paging defaults to page 1 of 25, and a page holds at most 100 items.** A larger `pageSize` returns 400 rather than being silently reduced. There is no right answer for these numbers; they keep responses small, and the decision is recorded here so it can be changed deliberately. Each list reads one extra row to set `hasNextPage`, rather than counting every row.
- **Demo users share one password, on purpose.** The seed data (two teams of three users) exists so reviewers can sign in as anyone and see every rule in action; one shared password keeps that simple. It is supplied through `SEED_PASSWORD`, never stored in the code, and is for local demonstration only.

- **Only the author can change a note's attributes,** so a mistake made at creation can be corrected; no one else can change them.
- **Your own activity includes notes you can no longer see.** It is your history, so it stays visible to you; because entries never carry a note's title or content, this reveals nothing the note now holds. Opening such a note still returns 404.
- **`/activity/users/{userId}` includes the user ID for consistency.** It is not technically needed, because the endpoint is limited to the authenticated user, but it mirrors `/activity/notes/{noteId}`, and the shape would allow a later rule (for example, team leads reading their team's activity) without a new endpoint.

## Known Limitations

- **Deletes are hard deletes, and the activity log has no foreign key to notes.** Deleting a note removes it permanently; its activity entries, including a `deleted` entry, are kept, so each user's own activity still shows their changes. Because the note row is gone, `activity.note_id` cannot reference it, so the database does not enforce referential integrity on that column. We would prefer a soft delete (the note kept with a `deleted_at` timestamp) with a real foreign key, which would also let an author restore a note; given our timeframe, we chose the hard delete.

- **Pages can shift.** Paging uses offsets, so if a note is added or deleted while someone is paging, an item can appear on two pages or be skipped.
- **Deep pages get slower.** The database still reads past every skipped row; irrelevant at small-team scale.
- **The list's visibility rule is also expressed in SQL.** Filtering after reading a page would return short pages, so the database filters by who may see each note. The manager still decides which filters apply; adding a wider scope means updating this query as well.

- **Your activity can point to notes you can no longer open.** If an author narrows who can see a note after you changed it, the entry stays in your activity, but opening the note returns 404. See With More Time for the two ways to improve this.

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

### Change

- **Cursor paging instead of offsets,** if lists grow large: stable pages while notes are added, and constant cost for deep pages.

### Add

- **Sharing across teams.** Extend the view and edit scopes beyond the team with a new scope, `everyone`, so notes can be shared across teams.
- **Viewed events in the activity log.** Record when a user views a note, so someone starting work can find "the note I was reading yesterday".
- **More detail in the activity log.** Record what specifically changed, or before and after images of the note.
- **Search.** Find notes by words in their title or body (for example with PostgreSQL full-text search), limited to the notes the caller can see.
- **A "notes I can edit" filter.** The notes list filters by author; a filter for notes the caller can edit would help someone looking for work to contribute to.

### Stop: Functional

- **Stop hard-deleting notes.** Keep deleted notes with a `deleted_at` timestamp, add a foreign key from `activity.note_id` to `notes` for referential integrity, and let an author restore a note deleted by mistake. Every note query would exclude deleted notes.
- **Stop throwing away concurrent edits wholesale.** A stale edit is rejected even when the two people changed different fields; merge field by field, and reject only real conflicts (see Resolving Concurrent Edits).
- **Stop moving notes with their author.** A note's team is read through its author, so a note follows its author if they change teams: the old team loses sight of it, including notes its members helped edit. We would develop a more sophisticated mechanism, for example storing the team on the note so it stays with the team it was written in, or letting the author choose. There is no team-change operation today.
- **Stop listing activity you cannot open.** Your own activity lists every change you made, so you can click an entry for a note you no longer have access to and get an error. Two better options: mark such entries as "can no longer view", so a client can show them without a link; or leave them out of your activity altogether.

### Stop: Technical

- **Programming: stop expressing visibility in two places.** The rule lives in the manager and again in the list's SQL, so adding a scope means changing both. Keep one source of truth, for example by generating the SQL filter from the scope definitions.
- **Architecture: stop issuing tokens in this service.** Login is a stand-in; an identity provider should own registration and login (signing with its own keys), leaving only the token check here.
- **Architecture: stop using one shared demo password and the seed script** outside local demonstration.
- **DevOps: stop running migrations at service startup.** Run them as a separate deploy step, so instances never race and a bad migration does not take every instance down.
- **DevOps: stop logging every health check at `info`.** Docker calls `/health` every 5 seconds, which floods the logs; log successes at `debug`.
- **DevOps: stop keeping the token secret in `compose.yaml`.** Use a secret store, even in shared development environments.

## AI-Assisted Development

Claude Code was used to write the code and this document. The design, and each decision in it, were worked through and directed by the author: the AI listed each step's files for approval before building them, and built only what was approved.

| File | Purpose |
|---|---|
| `AGENTS.md` | The rules for any AI tool: working agreement, build protocol, stack, architecture, conventions |
| `CLAUDE.md` | One line, `@AGENTS.md`, so Claude Code reads the same rules |

This documentation is intentionally brief. Questions or requests for more detail are welcome and can guide further discussion.
