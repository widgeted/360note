import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import {
  Archive,
  ArrowRight,
  Bot,
  CloudDownload,
  Download,
  FilePlus2,
  FolderPlus,
  History,
  KeyRound,
  Languages,
  LayoutPanelLeft,
  LogOut,
  Moon,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  Tags,
  Upload,
  Users,
  Wand2,
} from 'lucide-react';
import type { NoteSummary } from '@360note/shared';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { getStoredTheme, storeTheme } from '../lib/theme';
import { useIsMobile } from '../lib/useMediaQuery';
import { formatNoteDate, shortcutLabel } from '../lib/utils';
import { toast } from '../stores/toast';

interface PaletteCommand {
  id: string;
  title: string;
  description?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const open = useAppStore((state) => state.commandOpen);
  const setOpen = useAppStore((state) => state.setCommandOpen);
  const workspaceId = useAppStore((state) => state.workspaceId);
  const note = useAppStore((state) => state.note);
  const storeNotes = useAppStore((state) => state.notes);
  const createNote = useAppStore((state) => state.createNote);
  const setQuery = useAppStore((state) => state.setQuery);
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const instance = useAuthStore((state) => state.instance);
  const isMobile = useIsMobile();
  const setUser = useAuthStore((state) => state.setUser);
  const [query, setQueryValue] = useState('');
  const [results, setResults] = useState<NoteSummary[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQueryValue('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    if (!query.trim()) {
      setResults(storeNotes.slice(0, 7));
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api.get<{ notes: NoteSummary[] }>(
          `/api/search?workspaceId=${workspaceId}&q=${encodeURIComponent(query.trim())}&limit=8`,
        );
        setResults(response.notes);
      } catch {
        setResults(
          storeNotes.filter(
            (entry) =>
              entry.title.toLowerCase().includes(query.toLowerCase()) ||
              entry.excerpt.toLowerCase().includes(query.toLowerCase()),
          ).slice(0, 8),
        );
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open, workspaceId, storeNotes]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  function close() {
    setOpen(false);
  }

  function openNew() {
    close();
    void createNote().then((created) => {
      if (created) navigate(`/app/note/${created.id}`);
    });
  }

  function go(path: string) {
    close();
    const state = path.startsWith('/app/settings')
      ? location.pathname.startsWith('/app/settings')
        ? location.state
        : { from: location.pathname + location.search }
      : undefined;
    navigate(path, state ? { state } : undefined);
  }

  function editorAction(action: string) {
    if (!note) {
      toast('warning', t('请先打开一篇笔记'));
      return;
    }
    close();
    window.dispatchEvent(new CustomEvent('nh:editor-action', { detail: { action } }));
  }

  async function toggleTheme() {
    const current = getStoredTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    storeTheme(next);
    try {
      const response = await api.patch<{ user: typeof user }>('/api/me/prefs', { theme: next });
      if (response.user) setUser(response.user);
    } catch {
      /* local theme still applies */
    }
    close();
    toast('success', next === 'dark' ? t('已切换到深色主题') : t('已切换到浅色主题'));
  }

  const commands: PaletteCommand[] = [
    {
      id: 'new-note',
      title: t('新建笔记'),
      description: shortcutLabel('Mod+N'),
      icon: <FilePlus2 size={15} />,
      keywords: 'new note create',
      run: openNew,
    },
    ...(note
      ? [
          {
            id: 'history',
            title: t('版本历史'),
            description: note.title,
            icon: <History size={15} />,
            keywords: 'history version restore',
            run: () => editorAction('history'),
          },
          {
            id: 'share',
            title: t('分享当前笔记'),
            description: note.title,
            icon: <Share2 size={15} />,
            keywords: 'share link publish',
            run: () => editorAction('share'),
          },
          ...(instance?.aiEnabled ? [{
            id: 'summary',
            title: t('生成摘要'),
            description: note.title,
            icon: <Sparkles size={15} />,
            keywords: 'summary ai',
            run: () => editorAction('summary'),
          }] : []),
          {
            id: 'export-note',
            title: t('导出当前笔记'),
            description: t('Markdown / HTML / PDF'),
            icon: <Download size={15} />,
            keywords: 'export download markdown html pdf',
            run: () => editorAction('export'),
          },
        ]
      : []),
    {
      id: 'settings-data',
      title: t('备份与恢复'),
      description: t('自动备份、上传备份、恢复预览'),
      icon: <CloudDownload size={15} />,
      keywords: 'backup restore data',
      run: () => go('/app/settings/data'),
    },
    {
      id: 'settings-export',
      title: t('全库导出'),
      description: t('Markdown + 附件 / HTML / JSON'),
      icon: <Download size={15} />,
      keywords: 'export all workspace markdown',
      run: () => go('/app/settings/data'),
    },
    {
      id: 'settings-import',
      title: t('导入笔记'),
      description: t('Markdown / Evernote / Notion / CSV'),
      icon: <Upload size={15} />,
      keywords: 'import evernote notion csv markdown',
      run: () => go('/app/settings/data?import=1'),
    },
    {
      id: 'settings-security',
      title: t('安全与登录设备'),
      description: t('两步验证、会话、恢复密钥'),
      icon: <ShieldCheck size={15} />,
      keywords: 'security 2fa totp sessions recovery key',
      run: () => go('/app/settings/security'),
    },
    {
      id: 'settings-ai',
      title: t('AI 与隐私'),
      description: t('数据是否用于训练、AI 开关'),
      icon: <Bot size={15} />,
      keywords: 'ai privacy training',
      run: () => go('/app/settings/ai'),
    },
    {
      id: 'settings-api',
      title: t('API 令牌与集成'),
      description: t('外部调用、网页剪藏'),
      icon: <KeyRound size={15} />,
      keywords: 'api token webhook clipper',
      run: () => go('/app/settings/api'),
    },
    {
      id: 'settings-team',
      title: t('团队与空间'),
      description: t('成员、角色、审计日志'),
      icon: <Users size={15} />,
      keywords: 'team members roles audit',
      run: () => go('/app/settings/team'),
    },
    {
      id: 'settings-appearance',
      title: t('外观与语言'),
      description: t('主题、字体、编辑器宽度'),
      icon: <Languages size={15} />,
      keywords: 'appearance theme language font',
      run: () => go('/app/settings/appearance'),
    },
    {
      id: 'settings-editor',
      title: t('编辑器与快捷键'),
      description: t('Markdown、拼写检查、默认格式'),
      icon: <LayoutPanelLeft size={15} />,
      keywords: 'editor markdown spellcheck shortcuts',
      run: () => go('/app/settings/editor'),
    },
    {
      id: 'theme',
      title: t('切换明暗主题'),
      description: getStoredTheme() === 'dark' ? t('当前：深色') : t('当前：浅色'),
      icon: getStoredTheme() === 'dark' ? <Sun size={15} /> : <Moon size={15} />,
      keywords: 'theme dark light mode',
      run: () => void toggleTheme(),
    },
    {
      id: 'trash',
      title: t('打开回收站'),
      description: t('恢复或永久删除'),
      icon: <Archive size={15} />,
      keywords: 'trash recycle restore delete',
      run: () => {
        close();
        void useAppStore.getState().setFilter('trash');
        navigate('/app');
      },
    },
    {
      id: 'templates',
      title: t('从模板创建'),
      description: t('内置模板与自定义模板'),
      icon: <Wand2 size={15} />,
      keywords: 'template meeting daily project',
      run: () => {
        close();
        window.dispatchEvent(new CustomEvent('nh:open-templates'));
      },
    },
    {
      id: 'focus',
      title: t('聚焦模式'),
      description: t('专注写作，隐藏其他一切'),
      icon: <LayoutPanelLeft size={15} />,
      keywords: 'focus zen writing',
      run: () => editorAction('focus'),
    },
    {
      id: 'logout',
      title: t('退出登录'),
      description: user?.email,
      icon: <LogOut size={15} />,
      keywords: 'logout sign out',
      run: async () => {
        close();
        await logout();
        navigate('/login');
      },
    },
  ];

  const filteredCommands = commands.filter((command) => {
    if (isMobile && command.id === 'focus') return false;
    if (!query.trim()) return true;
    const haystack = `${command.title} ${command.description ?? ''} ${command.keywords ?? ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return createPortal(
    <div
      className="cmdk-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <Command className="cmdk" label={t('命令面板')} loop shouldFilter={false}>
        <div className="cmdk-input-row">
          <Search size={16} />
          <Command.Input
            className="cmdk-input"
            value={query}
            onValueChange={setQueryValue}
            placeholder={t('搜索笔记、跳转或输入功能名称…')}
            autoFocus
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>
        <Command.List className="cmdk-list">
          <Command.Empty className="cmdk-empty">
            {searching ? t('搜索中…') : t('没有匹配结果')}
          </Command.Empty>
          {(results.length > 0 || query.trim()) && (
            <Command.Group heading={t('笔记')}>
              {results.map((entry) => (
                <Command.Item
                  key={entry.id}
                  className="cmdk-item"
                  value={`${entry.title} ${entry.excerpt}`}
                  onSelect={() => {
                    close();
                    navigate(`/app/note/${entry.id}`);
                  }}
                >
                  <span className="cmdk-item-icon"><FilePlus2 size={14} /></span>
                  <span className="cmdk-item-body">
                    <span className="cmdk-item-title">{entry.title}</span>
                    <span className="cmdk-item-sub">{entry.excerpt || t('无标题')}</span>
                  </span>
                  <span className="cmdk-item-detail">{formatNoteDate(entry.updatedAt)}</span>
                  <ArrowRight size={12} style={{ color: 'var(--text-tertiary)' }} />
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading={t('命令')}>
            {filteredCommands.map((command) => (
              <Command.Item
                key={command.id}
                className="cmdk-item"
                value={`${command.title} ${command.description ?? ''} ${command.keywords ?? ''}`}
                onSelect={command.run}
              >
                <span className="cmdk-item-icon">{command.icon}</span>
                <span className="cmdk-item-body">
                  <span className="cmdk-item-title">{command.title}</span>
                  {command.description && <span className="cmdk-item-sub">{command.description}</span>}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('选择')}</span>
          <span><kbd>↵</kbd> {t('打开')}</span>
          <span style={{ marginLeft: 'auto' }}><Tags size={11} /> {t('搜索标题、正文、标签')}</span>
        </div>
      </Command>
    </div>,
    document.body,
  );
}
