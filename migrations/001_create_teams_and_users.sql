-- Teams, and the users who belong to them. A user belongs to exactly one team.

CREATE TABLE teams (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id              uuid        NOT NULL REFERENCES teams (id),
    email                text        NOT NULL UNIQUE CHECK (email = lower(email)),
    first_name           text        NOT NULL,
    last_name            text        NOT NULL,
    password_hash        text        NOT NULL,
    active               boolean     NOT NULL DEFAULT true,
    password_changed_at  timestamptz NOT NULL DEFAULT now(),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_team_id ON users (team_id);
