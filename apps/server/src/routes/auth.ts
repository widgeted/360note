import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { one, query, transaction } from '../db.js';
import { clientIp, clearSessionCookie, requireAuth, sessionCookieName, setSessionCookie } from '../auth.js';
import { encryptString, decryptString, generateRecoveryKey, hashRecoveryKey, randomToken, safeEqual, sha256, signToken, verifyToken } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { hashPassword, passwordIssues, verifyPassword } from '../lib/passwords.js';
import { generateBackupCodes, generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';
import { emailSchema, parse, passwordSchema } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { publicUser, type DbUser } from '../lib/users.js';
import { avatarColor, welcomeSeed } from '../lib/seed.js';
import { createSession, listSessions, notify, revokeAllSessions, revokeSession } from '../services/sessions.js';
import { createNote } from '../services/notes.js';
import { consumeEmailCode, issueEmailCode } from '../services/email-codes.js';
import { normalizeLocale, sendEmailChangedEmail, sendPasswordChangedEmail, sendWelcomeEmail } from '../lib/mailer.js';

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
const DUMMY_HASH = 'scrypt$32768$8$1$gRxMaJTRQkB0QqlmAreJig==$4AG/OI/xhWzP1TphsbW8eyTGejxShutVOdeL7HTTnOoXnnmiP3rNeyD8ww7J6QPn1bkbUvNFkkKv66iTEmSxpQ==';
const registerSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1, '请输入昵称').max(60),
  password: passwordSchema,
  inviteCode: z.string().max(200).optional(),
  locale: z.string().max(20).optional(),
  emailCode: z.string().trim().regex(/^\d{6}$/, '请输入 6 位邮箱验证码'),
});

async function userCount(): Promise<number> {
  const row = await one<{ count: string }>('SELECT count(*)::text AS count FROM users WHERE deleted_at IS NULL');
  return Number(row?.count ?? 0);
}

async function workspacesFor(userId: string) {
  const { userWorkspaces } = await import('../lib/users.js');
  return (await userWorkspaces(userId)).map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    kind: workspace.kind as 'personal' | 'team',
    icon: workspace.icon,
    color: workspace.color,
    ownerId: workspace.owner_id,
    role: workspace.role as 'owner' | 'admin' | 'editor' | 'viewer',
    memberCount: Number(workspace.member_count),
    createdAt: workspace.created_at.toISOString(),
    updatedAt: workspace.updated_at.toISOString(),
  }));
}

/**
 * Consume a TOTP time step exactly once. Two concurrent requests with the same
 * code race on this conditional UPDATE: only the first gets a row back.
 */
async function consumeTotpStep(userId: string, step: number): Promise<boolean> {
  const row = await one<{ id: string }>(
    `UPDATE users SET totp_last_step = $2
     WHERE id = $1 AND totp_enabled = true
       AND (totp_last_step IS NULL OR totp_last_step < $2)
     RETURNING id`,
    [userId, step],
  );
  return Boolean(row);
}

/** Consume a backup code exactly once, without a read-then-write race. */
async function consumeBackupCode(userId: string, normalizedCode: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `UPDATE totp_backup_codes SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL AND code_hash = $2
     RETURNING id`,
    [userId, sha256(normalizedCode)],
  );
  return Boolean(row);
}

