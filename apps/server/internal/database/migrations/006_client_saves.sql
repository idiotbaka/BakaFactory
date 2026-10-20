-- Client-authoritative saves start independently of the retired server factories.
-- Keep all published migrations and existing accounts / legacy data intact.
DELETE FROM sessions WHERE token_hash IN (
    SELECT token_hash FROM (
        SELECT token_hash, ROW_NUMBER() OVER (
            PARTITION BY user_id ORDER BY created_at DESC, token_hash DESC
        ) AS position FROM sessions
    ) WHERE position > 1
);
CREATE UNIQUE INDEX one_session_per_user ON sessions(user_id);
CREATE TABLE cloud_saves (
    owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0),
    saved_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK(json_valid(state))
);
