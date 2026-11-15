-- Password-derived encrypted spaces.
-- Content keys are wrapped by a password-derived KEK and by a one-time
-- recovery key; the server only holds the unwrapped key in memory while the
-- space is unlocked.

ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_kind_check;
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('personal', 'team', 'vault'));

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS vault_salt text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS vault_key_wrapped text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS vault_recovery_hash text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS vault_recovery_wrapped text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS vault_created_at timestamptz;

CREATE TABLE IF NOT EXISTS workspace_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (workspace_id, session_id)
);
CREATE INDEX IF NOT EXISTS workspace_unlocks_session_idx ON workspace_unlocks (session_id);
CREATE INDEX IF NOT EXISTS workspace_unlocks_expiry_idx ON workspace_unlocks (expires_at);

CREATE INDEX IF NOT EXISTS notes_vault_idx ON notes (workspace_id) WHERE encrypted = true;
