import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, LockKeyhole, ShieldAlert, UserLock } from 'lucide-react';
import type { Workspace } from '@360note/shared';
import { useT } from '../lib/i18n';
import { useVaultStore } from '../stores/vault';
import { copyText } from '../lib/utils';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { Modal } from './Modal';

export function VaultLockScreen({
  workspace,
  onUnlocked,
  onSwitch,
}: {
  workspace: Workspace;
  onUnlocked: () => void;
  onSwitch: () => void;
}) {
  const t = useT();
  const unlock = useVaultStore((state) => state.unlock);
  const recover = useVaultStore((state) => state.recover);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [issuedRecovery, setIssuedRecovery] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [mode, issuedRecovery]);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(workspace.id, password);
      setPassword('');
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRecovery(event: FormEvent) {
    event.preventDefault();
    if (!recoveryKey.trim()) return;
    if (newPassword.length < 10) {
      setError(t('新空间密码至少需要 10 个字符'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('两次输入的密码不一致'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextRecovery = await recover(workspace.id, recoveryKey.trim(), newPassword);
      setIssuedRecovery(nextRecovery);
      setRecoveryKey('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSpace() {
    if (deleteName.trim() !== workspace.name.trim()) return;
    setDeleting(true);
    try {
      await api.delete(`/api/workspaces/${workspace.id}`);
      await useAuthStore.getState().refresh();
      setDeleteOpen(false);
      onSwitch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="vault-lock-screen">
      <div className="vault-lock-card">
        <div className="vault-lock-mark" aria-hidden="true">
          <UserLock size={30} />
        </div>
        <div className="vault-lock-kicker">{t('加密空间')}</div>
        <h1 className="vault-lock-title">{workspace.name}</h1>

        {issuedRecovery ? (
          <>
            <p className="vault-lock-text">
              {t('空间已恢复。请立即保存新的恢复密钥；离开此页面后将无法再次查看。')}
            </p>
            <div className="vault-recovery-key">
              <code>{issuedRecovery}</code>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => {
                  void copyText(issuedRecovery);
                  setCopied(true);
                }}
                aria-label={t('复制恢复密钥')}
                title={t('复制恢复密钥')}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <button type="button" className="btn btn-primary vault-lock-submit" onClick={onUnlocked}>
              {t('我已保存，进入空间')}
            </button>
          </>
        ) : mode === 'password' ? (
          <>
            <p className="vault-lock-text">
              {t('这是加密空间。需要空间密码才能解密内容；账号密码无法代替。')}
            </p>
            <form onSubmit={(event) => void submitPassword(event)}>
              <div className="field">
                <label htmlFor="vault-password">{t('空间密码')}</label>
                <input
                  id="vault-password"
                  ref={inputRef}
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder={t('输入空间密码')}
                />
              </div>
              {error && <div className="form-error" role="alert">{error}</div>}
              <button type="submit" className="btn btn-primary vault-lock-submit" disabled={busy || !password}>
                {busy ? <span className="spinner" /> : <LockKeyhole size={15} />} {t('解锁空间')}
              </button>
            </form>
            <button type="button" className="vault-lock-link" onClick={() => { setMode('recovery'); setError(null); }}>
              <KeyRound size={14} /> {t('使用恢复密钥')}
            </button>
          </>
        ) : (
          <>
            <p className="vault-lock-text">
              {t('输入创建空间时保存的恢复密钥，并设置一个新的空间密码。恢复后旧密码和旧恢复密钥都会失效。')}
            </p>
            <form onSubmit={(event) => void submitRecovery(event)}>
              <div className="field">
                <label htmlFor="vault-recovery-key">{t('恢复密钥')}</label>
                <input
                  id="vault-recovery-key"
                  ref={inputRef}
                  className="input mono"
                  value={recoveryKey}
                  onChange={(event) => setRecoveryKey(event.target.value)}
                  autoComplete="off"
                  placeholder="nhv1-…"
                />
              </div>
              <div className="field">
                <label htmlFor="vault-new-password">{t('新的空间密码')}</label>
                <input
                  id="vault-new-password"
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="field">
                <label htmlFor="vault-confirm-password">{t('确认新密码')}</label>
                <input
                  id="vault-confirm-password"
                  className="input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {error && <div className="form-error" role="alert">{error}</div>}
              <button type="submit" className="btn btn-primary vault-lock-submit" disabled={busy || !recoveryKey.trim()}>
                {busy ? <span className="spinner" /> : <KeyRound size={15} />} {t('恢复并解锁')}
              </button>
            </form>
            <button type="button" className="vault-lock-link" onClick={() => { setMode('password'); setError(null); }}>
              <ArrowLeft size={14} /> {t('返回密码解锁')}
            </button>
          </>
        )}

        <div className="vault-lock-warning">
          <ShieldAlert size={14} />
          <span>{t('15 分钟无操作会自动锁定。空间密码和恢复密钥无法由 360note 找回；两者都丢失时内容无法恢复。')}</span>
        </div>
        <button type="button" className="vault-lock-switch" onClick={onSwitch}>
          <ArrowLeft size={14} /> {t('切换到其他空间')}
        </button>
        <button type="button" className="vault-lock-danger" onClick={() => { setDeleteName(''); setDeleteOpen(true); }}>
          {t('忘记密码和恢复密钥？删除此空间')}
        </button>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('删除加密空间？')}
        description={t('这会永久删除空间内的笔记、版本和附件。没有密码或恢复密钥时，内容无法恢复。')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleteOpen(false)}>{t('取消')}</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void deleteSpace()} disabled={deleting || deleteName.trim() !== workspace.name.trim()}>
              {deleting ? <span className="spinner" /> : null} {t('永久删除')}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="vault-delete-confirm">{t('输入空间名称“{name}”确认', { name: workspace.name })}</label>
          <input id="vault-delete-confirm" className="input" value={deleteName} onChange={(event) => setDeleteName(event.target.value)} autoComplete="off" />
        </div>
      </Modal>
    </div>
  );
}
