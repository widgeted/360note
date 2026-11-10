import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { formatFullDate } from '../../lib/utils';
import { toast } from '../../stores/toast';
import { ConfirmDialog } from '../Modal';

interface ManagedComment {
  id: string;
  noteId: string;
  noteTitle: string;
  authorId: string | null;
  authorName: string;
  isGuest: boolean;
  body: string;
  resolved: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function CommentSettings() {
  const t = useT();
  const [comments, setComments] = useState<ManagedComment[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedComment | null>(null);

  async function load(nextOffset: number) {
    setLoading(true);
    try {
      const response = await api.get<{ comments: ManagedComment[]; total: number }>(
        `/api/comments/manage?limit=50&offset=${nextOffset}`,
      );
      setComments(response.comments);
      setTotal(response.total);
      setOffset(nextOffset);
    } catch (error) {
      toast('error', t('加载失败'), (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(0);
  }, []);

  async function remove() {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/comments/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load(offset);
      toast('success', t('评论已删除'));
    } catch (error) {
      toast('error', t('删除评论失败'), (error as Error).message);
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('评论管理')}</h1>
      <p className="settings-subtitle">{t('管理你笔记上的评论，或删除自己发表过的评论。匿名访客评论由笔记作者删除。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('我的评论')}</span>
          <span className="settings-section-desc">{t('共 {n} 条', { n: total })}</span>
        </div>
        <div className="setting-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table admin-comment-table">
            <thead><tr><th>{t('评论内容')}</th><th>{t('评论者')}</th><th>{t('被评论笔记')}</th><th>{t('时间')}</th><th>{t('操作')}</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}><div className="loading-row"><span className="spinner" /> {t('加载中…')}</div></td></tr>
              ) : comments.length === 0 ? (
                <tr><td colSpan={5}><div className="context-empty">{t('暂无评论')}</div></td></tr>
              ) : comments.map((comment) => (
                <tr key={comment.id}>
                  <td><div className="admin-comment-body">{comment.body}</div></td>
                  <td>
                    <div>{comment.authorName} {comment.isGuest && <span className="badge">{t('访客')}</span>}</div>
                    {comment.resolved && <div className="setting-note">{t('已解决')}</div>}
                  </td>
                  <td>
                    <a className="admin-comment-note" href={`/app/note/${comment.noteId}?panel=comments&comment=${comment.id}`}>
                      {comment.noteTitle || t('未命名笔记')}
                    </a>
                  </td>
                  <td className="setting-note">{formatFullDate(comment.createdAt)}</td>
                  <td>
                    {comment.canDelete ? (
                      <button type="button" className="icon-btn icon-btn-sm" onClick={() => setDeleteTarget(comment)} title={t('删除评论')} aria-label={t('删除评论')}>
                        <Trash2 size={13} />
                      </button>
                    ) : <span className="setting-note">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-log-pager">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load(Math.max(0, offset - 50))} disabled={loading || offset === 0}>{t('上一页')}</button>
          <span className="setting-note">{t('第 {page} 页', { page: Math.floor(offset / 50) + 1 })}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load(offset + 50)} disabled={loading || offset + 50 >= total}>{t('下一页')}</button>
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={t('删除评论')}
        description={t('删除这条评论？')}
        confirmLabel={t('删除')}
        danger
      />
    </>
  );
}
