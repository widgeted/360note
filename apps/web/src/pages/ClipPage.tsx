import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Link2, Scissors } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { useIsMobile } from '../lib/useMediaQuery';
import { LogoLockup } from '../components/Logo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function ClipPage() {
  const t = useT();
  useDocumentTitle(t('剪藏'));
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const workspaces = useAuthStore((state) => state.workspaces);
  const workspaceId =
    localStorage.getItem('nh-workspace') ||
    workspaces.find((workspace) => workspace.kind === 'personal')?.id ||
    workspaces[0]?.id;

  const pageTitle = params.get('title') ?? '';
  const pageUrl = params.get('url') ?? '';
  const selection = params.get('text') ?? params.get('selection') ?? '';

  const [title, setTitle] = useState(pageTitle || t('网页剪藏'));
  const [body, setBody] = useState(
    `${selection ? `${selection}\n\n` : ''}${pageUrl ? `> [${pageTitle || pageUrl}](${pageUrl})\n` : ''}`,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId) {
      setError(t('还没有可用的工作区'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const contentMd = `# ${title}\n\n${body}`;
      const response = await api.post<{ note: { id: string } }>('/api/notes', {
        workspaceId,
        title,
        contentMd,
        tagNames: pageUrl ? [t('剪藏')] : [],
      });
      navigate(`/app/note/${response.note.id}`, { replace: true });
    } catch (error) {
      setError((error as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="center-page">
      <div className="center-card" style={{ maxWidth: 540 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/app" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <LogoLockup />
          </Link>
          <Link to="/app" className="btn btn-ghost btn-sm"><ArrowLeft size={12} /> {t('返回')}</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 26 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--blue-soft)', color: 'var(--blue)' }}>
            <Scissors size={16} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>{t('网页剪藏')}</h1>
            <p style={{ marginTop: 2 }}>{t('保存到 {name} 的空间', { name: user?.displayName ?? '' })}</p>
          </div>
        </div>
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
          <div className="field">
            <label>{t('标题')}</label>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </div>
          <div className="field">
            <label>{t('内容')}</label>
            <textarea className="textarea" value={body} onChange={(event) => setBody(event.target.value)} style={{ minHeight: 150 }} rows={7} />
          </div>
          {pageUrl && (
            <div className="info-line">
              <Link2 size={13} />
              <span className="truncate">{pageUrl}</span>
            </div>
          )}
          {error && <div className="form-error">{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <Link to="/app" className="btn btn-ghost">{t('取消')}</Link>
            <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>
              {saving ? <span className="spinner" /> : <Check size={14} />} {t('保存剪藏')}
            </button>
          </div>
        </form>
        <p className="auth-legal" style={{ textAlign: 'left', marginTop: 18 }}>
          {isMobile
            ? t('提示：在桌面浏览器中把“保存到 360笔记”拖到书签栏，即可一键剪藏；移动端请直接粘贴网址与选中的文字。')
            : t('提示：把浏览器书签栏中的“保存到 360笔记”拖到书签栏，即可在任意网页一键剪藏。可在 设置 → API 与集成 中获取。')}
        </p>
      </div>
    </div>
  );
}
