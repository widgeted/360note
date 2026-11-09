#!/usr/bin/env node
/**
 * Production-safe security audit.
 *
 * It creates temporary users/workspaces directly in the database, then exercises
 * the HTTP API to verify workspace isolation, role permissions, share links,
 * attachment access, API token scopes, CSRF and account-recovery codes.
 *
 * It never sends email. All temporary data is removed at the end.
 *
 * Required env:
 *   DATABASE_URL
 *   BASE_URL=http(s)://...
 *   ADMIN_EMAIL, ADMIN_PASSWORD   (for the instance-admin check)
 *
 * Run from /opt/360note with Node 22:
 *   sudo env ... node tests/manual/security-audit.mjs
 */
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashPassword } from '../../apps/server/dist/lib/passwords.js';
import { encryptString, randomToken, sha256 } from '../../apps/server/dist/lib/crypto.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const DATA_DIR = process.env.NOTE360_DATA_DIR || '/var/lib/360note';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const TEST_CLIENT_IP = `198.51.100.${crypto.randomInt(1, 254)}`;
const createdUserIds = [];
const createdWorkspaceIds = [];

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function request(pathname, options = {}) {
  const headers = { ...(options.headers ?? {}), 'x-forwarded-for': TEST_CLIENT_IP };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrf !== false && !['GET', 'HEAD'].includes(options.method ?? 'GET')) {
    headers['x-360note-csrf'] = '1';
  }
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function login(email, password) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (response.status !== 200) throw new Error(`login failed for ${email}: ${response.status} ${response.text}`);
  return response.headers.get('set-cookie').split(';')[0];
}

async function createUser(label, password = 'Audit-Pass-2026!') {
  const email = `sec-${label}-${stamp}@invalid.local`;
  const hash = await hashPassword(password);
  const user = await pool.query(
    `INSERT INTO users (email, display_name, password_hash, role, avatar_color, email_verified_at)
     VALUES ($1, $2, $3, 'user', '#17865b', now()) RETURNING id, email`,
    [email, `Audit ${label}`, hash],
  );
  const row = user.rows[0];
  createdUserIds.push(row.id);
  const workspace = await pool.query(
    `INSERT INTO workspaces (name, kind, icon, color, owner_id)
     VALUES ($1, 'personal', '📔', '#17865b', $2) RETURNING id`,
    [`Audit ${label} personal`, row.id],
  );
  createdWorkspaceIds.push(workspace.rows[0].id);
  await pool.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    workspace.rows[0].id,
    row.id,
  ]);
  return { ...row, password, personalWorkspaceId: workspace.rows[0].id };
}

async function cleanup() {
  try {
    const attachmentRows = await pool.query(
      `SELECT a.storage_key FROM attachments a JOIN notes n ON n.id = a.note_id WHERE n.workspace_id = ANY($1::uuid[])`,
      [createdWorkspaceIds],
    );
    for (const row of attachmentRows.rows) {
      await fs.rm(path.join(DATA_DIR, 'attachments', row.storage_key), { force: true }).catch(() => {});
    }
    await pool.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [createdUserIds]);
    await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [createdUserIds]);
    await pool.query('DELETE FROM login_attempts WHERE email LIKE $1', [`sec-%${stamp}%`]);
    await pool.query('DELETE FROM email_codes WHERE email LIKE $1', [`sec-%${stamp}%`]);
    await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [createdWorkspaceIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  } catch (error) {
    console.error('cleanup failed', error);
  }
}

