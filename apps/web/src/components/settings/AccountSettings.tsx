import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Mail, Save, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { getLocale, useT } from '../../lib/i18n';
import { formatBytes, formatFullDate } from '../../lib/utils';
import { Avatar } from '../Avatar';
import { Modal } from '../Modal';
import { toast } from '../../stores/toast';

function roleLabel(t: ReturnType<typeof useT>, role: string): string {
  if (role === 'owner') return t('所有者');
  if (role === 'admin') return t('管理员');
  if (role === 'editor') return t('编辑者');
  if (role === 'viewer') return t('查看者');
  return role;
}

export default function AccountSettings() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const workspaceId = useAppStore((state) => state.workspaceId);
  const workspace = useAuthStore((state) => state.workspaces.find((entry) => entry.id === workspaceId));
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<{ noteCount: number; memberCount: number; attachmentBytes: number } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailEditing, setEmailEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (emailCountdown <= 0) return;
    const timer = window.setInterval(() => setEmailCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [emailCountdown]);

  useEffect(() => {
    if (!workspaceId) return;
    api
      .get<{ noteCount: number; memberCount: number; attachmentBytes: number }>(`/api/workspaces/${workspaceId}/summary`)
      .then(setSummary)
      .catch(() => {});
  }, [workspaceId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await api.patch<{ user: typeof user }>('/api/me', { displayName: displayName.trim() });
      if (response.user) setUser(response.user);
      toast('success', t('已保存设置'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function sendEmailCode() {
    setEmailError(null);
    if (!newEmail.trim()) {
      setEmailError(t('请输入新邮箱'));
      return;
    }
    setSendingCode(true);
    try {
      await api.post('/api/auth/email-code', {
        email: newEmail.trim(),
        purpose: 'change_email',
        locale: getLocale(),
      });
      setCodeSent(true);
      setEmailCountdown(60);
    } catch (error) {
      setEmailError((error as Error).message);
    } finally {
      setSendingCode(false);
    }
  }

  async function saveEmail() {
    setEmailSaving(true);
    setEmailError(null);
    try {
      const response = await api.patch<{ user: typeof user }>('/api/me/email', {
        email: newEmail.trim(),
        emailCode: emailCode.trim(),
        password: emailPassword,
      });
      if (response.user) setUser(response.user);
      setEmail(response.user?.email ?? newEmail.trim());
      setEmailEditing(false);
      setNewEmail('');
      setEmailCode('');
      setEmailPassword('');
      setCodeSent(false);
      toast('success', t('邮箱已更新'));
    } catch (error) {
      setEmailError((error as Error).message);
    } finally {
      setEmailSaving(false);
    }
  }

  function cancelEmailEdit() {
    setEmailEditing(false);
    setEmailError(null);
    setNewEmail('');
    setEmailCode('');
    setEmailPassword('');
    setCodeSent(false);
  }

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      await api.delete('/api/me', { password: deletePassword, confirm: 'DELETE' });
      useAuthStore.setState({ user: null, workspaces: [], status: 'anonymous' });
      navigate('/', { replace: true });
    } catch (error) {
      setError((error as Error).message);
      setDeleting(false);
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('账户')}</h1>
      <p className="settings-subtitle">{t('管理你的身份、登录邮箱与个人空间。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('个人资料')}</span>
          <span className="settings-section-desc">{t('显示在评论、分享与团队中')}</span>
        </div>
        <div className="profile-layout">
          <Avatar name={displayName || user?.displayName || 'N'} color={user?.avatarColor} size="xl" />
          <div className="profile-fields">
            <div className="field">
              <label>{t('显示名称')}</label>
              <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} />
            </div>
            <div className="field">
              <label>{t('邮箱')}</label>
              {!emailEditing ? (
                <div className="email-edit-row">
                  <input className="input" value={email} readOnly disabled style={{ flex: 1 }} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEmailEditing(true); setNewEmail(email); }}>
                    <Mail size={13} /> {t('修改邮箱')}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <input
                    className="input"
                    type="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder={t('新邮箱地址')}
                    autoComplete="email"
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input"
                      inputMode="numeric"
                      maxLength={6}
                      value={emailCode}
                      onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={t('6 位验证码')}
                      autoComplete="one-time-code"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={sendingCode || emailCountdown > 0 || !newEmail.trim()}
                      onClick={sendEmailCode}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {sendingCode ? <span className="spinner" /> : null}
                      {emailCountdown > 0 ? t('重新发送（{n}s）', { n: emailCountdown }) : codeSent ? t('重新发送') : t('发送验证码')}
                    </button>
                  </div>
                  <input
                    className="input"
                    type="password"
                    value={emailPassword}
                    onChange={(event) => setEmailPassword(event.target.value)}
                    placeholder={t('输入当前密码以确认')}
                    autoComplete="current-password"
                  />
                  {emailError && <div className="form-error"><AlertCircle size={14} /> {emailError}</div>}
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={saveEmail}
                      disabled={emailSaving || !newEmail.trim() || emailCode.length !== 6 || !emailPassword}
                    >
                      {emailSaving ? <span className="spinner" /> : <Check size={13} />} {t('确认修改')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEmailEdit}>
                      <X size={13} /> {t('取消')}
                    </button>
                  </div>
                </div>
              )}
              <span className="field-hint">{t('邮箱用于登录、账户识别与验证码。修改邮箱需要验证新地址和当前密码。')}</span>
            </div>
            {error && <div className="form-error"><AlertCircle size={14} /> {error}</div>}
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !displayName.trim() || displayName.trim() === user?.displayName}>
                {saving ? <span className="spinner" /> : <Save size={13} />} {t('保存')}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('当前空间')}</span>
          <span className="settings-section-desc">{workspace?.kind === 'team' ? t('团队空间') : t('个人空间')}</span>
        </div>
        <div className="setting-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className="workspace-mark"
              style={{
                background: `${workspace?.color ?? '#17865b'}24`,
                borderColor: `${workspace?.color ?? '#17865b'}40`,
                color: workspace?.color ?? 'var(--blue)',
              }}
            >
              {workspace?.icon ?? '📔'}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{workspace?.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>{t('角色：{role}', { role: roleLabel(t, workspace?.role ?? 'owner') })}</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/app/settings/team')}>{t('管理')}</button>
          </div>
          {summary && (
            <div style={{ display: 'flex', gap: 26, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
              <div>
                <div style={{ fontSize: 18, fontFamily: 'var(--font-ui)', fontWeight: 500 }}>{summary.noteCount}</div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('笔记')}</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontFamily: 'var(--font-ui)', fontWeight: 500 }}>{summary.memberCount}</div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('成员')}</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontFamily: 'var(--font-ui)', fontWeight: 500 }}>{formatBytes(summary.attachmentBytes)}</div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('附件')}</div>
              </div>
            </div>
          )}
        </div>
        <div className="setting-note" style={{ marginTop: 8 }}>
          {t('账户创建于 {date}', { date: user ? formatFullDate(user.createdAt) : '' })} · {t('实例管理员')}: {user?.role === 'admin' ? t('是') : t('否')}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title" style={{ color: 'var(--red)' }}>{t('危险操作')}</span>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('注销账户')}</div>
            <div className="setting-row-desc">{t('删除你的个人空间、笔记、附件与登录会话。团队空间需要先转移所有权。')}</div>
          </div>
          <div className="setting-row-control">
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={13} /> {t('注销账户')}
            </button>
          </div>
        </div>
      </section>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('注销账户')}
        description={t('此操作不可撤销。请先导出你需要保留的数据。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleteOpen(false)}>{t('取消')}</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={deleteAccount} disabled={deleting || deleteConfirm !== 'DELETE' || !deletePassword}>
              {deleting ? <span className="spinner" /> : <Trash2 size={13} />} {t('永久注销')}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>{t('密码')}</label>
            <input className="input" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label>{t('输入 DELETE 确认')}</label>
            <input className="input mono" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" />
          </div>
          <div className="banner banner-error">
            <AlertCircle size={14} />
            <div>{t('个人空间和附件会被立即删除。备份中的副本会在保留周期结束后清除。')}</div>
          </div>
        </div>
      </Modal>
    </>
  );
}
