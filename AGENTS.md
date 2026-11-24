# Notes Service: Rules for AI Assistants

These rules apply to any AI tool working in this project.

## Project

A back-end REST service where several small teams capture notes and work on them together. A note's author sets who can see it and who can edit it (`viewAccess`, `editAccess`: `author` or `team`), and can lock its text. Edits to the text are version-checked; every change is recorded in an activity log. The README's Functional Rules are the specification.

## Working Agreement

- Thomas leads the pace. One step at a time; wait for his go before the next step.
- Agree a design before writing code. Do not present solution alternatives before the problem is agreed.
- State-changing actions (installing packages, deleting files, git commits and pushes, Docker volumes) need his go-ahead. Reads are free.
- Check every design choice against the brief and the README's Functional Rules. Never trade a requirement away and list it as a limitation.
- When a step runs longer than its time budget, say so in one line and let Thomas decide.
- Keep it simple. Do not over-engineer; do not add what was not agreed.
- Fail loudly rather than swallowing errors.

## Build Protocol

Thomas must never have to catch up with what the AI has built.

1. Before each step, list exactly what will be created: each file, endpoint and Make target, with one line on what it does. Build nothing until Thomas approves the list.
2. Build only what is on the approved list. If something else turns out to be needed, stop and ask before adding it.
3. Work in small slices: one concern at a time. Thomas reviews each slice before the next.
4. Explain before building, not after: a few lines on what it does and why.
5. Flag any change to an agreed design before building it, never afterwards.

## Seed Data

Never invent seed data. List the shape needed for Thomas to confirm, then ask for each value one question at a time (team names; each user's email, first name, last name and team; passwords), and show the complete data as a table for him to check before it goes into the seed script.

## Stack

- Node 20 or later, ES modules, Express 5.
- PostgreSQL 17 in Docker Compose; the `pg` driver; SQL migrations in `migrations/`.
- JWT with `jose`; passwords hashed with Node's built-in `crypto.scrypt`.
- Tests with Node's built-in `node:test` and `fetch`.
- The Makefile is the operational front door: every routine task has a target, added as we go. Edit the Makefile with the editor, not a shell heredoc.

## Architecture

The three tiers apply to the domain (notes, users, teams, activity). Operational code (health checks, migrations, seed scripts) is not domain code: it lives in `util/` and `scripts/`, outside the tiers, and contains no business rules.

- `routes/`: HTTP only. Read the request, call the manager, send the status.
- `manager/`: business rules. Throws typed errors; knows nothing about HTTP.
- `api/`: data access only. Plain parameterised SQL; maps `snake_case` columns to `camelCase` objects.
- Supporting folders: `model/`, `enum/`, `error/`, `middleware/`.
- `util/`: infrastructure shared by the tiers (configuration, logging, database pool, migrations, password hashing, tokens). No business rules; a file belongs here if it could be copied unchanged into a different service.
- File names are `snake_case` and carry their tier as a suffix (`note_routes.js`, `note_manager.js`, `note_api.js`).
- Each tier is a factory with its dependencies passed in, so tests use fakes. `app.js` builds the app and never listens; `server.js` starts it.
- One central error handler maps typed errors to JSON `{ error, details }`. Unknown routes return a JSON 404. `X-Powered-By` is off.
- A password hash is read only by the login check. It never appears in a response, a log line or the `User` model.

## Code Conventions

- Every function has a comment stating its purpose.
- Every test block has a one-line comment.
- Assumptions in code are marked `// Notice - ...`. Ask Thomas before adding any Notice comment.
- New files carry `@author: tgibbons via Claude`. No copyright headers.

## Documents

- Every title uses title case: headings, table column headers and diagram labels. Body text stays in sentence case.
- The README is brief, is built as we go, and answers the brief literally: 2–3 design choices and why; what we would change, add or stop doing.

## Done Means

- `make test` passes, and the change is checked against the running service with `make up`.
- The README matches the code.
- Small commits, one per slice of work: the commit history is reviewed.
