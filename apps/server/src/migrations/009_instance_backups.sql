-- Whole-instance backups (database dump + encrypted attachment files).
CREATE TABLE IF NOT EXISTS instance_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instance_backups_created_idx ON instance_backups (created_at DESC);
