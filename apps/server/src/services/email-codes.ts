import { one, query, transaction } from '../db.js';
import { randomDigits, safeEqual, sha256 } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { mailEnabled, sendVerificationCode, type MailLocale } from '../lib/mailer.js';

export type EmailCodePurpose = 'register' | 'recover' | 'change_email';

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 6;
const MAX_ATTEMPTS = 5;

function codeHash(email: string, purpose: EmailCodePurpose, code: string): string {
  return sha256(`${purpose}:${email.trim().toLowerCase()}:${code}`);
}

export async function issueEmailCode(options: {
  email: string;
  purpose: EmailCodePurpose;
  locale: MailLocale;
  ip?: string;
}): Promise<{ expiresIn: number; resendAfter: number }> {
  const { email, purpose, locale, ip = '' } = options;
  if (!mailEnabled()) throw errors.internal('邮件服务尚未配置，暂时无法发送验证码');

  // Serialize issue attempts per address and purpose. Without this lock two
  // concurrent clicks can both pass the cooldown and send duplicate mail.
  const issued = await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `email-code:${purpose}:${email.trim().toLowerCase()}`,
    ]);
    const latest = await client.query<{ created_at: Date }>(
      `SELECT created_at FROM email_codes
       WHERE lower(email) = lower($1) AND purpose = $2
       ORDER BY created_at DESC LIMIT 1`,
      [email, purpose],
    );
    if (latest.rows[0] && Date.now() - latest.rows[0].created_at.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
      throw errors.tooMany('验证码发送过于频繁，请稍后再试');
    }

    const recent = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM email_codes
       WHERE lower(email) = lower($1) AND purpose = $2 AND created_at > now() - interval '1 hour'`,
      [email, purpose],
    );
    if (Number(recent.rows[0]?.count ?? 0) >= MAX_SENDS_PER_HOUR) {
      throw errors.tooMany('验证码发送次数过多，请稍后再试');
    }

    const code = randomDigits(6);
    const row = await client.query<{ id: string }>(
      `INSERT INTO email_codes (email, purpose, code_hash, ip, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '${CODE_TTL_MINUTES} minutes')
       RETURNING id`,
      [email, purpose, codeHash(email, purpose, code), ip],
    );
    return { id: row.rows[0].id, code };
  });

  try {
    await sendVerificationCode({
      to: email,
      code: issued.code,
      purpose,
      locale,
      expiresMinutes: CODE_TTL_MINUTES,
    });
  } catch (error) {
    await query('DELETE FROM email_codes WHERE id = $1', [issued.id]).catch(() => {});
    throw error;
  }

  await query(`DELETE FROM email_codes WHERE created_at < now() - interval '24 hours'`).catch(() => {});
  return { expiresIn: CODE_TTL_MINUTES * 60, resendAfter: RESEND_COOLDOWN_SECONDS };
}

export async function consumeEmailCode(
  email: string,
  purpose: EmailCodePurpose,
  code: string,
): Promise<boolean> {
  const row = await one<{ id: string; code_hash: string; attempts: number; expires_at: Date }>(
    `SELECT id, code_hash, attempts, expires_at FROM email_codes
     WHERE lower(email) = lower($1) AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );
  if (!row) return false;
  if (row.expires_at.getTime() <= Date.now() || row.attempts >= MAX_ATTEMPTS) return false;

  const expected = row.code_hash;
  const actual = codeHash(email, purpose, code.replace(/\s/g, ''));
  if (safeEqual(expected, actual)) {
    // Atomic consume: two concurrent recovery/registration requests must not
    // both succeed with the same code.
    const consumed = await one<{ id: string }>(
      'UPDATE email_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id',
      [row.id],
    );
    return Boolean(consumed);
  }
  await query('UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1 AND consumed_at IS NULL', [row.id]);
  return false;
}