async function main() {
  console.log(`Base URL: ${BASE}`);
  console.log(`Temporary audit id: ${stamp}\n`);

  const A = await createUser('a');
  const B = await createUser('b');
  const C = await createUser('c');
  const D = await createUser('d');
  const E = await createUser('e');
  const F = await createUser('f');

  const team = await pool.query(
    `INSERT INTO workspaces (name, kind, icon, color, owner_id)
     VALUES ($1, 'team', '👥', '#0f766e', $2) RETURNING id`,
    [`Audit team ${stamp}`, A.id],
  );
  const teamId = team.rows[0].id;
  createdWorkspaceIds.push(teamId);
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
       ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'editor'), ($1, $5, 'viewer')`,
    [teamId, A.id, B.id, C.id, D.id],
  );

  const cookieA = await login(A.email, A.password);
  const cookieB = await login(B.email, B.password);
  const cookieC = await login(C.email, C.password);
  const cookieD = await login(D.email, D.password);

  // ---- unauthenticated surface ----
  const anonConfig = await request('/api/public/config');
  check('public config is readable without auth', anonConfig.status === 200 && anonConfig.json?.registrationMode === 'open');
  const anonMe = await request('/api/auth/me');
  check('auth/me rejects anonymous', anonMe.status === 401);
  const anonNotes = await request(`/api/notes?workspaceId=${A.personalWorkspaceId}`);
  check('notes list rejects anonymous', anonNotes.status === 401);
  const anonAdmin = await request('/api/admin/settings');
  check('admin settings rejects anonymous', anonAdmin.status === 401);
  const noCsrf = await request('/api/notes', { method: 'POST', cookie: cookieA, csrf: false, body: {} });
  check('cookie mutation without CSRF header is rejected', noCsrf.status === 403 && noCsrf.json?.error?.code === 'CSRF_REQUIRED');

  // ---- create content ----
  const note = await request('/api/notes', {
    method: 'POST',
    cookie: cookieA,
    body: {
      workspaceId: A.personalWorkspaceId,
      title: 'Audit private note',
      contentMd: '# Audit private note\n\nsecret-body-marker',
    },
  });
  check('owner can create a note', note.status === 200 && Boolean(note.json?.note?.id));
  const noteId = note.json.note.id;

  // PATCH/RETURNING rows do not include aggregated tag JSON unless the service
  // re-reads the canonical row. Keep this regression check explicit.
  const tagged = await request(`/api/notes/${noteId}`, {
    method: 'PATCH',
    cookie: cookieA,
    body: { tagNames: ['audit-keep-tag'] },
  });
  const updatedKeepTags = await request(`/api/notes/${noteId}`, {
    method: 'PATCH',
    cookie: cookieA,
    body: { contentMd: '# Audit private note\n\nsecret-body-marker updated' },
  });
  check(
    'note updates return their tags',
    tagged.status === 200 &&
      updatedKeepTags.status === 200 &&
      updatedKeepTags.json?.note?.tags?.some((tag) => tag.name === 'audit-keep-tag'),
    `tags=${JSON.stringify(updatedKeepTags.json?.note?.tags ?? [])}`,
  );
  await request(`/api/notes/${noteId}`, { method: 'DELETE', cookie: cookieA });
  const restored = await request(`/api/notes/${noteId}/restore`, { method: 'POST', cookie: cookieA });
  check(
    'restored notes keep their tags',
    restored.status === 200 && restored.json?.note?.tags?.some((tag) => tag.name === 'audit-keep-tag'),
  );

  const teamNote = await request('/api/notes', {
    method: 'POST',
    cookie: cookieA,
    body: { workspaceId: teamId, title: 'Audit team note', contentMd: '# Team note\n\nshared' },
  });
  check('team owner can create a note', teamNote.status === 200);
  const teamNoteId = teamNote.json.note.id;

  // ---- cross-workspace isolation ----
  const bRead = await request(`/api/notes/${noteId}`, { cookie: cookieB });
  check('another user cannot read a personal note', bRead.status === 404 || bRead.status === 403, `status ${bRead.status}`);
  const bWrite = await request(`/api/notes/${noteId}`, {
    method: 'PATCH',
    cookie: cookieB,
    body: { contentMd: 'hacked' },
  });
  check('another user cannot edit a personal note', bWrite.status === 404 || bWrite.status === 403, `status ${bWrite.status}`);
  const bDelete = await request(`/api/notes/${noteId}`, { method: 'DELETE', cookie: cookieB });
  check('another user cannot delete a personal note', bDelete.status === 404 || bDelete.status === 403, `status ${bDelete.status}`);
  const bList = await request(`/api/notes?workspaceId=${A.personalWorkspaceId}`, { cookie: cookieB });
  check('another user cannot list a personal workspace', bList.status === 404 || bList.status === 403, `status ${bList.status}`);
  const bFolders = await request(`/api/folders?workspaceId=${A.personalWorkspaceId}`, { cookie: cookieB });
  check('another user cannot list personal folders', bFolders.status === 404 || bFolders.status === 403, `status ${bFolders.status}`);
  const bSearch = await request(`/api/search?workspaceId=${A.personalWorkspaceId}&q=secret`, { cookie: cookieB });
  check('another user cannot search a personal workspace', bSearch.status === 404 || bSearch.status === 403, `status ${bSearch.status}`);
  const bExport = await request(`/api/export?workspaceId=${A.personalWorkspaceId}&format=md`, { cookie: cookieB });
  check('another user cannot export a personal workspace', bExport.status === 404 || bExport.status === 403, `status ${bExport.status}`);
  const bBackup = await request(`/api/workspaces/${A.personalWorkspaceId}/backups`, { method: 'POST', cookie: cookieB });
  check('another user cannot back up a personal workspace', bBackup.status === 404 || bBackup.status === 403, `status ${bBackup.status}`);

  // ---- team roles ----
  const dRead = await request(`/api/notes/${teamNoteId}`, { cookie: cookieD });
  check('viewer can read a team note', dRead.status === 200);
  const dWrite = await request(`/api/notes/${teamNoteId}`, {
    method: 'PATCH',
    cookie: cookieD,
    body: { contentMd: 'viewer edit' },
  });
  check('viewer cannot edit a team note', dWrite.status === 403, `status ${dWrite.status}`);
  const dCreate = await request('/api/notes', {
    method: 'POST',
    cookie: cookieD,
    body: { workspaceId: teamId, title: 'viewer note' },
  });
  check('viewer cannot create team notes', dCreate.status === 403, `status ${dCreate.status}`);
  const cCreate = await request('/api/notes', {
    method: 'POST',
    cookie: cookieC,
    body: { workspaceId: teamId, title: 'editor note', contentMd: 'editor body' },
  });
  check('editor can create a team note', cCreate.status === 200);
  const cEdit = await request(`/api/notes/${teamNoteId}`, {
    method: 'PATCH',
    cookie: cookieC,
    body: { contentMd: '# Team note\n\nedited by editor' },
  });
  check('editor can edit a team note', cEdit.status === 200);
  const cManage = await request(`/api/workspaces/${teamId}/members/${D.id}`, {
    method: 'PATCH',
    cookie: cookieC,
    body: { role: 'editor' },
  });
  check('editor cannot manage members', cManage.status === 403, `status ${cManage.status}`);
  const bManage = await request(`/api/workspaces/${teamId}/members/${C.id}`, {
    method: 'PATCH',
    cookie: cookieB,
    body: { role: 'viewer' },
  });
  check('admin can manage member roles', bManage.status === 200, `status ${bManage.status}`);
  await request(`/api/workspaces/${teamId}/members/${C.id}`, {
    method: 'PATCH',
    cookie: cookieB,
    body: { role: 'editor' },
  });
  const bTransfer = await request(`/api/workspaces/${teamId}/members/${B.id}`, {
    method: 'PATCH',
    cookie: cookieB,
    body: { role: 'owner' },
  });
  check('admin cannot transfer ownership to themselves', bTransfer.status === 403, `status ${bTransfer.status}`);
  const bDeleteTeam = await request(`/api/workspaces/${teamId}`, { method: 'DELETE', cookie: cookieB });
  check('admin cannot delete a team workspace', bDeleteTeam.status === 403, `status ${bDeleteTeam.status}`);

  // Invitation acceptance grants only the invited role.
  const inviteToken = randomToken(24);
  const invitation = await pool.query(
    `INSERT INTO workspace_invitations (workspace_id, inviter_id, email, invitee_id, role, token_hash, token_cipher, expires_at)
     VALUES ($1, $2, $3, $4, 'editor', $5, 'pending', now() + interval '14 days') RETURNING id`,
    [teamId, A.id, F.email, F.id, sha256(inviteToken)],
  );
  await pool.query('UPDATE workspace_invitations SET token_cipher = $2 WHERE id = $1', [
    invitation.rows[0].id,
    encryptString(inviteToken, `invite:${invitation.rows[0].id}`),
  ]);
  const cookieF = await login(F.email, F.password);
  const acceptInvite = await request(`/api/invitations/${inviteToken}/accept`, { method: 'POST', cookie: cookieF });
  check('invited user can accept an invitation', acceptInvite.status === 200 && acceptInvite.json?.workspaceId === teamId);
  const fReadTeam = await request(`/api/notes/${teamNoteId}`, { cookie: cookieF });
  check('accepted member can read team notes', fReadTeam.status === 200);
  const fManage = await request(`/api/workspaces/${teamId}/members/${C.id}`, {
    method: 'PATCH',
    cookie: cookieF,
    body: { role: 'viewer' },
  });
  check('accepted editor cannot manage members', fManage.status === 403, `status ${fManage.status}`);

  // ---- attachments ----
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#17865b"/></svg>');
  const form = new FormData();
  form.append('file', new Blob([svg], { type: 'image/svg+xml' }), 'audit.svg');
  const upload = await request(`/api/notes/${noteId}/attachments`, { method: 'POST', cookie: cookieA, body: form });
  check('owner can upload an attachment', upload.status === 201);
  const attachmentId = upload.json?.attachment?.id;
  const aAttachment = await request(`/api/attachments/${attachmentId}/content`, { cookie: cookieA });
  check('owner can read the attachment', aAttachment.status === 200);
  const bAttachment = await request(`/api/attachments/${attachmentId}/content`, { cookie: cookieB });
  check('another user cannot read the attachment', bAttachment.status === 403 || bAttachment.status === 404, `status ${bAttachment.status}`);
  const anonAttachment = await request(`/api/attachments/${attachmentId}/content`);
  check('anonymous cannot read a private attachment', anonAttachment.status === 401);

  // ---- sharing ----
  const publicShare = await request(`/api/notes/${noteId}/shares`, {
    method: 'POST',
    cookie: cookieA,
    body: { permission: 'view' },
  });
  check('owner can create a public share', publicShare.status === 200);
  const publicToken = publicShare.json?.share?.token;
  check(
    'public share token uses a compact 96-bit form',
    typeof publicToken === 'string' && /^[A-Za-z0-9_-]{16}$/.test(publicToken),
    publicToken,
  );
  const publicRead = await request(`/api/public/shares/${publicToken}`);
  check('public share is readable', publicRead.status === 200 && publicRead.json?.hasAccess === true);
  const publicAttachment = await request(`/api/public/shares/${publicToken}/attachments/${attachmentId}`);
  check('public share can serve its attachment', publicAttachment.status === 200);

  const guardedShare = await request(`/api/notes/${noteId}/shares`, {
    method: 'POST',
    cookie: cookieA,
    body: { permission: 'comment', password: 'audit-pass' },
  });
  const guardedToken = guardedShare.json?.share?.token;
  const guardedRead = await request(`/api/public/shares/${guardedToken}`);
  check(
    'password share hides content before unlock',
    guardedRead.status === 200 && guardedRead.json?.hasAccess === false && guardedRead.json?.note?.contentMd === '',
  );
  const wrongUnlock = await request(`/api/public/shares/${guardedToken}/unlock`, {
    method: 'POST',
    body: { password: 'wrong-password' },
  });
  check('password share rejects a wrong password', wrongUnlock.status === 400);
  const unlock = await request(`/api/public/shares/${guardedToken}/unlock`, {
    method: 'POST',
    body: { password: 'audit-pass' },
  });
  check('password share unlocks with the correct password', unlock.status === 200 && Boolean(unlock.json?.accessToken));
  const unlockedRead = await request(`/api/public/shares/${guardedToken}`, {
    headers: { 'x-share-access': unlock.json.accessToken },
  });
  check('unlocked share exposes its content', unlockedRead.status === 200 && unlockedRead.json?.hasAccess === true);
  const changedPassword = await request(`/api/shares/${guardedShare.json.share.id}`, {
    method: 'PATCH',
    cookie: cookieA,
    body: { password: 'audit-pass-2' },
  });
  check('owner can change a share password', changedPassword.status === 200);
  const oldTokenAfterChange = await request(`/api/public/shares/${guardedToken}`, {
    headers: { 'x-share-access': unlock.json.accessToken },
  });
  check(
    'changing the share password invalidates old access cookies',
    oldTokenAfterChange.status === 200 && oldTokenAfterChange.json?.hasAccess === false,
  );
  const unlockAgain = await request(`/api/public/shares/${guardedToken}/unlock`, {
    method: 'POST',
    body: { password: 'audit-pass-2' },
  });
  const guestComment = await request(`/api/public/shares/${guardedToken}/comments`, {
    method: 'POST',
    headers: { 'x-share-access': unlockAgain.json.accessToken },
    body: { guestName: 'Audit guest', body: 'Guest comment from security audit' },
  });
  check('comment share allows a guest comment after unlock', guestComment.status === 200);
  const bShareAccess = await request(`/api/notes/${noteId}`, { cookie: cookieB, headers: { 'x-share-access': unlockAgain.json.accessToken } });
  check('share access does not grant private note API access', bShareAccess.status === 404 || bShareAccess.status === 403);

  const past = new Date(Date.now() - 60_000).toISOString();
  const expired = await request(`/api/notes/${noteId}/shares`, {
    method: 'POST',
    cookie: cookieA,
    body: { permission: 'view', expiresAt: past },
  });
  check('expired share creation is rejected', expired.status === 400);

  const revoke = await request(`/api/shares/${publicShare.json.share.id}`, { method: 'DELETE', cookie: cookieA });
  check('owner can revoke a share', revoke.status === 200);
  const revokedRead = await request(`/api/public/shares/${publicToken}`);
  check('revoked share is no longer readable', revokedRead.status === 404);

  // ---- API tokens ----
  const readToken = await request('/api/tokens', {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'audit read token', scopes: ['notes:read'] },
  });
  check('user can create a read-only API token', readToken.status === 200 && Boolean(readToken.json?.token));
  const rawToken = readToken.json.token;
  const tokenExists = await pool.query('SELECT token_hash FROM api_tokens WHERE id = $1', [readToken.json.id]);
  check('API token is stored hashed', tokenExists.rows[0]?.token_hash === sha256(rawToken) && tokenExists.rows[0]?.token_hash !== rawToken);
  const bearerRead = await request(`/api/notes?workspaceId=${A.personalWorkspaceId}`, {
    headers: { authorization: `Bearer ${rawToken}` },
  });
  check('read token can list notes', bearerRead.status === 200);
  const bearerWrite = await request('/api/notes', {
    method: 'POST',
    headers: { authorization: `Bearer ${rawToken}` },
    body: { workspaceId: A.personalWorkspaceId, title: 'token write' },
  });
  check('read-only token cannot write notes', bearerWrite.status === 403);
  const bearerAdmin = await request('/api/admin/settings', { headers: { authorization: `Bearer ${rawToken}` } });
  check('API token cannot access admin settings', bearerAdmin.status === 403);
  await request(`/api/tokens/${readToken.json.id}`, { method: 'DELETE', cookie: cookieA });
  const afterRevoke = await request(`/api/notes?workspaceId=${A.personalWorkspaceId}`, {
    headers: { authorization: `Bearer ${rawToken}` },
  });
  check('revoked API token stops working', afterRevoke.status === 401);

  // ---- email verification codes (inserted directly; no email is sent) ----
  const registerEmail = `sec-register-${stamp}@invalid.local`;
  const registerCode = '123456';
  await pool.query(
    `INSERT INTO email_codes (email, purpose, code_hash, expires_at)
     VALUES ($1, 'register', $2, now() + interval '10 minutes')`,
    [registerEmail, sha256(`register:${registerEmail}:${registerCode}`)],
  );
  const wrongRegister = await request('/api/auth/register', {
    method: 'POST',
    body: {
      email: registerEmail,
      displayName: 'Audit register',
      password: 'K9m!tR4#vQ2@2026',
      emailCode: '000000',
    },
  });
  check('registration rejects a wrong email code', wrongRegister.status === 400);
  const register = await request('/api/auth/register', {
    method: 'POST',
    body: {
      email: registerEmail,
      displayName: 'Audit register',
      password: 'K9m!tR4#vQ2@2026',
      emailCode: registerCode,
    },
  });
  check('registration accepts a valid email code', register.status === 200 && Boolean(register.json?.user?.id));
  if (register.json?.user?.id) createdUserIds.push(register.json.user.id);

  const recoverCode = '654321';
  await pool.query(
    `INSERT INTO email_codes (email, purpose, code_hash, expires_at)
     VALUES ($1, 'recover', $2, now() + interval '10 minutes')`,
    [E.email, sha256(`recover:${E.email}:${recoverCode}`)],
  );
  const recover = await request('/api/auth/recover', {
    method: 'POST',
    body: { email: E.email, emailCode: recoverCode, newPassword: 'Audit-New-Pass-2026!' },
  });
  check('password recovery accepts a valid email code', recover.status === 200 && Boolean(recover.json?.recoveryKey));
  const oldLogin = await request('/api/auth/login', { method: 'POST', body: { email: E.email, password: E.password } });
  check('old password stops working after recovery', oldLogin.status === 401);
  const newLogin = await request('/api/auth/login', { method: 'POST', body: { email: E.email, password: 'Audit-New-Pass-2026!' } });
  check('new password works after recovery', newLogin.status === 200);

  // ---- email code attempt limit ----
  const limitEmail = `sec-limit-${stamp}@invalid.local`;
  const limitCode = '445566';
  await pool.query(
    `INSERT INTO email_codes (email, purpose, code_hash, expires_at)
     VALUES ($1, 'register', $2, now() + interval '10 minutes')`,
    [limitEmail, sha256(`register:${limitEmail}:${limitCode}`)],
  );
  for (let index = 0; index < 5; index += 1) {
    await request('/api/auth/register', {
      method: 'POST',
      body: {
        email: limitEmail,
        displayName: 'Limit test',
        password: 'K9m!tR4#vQ2@2026',
        emailCode: '000000',
      },
    });
  }
  const afterLimit = await request('/api/auth/register', {
    method: 'POST',
    body: {
      email: limitEmail,
      displayName: 'Limit test',
      password: 'K9m!tR4#vQ2@2026',
      emailCode: limitCode,
    },
  });
  check('email code stops working after five failed attempts', afterLimit.status === 400);

  // ---- email change ----
  const newEmailB = `sec-b-new-${stamp}@invalid.local`;
  const changeCode = '112233';
  await pool.query(
    `INSERT INTO email_codes (email, purpose, code_hash, expires_at)
     VALUES ($1, 'change_email', $2, now() + interval '10 minutes')`,
    [newEmailB, sha256(`change_email:${newEmailB}:${changeCode}`)],
  );
  const changeWrongPassword = await request('/api/me/email', {
    method: 'PATCH',
    cookie: cookieB,
    body: { email: newEmailB, emailCode: changeCode, password: 'wrong-password' },
  });
  check('email change requires the current password', changeWrongPassword.status === 400);
  const change = await request('/api/me/email', {
    method: 'PATCH',
    cookie: cookieB,
    body: { email: newEmailB, emailCode: changeCode, password: B.password },
  });
  check('email change accepts a valid code and password', change.status === 200 && change.json?.user?.email === newEmailB);
  const loginNewEmail = await request('/api/auth/login', { method: 'POST', body: { email: newEmailB, password: B.password } });
  check('user can sign in with the changed email', loginNewEmail.status === 200);

  // ---- admin boundary ----
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const adminCookie = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    const adminSettings = await request('/api/admin/settings', { cookie: adminCookie });
    check('instance admin can read admin settings', adminSettings.status === 200);
    const userAdmin = await request('/api/admin/settings', { cookie: cookieA });
    check('normal user cannot read admin settings', userAdmin.status === 403);
  } else {
    console.log('SKIP  instance-admin check (ADMIN_EMAIL/ADMIN_PASSWORD not provided)');
  }

  // ---- SQL injection smoke test ----
  const injection = await request(`/api/search?workspaceId=${A.personalWorkspaceId}&q=${encodeURIComponent("' OR 1=1 --")}`, {
    cookie: cookieA,
  });
  check('search handles SQL metacharacters without an error', injection.status === 200);

  await cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('AUDIT ERROR', error);
  await cleanup();
  await pool.end().catch(() => {});
  process.exit(1);
});
