import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: process.env.NOTE360_ENV_FILE || path.join(repoRoot, '.env') });

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function requiredInProduction(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? '';
}

let appVersion = '0.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version?: string };
  appVersion = pkg.version ?? appVersion;
} catch {
  // Version is only informational; a missing package.json must not block startup.
}

const dataDir = process.env.NOTE360_DATA_DIR || path.join(repoRoot, 'storage');
export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  publicOrigin: (process.env.PUBLIC_ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://360note:360note@127.0.0.1:5432/360note',
  sessionSecret: requiredInProduction('SESSION_SECRET') || 'dev-session-secret-change-me-please',
  masterKeyB64: requiredInProduction('NOTE360_MASTER_KEY') || '',
  dataDir,
  webDist: process.env.WEB_DIST || path.join(repoRoot, 'apps/web/dist'),
  registrationMode: (process.env.REGISTRATION_MODE || 'open') as 'open' | 'invite',
  inviteCode: process.env.REGISTRATION_INVITE_CODE || '',
  // Optional: pin first-user administrator bootstrap to a known address.
  bootstrapAdminEmail: (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase() || null,
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  trustProxy: (() => {
    const value = (process.env.TRUST_PROXY || '').trim();
    if (value === 'false' || value === '0') return false;
    if (!value || value === 'true' || value === '1') return '127.0.0.1';
    return value;
  })(),
  ai: {
    enabled: bool(process.env.AI_ENABLED, false),
    baseUrl: process.env.AI_BASE_URL || '',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || '',
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 465),
    secure: bool(process.env.SMTP_SECURE, Number(process.env.SMTP_PORT || 465) === 465),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
    fromName: process.env.MAIL_FROM_NAME || '360note',
  },
  ocrEnabled: bool(process.env.OCR_ENABLED, false),
  backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30),
  version: appVersion,
};

export const paths = {
  root: repoRoot,
  attachments: path.join(dataDir, 'attachments'),
  backups: path.join(dataDir, 'backups'),
  imports: path.join(dataDir, 'imports'),
  temp: path.join(dataDir, 'tmp'),
};

export function ensureDataDirs(): void {
  for (const dir of Object.values(paths)) {
    if (dir === repoRoot) continue;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
