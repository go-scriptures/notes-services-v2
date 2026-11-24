-- Notes. A note's team is its author's team (through users.team_id).
-- view_access and edit_access are levels ('author', 'team'); edit is never wider than view.
-- version supports optimistic concurrency for edits to the text: every text edit increments it.

CREATE TABLE notes (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by   uuid        NOT NULL REFERENCES users (id),
    title        text        NOT NULL CHECK (length(trim(title)) > 0),
    body         text,
    view_access  text        NOT NULL DEFAULT 'author' CHECK (view_access IN ('author', 'team')),
    edit_access  text        NOT NULL DEFAULT 'author' CHECK (edit_access IN ('author', 'team')),
    locked       boolean     NOT NULL DEFAULT false,
    version      integer     NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    -- No one can edit what they cannot see.
    CONSTRAINT notes_edit_within_view CHECK (NOT (view_access = 'author' AND edit_access = 'team'))
);

-- Lists are read by author, newest first, with (created_at, id) as the stable order.
CREATE INDEX notes_created_by_created ON notes (created_by, created_at DESC, id DESC);
