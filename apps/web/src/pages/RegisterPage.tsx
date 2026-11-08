import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, Copy, Download, Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { getLocale, useT } from '../lib/i18n';
import { api } from '../lib/api';
import { copyText, emailValid, passwordStrength } from '../lib/utils';
import { AuthLayout } from './AuthLayout';

export default function RegisterPage() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes('\\') ? nextParam : '/app';
  const register = useAuthStore((state) => state.register);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteMode, setInviteMode] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [firstUser, setFirstUser] = useState(false);

  useEffect(() => {
    api
      .get<{ registrationMode: 'open' | 'invite' }>('/api/public/config')
      .then((config) => setInviteMode(config.registrationMode === 'invite'))
      .catch(() => {});
  }, []);

  const strength = passwordStrength(password);
  const brand = getLocale() === 'zh-CN' ? '360笔记' : '360note';

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function sendEmailCode() {
    setError(null);
    if (!emailValid(email)) {
      setError(t('请输入有效的邮箱地址'));
      return;
    }
    setSendingCode(true);
    try {
      await api.post('/api/auth/email-code', {
        email,
        purpose: 'register',
        locale: getLocale(),
      });
      setCodeSent(true);
      setCountdown(60);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSendingCode(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!emailValid(email)) {
      setError(t('请输入有效的邮箱地址'));
      return;
    }
    if (!displayName.trim()) {
      setError(t('请输入昵称'));
      return;
    }
    if (password.length < 10) {
      setError(t('密码至少需要 10 个字符'));
      return;
    }
    if (password !== confirm) {
      setError(t('两次输入的密码不一致'));
      return;
    }
    if (!/^\d{6}$/.test(emailCode.trim())) {
      setError(t('请输入 6 位邮箱验证码'));
      return;
    }
    if (!terms) {
      setError(t('请先同意服务条款与隐私政策'));
      return;
    }
    setLoading(true);
    try {
      const response = await register({
        email,
        displayName: displayName.trim(),
        password,
        inviteCode: inviteCode.trim() || undefined,
        emailCode: emailCode.trim(),
      });
      setRecoveryKey(response.recoveryKey);
      setFirstUser(response.firstUser);
    } catch (error) {
      setError((error as Error).message);
      setLoading(false);
    }
  }

  async function copyKey() {
    if (!recoveryKey) return;
    await copyText(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function downloadKey() {
    if (!recoveryKey) return;
    const blob = new Blob(
      [
        `${brand} 恢复密钥 / Recovery key\n\n账户 / Account：${email}\n密钥 / Key：${recoveryKey}\n\n生成时间 / Generated：${new Date().toISOString()}\n\n请离线保存。此密钥只在本次显示，无法找回。\nKeep it offline. It is shown only once and cannot be recovered.\n`,
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '360note-recovery-key.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  if (recoveryKey) {
    return (
      <AuthLayout wide>
        <div className="animate-rise">
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--green-soft)',
              color: 'var(--green)',
              marginBottom: 18,
            }}
          >
            <KeyRound size={20} />
          </div>
          <h1 className="auth-heading">{t('保存你的恢复密钥')}</h1>
          <p className="auth-sub">
            {t('恢复密钥只显示这一次。忘记密码时，它是你重新进入账户的唯一方式。请保存在密码管理器或离线位置。')}
          </p>
          {firstUser && (
            <div className="banner banner-info" style={{ marginTop: 16 }}>
              <ShieldAlert size={15} />
              <div>{t('你是这个实例的第一个账户，已获得管理员权限。')}</div>
            </div>
          )}
          <div className="recovery-key-display" style={{ marginTop: 22 }}>
            {recoveryKey}
          </div>
          <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copyKey}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t('已复制') : t('复制密钥')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={downloadKey}>
              <Download size={13} />
              {t('下载文本文件')}
            </button>
          </div>
          <div className="banner banner-warning" style={{ marginTop: 18 }}>
            <ShieldAlert size={15} />
            <div>
              <strong>{t('恢复密钥无法找回。')}</strong>
              <br />
              {t('如果有人获得了它，可以重置你的密码并关闭两步验证。请像保护主密码一样保护它。')}
            </div>
          </div>
          <label className="checkbox-row" style={{ marginTop: 20 }}>
            <input type="checkbox" checked={savedKey} onChange={(event) => setSavedKey(event.target.checked)} />
            <span>{t('我已将恢复密钥保存在一个安全的地方，并理解它无法找回。')}</span>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-block auth-submit"
            style={{ marginTop: 18 }}
            disabled={!savedKey}
            onClick={() => navigate(next, { replace: true })}
          >
            {getLocale() === 'zh-CN' ? '开始使用 360笔记' : 'Start using 360note'}
            <ArrowRight size={14} />
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout wide>
      <h1 className="auth-heading">{t('创建你的空间')}</h1>
      <p className="auth-sub">{t('一个邮箱、一个密码，然后直接开始写。')}</p>
      <form className="auth-form auth-form-grid" onSubmit={onSubmit}>
        <div className="auth-form-pair">
          <div className="field">
            <label htmlFor="reg-name">{t('昵称')}</label>
            <input
              id="reg-name"
              className="input input-lg"
              placeholder={t('你希望被怎样称呼')}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="reg-email">{t('邮箱')}</label>
            <input
              id="reg-email"
              className="input input-lg"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>
        </div>
        <div className="auth-form-pair">
          <div className="field">
            <label htmlFor="reg-password">{t('密码')}</label>
            <div style={{ position: 'relative' }}>
              <input
                id="reg-password"
                className="input input-lg"
                type={showPassword ? 'text' : 'password'}
                placeholder={t('至少 10 个字符')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                minLength={10}
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => setShowPassword((value) => !value)}
                style={{ position: 'absolute', right: 7, top: 7 }}
                aria-label={showPassword ? t('隐藏密码') : t('显示密码')}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {password && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <div className="progress" style={{ flex: 1, height: 3 }}>
                  <div
                    className="progress-bar"
                    style={{
                      width: `${strength.score}%`,
                      background:
                        strength.tone === 'weak'
                          ? 'var(--red)'
                          : strength.tone === 'fair'
                            ? 'var(--amber)'
                            : strength.tone === 'good'
                              ? 'var(--blue)'
                              : 'var(--green)',
                    }}
                  />
                </div>
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                  {strength.label}
                </span>
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="reg-confirm">{t('确认密码')}</label>
            <input
              id="reg-confirm"
              className="input input-lg"
              type="password"
              placeholder={t('再次输入密码')}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
        </div>
        <div className="field auth-form-full">
          <label htmlFor="reg-code">{t('邮箱验证码')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="reg-code"
              className="input input-lg"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder={t('请输入 6 位邮箱验证码')}
              value={emailCode}
              onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
              required
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-lg"
              disabled={sendingCode || countdown > 0}
              onClick={sendEmailCode}
              style={{ whiteSpace: 'nowrap' }}
            >
              {sendingCode ? <span className="spinner" /> : null}
              {countdown > 0
                ? t('重新发送（{n}s）', { n: countdown })
                : codeSent
                  ? t('重新发送')
                  : t('获取验证码')}
            </button>
          </div>
          {codeSent && (
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
              {t('验证码已发送，请查收邮箱（也请检查垃圾邮件）。')}
            </p>
          )}
        </div>
        {inviteMode && (
          <div className="field auth-form-full">
            <label htmlFor="reg-invite">{t('邀请码')}</label>
            <input
              id="reg-invite"
              className="input input-lg"
              placeholder={t('当前实例仅接受邀请注册')}
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
            />
          </div>
        )}
        <label className="checkbox-row auth-form-full" style={{ marginTop: 2 }}>
          <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />
          <span>
            {t('我同意')} <Link to="/terms">{t('服务条款')}</Link> {t('与')}{' '}
            <Link to="/privacy">{t('隐私政策')}</Link>
            {t('，并理解 360note 只发送账户相关邮件，不发送营销邮件。')}
          </span>
        </label>
        {error && (
          <div className="form-error auth-form-full" role="alert">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block auth-submit auth-form-full" disabled={loading}>
          {loading ? <span className="spinner" /> : null}
          {loading ? t('创建中…') : t('创建账户')}
          {!loading && <ArrowRight size={14} />}
        </button>
      </form>
      <p className="auth-switch">
        {t('已经有账户？')} <Link to="/login">{t('登录')}</Link>
      </p>
      <p className="auth-legal">
        {t('注册后会生成一个恢复密钥。请提前准备一个离线保存的位置。')}
      </p>
    </AuthLayout>
  );
}
