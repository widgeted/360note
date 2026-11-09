import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Edit3,
  Eye,
  LockKeyhole,
  MessageCircle,
  Paperclip,
  Printer,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { PublicShare } from '@360note/shared';
import { api, ApiError } from '../lib/api';
import { getLocale, useT } from '../lib/i18n';
import { copyText, formatFullDate, formatPrintDate, formatRelative } from '../lib/utils';
import { renderMarkdown, stripDuplicateTitle } from '../lib/markdown';
import { cn } from '../lib/utils';
import { LogoLockup } from '../components/Logo';
import { Avatar } from '../components/Avatar';

export default function SharePage() {
  const t = useT();
  const brand = getLocale() === 'zh-CN' ? '360笔记' : '360note';
  const { token } = useParams<{ token: string }>();
  const [share, setShare] = useState<PublicShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [guestName, setGuestName] = useState(() => localStorage.getItem('nh-guest-name') ?? '');
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  async function load() {
    if (!token) return;
    try {
      const data = await api.get<PublicShare>(`/api/public/shares/${token}`);
      setShare(data);
      setEditContent(data.note.contentMd);
      setEditTitle(data.note.title);
      document.title = `${data.note.title} — ${brand}`;
      setError(null);
    } catch (error) {
      setError((error as Error).message || t('分享链接不存在或已失效'));
      document.title = `${t('链接不存在或已失效')} — ${brand}`;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const rendered = useMemo(
    () => renderMarkdown(stripDuplicateTitle(share?.note.contentMd ?? '', share?.note.title ?? ''), { toc: true, wikiLinks: true }),
    [share?.note.contentMd],
  );

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setUnlocking(true);
    setError(null);
    try {
      await api.post(`/api/public/shares/${token}/unlock`, { password });
      setPassword('');
      await load();
    } catch (error) {
      setError((error as Error).message || t('密码不正确'));
    } finally {
      setUnlocking(false);
    }
  }

  async function copyShareLink() {
    await copyText(window.location.href);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1600);
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!token || !commentBody.trim()) return;
    if (guestName.trim()) localStorage.setItem('nh-guest-name', guestName.trim());
    setPosting(true);
    try {
      const response = await api.post<{ comment: NonNullable<PublicShare['comments']>[number] }>(
        `/api/public/shares/${token}/comments`,
        { body: commentBody.trim(), guestName: guestName.trim() || undefined },
      );
      setShare((current) =>
        current ? { ...current, comments: [...(current.comments ?? []), response.comment] } : current,
      );
      setCommentBody('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPosting(false);
    }
  }

  async function saveEdit() {
    if (!token || !share) return;
    setSaving(true);
    setEditError(null);
    try {
      const response = await api.put<{ note: { version: number; updatedAt: string; title: string } }>(
        `/api/public/shares/${token}/note`,
        {
          title: editTitle,
          contentMd: editContent,
          baseVersion: share.note.version,
          guestName: guestName.trim() || undefined,
        },
      );
      setShare((current) =>
        current
          ? {
              ...current,
              note: {
                ...current.note,
                title: response.note.title,
                contentMd: editContent,
                version: response.note.version,
                updatedAt: response.note.updatedAt,
              },
            }
          : current,
      );
      setEditing(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setEditError(t('这篇笔记刚刚被其他人更新。你的修改仍在这里，可以复制保存，然后重新加载。'));
      } else {
        setEditError((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="public-page" style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <div className="loading-row"><span className="spinner" /> {t('正在加载…')}</div>
      </div>
    );
  }

  if (!share || !token) {
    return (
      <div className="public-page">
        <PublicHeader minimal />
        <div className="public-gate">
          <div className="public-gate-icon"><LockKeyhole size={22} /></div>
          <h1>{t('链接不存在或已失效')}</h1>
          <p>{error ?? t('它可能已被撤销、过期，或链接不完整。')}</p>
          <Link to="/" className="btn btn-secondary public-gate-cta">{t('了解 360笔记')}</Link>
        </div>
      </div>
    );
  }

  if (!share.hasAccess) {
    return (
      <div className="public-page">
        <PublicHeader minimal />
        <div className="public-gate">
          <div className="public-gate-icon"><LockKeyhole size={22} /></div>
          <h1>{t('此分享需要密码')}</h1>
          <p>{share.note.title}</p>
          <form onSubmit={unlock}>
            <input
              className="input"
              type="password"
              placeholder={t('输入密码查看')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
            {error && <div className="form-error" style={{ textAlign: 'left' }}><AlertCircle size={14} /> {error}</div>}
            <button className="btn btn-primary" type="submit" disabled={unlocking}>
              {unlocking ? <span className="spinner" /> : <Eye size={14} />}
              {t('查看笔记')}
            </button>
          </form>
          <div className="public-share-brand">
            <span style={{ fontWeight: 650 }}>{brand}.</span>{' '}
            {getLocale() === 'zh-CN' ? '由 360笔记 保护' : 'Protected by 360note'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="public-page">
      <PublicHeader />
      <div className={cn('public-layout', rendered.toc.length === 0 && 'no-toc')}>
        <article className="public-article">
          <div className="public-kicker">
            <span>{share.workspaceName}</span>
            <span className="dot" />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {share.permission === 'view' ? <Eye size={11} /> : share.permission === 'edit' ? <Edit3 size={11} /> : <MessageCircle size={11} />}
              {share.permission === 'view' ? t('只读') : share.permission === 'edit' ? t('可编辑') : t('可评论')}
            </span>
            {share.expiresAt && (
              <>
                <span className="dot" />
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={11} /> {t('到期于')} {formatFullDate(share.expiresAt)}
                </span>
              </>
            )}
          </div>

          {editing ? (
            <>
              <input
                className="input public-edit-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
              />
              <div className="banner banner-info public-edit-banner">
                <Edit3 size={15} />
                <div>{t('你正在通过分享链接编辑 Markdown。保存后会生成新的历史版本，并通知笔记作者。')}</div>
              </div>
              <textarea
                className="markdown-source public-edit-source"
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
              />
              {editError && <div className="form-error public-edit-error"><AlertCircle size={14} /> {editError}</div>}
              <div className="public-edit-actions">
                <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setEditContent(share.note.contentMd); setEditTitle(share.note.title); }}>
                  {t('取消')}
                </button>
                <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                  {saving ? <span className="spinner" /> : <Check size={14} />} {t('保存更改')}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="public-title">{share.note.title}</h1>
              <div className="public-meta screen-only">
                <div className="public-byline">
                  <span className="public-author">
                    <Avatar name={share.authorName} color="#17865b" size="sm" />
                    {share.authorName}
                  </span>
                  <span className="dot" />
                  <span>{t('发布于')} {formatFullDate(share.publishedAt)}</span>
                  <span className="dot" />
                  <span>{t('更新于')} {formatRelative(share.note.updatedAt)}</span>
                </div>
                <div className="public-actions">
                  <button type="button" className="icon-btn icon-btn-sm share-action-copy" onClick={() => void copyShareLink()} aria-label={t('复制链接')} title={copiedLink ? t('已复制') : t('复制链接')}>
                    {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button type="button" className="icon-btn icon-btn-sm share-action-print" onClick={() => window.print()} aria-label={t('打印')} title={t('打印')}>
                    <Printer size={14} />
                  </button>
                  {share.permission === 'edit' && (
                    <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditing(true)} aria-label={t('编辑')} title={t('编辑')}>
                      <Edit3 size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="public-meta public-print-meta print-only">
                <span>{share.authorName}</span>
                <span className="dot" />
                <span>{t('发布于')} {formatPrintDate(share.publishedAt)}</span>
                <span className="dot" />
                <span>{t('更新于')} {formatRelative(share.note.updatedAt)}</span>
                <span className="dot" />
                <span>{t('打印于')} {formatPrintDate(new Date().toISOString())}</span>
              </div>
              <div className="public-body prose" dangerouslySetInnerHTML={{ __html: rendered.html }} />
              {share.note.attachments.length > 0 && (
                <section className="public-attachments">
                  <div className="public-toc-title">{t('附件')}</div>
                  <div className="public-attachment-list">
                    {share.note.attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        className="public-attachment"
                        href={`/api/public/shares/${token}/attachments/${attachment.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Paperclip size={13} />
                        <span>{attachment.filename}</span>
                      </a>
                    ))}
                  </div>
                </section>
              )}
              <footer className="public-footer">
                <div className="public-footer-brand">
                  <span style={{ fontWeight: 650, color: 'var(--text)' }}>{brand}.</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ShieldCheck size={12} />
                  <span>{t('此页面通过安全链接访问')}</span>
                </div>
              </footer>

              {share.commentsEnabled && (
                <section className="public-comments">
                  <div className="public-comments-title">
                    <MessageCircle size={15} />
                    {t('评论')} <span className="badge">{share.comments?.length ?? 0}</span>
                  </div>
                  {(share.comments ?? []).map((comment) => (
                    <div className="public-comment" key={comment.id}>
                      <Avatar name={comment.authorName} color="#6c5ce7" size="sm" />
                      <div className="public-comment-body">
                        <div className="public-comment-head">
                          <span className="public-comment-author">{comment.authorName}</span>
                          <span>{formatRelative(comment.createdAt)}</span>
                        </div>
                        <div className="public-comment-text">{comment.body}</div>
                      </div>
                    </div>
                  ))}
                  <form className="public-comment-form" onSubmit={submitComment}>
                    <input
                      placeholder={t('你的名字（可选）')}
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      maxLength={80}
                    />
                    <textarea
                      placeholder={t('留下一条评论…')}
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      maxLength={5000}
                      required
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('评论会通知笔记作者')}</span>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={posting || !commentBody.trim()}>
                        {posting ? <span className="spinner" /> : <Send size={13} />} {t('发送')}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              {share.permission === 'edit' && !editing && (
                <div className="banner banner-warning" style={{ marginTop: 26 }}>
                  <Edit3 size={15} />
                  <div>{t('任何拥有此链接的人都可以编辑。每次保存都会生成历史版本。')}</div>
                </div>
              )}
            </>
          )}
        </article>

        <aside className="public-toc">
          {rendered.toc.length > 0 && (
            <>
              <div className="public-toc-title">{t('目录')}</div>
              {rendered.toc.map((item) => (
                <a key={item.id} href={`#${item.id}`} className={`level-${item.level}`}>
                  {item.text}
                </a>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function PublicHeader({ minimal = false }: { minimal?: boolean }) {
  const t = useT();
  const brand = getLocale() === 'zh-CN' ? '360笔记' : '360note';
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <Link to="/" aria-label={brand}>
          <LogoLockup />
        </Link>
        {!minimal && (
          <Link to="/register" className="btn btn-secondary btn-sm public-header-cta">
            {t('创建你的 360笔记')} <ArrowLeft size={12} style={{ transform: 'rotate(180deg)' }} />
          </Link>
        )}
      </div>
    </header>
  );
}
