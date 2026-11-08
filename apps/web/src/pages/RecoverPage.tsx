import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Copy, KeyRound, Mail } from 'lucide-react';
import { api } from '../lib/api';
import { getLocale, useT } from '../lib/i18n';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { copyText } from '../lib/utils';
import { AuthLayout } from './AuthLayout';

export default function RecoverPage() {
  const t = useT();
  useDocumentTitle(t('恢复账户'));
  const navigate = useNavigate();
  const [mode, setMode] = useState<'email' | 'key'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function sendCode() {
    setError(null);
    if (!email.trim()) {
      setError(t('请输入邮箱'));
      return;
    }
    setSendingCode(true);
    try {
      await api.post('/api/auth/email-code', {
        email,
        purpose: 'recover',
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
    if (password !== confirm) {
      setError(t('两次输入的密码不一致'));
      return;
    }
    if (mode === 'email' && !/^\d{6}$/.test(code.trim())) {
      setError(t('请输入 6 位邮箱验证码'));
      return;
    }
    setLoading(true);
    try {
      const response = await api.post<{ recoveryKey: string }>('/api/auth/recover', {
        email,
        ...(mode === 'email' ? { emailCode: code.trim() } : { recoveryKey: key }),
        newPassword: password,
        locale: getLocale(),
      });
      setNewKey(response.recoveryKey);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (newKey) {
    return (
      <AuthLayout>
        <h1 className="auth-heading">{t('账户已恢复')}</h1>
        <p className="auth-sub">
          {t('密码已重置，所有旧会话与两步验证已失效。下面是新的恢复密钥，请重新保存。')}
        </p>
        <div className="recovery-key-display" style={{ marginTop: 22 }}>{newKey}</div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 10 }}
          onClick={async () => {
            await copyText(newKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('已复制') : t('复制密钥')}
        </button>
        <div className="banner banner-warning" style={{ marginTop: 18 }}>
          <KeyRound size={15} />
          <div>{t('旧恢复密钥已作废。两步验证需要重新开启。')}</div>
        </div>
        <button type="button" className="btn btn-primary btn-block auth-submit" style={{ marginTop: 20 }} onClick={() => navigate('/login')}>
          {t('使用新密码登录')} <ArrowRight size={14} />
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/login')} style={{ marginLeft: -10, marginBottom: 18 }}>
        <ArrowLeft size={13} /> {t('返回登录')}
      </button>
      <h1 className="auth-heading">{t('恢复账户')}</h1>
      <p className="auth-sub">
        {mode === 'email'
          ? t('输入注册邮箱，我们会发送一个 6 位验证码。验证通过后即可设置新密码。')
          : t('使用注册时保存的恢复密钥重设密码。为安全起见，两步验证和所有登录设备也会被重置。')}
      </p>
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="recover-email">{t('邮箱')}</label>
          <input id="recover-email" className="input input-lg" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus autoComplete="email" />
        </div>
        {mode === 'email' ? (
          <div className="field">
            <label htmlFor="recover-code">{t('邮箱验证码')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="recover-code"
                className="input input-lg"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('6 位验证码')}
                autoComplete="one-time-code"
                required
                style={{ flex: 1 }}
              />
              <button type="button" className="btn btn-secondary btn-lg" disabled={sendingCode || countdown > 0} onClick={sendCode} style={{ whiteSpace: 'nowrap' }}>
                {sendingCode ? <span className="spinner" /> : null}
                {countdown > 0 ? t('重新发送（{n}s）', { n: countdown }) : codeSent ? t('重新发送') : t('发送验证码')}
              </button>
            </div>
            {codeSent && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
                {t('如果该邮箱已注册，验证码会在一分钟内送达。请同时检查垃圾邮件。')}
              </p>
            )}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="recover-key">{t('恢复密钥')}</label>
            <input id="recover-key" className="input input-lg mono" value={key} onChange={(event) => setKey(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required autoComplete="off" />
          </div>
        )}
        <div className="field">
          <label htmlFor="recover-password">{t('新密码')}</label>
          <input id="recover-password" className="input input-lg" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} autoComplete="new-password" placeholder={t('至少 10 个字符')} />
        </div>
        <div className="field">
          <label htmlFor="recover-confirm">{t('确认密码')}</label>
          <input id="recover-confirm" className="input input-lg" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required autoComplete="new-password" />
        </div>
        {error && <div className="form-error"><AlertCircle size={14} /> {error}</div>}
        <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading}>
          {loading ? <span className="spinner" /> : mode === 'email' ? <Mail size={14} /> : <KeyRound size={14} />}
          {loading ? t('重置中…') : t('重置密码')}
        </button>
      </form>
      <p className="auth-switch">
        {mode === 'email' ? (
          <button type="button" className="link-button" onClick={() => { setMode('key'); setError(null); }}>
            {t('改用恢复密钥')}
          </button>
        ) : (
          <button type="button" className="link-button" onClick={() => { setMode('email'); setError(null); }}>
            {t('改用邮箱验证码')}
          </button>
        )}
      </p>
      <p className="auth-legal">
        {mode === 'key' ? t('没有恢复密钥？') : t('仍然无法登录？')}
        <br />
        <Link to="/register">{t('创建一个新账户')}</Link> · <a href="mailto:noreply@360note.com">{t('联系我们')}</a>
      </p>
    </AuthLayout>
  );
}
