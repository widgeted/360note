import { many, one } from '../db.js';

export interface DbUser {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: 'user' | 'admin';
  avatar_color: string;
  totp_secret_enc: string | null;
  totp_enabled: boolean;
  totp_last_step: number | null;
  recovery_key_hash: string | null;
  failed_logins: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  prefs: Record<string, unknown>;
  sharing_disabled: boolean;
  disabled_at: Date | null;
  encryption_enabled: boolean;
  encryption_salt: string | null;
  enc_wrapped_pass: string | null;
  enc_wrapped_recovery: string | null;
  enc_check: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface DbSession {
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string | null;
  user_agent: string;
  ip: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface AuthContext {
  user: DbUser;
  session: DbSession | null;
  tokenId?: string;
  tokenScopes?: string[];
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  return one<DbUser>('SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [email]);
}

export async function findUserById(id: string): Promise<DbUser | null> {
  return one<DbUser>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
}

export async function getWorkspaceRole(workspaceId: string, userId: string): Promise<string | null> {
  const row = await one<{ role: string }>(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  return row?.role ?? null;
}

export async function userWorkspaces(userId: string) {
  return many<{
    id: string;
    name: string;
    kind: string;
    icon: string;
    color: string;
    owner_id: string;
    role: string;
    created_at: Date;
    updated_at: Date;
    member_count: string;
  }>(
    `SELECT w.id, w.name, w.kind, w.icon, w.color, w.owner_id, m.role, w.created_at, w.updated_at,
            (SELECT count(*)::text FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count
     FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
     WHERE w.deleted_at IS NULL
     ORDER BY w.kind = 'personal' DESC, w.created_at ASC`,
    [userId],
  );
}

export function publicUser(user: DbUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    avatarColor: user.avatar_color,
    totpEnabled: user.totp_enabled,
    encryptionEnabled: user.encryption_enabled,
    createdAt: user.created_at.toISOString(),
    prefs: user.prefs ?? {},
  };
}
