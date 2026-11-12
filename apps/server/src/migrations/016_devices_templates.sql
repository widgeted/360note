ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id text;
CREATE INDEX IF NOT EXISTS sessions_user_device_idx ON sessions (user_id, device_id);

ALTER TABLE templates ADD COLUMN IF NOT EXISTS builtin_key text;
CREATE UNIQUE INDEX IF NOT EXISTS templates_user_builtin_idx ON templates (user_id, builtin_key);

ALTER TABLE users ADD COLUMN IF NOT EXISTS templates_seeded_at timestamptz;
