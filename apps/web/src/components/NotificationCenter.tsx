import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight, MessageCircle, PencilLine, ShieldAlert, UserPlus } from 'lucide-react';
import type { Notification } from '@360note/shared';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { formatRelativeShort } from '../lib/utils';
import { Dropdown } from './Dropdown';
import { Modal } from './Modal';

function notificationIcon(notification: Notification): ReactNode {
  if (notification.type === 'security') return <ShieldAlert size={15} />;
  if (notification.type === 'invitation') return <UserPlus size={15} />;
  if (notification.type === 'share_edit') return <PencilLine size={15} />;
  return <MessageCircle size={15} />;
}

export function NotificationCenter() {
  const t = useT();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [allOffset, setAllOffset] = useState(0);
  const [allLoading, setAllLoading] = useState(false);

  async function load() {
    try {
      const response = await api.get<{ notifications: Notification[]; unread: number }>('/api/notifications?limit=20');
      setNotifications(response.notifications);
      setUnread(response.unread);
    } catch {
      /* silent */
    }
  }

  async function loadAll(offset: number) {
    setAllLoading(true);
    try {
      const response = await api.get<{ notifications: Notification[]; unread: number; total: number }>(
        `/api/notifications?limit=50&offset=${offset}`,
      );
      setAllNotifications(response.notifications);
      setAllTotal(response.total);
      setAllOffset(offset);
      setUnread(response.unread);
    } catch {
      /* silent */
    } finally {
      setAllLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (showAll) void loadAll(0);
  }, [showAll]);

  async function markAll() {
    await api.post('/api/notifications/read-all').catch(() => {});
    await load();
    if (showAll) await loadAll(allOffset);
  }

  async function open(notification: Notification) {
    if (!notification.readAt) {
      await api.post(`/api/notifications/${notification.id}/read`).catch(() => {});
      await load();
      if (showAll) await loadAll(allOffset);
    }
    if (notification.link) {
      let link = notification.link;
      // Older notifications were stored before deep links existed. Infer the
      // relevant panel so historical notifications stay actionable too.
      if (!/[?&]panel=/.test(link)) {
        if (notification.type === 'comment') link += `${link.includes('?') ? '&' : '?'}panel=comments`;
        if (notification.type === 'share_edit') link += `${link.includes('?') ? '&' : '?'}panel=history&preview=latest`;
      }
      if (link.startsWith('/settings/')) link = `/app${link}`;
      setShowAll(false);
      navigate(link);
    }
  }

  function renderNotification(notification: Notification, close?: () => void) {
    return (
      <button
        key={notification.id}
        type="button"
        className="menu-item"
        onClick={() => {
          void open(notification);
          close?.();
        }}
        style={{ alignItems: 'flex-start', paddingTop: 8, paddingBottom: 8 }}
      >
        <span style={{ color: notification.readAt ? 'var(--text-tertiary)' : 'var(--blue)', marginTop: 1 }}>
          {notificationIcon(notification)}
        </span>
        <span style={{ minWidth: 0, whiteSpace: 'normal' }}>
          <span style={{ display: 'block', fontWeight: notification.readAt ? 450 : 600, color: 'var(--text)', lineHeight: 1.4 }}>
            {notification.title}
          </span>
          {notification.body && (
            <span style={{ display: 'block', marginTop: 2, fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
              {notification.body}
            </span>
          )}
          <span style={{ display: 'block', marginTop: 4, fontSize: 13, color: 'var(--text-tertiary)' }}>
            {formatRelativeShort(notification.createdAt)}
          </span>
          {notification.link && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                marginTop: 5,
                fontSize: 13,
                fontWeight: 560,
                color: 'var(--blue)',
              }}
            >
              {notification.type === 'share_edit'
                ? t('查看修改')
                : notification.type === 'comment'
                  ? t('查看评论')
                  : notification.type === 'security'
                    ? t('查看安全设置')
                    : t('查看')}
              <ChevronRight size={12} />
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <>
      <Dropdown
        width={320}
        trigger={
          <button type="button" className="sidebar-icon-btn" aria-label={t('通知')} title={t('通知')} style={{ position: 'relative' }}>
            <Bell size={15} />
            {unread > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--sidebar-accent)',
                  boxShadow: '0 0 0 2px var(--sidebar-bg)',
                }}
              />
            )}
          </button>
        }
      >
        {(close) => (
          <div style={{ maxHeight: 430, overflowY: 'auto' }}>
            <div className="menu-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="menu-header-title">{t('通知')}</div>
                <div className="menu-header-sub">{unread > 0 ? t('{n} 条未读', { n: unread }) : t('没有未读通知')}</div>
              </div>
              {unread > 0 && (
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => void markAll()} title={t('全部已读')}>
                  <CheckCheck size={14} />
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="cmdk-empty" style={{ padding: '28px 16px' }}>
                {t('没有通知')}
              </div>
            ) : (
              notifications.slice(0, 20).map((notification) => renderNotification(notification, close))
            )}
            <div className="menu-separator" />
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                close();
                setShowAll(true);
              }}
              style={{ justifyContent: 'space-between' }}
            >
              <span>{t('全部消息')}</span>
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </Dropdown>

      <Modal
        open={showAll}
        onClose={() => setShowAll(false)}
        title={t('全部消息')}
        description={t('所有历史通知与安全消息。')}
        size="lg"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="setting-note">{unread > 0 ? t('{n} 条未读', { n: unread }) : t('没有未读通知')}</span>
          {unread > 0 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void markAll()}>
              <CheckCheck size={13} /> {t('全部已读')}
            </button>
          )}
        </div>
        <div style={{ maxHeight: '56vh', overflowY: 'auto' }}>
          {allLoading ? (
            <div className="loading-row"><span className="spinner" /> {t('加载中…')}</div>
          ) : allNotifications.length === 0 ? (
            <div className="context-empty">{t('没有通知')}</div>
          ) : (
            allNotifications.map((notification) => renderNotification(notification))
          )}
        </div>
        <div className="admin-log-pager">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadAll(Math.max(0, allOffset - 50))} disabled={allLoading || allOffset === 0}>
            {t('上一页')}
          </button>
          <span className="setting-note">{t('第 {page} 页', { page: Math.floor(allOffset / 50) + 1 })}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadAll(allOffset + 50)} disabled={allLoading || allOffset + 50 >= allTotal}>
            {t('下一页')}
          </button>
        </div>
      </Modal>
    </>
  );
}
