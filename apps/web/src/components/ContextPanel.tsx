import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  History,
  MessageCircle,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import type { Backlink, Comment, NoteVersion, NoteVersionDetail } from '@360note/shared';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { cn, formatBytes, formatFullDate, formatRelativeShort } from '../lib/utils';
import { renderMarkdown } from '../lib/markdown';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './Modal';
import { toast } from '../stores/toast';

const REASON_LABELS: Record<string, string> = {
  auto: '自动保存',
  manual: '手动保存',
  restore: '恢复操作',
  import: '导入操作',
  conflict: '冲突副本',
};

export function ContextPanel() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [searchParams] = useSearchParams();
  const requestedComment = searchParams.get('comment');
  const requestedVersion = searchParams.get('version');
  const previewLatest = searchParams.get('preview') === 'latest';
  const note = useAppStore((state) => state.note);
  const folders = useAppStore((state) => state.folders);
  const tags = useAppStore((state) => state.tags);
  const tab = useAppStore((state) => state.contextTab);
  const setTab = useAppStore((state) => state.setContextTab);
  const setOpen = useAppStore((state) => state.setContextOpen);
  const updateNoteMeta = useAppStore((state) => state.updateNoteMeta);
  const restoreVersion = useAppStore((state) => state.restoreVersion);
  const reloadNote = useAppStore((state) => state.reloadNote);

  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [versions, setVersions] = useState<{ currentVersion: number; versions: NoteVersion[] } | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionDetail, setVersionDetail] = useState<NoteVersionDetail | null>(null);
  const [loadingVersionId, setLoadingVersionId] = useState<number | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<Comment | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [addTagLoading, setAddTagLoading] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [confirmAttachment, setConfirmAttachment] = useState<string | null>(null);

  const folderPath = useMemo(() => {
    if (!note) return [];
    const path: string[] = [];
    let current = note.folderId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = folders.find((entry) => entry.id === current);
      if (!folder) break;
      path.unshift(folder.name);
      current = folder.parentId;
    }
    return path;
  }, [note?.folderId, folders]);

  const open = useAppStore((state) => state.contextOpen);

  useEffect(() => {
    if (!note) return;
    if (tab === 'backlinks') {
      api.get<{ backlinks: Backlink[] }>(`/api/notes/${note.id}/backlinks`).then((response) => setBacklinks(response.backlinks)).catch(() => setBacklinks([]));
    }
    if (tab === 'comments') {
      setCommentLoading(true);
      api.get<{ comments: Comment[] }>(`/api/notes/${note!.id}/comments`)
        .then((response) => {
          setComments(response.comments);
          if (requestedComment) {
            window.setTimeout(() => {
              document.getElementById(`comment-${requestedComment}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 60);
          }
        })
        .catch(() => setComments([]))
        .finally(() => setCommentLoading(false));
    }
    if (tab === 'history') {
      setVersionLoading(true);
      setVersionDetail(null);
      api.get<{ currentVersion: number; versions: NoteVersion[] }>(`/api/notes/${note!.id}/versions`).then(setVersions).catch(() => setVersions(null)).finally(() => setVersionLoading(false));
    }
  }, [tab, note?.id, note?.version, requestedComment]);

  useEffect(() => {
    if (tab !== 'history' || !versions) return;
    const target = requestedVersion
      ? versions.versions.find((version) => String(version.version) === requestedVersion)
      : previewLatest
        ? versions.versions[0]
        : undefined;
    if (target && versionDetail?.id !== target.id) void loadVersion(target);
  }, [tab, versions, requestedVersion, previewLatest, versionDetail?.id]);

  if (!note) return null;

  const visibleAttachments = note.attachments.filter((attachment) =>
    note.contentMd.includes(`/api/attachments/${attachment.id}/content`),
  );

  const availableTags = tags.filter((tag) => !note.tags.some((entry) => entry.id === tag.id));
  const tagResults = availableTags.filter((tag) => !tagQuery.trim() || tag.name.toLowerCase().includes(tagQuery.trim().toLowerCase())).slice(0, 8);

  function focusTagInput() {
    window.setTimeout(() => tagInputRef.current?.focus(), 20);
  }

  async function addTag(tagId: string) {
    if (!note) return;
    setAddTagLoading(true);
    try {
      await updateNoteMeta({ tagIds: [...note.tags.map((tag) => tag.id), tagId] });
      setTagQuery('');
      focusTagInput();
    } finally {
      setAddTagLoading(false);
    }
  }

  async function createAndAddTag() {
    const name = tagQuery.trim();
    if (!name || !note) {
      if (!name) setTagOpen(false);
      return;
    }
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      await addTag(existing.id);
      return;
    }
    setAddTagLoading(true);
    try {
      const response = await api.post<{ tag: { id: string; name: string; color: string | null } }>('/api/tags', {
        workspaceId: note.workspaceId,
        name,
      });
      await useAppStore.getState().refreshTags();
      await addTag(response.tag.id);
    } catch (error) {
      toast('error', t('创建标签失败'), (error as Error).message);
    } finally {
      setAddTagLoading(false);
    }
  }

  async function removeTag(tagId: string) {
    await updateNoteMeta({ tagIds: note!.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id) });
  }

  async function removeAttachment(attachmentId: string) {
    if (confirmAttachment !== attachmentId) {
      setConfirmAttachment(attachmentId);
      return;
    }
    try {
      await api.delete(`/api/attachments/${attachmentId}`);
      setConfirmAttachment(null);
      await reloadNote();
      toast('success', t('附件已删除'));
    } catch (error) {
      toast('error', t('删除附件失败'), (error as Error).message);
    }
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    setPosting(true);
    try {
      const response = await api.post<{ comment: Comment }>(`/api/notes/${note!.id}/comments`, { body: commentBody.trim() });
      setComments((current) => [...current, response.comment]);
      setCommentBody('');
      void reloadNote();
    } catch (error) {
      toast('error', t('发送评论失败'), (error as Error).message);
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment() {
    if (!deleteCommentTarget) return;
    try {
      await api.delete(`/api/comments/${deleteCommentTarget.id}`);
      setComments((current) => current.filter((entry) => entry.id !== deleteCommentTarget.id));
      setDeleteCommentTarget(null);
      toast('success', t('评论已删除'));
    } catch (error) {
      toast('error', t('删除评论失败'), (error as Error).message);
    }
  }

  async function resolveComment(comment: Comment) {
    try {
      await api.patch(`/api/comments/${comment.id}`, { resolved: !comment.resolved });
      setComments((current) => current.map((entry) => (entry.id === comment.id ? { ...entry, resolved: !entry.resolved } : entry)));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function loadVersion(version: NoteVersion) {
    setVersionDetail(null);
    setLoadingVersionId(version.id);
    try {
      const response = await api.get<{ version: NoteVersionDetail }>(`/api/notes/${note!.id}/versions/${version.id}`);
      setVersionDetail(response.version);
      setConfirmRestore(null);
    } catch (error) {
      toast('error', t('无法加载版本'), (error as Error).message);
    } finally {
      setLoadingVersionId(null);
    }
  }

  async function doRestore(version: NoteVersion) {
    if (confirmRestore !== version.id) {
      setConfirmRestore(version.id);
      return;
    }
    await restoreVersion(version.id);
    setConfirmRestore(null);
  }

  async function createVersion() {
    try {
      await api.post(`/api/notes/${note!.id}/versions`);
      const response = await api.get<{ currentVersion: number; versions: NoteVersion[] }>(`/api/notes/${note!.id}/versions`);
      setVersions(response);
      toast('success', t('已保存一个新版本'));
    } catch (error) {
      toast('error', t('保存版本失败'), (error as Error).message);
    }
  }

  return (
    <aside className={cn('context-panel', open && 'is-open')} aria-hidden={!open}>
      <div className="context-head">
        <div className="context-tabs">
          {(['info', 'backlinks', 'comments', 'history'] as const).map((entry) => (
            <button key={entry} type="button" className={cn('context-tab', tab === entry && 'active')} onClick={() => setTab(entry)}>
              {entry === 'info' ? t('信息') : entry === 'backlinks' ? t('反向链接') : entry === 'comments' ? t('评论') : t('历史')}
              {entry === 'comments' && comments.length > 0 && <span style={{ marginLeft: 3, fontSize: 13, color: 'var(--text-tertiary)' }}>{comments.length}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setOpen(false)} aria-label={t('关闭')}>
          <X size={15} />
        </button>
      </div>
      <div className="context-body app-scroll">
        {tab === 'info' && (
          <>
            <div className="context-section">
              <div className="context-section-title">
                <span>{t('标签')}</span>
              </div>
              <div className="context-tag-list">
                {note.tags.map((tag) => (
                  <span className="tag-token" key={tag.id}>
                    <span className="tag-hash">#</span>
                    <span className="tag-token-name">{tag.name}</span>
                    <button type="button" onClick={() => void removeTag(tag.id)} aria-label={t('移除')}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {tagOpen ? (
                  <span className="tag-token tag-token-edit">
                    <span className="tag-hash">#</span>
                    <input
                      ref={tagInputRef}
                      value={tagQuery}
                      onChange={(event) => setTagQuery(event.target.value)}
                      placeholder={t('添加标签')}
                      aria-label={t('添加标签')}
                      disabled={addTagLoading}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void createAndAddTag();
                        }
                        if (event.key === 'Escape') {
                          setTagOpen(false);
                          setTagQuery('');
                        }
                      }}
                      onBlur={() => {
                        if (tagQuery.trim()) void createAndAddTag();
                        else setTagOpen(false);
                      }}
                    />
                  </span>
                ) : (
                  <button type="button" className="tag-token tag-token-add" onClick={() => { setTagOpen(true); focusTagInput(); }}>
                    <span className="tag-hash">#</span> {t('添加标签')}
                  </button>
                )}
              </div>
              {tagOpen && tagResults.length > 0 && (
                <div className="context-tag-suggestions">
                  {tagResults.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className="tag-token tag-token-select"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void addTag(tag.id)}
                      disabled={addTagLoading}
                    >
                      <span className="tag-hash">#</span> {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="context-section">
              <div className="context-section-title">{t('位置')}</div>
              <div className="context-row"><span>{t('文件夹')}</span><span>{folderPath.length ? folderPath.join(' / ') : t('根目录')}</span></div>
              <div className="context-row"><span>{t('收藏')}</span><span>{note.isFavorite ? t('是') : t('否')}</span></div>
              <div className="context-row"><span>{t('置顶')}</span><span>{note.isPinned ? t('是') : t('否')}</span></div>
            </div>

            <div className="context-section">
              <div className="context-section-title">{t('文档信息')}</div>
              <div className="context-row"><span>{t('字数')}</span><span>{note.wordCount ?? 0}</span></div>
              <div className="context-row"><span>{t('版本')}</span><span>v{note.version}</span></div>
              <div className="context-row"><span>{t('创建于')}</span><span>{formatFullDate(note.createdAt)}</span></div>
              <div className="context-row"><span>{t('更新于')}</span><span>{formatFullDate(note.updatedAt)}</span></div>
            </div>

            <div className="context-section">
              <div className="context-section-title">
                <span>{t('附件')}</span>
                <span style={{ fontWeight: 450, letterSpacing: 0, textTransform: 'none', color: 'var(--text-tertiary)' }}>{visibleAttachments.length}</span>
              </div>
              {visibleAttachments.length === 0 ? (
                <div className="context-empty">{t('上传图片或附件后，它们会显示在这里。')}</div>
              ) : (
                visibleAttachments.map((attachment) => (
                  <div className="attachment-item" key={attachment.id}>
                    <div className="attachment-thumb">
                      {attachment.mime.startsWith('image/') ? (
                        <img src={`/api/attachments/${attachment.id}/content`} alt="" loading="lazy" />
                      ) : (
                        <FileText size={14} />
                      )}
                    </div>
                    <div className="attachment-meta">
                      <div className="attachment-name">{attachment.filename}</div>
                      <div className="attachment-size">
                        {formatBytes(attachment.size)}
                        {attachment.ocrStatus === 'done' && ` · ${t('已提取文字')}`}
                        {attachment.ocrStatus === 'pending' && ` · ${t('识别中…')}`}
                      </div>
                      {attachment.imageTags && attachment.imageTags.length > 0 && (
                        <div className="attachment-image-tags" title={t('由缤纷云图片分析生成')}>
                          {attachment.imageTags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                        </div>
                      )}
                    </div>
                    <a className="icon-btn icon-btn-sm" href={`/api/attachments/${attachment.id}/content`} download={attachment.filename} aria-label={t('下载')}>
                      <Download size={13} />
                    </a>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onClick={() => void removeAttachment(attachment.id)}
                      title={confirmAttachment === attachment.id ? t('再次点击确认') : t('删除附件')}
                      aria-label={t('删除附件')}
                      style={confirmAttachment === attachment.id ? { background: 'var(--red-soft)', color: 'var(--red)' } : undefined}
                    >
                      {confirmAttachment === attachment.id ? <Check size={13} /> : <Trash2 size={13} />}
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {tab === 'backlinks' && (
          <div className="context-section">
            <div className="context-section-title">
              <span>{t('反向链接')}</span>
              <span style={{ fontWeight: 450, letterSpacing: 0, textTransform: 'none' }}>{backlinks.length}</span>
            </div>
            {backlinks.length === 0 ? (
              <div className="context-empty">{t('还没有其他笔记链接到这里。输入 [[{title}]] 即可建立连接。', { title: note.title })}</div>
            ) : (
              backlinks.map((backlink) => (
                <button key={backlink.id} type="button" className="backlink-item" onClick={() => navigate(`/app/note/${backlink.id}`)}>
                  <div className="backlink-title">{backlink.title}</div>
                  <div className="backlink-excerpt">{backlink.excerpt}</div>
                </button>
              ))
            )}
          </div>
        )}

        {tab === 'comments' && (
          <div className="context-section">
            <div className="context-section-title">
              <span>{t('评论')}</span>
              <span style={{ fontWeight: 450, letterSpacing: 0, textTransform: 'none' }}>{comments.length}</span>
            </div>
            {commentLoading ? (
              <div className="loading-row"><span className="spinner" /> {t('加载中…')}</div>
            ) : comments.length === 0 ? (
              <div className="context-empty">{t('还没有评论。评论适合记录讨论，而不改变正文。')}</div>
            ) : (
              <div className="comment-list">
                {comments.map((comment) => (
                  <div
                    className={cn('comment-item', requestedComment === comment.id && 'is-target')}
                    id={`comment-${comment.id}`}
                    key={comment.id}
                  >
                    <Avatar name={comment.authorName} color={comment.isGuest ? '#6c5ce7' : '#17865b'} size="sm" />
                    <div className="comment-body">
                      <div className="comment-head">
                        <span className="comment-author">{comment.authorName}</span>
                        <span>{formatRelativeShort(comment.createdAt)}</span>
                        {comment.isGuest && <span className="badge">{t('访客')}</span>}
                        {comment.resolved && <span className="badge badge-green"><Check size={9} /> {t('已解决')}</span>}
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
                          <button type="button" className="footbar-button" onClick={() => void resolveComment(comment)}>
                            {comment.resolved ? t('重新打开') : t('解决')}
                          </button>
                          {(comment.authorId === user?.id || (comment.isGuest && note?.createdBy === user?.id)) && (
                            <button
                              type="button"
                              className="footbar-button"
                              onClick={() => setDeleteCommentTarget(comment)}
                              title={t('删除评论')}
                              aria-label={t('删除评论')}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="comment-text">{comment.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="comment-compose">
              <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder={t('写下评论…')} maxLength={5000} />
              <div className="comment-compose-bottom">
                <button type="button" className="btn btn-primary btn-sm" onClick={postComment} disabled={posting || !commentBody.trim()}>
                  {posting ? <span className="spinner" /> : <Send size={12} />} {t('发送')}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="context-section">
            <div className="context-section-title">
              <span>{t('版本历史')}</span>
              <button type="button" className="context-add-tag" onClick={createVersion}>{t('保存版本')}</button>
            </div>
            {versionLoading ? (
              <div className="loading-row"><span className="spinner" /> {t('加载中…')}</div>
            ) : !versions || versions.versions.length === 0 ? (
              <div className="context-empty">{t('版本由自动保存与手动保存生成。')}</div>
            ) : (
              <div className="version-list">
                {versions.versions.map((version) => {
                  const expanded = versionDetail?.id === version.id;
                  return (
                    <div className={cn('version-accordion', expanded && 'open')} key={version.id}>
                      <button
                        type="button"
                        className={cn('version-item', expanded && 'active')}
                        aria-expanded={expanded}
                        onClick={() => {
                          if (expanded) {
                            setVersionDetail(null);
                            setConfirmRestore(null);
                          } else {
                            void loadVersion(version);
                          }
                        }}
                      >
                        <History size={13} style={{ color: 'var(--text-tertiary)', marginTop: 2 }} />
                        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <span className="version-time" style={{ display: 'block' }}>{formatFullDate(version.createdAt)}</span>
                          <span className="version-reason">
                            {t(REASON_LABELS[version.reason] ?? '自动保存')}
                            {version.reason === 'conflict' ? '' : version.version === versions.currentVersion ? ` · ${t('当前版本')}` : ` · v${version.version}`}
                          </span>
                        </span>
                        <ChevronDown size={14} className={cn('version-chevron', expanded && 'open')} />
                      </button>
                      {expanded && (
                        <div className="version-collapse">
                          {loadingVersionId === version.id || !versionDetail ? (
                            <div className="loading-row"><span className="spinner" /> {t('加载中…')}</div>
                          ) : (
                            <>
                              <div className="version-preview prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(versionDetail.contentMd).html }} />
                              <div className="version-collapse-actions">
                                <button type="button" className={cn('btn btn-sm', confirmRestore === versionDetail.id ? 'btn-danger' : 'btn-secondary')} onClick={() => void doRestore(versionDetail)}>
                                  <RotateCcw size={12} /> {confirmRestore === versionDetail.id ? t('再次点击确认恢复') : t('恢复此版本')}
                                </button>
                              </div>
                              <p className="setting-note">{t('恢复会创建一个新版本，当前内容不会被静默覆盖。')}</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="setting-note" style={{ marginTop: 8 }}>{t('自动保存最多每 5 分钟生成一个版本；手动保存、导入、恢复与冲突会立即生成。每篇笔记最多保留 60 个版本。')}</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteCommentTarget)}
        onClose={() => setDeleteCommentTarget(null)}
        onConfirm={() => void deleteComment()}
        title={t('删除评论')}
        description={t('删除这条评论？')}
        confirmLabel={t('删除')}
        danger
      />
    </aside>
  );
}