function authPayload(user: DbUser, workspaces: Awaited<ReturnType<typeof workspacesFor>>) {
  return {
    user: publicUser(user),
    workspaces,
    instance: {
      version: config.version,
      registrationMode: config.registrationMode,
      aiEnabled: config.ai.enabled,
      ocrEnabled: config.ocrEnabled,
      maxUploadBytes: config.maxUploadBytes,
      publicOrigin: config.publicOrigin,
    },
  };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/email-code', {
    config: { rateLimit: { max: 12, timeWindow: '1 hour' } },
  }, async (request) => {
    const body = parse(
      z.object({
        email: emailSchema,
        purpose: z.enum(['register', 'recover', 'change_email']),
        locale: z.string().max(20).optional(),
      }),
      request.body,
    );
    const existing = await one<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
      [body.email],
    );
    if (body.purpose === 'change_email') {
      const auth = requireAuth(request);
      if (existing?.id === auth.user.id) throw errors.conflict('这是你当前使用的邮箱');
      if (existing) throw errors.conflict('这个邮箱已注册');
      await issueEmailCode({
        email: body.email,
        purpose: body.purpose,
        locale: normalizeLocale(body.locale ?? request.headers['accept-language']),
        ip: clientIp(request),
      });
      return { ok: true, expiresIn: 600, resendAfter: 60 };
    }
    if (body.purpose === 'register' && existing) {
      throw errors.conflict('这个邮箱已注册');
    }
    // Do not reveal whether an account exists during password recovery.
    if (body.purpose === 'register' || existing) {
      await issueEmailCode({
        email: body.email,
        purpose: body.purpose,
        locale: normalizeLocale(body.locale ?? request.headers['accept-language']),
        ip: clientIp(request),
      });
    }
    return { ok: true, expiresIn: 600, resendAfter: 60 };
  });

  app.post('/api/auth/register', {
    config: { rateLimit: { max: 8, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = parse(registerSchema, request.body);
    const count = await userCount();
    if (count > 0 && config.registrationMode === 'invite') {
      if (!config.inviteCode || body.inviteCode !== config.inviteCode) {
        throw errors.forbidden('当前仅接受邀请注册');
      }
    }
    const issues = passwordIssues(body.password, body.email);
    if (issues.length) throw errors.badRequest(issues[0]);
    if (count === 0 && config.bootstrapAdminEmail && body.email.toLowerCase() !== config.bootstrapAdminEmail) {
      throw errors.forbidden('实例尚未初始化，请使用管理员邮箱完成首次注册');
    }
    const exists = await one('SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [body.email]);
    if (exists) throw errors.conflict('这个邮箱已注册');
    const codeOk = await consumeEmailCode(body.email, 'register', body.emailCode);
    if (!codeOk) throw errors.badRequest('验证码不正确或已过期');

    const recoveryKey = generateRecoveryKey();
    const passwordHash = await hashPassword(body.password);
    const displayName = body.displayName.trim();

    let user: DbUser;
    let firstUser = false;
    try {
      const created = await transaction(async (client) => {
        // Serialize account creation. Without this lock two concurrent first
        // registrations both see count=0 and both become instance admins.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('360note:registration'))`);
        const countRow = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM users WHERE deleted_at IS NULL',
        );
        const isFirstUser = Number(countRow.rows[0]?.count ?? 0) === 0;
        const row = await client.query<DbUser>(
          `INSERT INTO users (email, display_name, password_hash, role, avatar_color, recovery_key_hash, email_verified_at, prefs)
           VALUES ($1, $2, $3, $4, $5, $6, now(), $7::jsonb) RETURNING *`,
          [
            body.email,
            displayName,
            passwordHash,
            isFirstUser ? 'admin' : 'user',
            avatarColor(body.email),
            hashRecoveryKey(recoveryKey),
            JSON.stringify({ locale: body.locale?.toLowerCase().startsWith('en') ? 'en' : 'zh-CN' }),
          ],
        );
        const createdUser = row.rows[0];
        const workspaceName = body.locale?.startsWith('zh') ? '我的空间' : 'My space';
        const workspace = await client.query<{ id: string }>(
          `INSERT INTO workspaces (name, kind, owner_id) VALUES ($1, 'personal', $2) RETURNING id`,
          [workspaceName, createdUser.id],
        );
        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [workspace.rows[0].id, createdUser.id],
        );
        return { user: createdUser, firstUser: isFirstUser };
      });
      user = created.user;
      firstUser = created.firstUser;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw errors.conflict('这个邮箱已注册');
      throw error;
    }

    // Seed a tiny, useful starting space. Failure here must not block signup.
    try {
      const workspace = await one<{ id: string }>(
        `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
         WHERE m.user_id = $1 AND w.kind = 'personal' LIMIT 1`,
        [user.id],
      );
      const seed = welcomeSeed(body.locale ?? request.headers['accept-language'] ?? 'zh', displayName);
      if (workspace) {
        const folder = await one<{ id: string }>(
          `INSERT INTO folders (workspace_id, name) VALUES ($1, $2) RETURNING id`,
          [workspace.id, seed.folder],
        );
        for (const note of seed.notes) {
          await createNote({
            workspaceId: workspace.id,
            userId: user.id,
            title: note.title,
            contentMd: note.content,
            folderId: folder?.id ?? null,
            tagNames: note.tags,
          });
        }
      }
    } catch (error) {
      app.log.warn({ error }, 'failed to seed welcome notes');
    }

    const session = await createSession(user.id, request);
    setSessionCookie(reply, session.token);
    await audit({ actorId: user.id, action: 'auth.register', ip: clientIp(request), meta: { firstUser } });
    void sendWelcomeEmail(user.email, displayName, normalizeLocale(body.locale)).catch((error) => {
      app.log.warn({ error, userId: user.id }, 'failed to send welcome email');
    });
    const workspaces = await workspacesFor(user.id);
    return reply.send({
      ...authPayload(user, workspaces),
      recoveryKey,
      firstUser,
      requiresRecoveryKeyConfirmation: true,
    });
  });

  app.post('/api/auth/login', {
    config: { rateLimit: { max: 12, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const ip = clientIp(request);
    const user = await one<DbUser>('SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [body.email]);
    const passwordOk = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);

    await query('INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, $3)', [
      body.email,
      ip,
      Boolean(user && passwordOk),
    ]).catch(() => {});

    if (!user || !passwordOk) {
      if (user) {
        // Atomic increment: concurrent failed attempts must not undercount and
        // bypass the 10-attempt lockout.
        await one(
          `UPDATE users
           SET failed_logins = failed_logins + 1,
               locked_until = CASE WHEN failed_logins + 1 >= 10 THEN now() + interval '15 minutes' ELSE locked_until END
           WHERE id = $1 RETURNING id`,
          [user.id],
        );
      }
      throw errors.unauthorized('邮箱或密码不正确');
    }

    if (user.locked_until && user.locked_until > new Date()) {
      throw errors.tooMany('登录尝试过多，请稍后再试');
    }

    if (user.totp_enabled) {
      const challengeToken = signToken({ typ: '2fa', uid: user.id }, 300);
      await audit({ actorId: user.id, action: 'auth.login.password', ip, meta: { stage: '2fa_required' } });
      return reply.send({ twoFactorRequired: true, challengeToken });
    }

    const previous = await one<{ ip: string | null }>(
      'SELECT ip FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [user.id],
    );
    await one('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1 RETURNING id', [user.id]);
    const session = await createSession(user.id, request);
    setSessionCookie(reply, session.token);
    if (previous?.ip && previous.ip !== ip) {
      await notify({
        userId: user.id,
        type: 'security',
        title: '新的登录设备',
        titleEn: 'New sign-in device',
        body: `检测到来自 ${ip || '未知地址'} 的登录。如不是你本人，请立即在设置中退出该设备并修改密码。`,
        bodyEn: `A sign-in from ${ip || 'an unknown location'} was detected. If this was not you, revoke the device in Settings and change your password immediately.`,
        link: '/settings/security',
      });
    }
    await audit({ actorId: user.id, action: 'auth.login', ip });
    const fresh = await one<DbUser>('SELECT * FROM users WHERE id = $1', [user.id]);
    return reply.send(authPayload(fresh!, await workspacesFor(user.id)));
  });

  app.post('/api/auth/login/2fa', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = parse(z.object({ challengeToken: z.string().min(1), code: z.string().min(6).max(12) }), request.body);
    const challenge = verifyToken<{ uid: string }>(body.challengeToken);
    if (!challenge || challenge.typ !== '2fa') throw errors.unauthorized('验证已过期，请重新登录');
    const user = await one<DbUser>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [challenge.uid]);
    if (!user || !user.totp_enabled || !user.totp_secret_enc) throw errors.unauthorized();
    const secret = decryptString(user.totp_secret_enc, `totp:${user.id}`);
    let valid = false;
    let usedBackup = false;
    if (/^\d{6}$/.test(body.code.replace(/\s/g, ''))) {
      const result = verifyTotp(secret, body.code);
      if (result.valid && result.step !== null) valid = await consumeTotpStep(user.id, result.step);
    } else {
      const normalized = body.code.replace(/[^0-9]/g, '');
      valid = await consumeBackupCode(user.id, normalized);
      usedBackup = valid;
    }
    if (!valid) throw errors.unauthorized('验证码不正确或已使用');
    await one('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1 RETURNING id', [user.id]);
    const session = await createSession(user.id, request);
    setSessionCookie(reply, session.token);
    await audit({
      actorId: user.id,
      action: 'auth.login.2fa',
      ip: clientIp(request),
      meta: { backupCode: usedBackup },
    });
    const fresh = await one<DbUser>('SELECT * FROM users WHERE id = $1', [user.id]);
    return reply.send(authPayload(fresh!, await workspacesFor(user.id)));
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const auth = request.auth;
    if (auth?.session) await revokeSession(auth.session.id, auth.user.id);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (request) => {
    const auth = requireAuth(request);
    return authPayload(auth.user, await workspacesFor(auth.user.id));
  });

  app.patch('/api/me', async (request) => {
    const auth = requireAuth(request);
    const body = parse(z.object({ displayName: z.string().trim().min(1).max(60) }), request.body);
    const row = await one<DbUser>('UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1 RETURNING *', [
      auth.user.id,
      body.displayName,
    ]);
    await audit({ actorId: auth.user.id, action: 'account.profile.update', ip: clientIp(request) });
    return { user: publicUser(row!) };
  });

  app.patch('/api/me/email', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request) => {
    const auth = requireAuth(request);
    const body = parse(
      z.object({
        email: emailSchema,
        emailCode: z.string().trim().regex(/^\d{6}$/, '请输入 6 位邮箱验证码'),
        password: z.string().min(1).max(200),
      }),
      request.body,
    );
    if (!(await verifyPassword(body.password, auth.user.password_hash))) {
      throw errors.badRequest('密码不正确');
    }
    if (body.email.toLowerCase() === auth.user.email.toLowerCase()) {
      throw errors.badRequest('新邮箱与当前邮箱相同');
    }
    const existing = await one<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
      [body.email],
    );
    if (existing) throw errors.conflict('这个邮箱已注册');
    if (!(await consumeEmailCode(body.email, 'change_email', body.emailCode))) {
      throw errors.badRequest('验证码不正确或已过期');
    }
    const oldEmail = auth.user.email;
    let row: DbUser | null;
    try {
      row = await one<DbUser>(
        'UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1 RETURNING *',
        [auth.user.id, body.email],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw errors.conflict('这个邮箱已注册');
      throw error;
    }
    await revokeAllSessions(auth.user.id, auth.session?.id);
    await audit({
      actorId: auth.user.id,
      action: 'account.email.update',
      targetType: 'email',
      targetId: body.email,
      ip: clientIp(request),
    });
    void sendEmailChangedEmail(oldEmail, body.email, normalizeLocale(request.headers['accept-language'])).catch((error) => {
      app.log.warn({ error, userId: auth.user.id }, 'failed to send email change notice');
    });
    return { user: publicUser(row!) };
  });

  app.patch('/api/me/prefs', async (request) => {
    const auth = requireAuth(request);
    const body = parse(z.record(z.string(), z.unknown()), request.body);
    const allowed = ['theme', 'locale', 'editorFont', 'editorWidth', 'spellcheck', 'defaultFolderId', 'defaultNoteFormat', 'reduceMotion', 'autoUpdateLinks'];
    const merged = { ...(auth.user.prefs ?? {}) };
    for (const [key, value] of Object.entries(body)) {
      if (allowed.includes(key)) merged[key] = value;
    }
    const row = await one<DbUser>('UPDATE users SET prefs = $2, updated_at = now() WHERE id = $1 RETURNING *', [
      auth.user.id,
      JSON.stringify(merged),
    ]);
    return { user: publicUser(row!) };
  });

  app.get('/api/auth/sessions', async (request) => {
    const auth = requireAuth(request);
    return { sessions: await listSessions(auth.user.id, auth.session?.id) };
  });

  app.delete('/api/auth/sessions/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const revoked = await revokeSession(id, auth.user.id);
    if (!revoked) throw errors.notFound('会话不存在');
    await audit({ actorId: auth.user.id, action: 'auth.session.revoke', targetType: 'session', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-others', async (request) => {
    const auth = requireAuth(request);
    await revokeAllSessions(auth.user.id, auth.session?.id);
    await audit({ actorId: auth.user.id, action: 'auth.session.revoke_others', ip: clientIp(request) });
    return { ok: true };
  });

  app.post('/api/auth/password', async (request, reply) => {
    const auth = requireAuth(request);
    const body = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
      request.body,
    );
    const ok = await verifyPassword(body.currentPassword, auth.user.password_hash);
    if (!ok) throw errors.badRequest('当前密码不正确');
    const issues = passwordIssues(body.newPassword, auth.user.email);
    if (issues.length) throw errors.badRequest(issues[0]);
    const hash = await hashPassword(body.newPassword);
    await one('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING id', [auth.user.id, hash]);
    await revokeAllSessions(auth.user.id, auth.session?.id);
    await audit({ actorId: auth.user.id, action: 'auth.password.change', ip: clientIp(request) });
    return reply.send({ ok: true });
  });

  app.post('/api/auth/recover', {
    config: { rateLimit: { max: 8, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = parse(
      z.object({
        email: emailSchema,
        recoveryKey: z.string().min(10).optional(),
        emailCode: z.string().trim().min(6).max(12).optional(),
        newPassword: passwordSchema,
        locale: z.string().max(20).optional(),
      }),
      request.body,
    );
    if (!body.recoveryKey && !body.emailCode) throw errors.badRequest('未知的恢复方式');
    const user = await one<DbUser>('SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [body.email]);
    let allowed = false;
    if (body.emailCode) {
      allowed = await consumeEmailCode(body.email, 'recover', body.emailCode);
    } else if (user?.recovery_key_hash && body.recoveryKey) {
      allowed = safeEqual(user.recovery_key_hash, hashRecoveryKey(body.recoveryKey));
    }
    if (!user || !allowed) {
      throw errors.badRequest(body.emailCode ? '验证码不正确或已过期' : '邮箱或恢复密钥不正确');
    }
    const issues = passwordIssues(body.newPassword, user.email);
    if (issues.length) throw errors.badRequest(issues[0]);
    const hash = await hashPassword(body.newPassword);
    const newRecoveryKey = generateRecoveryKey();
    await one(
      `UPDATE users SET password_hash = $2, recovery_key_hash = $3, failed_logins = 0, locked_until = NULL,
         totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, email_verified_at = now(), updated_at = now()
       WHERE id = $1 RETURNING id`,
      [user.id, hash, hashRecoveryKey(newRecoveryKey)],
    );
    await query('DELETE FROM totp_backup_codes WHERE user_id = $1', [user.id]);
    await revokeAllSessions(user.id);
    await audit({ actorId: user.id, action: 'auth.recover', ip: clientIp(request), meta: { twoFactorReset: true } });
    void sendPasswordChangedEmail(user.email, normalizeLocale(body.locale)).catch((error) => {
      app.log.warn({ error, userId: user.id }, 'failed to send password reset email');
    });
    return reply.send({ ok: true, recoveryKey: newRecoveryKey });
  });

  app.post('/api/auth/recovery-key/rotate', async (request) => {
    const auth = requireAuth(request);
    const body = parse(z.object({ password: z.string().min(1) }), request.body);
    const ok = await verifyPassword(body.password, auth.user.password_hash);
    if (!ok) throw errors.badRequest('密码不正确');
    const key = generateRecoveryKey();
    await one('UPDATE users SET recovery_key_hash = $2, updated_at = now() WHERE id = $1 RETURNING id', [
      auth.user.id,
      hashRecoveryKey(key),
    ]);
    await audit({ actorId: auth.user.id, action: 'auth.recovery_key.rotate', ip: clientIp(request) });
    return { recoveryKey: key };
  });

  app.post('/api/auth/2fa/setup', async (request) => {
    const auth = requireAuth(request);
    if (auth.user.totp_enabled) throw errors.badRequest('两步验证已开启');
    const secret = generateTotpSecret();
    await one('UPDATE users SET totp_secret_enc = $2 WHERE id = $1 RETURNING id', [
      auth.user.id,
      encryptString(secret, `totp:${auth.user.id}`),
    ]);
    const url = otpauthUrl(secret, auth.user.email);
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
    return { secret, otpauthUrl: url, qr };
  });

  app.post('/api/auth/2fa/enable', async (request) => {
    const auth = requireAuth(request);
    const body = parse(z.object({ code: z.string().min(6).max(6) }), request.body);
    const row = await one<{ totp_secret_enc: string | null; totp_enabled: boolean }>(
      'SELECT totp_secret_enc, totp_enabled FROM users WHERE id = $1',
      [auth.user.id],
    );
    if (!row?.totp_secret_enc || row.totp_enabled) throw errors.badRequest('请先开始设置两步验证');
    const secret = decryptString(row.totp_secret_enc, `totp:${auth.user.id}`);
    const result = verifyTotp(secret, body.code);
    if (!result.valid) throw errors.badRequest('验证码不正确');
    const codes = generateBackupCodes();
    await transaction(async (client) => {
      const enabled = await client.query<{ id: string }>(
        `UPDATE users SET totp_enabled = true, totp_last_step = $2, updated_at = now()
         WHERE id = $1 AND totp_enabled = false AND totp_secret_enc IS NOT NULL
         RETURNING id`,
        [auth.user.id, result.step],
      );
      if (enabled.rowCount !== 1) throw errors.badRequest('请先开始设置两步验证');
      await client.query('DELETE FROM totp_backup_codes WHERE user_id = $1', [auth.user.id]);
      for (const code of codes) {
        await client.query('INSERT INTO totp_backup_codes (user_id, code_hash) VALUES ($1, $2)', [
          auth.user.id,
          sha256(code.replace(/-/g, '')),
        ]);
      }
    });
    await audit({ actorId: auth.user.id, action: 'auth.2fa.enable', ip: clientIp(request) });
    return { backupCodes: codes };
  });

  app.post('/api/auth/2fa/disable', async (request) => {
    const auth = requireAuth(request);
    const body = parse(z.object({ password: z.string().min(1), code: z.string().min(6) }), request.body);
    if (!(await verifyPassword(body.password, auth.user.password_hash))) throw errors.badRequest('密码不正确');
    if (!auth.user.totp_secret_enc) throw errors.badRequest('两步验证未开启');
    const secret = decryptString(auth.user.totp_secret_enc, `totp:${auth.user.id}`);
    let valid = false;
    if (/^\d{6}$/.test(body.code.replace(/\s/g, ''))) {
      const result = verifyTotp(secret, body.code);
      if (result.valid && result.step !== null) valid = await consumeTotpStep(auth.user.id, result.step);
    } else {
      valid = await consumeBackupCode(auth.user.id, body.code.replace(/[^0-9]/g, ''));
    }
    if (!valid) throw errors.badRequest('验证码不正确');
    await one(
      `UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, updated_at = now() WHERE id = $1 RETURNING id`,
      [auth.user.id],
    );
    await query('DELETE FROM totp_backup_codes WHERE user_id = $1', [auth.user.id]);
    await audit({ actorId: auth.user.id, action: 'auth.2fa.disable', ip: clientIp(request) });
    return { ok: true };
  });

  app.get('/api/notifications', async (request) => {
    const auth = requireAuth(request);
    const { many } = await import('../db.js');
    const rows = await many<{
      id: string;
      type: string;
      title: string;
      body: string | null;
      link: string | null;
      read_at: Date | null;
      created_at: Date;
    }>('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [auth.user.id]);
    const unread = await one<{ count: string }>(
      'SELECT count(*)::text AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [auth.user.id],
    );
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.read_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
      })),
      unread: Number(unread?.count ?? 0),
    };
  });

  app.post('/api/notifications/:id/read', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await one('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 RETURNING id', [id, auth.user.id]);
    return { ok: true };
  });

  app.post('/api/notifications/read-all', async (request) => {
    const auth = requireAuth(request);
    await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [auth.user.id]);
    return { ok: true };
  });

  app.get('/api/tokens', async (request) => {
    const auth = requireAuth(request);
    const { many } = await import('../db.js');
    const rows = await many<{
      id: string;
      name: string;
      prefix: string;
      scopes: string[];
      last_used_at: Date | null;
      expires_at: Date | null;
      created_at: Date;
      revoked_at: Date | null;
    }>('SELECT * FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC', [auth.user.id]);
    return {
      tokens: rows.map((row) => ({
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        lastUsedAt: row.last_used_at?.toISOString() ?? null,
        expiresAt: row.expires_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString() ?? null,
      })),
    };
  });

  app.post('/api/tokens', async (request) => {
    const auth = requireAuth(request);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80),
        scopes: z.array(z.enum(['notes:read', 'notes:write'])).max(2).optional(),
      }),
      request.body,
    );
    const token = `nh_${randomToken(30)}`;
    const scopes = body.scopes?.length ? body.scopes : ['notes:read', 'notes:write'];
    const row = await one<{ id: string }>(
      `INSERT INTO api_tokens (user_id, name, token_hash, prefix, scopes) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [auth.user.id, body.name, sha256(token), token.slice(0, 11), JSON.stringify(scopes)],
    );
    await audit({ actorId: auth.user.id, action: 'api_token.create', targetType: 'api_token', targetId: row!.id, ip: clientIp(request) });
    return { token, id: row!.id, scopes };
  });

  app.delete('/api/tokens/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const row = await one('UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 RETURNING id', [id, auth.user.id]);
    if (!row) throw errors.notFound('令牌不存在');
    await audit({ actorId: auth.user.id, action: 'api_token.revoke', targetType: 'api_token', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  // Clear a stale cookie helper for clients that lost their session.
  app.get('/api/auth/session', async (request) => {
    if (!request.auth) throw errors.unauthorized();
    return { authenticated: true };
  });

  void sessionCookieName;
  void crypto;
}
