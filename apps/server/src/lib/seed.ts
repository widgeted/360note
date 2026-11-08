import { config } from '../config.js';

const icons = ['#17865b', '#7c5cff', '#0f9d76', '#d97706', '#dc3d5d', '#0e7490', '#9333ea'];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return icons[hash % icons.length];
}

export interface SeedNote {
  title: string;
  content: string;
  tags?: string[];
}

export function welcomeSeed(locale: string, displayName: string): { folder: string; notes: SeedNote[] } {
  if (locale.toLowerCase().startsWith('zh')) {
    return {
      folder: '开始使用',
      notes: [
        {
          title: '欢迎来到 360note',
          tags: ['开始'],
          content: `# 欢迎，${displayName}

360note 是一个安静、快速、属于你的笔记空间。它把**记录**、**整理**和**分享**放在同一条路径上，而不是让你先学习一套复杂的系统。

## 从三个动作开始

1. **写下来。** 按 \`⌘/Ctrl + N\` 新建笔记，或点左上角的 **+**。内容会自动保存。
2. **找回来。** 按 \`⌘/Ctrl + K\`，输入标题、正文、标签或附件名。搜索会同时查找这些地方。
3. **放心用。** 左下角会显示保存与同步状态。离线时继续写，联网后会自动同步；出现冲突时保留两份，不静默覆盖。

## 你可以这样整理

- 用**文件夹**搭结构，用**标签**做横向关联；
- 用 \`[[双向链接]]\` 连接思想，右侧「信息」面板会显示反向链接；
- 收藏或置顶重要内容；
- 在笔记的「…」菜单中查看**历史版本**、导出、分享或移动。

> 提示：输入 \`/\` 打开插入菜单；输入 \`#\` 创建标题；把图片直接拖进编辑器即可上传。

## 关于安全

传输全程使用 TLS。附件在服务器上加密存放。你可以在「设置 → 安全」中开启两步验证、查看登录设备，并保存恢复密钥。我们不会向你发送营销邮件，也不会把笔记内容用于训练 AI。

现在，试着把第一个想法写下来吧。`,
        },
        {
          title: 'Markdown 与排版速查',
          tags: ['开始', '参考'],
          content: `# Markdown 与排版速查

360note 的正文以 **Markdown** 为底层格式，同时提供所见即所得的编辑体验。你可以随时切换到 Markdown 源码模式。

## 常用语法

| 想要 | 输入 |
| --- | --- |
| 标题 | \`# 一级标题\` 到 \`###### 六级标题\` |
| 加粗 / 斜体 | \`**加粗**\` / \`*斜体*\` |
| 删除线 | \`~~删除~~\` |
| 行内代码 | \`code\` |
| 链接 | \`[文字](https://example.com)\` |
| 图片 | 直接拖入或粘贴 |
| 任务 | \`- [x] 已完成\` |
| 引用 | \`> 引用\` |
| 表格 | 用工具栏的表格按钮 |

## 双向链接

输入 \`[[欢迎来到 360note]]\` 就能链接到另一篇笔记。修改笔记标题时，360note 会尽量同步更新这些链接。

## 分享与导出

在笔记右上角「…」中：
- **分享**：生成只读、可评论或可编辑的链接，可设置密码与过期时间；
- **导出**：Markdown、HTML 或 PDF；
- **版本历史**：查看过去的内容并恢复。

## 快捷键

- \`⌘/Ctrl + K\` 命令面板与搜索
- \`⌘/Ctrl + N\` 新建笔记
- \`⌘/Ctrl + S\` 立即保存
- ⌘/Ctrl + \\ 收起/展开侧栏
- \`⌘/Ctrl + J\` 打开右侧信息面板
- \`/\` 在正文中插入内容块`,
        },
        {
          title: '关于 360note 的设计',
          tags: ['开始'],
          content: `# 关于 360note 的设计

我们参考了 Trilium、Joplin、Standard Notes、SilverBullet、Memos、Blinko、Flatnotes、NoteDiscovery 与 Livebook 的经验，但没有把它们的界面拼在一起。

## 三条原则

**一屏一个主任务。** 写作时，管理操作退到后台；管理时，编辑控件让位。主界面只保留新建、搜索、笔记列表、编辑器和保存状态。

**默认简单，渐进披露。** 新用户只需要学会三件事：记录、搜索、看到同步状态。分享、版本、导出放在选中笔记后的上下文里；备份、恢复、加密、2FA 放在设置里，同时都能通过命令面板找到。

**数据是你的。** 正文是 Markdown，附件可以单独下载，全库可以导出为可重建的 Markdown + 附件目录。备份与同步是两件不同的事：同步会传播误删，备份不会。

## 不做什么

- 不把每一篇笔记都变成一张数据库表；
- 不在主界面堆叠徽章、进度条和统计；
- 不弹窗推销 AI，不把内容默认发送给模型；
- 不用专有格式锁住你的内容。

## 接下来

左侧栏的「设置」里有主题、编辑器、安全、数据与团队。遇到低频但重要的操作，试试 \`⌘/Ctrl + K\` 搜索功能名。`,
        },
      ],
    };
  }

  return {
    folder: 'Getting started',
    notes: [
      {
        title: 'Welcome to 360note',
        tags: ['start'],
        content: `# Welcome, ${displayName}

360note is a calm, fast notebook that is genuinely yours. Capture, shape, and share in one place — without learning a system first.

## Start with three actions

1. **Write.** Press \`⌘/Ctrl + N\` or the **+** button. Everything autosaves.
2. **Find.** Press \`⌘/Ctrl + K\` and search titles, body text, tags or attachment names.
3. **Relax.** The bottom-left corner shows save and sync status. Keep writing offline; changes sync when you reconnect. Conflicts keep both copies.

## Organize your way

- Use **folders** for structure and **tags** for connections;
- Type \`[[a note title]]\` to create a two-way link; see backlinks in the Info panel;
- Favorite or pin what matters;
- Open a note's **…** menu for version history, export, sharing or moving.

> Tip: type \`/\` for the insert menu, \`#\` for headings, or drag an image into the editor.

## Security without surprises

TLS everywhere. Attachments are encrypted at rest. In Settings → Security you can enable two-factor authentication, review signed-in devices, and save your recovery key. We do not send marketing email and do not use your notes to train AI.

Now write down the first idea that comes to mind.`,
      },
      {
        title: 'Markdown & formatting cheatsheet',
        tags: ['start', 'reference'],
        content: `# Markdown & formatting cheatsheet

360note stores your writing as **Markdown** while giving you a visual editor. Switch to Markdown source whenever you like.

## The basics

| Want | Type |
| --- | --- |
| Heading | \`# H1\` through \`###### H6\` |
| Bold / italic | \`**bold**\` / \`*italic*\` |
| Strikethrough | \`~~gone~~\` |
| Inline code | \`code\` |
| Link | \`[label](https://example.com)\` |
| Image | drag and drop or paste |
| Task | \`- [x] done\` |
| Quote | \`> quote\` |

## Wiki links

Type \`[[Welcome to 360note]]\` to link another note. 360note keeps backlinks up to date and updates links when you rename a note.

## Share and export

From the **…** menu:
- **Share**: create read-only, comment or edit links with optional password and expiry;
- **Export**: Markdown, HTML or PDF;
- **History**: preview and restore earlier versions.

## Shortcuts

- \`⌘/Ctrl + K\` command palette and search
- \`⌘/Ctrl + N\` new note
- \`⌘/Ctrl + S\` save now
- ⌘/Ctrl + \\ toggle sidebar
- \`⌘/Ctrl + J\` toggle the Info panel
- \`/\` insert menu in the editor`,
      },
    ],
  };
}

export const seedMeta = {
  product: '360note',
  version: config.version,
};
