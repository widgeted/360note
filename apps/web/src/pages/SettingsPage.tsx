import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  CloudDownload,
  Code2,
  Keyboard,
  LayoutTemplate,
  MessageCircle,
  Palette,
  ServerCog,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { useT } from '../lib/i18n';
import { useScrollFade } from '../lib/useScrollFade';
import { cn } from '../lib/utils';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import AccountSettings from '../components/settings/AccountSettings';
import AppearanceSettings from '../components/settings/AppearanceSettings';
import EditorSettings from '../components/settings/EditorSettings';
import SecuritySettings from '../components/settings/SecuritySettings';
import DataSettings from '../components/settings/DataSettings';
import CommentSettings from '../components/settings/CommentSettings';
import TemplateSettings from '../components/settings/TemplateSettings';
import TeamSettings from '../components/settings/TeamSettings';
import ApiSettings from '../components/settings/ApiSettings';
import AiSettings from '../components/settings/AiSettings';
import AboutSettings from '../components/settings/AboutSettings';
import AdminSettings from '../components/settings/AdminSettings';
import { ArrowLeft } from 'lucide-react';

const SECTIONS = [
  { id: 'account', icon: UserRound, label: '账户', group: '个人' },
  { id: 'appearance', icon: Palette, label: '外观与语言', group: '个人' },
  { id: 'editor', icon: Keyboard, label: '编辑器', group: '个人' },
  { id: 'security', icon: ShieldCheck, label: '安全', group: '个人' },
  { id: 'data', icon: CloudDownload, label: '数据与备份', group: '数据' },
  { id: 'comments', icon: MessageCircle, label: '评论管理', group: '数据' },
  { id: 'templates', icon: LayoutTemplate, label: '模板', group: '数据' },
  { id: 'team', icon: Users, label: '空间', group: '数据' },
  { id: 'api', icon: Code2, label: 'API 与集成', group: '数据' },
  { id: 'ai', icon: Bot, label: 'AI 与隐私', group: '高级' },
  { id: 'about', icon: null, label: '关于', group: '高级' },
  { id: 'admin', icon: ServerCog, label: '实例管理', group: '高级', adminOnly: true },
] as const;

export default function SettingsPage({ section }: { section: string }) {
  const t = useT();
  const navFade = useScrollFade<HTMLElement>();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const workspaceId = useAppStore((state) => state.workspaceId);
  const workspace = useAuthStore((state) => state.workspaces.find((entry) => entry.id === workspaceId));
  const visibleSections = SECTIONS.filter((entry) => !('adminOnly' in entry) || !entry.adminOnly || user?.role === 'admin');
  const current = visibleSections.some((entry) => entry.id === section) ? section : 'account';
  const sectionLabel = SECTIONS.find((entry) => entry.id === current)?.label ?? '设置';
  useDocumentTitle(t(sectionLabel));

  useEffect(() => {
    const nav = navFade.ref.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    const active = nav.querySelector<HTMLElement>('.settings-nav-item.active');
    if (!active) return;
    const navRect = nav.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    const target = nav.scrollLeft + itemRect.left - navRect.left - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, Math.min(target, nav.scrollWidth - nav.clientWidth)), behavior: 'smooth' });
  }, [current, navFade.ref]);

  const groups = ['个人', '数据', '高级'];
  const from = (location.state as { from?: unknown } | null)?.from;
  const backTarget =
    typeof from === 'string' && from.startsWith('/app') && !from.startsWith('/app/settings')
      ? from
      : '/app';

  return (
    <div className="page-shell">
      <header className="page-topbar">
        <button type="button" className="icon-btn mobile-back-btn" onClick={() => navigate(backTarget)} aria-label={t('返回笔记')}>
          <ArrowLeft size={17} />
        </button>
        <h1>{t('设置')}</h1>
        <span className="page-topbar-context">
          {workspace?.name ?? user?.displayName}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost btn-sm hide-mobile" onClick={() => navigate(backTarget)}>
          {t('返回笔记')}
        </button>
      </header>
      <div className="settings-layout">
        <nav ref={navFade.ref} className={cn('settings-nav', navFade.className)} aria-label={t('设置')}>
          {groups.map((group) => (
            <div className="settings-nav-group" key={group}>
              <div className="settings-nav-label">{t(group)}</div>
              {visibleSections.filter((entry) => entry.group === group).map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={cn('settings-nav-item', current === entry.id && 'active')}
                    onClick={() => navigate(`/app/settings/${entry.id}`, { state: location.state })}
                  >
                    {Icon ? <Icon size={14} /> : <span style={{ width: 14, display: 'grid', placeItems: 'center', fontSize: 13 }}>ⓘ</span>}
                    {t(entry.label)}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="settings-content app-scroll">
          <div className="settings-inner">
            {current === 'account' && <AccountSettings />}
            {current === 'appearance' && <AppearanceSettings />}
            {current === 'editor' && <EditorSettings />}
            {current === 'security' && <SecuritySettings />}
            {current === 'data' && <DataSettings />}
            {current === 'comments' && <CommentSettings />}
            {current === 'templates' && <TemplateSettings />}
            {current === 'team' && <TeamSettings />}
            {current === 'api' && <ApiSettings />}
            {current === 'ai' && <AiSettings />}
            {current === 'about' && <AboutSettings />}
            {current === 'admin' && user?.role === 'admin' && <AdminSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}
