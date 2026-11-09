import { useEffect, useState } from 'react';
import {
  CalendarDays,
  Check,
  Clock3,
  Copy,
  Edit3,
  Eye,
  Info,
  Link2,
  LockKeyhole,
  MessageCircle,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { Note, ShareLink, SharePermission } from '@360note/shared';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { copyText, formatFullDate } from '../../lib/utils';
import { Modal } from '../Modal';
import { toast } from '../../stores/toast';

export function ShareDialog({ note, open, onClose }: { note: Note; open: boolean; onClose: () => void }) {
  const t = useT();
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState<SharePermission>('view');
  const [advanced, setAdvanced] = useState(false);
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [customDate, setCustomDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [newShare, setNewShare] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNewShare(null);
    setLoading(true);
    api
      .get<{ shares: ShareLink[] }>(`/api/notes/${note.id}/shares`)
      .then((response) => setShares(response.shares))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, note.id]);

  async function create() {
    setCreating(true);
    try {
      let expiresAt: string | null = null;
      if (expiry === '1d') expiresAt = new Date(Date.now() + 86400000).toISOString();
      if (expiry === '7d') expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      if (expiry === '30d') expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      if (expiry === 'custom' && customDate) expiresAt = new Date(customDate).toISOString();
      const response = await api.post<{ share: ShareLink }>(`/api/notes/${note.id}/shares`, {
        permission,
        password: password.trim() || undefined,
        expiresAt,
      });
      setShares((current) => [response.share, ...current]);
      setNewShare(response.share);
      toast('success', t('分享链接已创建'), t('访客看到的是笔记的最新版本；之后编辑会立即反映到分享页。'));
    } catch (error) {
      toast('error', t('创建分享失败'), (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function copy(share: ShareLink) {
    if (!share.url) return;
    await copyText(share.url);
    setCopied(share.id);
    setTimeout(() => setCopied(null), 1600);
  }

  async function revoke(id: string) {
    if (revokeId !== id) {
      setRevokeId(id);
      return;
    }
    try {
      await api.delete(`/api/shares/${id}`);
      setShares((current) => current.map((share) => (share.id === id ? { ...share, revokedAt: new Date().toISOString() } : share)));
      toast('success', t('分享链接已撤销'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    } finally {
      setRevokeId(null);
    }
  }

  const activeShares = shares.filter((share) => !share.revokedAt);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('分享笔记')}
      description={t('创建一个无需登录即可访问的链接。权限、密码与有效期都由你控制。')}
      size="lg"
    >
      {note.encrypted ? (
        <div className="banner banner-warning">
          <ShieldAlert size={15} />
          <div>{t('端到端加密笔记不能创建公开分享。')}</div>
        </div>
      ) : (
        <>
          <div className="info-line" style={{ marginBottom: 12 }}>
            <Info size={13} />
            <span>{t('分享页始终展示最新版本：当前 v{version}，最后更新 {time}。', { version: note.version, time: formatFullDate(note.updatedAt) })}</span>
          </div>
          {activeShares.length > 0 && (
            <div className="banner banner-info" style={{ marginBottom: 14 }}>
              <Info size={15} />
              <div>{t('此笔记已有有效分享。访客看到的是最新版本；之后继续编辑，访客刷新即可看到更新。如需固定内容，请撤销分享或导出副本。')}</div>
            </div>
          )}
          <div className="share-permission-list">
            {(
              [
                { value: 'view', icon: <Eye size={15} />, name: t('仅查看'), desc: t('获得链接的人可以阅读，但不能修改或评论。') },
                { value: 'comment', icon: <MessageCircle size={15} />, name: t('可评论'), desc: t('读者可以在页面底部留下评论，评论会通知你。') },
                { value: 'edit', icon: <Edit3 size={15} />, name: t('可编辑'), desc: t('拥有链接的匿名访客也可以修改内容，每次保存都会生成历史版本。') },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                className={`share-permission-option ${permission === option.value ? 'selected' : ''}`}
                onClick={() => setPermission(option.value)}
              >
                <span className="share-permission-radio" />
                <span style={{ color: 'var(--text-tertiary)', marginTop: 1 }}>{option.icon}</span>
                <span>
                  <span className="share-permission-name">{option.name}</span>
                  <span className="share-permission-desc">{option.desc}</span>
                </span>
              </button>
            ))}
          </div>

          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={() => setAdvanced((value) => !value)}>
            <LockKeyhole size={13} /> {t('高级选项：密码与过期时间')} <span style={{ color: 'var(--text-tertiary)' }}>{advanced ? '−' : '+'}</span>
          </button>
          {advanced && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }} className="share-advanced">
              <div className="field">
                <label>{t('链接密码（可选）')}</label>
                <input className="input" type="text" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('留空则不需要密码')} autoComplete="off" />
              </div>
              <div className="field">
                <label>{t('过期时间')}</label>
                <select className="select" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                  <option value="never">{t('永不过期')}</option>
                  <option value="1d">{t('1 天后')}</option>
                  <option value="7d">{t('7 天后')}</option>
                  <option value="30d">{t('30 天后')}</option>
                  <option value="custom">{t('指定日期')}</option>
                </select>
                {expiry === 'custom' && (
                  <input className="input" type="datetime-local" value={customDate} onChange={(event) => setCustomDate(event.target.value)} style={{ marginTop: 6 }} />
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
              {creating ? <span className="spinner" /> : <Plus size={14} />}
              {t('创建分享链接')}
            </button>
            <span className="setting-note" style={{ flex: 1 }}>
              {permission === 'edit' ? t('任何拥有链接的人都可以编辑，包括匿名访客。') : t('此链接无需登录即可访问')}
            </span>
          </div>

          {newShare?.url && (
            <div className="animate-rise" style={{ marginTop: 18 }}>
              <div className="share-link-box">
                <Link2 size={13} style={{ color: 'var(--text-tertiary)' }} />
                <input readOnly value={newShare.url} onFocus={(event) => event.target.select()} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(newShare)}>
                  {copied === newShare.id ? <Check size={13} /> : <Copy size={13} />}
                  {copied === newShare.id ? t('已复制') : t('复制')}
                </button>
              </div>
              {newShare.hasPassword && <div className="setting-note" style={{ marginTop: 6 }}><LockKeyhole size={11} /> {t('访问者需要输入密码。密码不会显示在链接中。')}</div>}
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <div className="settings-section-head">
              <span className="settings-section-title">{t('已有分享')}</span>
              <span className="settings-section-desc">{t('{n} 个有效链接', { n: activeShares.length })}</span>
            </div>
            {loading ? (
              <div className="loading-row"><span className="spinner" /> {t('加载中…')}</div>
            ) : shares.length === 0 ? (
              <div className="context-empty">{t('还没有分享链接。选择权限后点击“创建分享链接”。')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {shares.map((share) => (
                  <div key={share.id} className={share.revokedAt ? 'share-item is-revoked' : 'share-item'}>
                    <div className="share-item-top">
                      {share.url ? (
                        <a
                          className="share-item-url"
                          href={share.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={share.url}
                        >
                          {share.url}
                        </a>
                      ) : (
                        <span className="share-item-url is-missing">{t('链接不可用')}</span>
                      )}
                      {!share.revokedAt && (
                        <div className="share-item-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(share)}>
                            {copied === share.id ? <Check size={13} /> : <Copy size={13} />} {copied === share.id ? t('已复制') : t('复制')}
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${revokeId === share.id ? 'btn-danger' : 'btn-ghost'}`}
                            onClick={() => void revoke(share.id)}
                            title={t('撤销')}
                            aria-label={revokeId === share.id ? t('再次点击确认') : t('撤销')}
                          >
                            <Trash2 size={13} /> {revokeId === share.id ? t('再次点击确认') : ''}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="share-item-meta">
                      <div className="share-item-meta-tags">
                        <span className="badge badge-blue">
                          {share.permission === 'view' ? <Eye size={11} /> : share.permission === 'edit' ? <Edit3 size={11} /> : <MessageCircle size={11} />}
                          {share.permission === 'view' ? t('只读') : share.permission === 'edit' ? t('可编辑') : t('可评论')}
                        </span>
                        {share.hasPassword && <span className="share-item-note"><LockKeyhole size={12} />{t('需要密码')}</span>}
                        {share.revokedAt && <span className="badge">{t('已撤销')}</span>}
                      </div>
                      <span><CalendarDays size={13} />{t('创建于 {date}', { date: formatFullDate(share.createdAt) })}</span>
                      <div className="share-item-meta-line">
                        <span><Clock3 size={13} />{share.expiresAt ? t('到期于 {date}', { date: formatFullDate(share.expiresAt) }) : t('永不过期')}</span>
                        <span><Eye size={13} />{t('浏览 {n}', { n: share.viewCount })}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="banner banner-warning" style={{ marginTop: 18 }}>
            <ShieldAlert size={15} />
            <div>{t('分享链接可能被搜索引擎索引。请勿在公开笔记中放入密码、密钥或个人隐私。')}</div>
          </div>
        </>
      )}
    </Modal>
  );
}
