import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight, MessageCircle, PencilLine, ShieldAlert, UserPlus } from 'lucide-react';
import type { Notification } from '@360note/shared';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { formatRelativeShort } from '../lib/utils';
import { Dropdown } from './Dropdown';

export function NotificationCenter() {
  const t = useT();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    try {
      const response = await api.get<{ notifications: Notification[]; unread: number }>('/api/notifications');
      setNotifications(response.notifications);
      setUnread(response.unread);
    } catch {
      /* silent */
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  async function markAll() {
    await api.post('/api/notifications/read-all').catch(() => {});
    setUnread(0);
    setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
  }

  function open(notification: Notification) {
    void api.post(`/api/notifications/${notification.id}/read`).catch(() => {});
    setUnread((value) => Math.max(0, value - (notification.readAt ? 0 : 1)));
    setNotifications((items) =>
      items.map((item) => (item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item)),
    );
    if (notification.link) {
      let link = notification.link;
      // Older notifications were stored before deep links existed. Infer the
      // relevant panel so historical notifications stay actionable too.
      if (!/[?&]panel=/.test(link)) {
        if (notification.type === 'comment') link += `${link.includes('?') ? '&' : '?'}panel=comments`;
        if (notification.type === 'share_edit') link += `${link.includes('?') ? '&' : '?'}panel=history&preview=latest`;
      }
      if (link.startsWith('/settings/')) link = `/app${link}`;
      navigate(link);
    }
  }

  return (
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
              <button type="button" className="icon-btn icon-btn-sm" onClick={markAll} title={t('全部已读')}>
                <CheckCheck size={14} />
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="cmdk-empty" style={{ padding: '28px 16px' }}>
              {t('没有通知')}
            </div>
          ) : (
            notifications.slice(0, 20).map((notification) => (
              <button
                key={notification.id}
                type="button"
                className="menu-item"
                onClick={() => {
                  open(notification);
                  close();
                }}
                style={{ alignItems: 'flex-start', paddingTop: 8, paddingBottom: 8 }}
              >
                <span style={{ color: notification.readAt ? 'var(--text-tertiary)' : 'var(--blue)', marginTop: 1 }}>
                  {notification.type === 'security' ? (
                    <ShieldAlert size={15} />
                  ) : notification.type === 'invitation' ? (
                    <UserPlus size={15} />
                  ) : notification.type === 'share_edit' ? (
                    <PencilLine size={15} />
                  ) : (
                    <MessageCircle size={15} />
                  )}
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
            ))
          )}
        </div>
      )}
    </Dropdown>
  );
}
