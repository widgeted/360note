-- Email verification codes for registration and password recovery.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS email_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('register', 'recover', 'change_email')),
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  ip text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_codes_lookup_idx
  ON email_codes (lower(email), purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS email_codes_created_idx
  ON email_codes (created_at);
