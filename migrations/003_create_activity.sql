-- The activity log: who did what to which note, and when. Changes only, never views.
-- note_id has no foreign key on purpose: entries outlive a deleted note, so each user's
-- own activity still shows the changes they made to it.

CREATE TABLE activity (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id     uuid        NOT NULL,
    user_id     uuid        NOT NULL REFERENCES users (id),
    action      text        NOT NULL CHECK (action IN
                    ('created', 'edited', 'attributes_changed', 'locked', 'unlocked', 'deleted')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Read by note and by user, newest first.
CREATE INDEX activity_note_created ON activity (note_id, created_at DESC, id DESC);
CREATE INDEX activity_user_created ON activity (user_id, created_at DESC, id DESC);
