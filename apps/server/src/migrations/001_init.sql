-- 360note initial schema
-- PostgreSQL 15+
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  avatar_color text NOT NULL DEFAULT '#2f6feb',
  totp_secret_enc text,
  totp_enabled boolean NOT NULL DEFAULT false,
  totp_last_step integer,
  recovery_key_hash text,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  encryption_enabled boolean NOT NULL DEFAULT false,
  encryption_salt text,
  enc_wrapped_pass text,
  enc_wrapped_recovery text,
  enc_check text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_lower_uidx ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE totp_backup_codes (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id, revoked_at);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'team')),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

CREATE TABLE workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  invitee_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  token_cipher text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE INDEX invitations_email_idx ON workspace_invitations (lower(email), status);
CREATE INDEX invitations_workspace_idx ON workspace_invitations (workspace_id, status);

CREATE TABLE folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  icon text,
  position integer NOT NULL DEFAULT 0,
  trashed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX folders_workspace_idx ON folders (workspace_id, parent_id);

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  content_md text NOT NULL DEFAULT '',
  excerpt text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0,
  is_favorite boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  encrypted boolean NOT NULL DEFAULT false,
  cipher_title text,
  cipher_body text,
  enc_iv text,
  enc_version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz,
  trashed_at timestamptz,
  deleted_at timestamptz,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content_md, ''))
  ) STORED
);
CREATE INDEX notes_workspace_idx ON notes (workspace_id, trashed_at, updated_at DESC);
CREATE INDEX notes_folder_idx ON notes (workspace_id, folder_id);
CREATE INDEX notes_search_idx ON notes USING GIN (search_vector);
CREATE INDEX notes_title_trgm_idx ON notes USING GIN (title gin_trgm_ops);
CREATE INDEX notes_content_trgm_idx ON notes USING GIN (content_md gin_trgm_ops);
CREATE INDEX notes_favorite_idx ON notes (workspace_id, is_favorite) WHERE trashed_at IS NULL;

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_workspace_name_uidx ON tags (workspace_id, lower(name));

CREATE TABLE note_tags (
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX note_tags_tag_idx ON note_tags (tag_id);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  width integer,
  height integer,
  ocr_text text,
  ocr_status text NOT NULL DEFAULT 'none' CHECK (ocr_status IN ('none', 'pending', 'done', 'failed')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX attachments_note_idx ON attachments (note_id);
CREATE INDEX attachments_name_trgm_idx ON attachments USING GIN (filename gin_trgm_ops);

CREATE TABLE note_versions (
  id bigserial PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version integer NOT NULL,
  title text NOT NULL,
  content_md text NOT NULL,
  reason text NOT NULL DEFAULT 'auto' CHECK (reason IN ('auto', 'manual', 'restore', 'import', 'conflict')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX note_versions_note_idx ON note_versions (note_id, version DESC);
CREATE UNIQUE INDEX note_versions_note_version_uidx ON note_versions (note_id, version);

CREATE TABLE share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  token_cipher text NOT NULL,
  permission text NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'comment', 'edit')),
  password_hash text,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz
);
CREATE INDEX share_links_note_idx ON share_links (note_id, revoked_at);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  guest_name text,
  body text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_note_idx ON comments (note_id, created_at);

CREATE TABLE note_links (
  source_note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id uuid REFERENCES notes(id) ON DELETE SET NULL,
  target_title text NOT NULL,
  PRIMARY KEY (source_note_id, target_title)
);
CREATE INDEX note_links_target_idx ON note_links (target_note_id, source_note_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);

CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["notes:read","notes:write"]'::jsonb,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_workspace_idx ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX audit_actor_idx ON audit_logs (actor_id, created_at DESC);

CREATE TABLE backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  filename text NOT NULL,
  storage_key text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'manual' CHECK (kind IN ('auto', 'manual', 'pre-restore')),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'running', 'failed')),
  note_count integer NOT NULL DEFAULT 0,
  attachment_count integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX backups_workspace_idx ON backups (workspace_id, created_at DESC);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  progress integer NOT NULL DEFAULT 0,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE instance_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), created_at DESC);
