CREATE TABLE application_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO application_metadata (key, value)
VALUES ('initialized_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
