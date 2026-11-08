import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, LogIn, UserPlus, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useT } from '../lib/i18n';
import { LogoLockup } from '../components/Logo';
import { Avatar } from '../components/Avatar';
import type { Invitation } from '@360note/shared';

export default function InvitePage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const refresh = useAuthStore((state) => state.refresh);
  const user = useAuthStore((state) => state.user);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') {
      setLoading(false);
      return;
    }
    api
      .get<{ invitations: Array<Invitation & { token: string }> }>('/api/invitations')
      .then((response) => {
        const found = response.invitations.find((entry) => entry.token === token);
        if (found) setInvitation(found);
        else setError(t('邀请不存在或已失效'));
      })
      .catch((error) => setError((error as Error).message))
      .finally(() => setLoading(false));
  }, [status, token, t]);

  async function accept() {
    if (!token) return;
    setWorking(true);
    setError(null);
    try {
      const response = await api.post<{ workspaceId: string; workspaceName: string }>(`/api/invitations/${token}/accept`);
      await refresh();
      localStorage.setItem('nh-workspace', response.workspaceId);
      navigate('/app', { replace: true });
    } catch (error) {
      setError((error as Error).message);
      setWorking(false);
    }
  }

  async function decline() {
    if (!token) return;
    setWorking(true);
    try {
      await api.post(`/api/invitations/${token}/decline`);
      navigate('/app', { replace: true });
    } catch (error) {
      setError((error as Error).message);
      setWorking(false);
    }
  }

  const next = encodeURIComponent(`/invite/${token ?? ''}`);

  return (
    <div className="center-page">
      <div className="center-card animate-rise">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <LogoLockup />
          </Link>
          <Link to="/app" className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto' }}>
            <ArrowLeft size={12} /> {t('回到应用')}
          </Link>
        </div>

        {status !== 'authenticated' ? (
          <>
            <h1>{t('你被邀请加入')} 360note</h1>
            <p>{t('登录或创建账户后即可接受邀请。')}</p>
            <Link to={`/login?next=${next}`} className="btn btn-primary btn-block">
              <LogIn size={14} /> {t('登录以继续')}
            </Link>
            <Link to={`/register?next=${next}`} className="btn btn-secondary btn-block" style={{ marginTop: 8 }}>
              <UserPlus size={14} /> {t('创建账户')}
            </Link>
          </>
        ) : loading ? (
          <div className="loading-row"><span className="spinner" /> {t('正在加载…')}</div>
        ) : invitation ? (
          <>
            <h1>{t('加入「{name}」', { name: invitation.workspaceName ?? '' })}</h1>
            <p>
              {invitation.inviterName ? `${invitation.inviterName} ` : ''}{t('邀请你以')}{' '}
              <strong style={{ color: 'var(--text)' }}>{roleLabel(t, invitation.role)}</strong>{' '}
              {t('身份加入这个空间。')}
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '13px 14px',
                borderRadius: 9,
                border: '1px solid var(--line)',
                background: 'var(--paper-50)',
                marginTop: 18,
              }}
            >
              <Avatar name={invitation.workspaceName ?? 'N'} color="#17865b" size="lg" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 620, fontSize: 13, color: 'var(--text)' }}>{invitation.workspaceName}</div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {t('以 {email} 的身份接受', { email: user?.email ?? '' })}
                </div>
              </div>
            </div>
            {error && <div className="form-error" style={{ marginTop: 14 }}><X size={14} /> {error}</div>}
            <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={accept} disabled={working}>
              {working ? <span className="spinner" /> : <Check size={15} />}
              {t('接受邀请')}
            </button>
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 6 }} onClick={decline} disabled={working}>
              {t('拒绝')}
            </button>
          </>
        ) : (
          <>
            <h1>{t('邀请已失效')}</h1>
            <p>{error ?? t('这个邀请可能已过期、被撤销，或发送给了另一个邮箱。')}</p>
            <Link to="/app" className="btn btn-secondary btn-block">{t('回到应用')}</Link>
          </>
        )}
        <div className="public-share-brand" style={{ marginTop: 24 }}>
          <span style={{ fontWeight: 650, color: 'var(--text)' }}>360note.</span> {t('驱动')}
        </div>
      </div>
    </div>
  );
}

function roleLabel(t: ReturnType<typeof useT>, role: string): string {
  if (role === 'admin') return t('管理员');
  if (role === 'editor') return t('编辑者');
  if (role === 'viewer') return t('查看者');
  return role;
}
