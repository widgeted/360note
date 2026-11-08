import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useT } from '../lib/i18n';
import { AuthLayout } from './AuthLayout';

export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useAuthStore((state) => state.login);
  const verifyTwoFactor = useAuthStore((state) => state.verifyTwoFactor);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const nextParam = params.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes('\\') ? nextParam : '/app';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.twoFactorRequired && result.challengeToken) {
        setChallenge(result.challengeToken);
        setLoading(false);
        return;
      }
      navigate(next, { replace: true });
    } catch (error) {
      setError((error as Error).message || t('邮箱或密码不正确'));
      setLoading(false);
    }
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      await verifyTwoFactor(challenge, code);
      navigate(next, { replace: true });
    } catch (error) {
      setError((error as Error).message || t('验证码不正确'));
      setLoading(false);
    }
  }

  if (challenge) {
    return (
      <AuthLayout>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setChallenge(null);
            setCode('');
            setError(null);
          }}
          style={{ marginLeft: -10, marginBottom: 18 }}
        >
          <ArrowLeft size={13} /> {t('返回登录')}
        </button>
        <h1 className="auth-heading">{t('输入验证码')}</h1>
        <p className="auth-sub">{t('打开身份验证器应用，输入当前 6 位验证码；也可以使用备用码。')}</p>
        <form className="auth-form" onSubmit={onVerify}>
          <div className="field">
            <label htmlFor="login-code">{t('验证码')}</label>
            <input
              id="login-code"
              className="totp-code-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="000 000"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
            />
          </div>
          {error && (
            <div className="form-error" role="alert">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading || code.length < 6}>
            {loading ? <span className="spinner" /> : <KeyRound size={14} />}
            {t('验证并登录')}
          </button>
        </form>
        <p className="auth-switch">
          {t('找不到验证器？')}{' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setChallenge(null);
              navigate('/recover');
            }}
            style={{ padding: 0, height: 'auto', fontSize: 'inherit', fontWeight: 600 }}
          >
            {t('使用恢复密钥')}
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="auth-heading">{t('欢迎回来')}</h1>
      <p className="auth-sub">{t('继续你上次停下的地方。')}</p>
      <form className="auth-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="login-email">{t('邮箱')}</label>
          <input
            id="login-email"
            className="input input-lg"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <div className="helper-row">
            <label htmlFor="login-password">{t('密码')}</label>
            <Link to="/recover" style={{ fontSize: 14, fontWeight: 550, color: 'var(--text-secondary)' }}>
              {t('忘记密码？')}
            </Link>
          </div>
          <div style={{ position: 'relative' }}>
            <input
              id="login-password"
              className="input input-lg"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder={t('输入密码')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
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
        </div>
        {error && (
          <div className="form-error" role="alert">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={loading}>
          {loading ? <span className="spinner" /> : null}
          {loading ? t('登录中…') : t('登录')}
          {!loading && <ArrowRight size={14} />}
        </button>
      </form>
      <p className="auth-switch">
        {t('还没有账户？')} <Link to={`/register${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`}>{t('创建一个')}</Link>
      </p>
      <p className="auth-legal">
        {t('我们只发送账户与安全相关邮件，不使用第三方分析。继续即表示你同意')}{' '}
        <Link to="/terms">{t('服务条款')}</Link> {t('和')} <Link to="/privacy">{t('隐私政策')}</Link>。
      </p>
    </AuthLayout>
  );
}
