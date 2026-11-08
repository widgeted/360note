import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  KeyRound,
  MonitorSmartphone,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import type { SessionInfo, User } from '@360note/shared';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { copyText, formatFullDate, formatRelativeShort } from '../../lib/utils';
import { Modal } from '../Modal';
import { toast } from '../../stores/toast';

export default function SecuritySettings() {
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string; otpauthUrl: string } | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    try {
      const response = await api.get<{ sessions: SessionInfo[] }>('/api/auth/sessions');
      setSessions(response.sessions);
    } catch {
      /* ignore */
    }
  }

  async function openSetup() {
    setSetupOpen(true);
    setSetup(null);
    setSetupCode('');
    setBackupCodes(null);
    try {
      const response = await api.post<{ secret: string; qr: string; otpauthUrl: string }>('/api/auth/2fa/setup');
      setSetup(response);
    } catch (error) {
      toast('error', t('无法开始设置'), (error as Error).message);
      setSetupOpen(false);
    }
  }

  async function enableTwoFactor() {
    setSetupBusy(true);
    try {
      const response = await api.post<{ backupCodes: string[] }>('/api/auth/2fa/enable', { code: setupCode });
      setBackupCodes(response.backupCodes);
      if (user) setUser({ ...user, totpEnabled: true });
      toast('success', t('两步验证已开启'));
    } catch (error) {
      toast('error', t('验证码不正确'), (error as Error).message);
    } finally {
      setSetupBusy(false);
    }
  }

  async function disableTwoFactor() {
    setSetupBusy(true);
    try {
      await api.post('/api/auth/2fa/disable', { password: disablePassword, code: disableCode });
      if (user) setUser({ ...user, totpEnabled: false });
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      toast('success', t('两步验证已关闭'));
    } catch (error) {
      toast('error', t('关闭失败'), (error as Error).message);
    } finally {
      setSetupBusy(false);
    }
  }

  async function revokeSession(id: string) {
    try {
      await api.delete(`/api/auth/sessions/${id}`);
      setSessions((current) => current.filter((session) => session.id !== id));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function revokeOthers() {
    try {
      await api.post('/api/auth/sessions/revoke-others');
      setSessions((current) => current.filter((session) => session.current));
      toast('success', t('其他设备已退出'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordForm.next !== passwordForm.confirm) {
      toast('error', t('两次输入的密码不一致'));
      return;
    }
    setPasswordBusy(true);
    try {
      await api.post('/api/auth/password', {
        currentPassword: passwordForm.current,
        newPassword: passwordForm.next,
      });
      setPasswordForm({ current: '', next: '', confirm: '' });
      await loadSessions();
      toast('success', t('密码已修改，其他设备已退出。'));
    } catch (error) {
      toast('error', t('修改密码失败'), (error as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  }

  async function rotateRecovery() {
    setRecoveryBusy(true);
    try {
      const response = await api.post<{ recoveryKey: string }>('/api/auth/recovery-key/rotate', { password: recoveryPassword });
      setNewRecoveryKey(response.recoveryKey);
      setRecoveryPassword('');
      toast('success', t('恢复密钥已更新。'));
    } catch (error) {
      toast('error', t('更新失败'), (error as Error).message);
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function copy(value: string, id: string) {
    await copyText(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <>
      <h1 className="settings-title">{t('安全')}</h1>
      <p className="settings-subtitle">{t('安全操作集中在这里：两步验证、登录设备、密码与恢复密钥。它们都很重要，但不需要每天看到。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('登录保护')}</span>
          <span className="settings-section-desc">{user?.totpEnabled ? t('两步验证已开启') : t('仅密码登录')}</span>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {user?.totpEnabled ? <ShieldCheck size={14} style={{ color: 'var(--green)' }} /> : <ShieldOff size={14} style={{ color: 'var(--text-tertiary)' }} />}
              {t('两步验证（2FA）')}
              {user?.totpEnabled && <span className="badge badge-green">{t('开启')}</span>}
            </div>
            <div className="setting-row-desc">{t('使用身份验证器应用生成 6 位验证码。开启后，登录需要密码与验证码两项。')}</div>
          </div>
          <div className="setting-row-control">
            {user?.totpEnabled ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDisableOpen(true)}>{t('关闭两步验证')}</button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={openSetup}><ShieldCheck size={13} /> {t('开启两步验证')}</button>
            )}
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('登录通知')}</div>
            <div className="setting-row-desc">{t('检测到新的登录设备或 IP 时，会在应用内提醒；必要时也会发送账户安全邮件。')}</div>
          </div>
          <div className="setting-row-control"><span className="badge badge-green"><Check size={9} /> {t('已启用')}</span></div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('恢复密钥')}</div>
            <div className="setting-row-desc">{t('忘记密码时，用恢复密钥重新进入账户。重置会同时关闭两步验证。')}</div>
          </div>
          <div className="setting-row-control">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setRecoveryOpen(true); setNewRecoveryKey(null); }}>
              <KeyRound size={13} /> {t('更新恢复密钥')}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('登录设备')}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={revokeOthers}>{t('退出其他设备')}</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {sessions.length === 0 && <div className="context-empty">{t('暂无登录设备')}</div>}
          {sessions.map((session) => (
            <div key={session.id} className="setting-card" style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: 12 }}>
              <span style={{ color: 'var(--text-tertiary)', marginTop: 1 }}>
                <MonitorSmartphone size={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 560, color: 'var(--text)' }}>{describeAgent(session.userAgent)}</span>
                  {session.current && <span className="badge badge-blue">{t('当前设备')}</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 3 }}>
                  {session.ip || t('未知地址')} · {t('最后活动')} {formatRelativeShort(session.lastSeenAt)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {t('登录于 {date}', { date: formatFullDate(session.createdAt) })}
                </div>
              </div>
              {!session.current && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void revokeSession(session.id)}>
                  <LogOut size={12} /> {t('退出')}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('修改密码')}</span>
        </div>
        <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
          <div className="field">
            <label>{t('当前密码')}</label>
            <input className="input" type="password" value={passwordForm.current} onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })} autoComplete="current-password" required />
          </div>
          <div className="field">
            <label>{t('新密码')}</label>
            <input className="input" type="password" value={passwordForm.next} onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })} autoComplete="new-password" minLength={10} required />
            <span className="field-hint">{t('至少 10 个字符。修改后其他登录设备会退出。')}</span>
          </div>
          <div className="field">
            <label>{t('确认新密码')}</label>
            <input className="input" type="password" value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} autoComplete="new-password" required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={passwordBusy || !passwordForm.current || !passwordForm.next}>
            {passwordBusy ? <span className="spinner" /> : <LockKeyhole size={13} />} {t('修改密码')}
          </button>
        </form>
      </section>

      <div className="banner banner-info">
        <ShieldCheck size={15} />
        <div>{t('密码使用 scrypt 加盐派生；会话 Cookie 仅以 HttpOnly 形式保存。恢复密钥只保存哈希，服务器无法显示它。')}</div>
      </div>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('端到端加密')}</span>
          <span className="settings-section-desc">{t('尚未启用')}</span>
        </div>
        <div className="banner banner-warning">
          <LockKeyhole size={15} />
          <div>
            <strong>{t('本版本不提供 E2EE。')}</strong>{' '}
            {t('服务器在技术上可以读取笔记正文，用于全文搜索、分享渲染与备份。附件已使用 AES-256-GCM 加密存储，但这不等同于端到端加密。')}
            <br />
            {t('如果未来开放 E2EE，会明确说明它会使服务端搜索、AI 摘要、公开分享与密码找回失效，并提供恢复密钥与应急流程。')}
          </div>
        </div>
      </section>

      <Modal
        open={setupOpen}
        onClose={() => { setSetupOpen(false); setSetupCode(''); setBackupCodes(null); }}
        title={backupCodes ? t('保存备用码') : t('开启两步验证')}
        description={backupCodes ? t('每个备用码只能使用一次。请离线保存。') : t('使用身份验证器应用扫描二维码，然后输入 6 位验证码。')}
        size="sm"
        footer={
          backupCodes ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setSetupOpen(false); setBackupCodes(null); }}>{t('完成')}</button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSetupOpen(false)}>{t('取消')}</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={enableTwoFactor} disabled={setupBusy || setupCode.length !== 6}>
                {setupBusy ? <span className="spinner" /> : <Check size={13} />} {t('验证并开启')}
              </button>
            </>
          )
        }
      >
        {backupCodes ? (
          <div>
            <div className="backup-codes">
              {backupCodes.map((code) => <span className="backup-code" key={code}>{code}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(backupCodes.join('\n'), 'backup')}>
                {copied === 'backup' ? <Check size={13} /> : <Copy size={13} />} {t('复制备用码')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const blob = new Blob([`360note 两步验证备用码\n\n${backupCodes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = '360note-backup-codes.txt';
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 2000);
                }}
              >
                <Download size={13} /> {t('下载')}
              </button>
            </div>
          </div>
        ) : setup ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: 12, background: '#fff', borderRadius: 9, border: '1px solid var(--line)' }}>
              <img src={setup.qr} alt="2FA QR" width={210} height={210} />
            </div>
            <div className="field">
              <label>{t('无法扫描？手动输入密钥')}</label>
              <div className="share-link-box"><input readOnly value={setup.secret} onFocus={(event) => event.target.select()} /><button type="button" className="icon-btn icon-btn-sm" onClick={() => void copy(setup.secret, 'secret')}>{copied === 'secret' ? <Check size={13} /> : <Copy size={13} />}</button></div>
            </div>
            <div className="field">
              <label>{t('验证码')}</label>
              <input className="totp-code-input" value={setupCode} onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" autoFocus />
            </div>
          </div>
        ) : (
          <div className="loading-row"><span className="spinner" /> {t('正在生成二维码…')}</div>
        )}
      </Modal>

      <Modal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title={t('关闭两步验证')}
        description={t('关闭后登录只需要密码。建议只在确定安全的情况下操作。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDisableOpen(false)}>{t('取消')}</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={disableTwoFactor} disabled={setupBusy || !disablePassword || disableCode.length < 6}>{t('关闭')}</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field"><label>{t('密码')}</label><input className="input" type="password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} autoComplete="current-password" /></div>
          <div className="field"><label>{t('验证码或备用码')}</label><input className="input mono" value={disableCode} onChange={(event) => setDisableCode(event.target.value)} placeholder="000000" /></div>
        </div>
      </Modal>

      <Modal
        open={recoveryOpen}
        onClose={() => { setRecoveryOpen(false); setNewRecoveryKey(null); }}
        title={t('更新恢复密钥')}
        description={t('输入密码后生成新的恢复密钥。旧密钥会立即作废。')}
        size="sm"
        footer={
          newRecoveryKey ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setRecoveryOpen(false); setNewRecoveryKey(null); }}>{t('完成')}</button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRecoveryOpen(false)}>{t('取消')}</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={rotateRecovery} disabled={recoveryBusy || !recoveryPassword}>{t('生成新密钥')}</button>
            </>
          )
        }
      >
        {newRecoveryKey ? (
          <div>
            <div className="recovery-key-display">{newRecoveryKey}</div>
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => void copy(newRecoveryKey, 'new-recovery')}>
              {copied === 'new-recovery' ? <Check size={13} /> : <Copy size={13} />} {t('复制密钥')}
            </button>
            <div className="banner banner-warning" style={{ marginTop: 12 }}><KeyRound size={14} /><div>{t('旧恢复密钥已失效。请立即保存新密钥。')}</div></div>
          </div>
        ) : (
          <div className="field"><label>{t('当前密码')}</label><input className="input" type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} autoComplete="current-password" autoFocus /></div>
        )}
      </Modal>
    </>
  );
}

function describeAgent(agent: string): string {
  const browser = /Edg\//i.test(agent)
    ? 'Edge'
    : /Chrome\//i.test(agent)
      ? 'Chrome'
      : /Safari\//i.test(agent) && !/Chrome/i.test(agent)
        ? 'Safari'
        : /Firefox\//i.test(agent)
          ? 'Firefox'
          : '浏览器';
  const os = /iPhone|iPad/i.test(agent)
    ? 'iOS'
    : /Android/i.test(agent)
      ? 'Android'
      : /Mac OS X/i.test(agent)
        ? 'macOS'
        : /Windows/i.test(agent)
          ? 'Windows'
          : /Linux/i.test(agent)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}
