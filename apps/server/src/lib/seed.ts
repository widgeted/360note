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
          title: `欢迎来到 360笔记，${displayName}`,
          tags: ['开始'],
          content: `# 欢迎，${displayName}

360笔记是一个安静、快速、属于你的笔记空间。它把**记录**、**整理**、**搜索**和**分享**放在同一条路径上，而不是让你先学习一套复杂的系统。

## 从三个动作开始

1. **写下来。** 按 \`⌘/Ctrl + N\` 新建笔记，或点左上角的 **+**。内容会自动保存。
2. **找回来。** 按 \`⌘/Ctrl + K\`，输入标题、正文、标签或附件名。搜索会同时查找这些地方。
3. **放心用。** 右下角会显示保存与同步状态。离线时继续写，联网后自动同步；出现冲突时保留两份，不静默覆盖。

## Markdown 速查

正文以 **Markdown** 为底层格式，同时提供所见即所得的编辑体验。你可以随时切换到 Markdown 源码模式。

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

## 整理与连接

- 用**文件夹**搭结构，用**标签**做横向关联；
- 输入 \`[[笔记标题]]\` 创建双向链接，右侧「信息」面板会显示反向链接；
- 收藏或置顶重要内容；
- 在笔记的「…」菜单中可以查看历史版本、导出、分享或移动。

## 分享与导出

- **分享**：生成只读、可评论或可编辑的链接，可设置密码与过期时间；
- **导出**：单篇导出 Markdown、HTML 或 PDF，整个空间导出为 Markdown + 附件、HTML 或 JSON；
- **备份**：自动/手动备份与恢复预览，备份包含附件，且与同步相互独立。

## 快捷键

- \`⌘/Ctrl + K\` 命令面板与搜索
- \`⌘/Ctrl + N\` 新建笔记
- \`⌘/Ctrl + S\` 立即保存
- \`⌘/Ctrl + \\\` 收起/展开侧栏
- \`⌘/Ctrl + J\` 打开右侧信息面板
- \`/\` 在正文中插入内容块

> 安全说明：全站使用 TLS，附件在服务器上加密存放。你可以在「设置 → 安全」中开启两步验证、查看登录设备并保存恢复密钥。我们不会发送营销邮件，也不会用你的笔记训练 AI。

现在，试着把第一个想法写下来吧。`,
        },
      ],
    };
  }

  return {
    folder: 'Getting started',
    notes: [
      {
        title: `Welcome to 360note, ${displayName}`,
        tags: ['start'],
        content: `# Welcome, ${displayName}

360note is a calm, fast notebook that is genuinely yours. It puts **capture**, **organization**, **search** and **sharing** on one path — without asking you to learn a system first.

## Start with three actions

1. **Write.** Press \`⌘/Ctrl + N\` or the **+** button. Everything autosaves.
2. **Find.** Press \`⌘/Ctrl + K\` and search titles, body text, tags or attachment names.
3. **Relax.** Save and sync status sit in the bottom-right corner. Keep writing offline; changes sync when you reconnect. Conflicts keep both copies.

## Markdown at a glance

Your writing is stored as **Markdown** while the editor shows a visual view. Switch to Markdown source whenever you like.

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

## Organize and connect

- Use **folders** for structure and **tags** for connections;
- Type \`[[a note title]]\` to create a two-way link; backlinks appear in the Info panel;
- Favorite or pin what matters;
- Open a note's **…** menu for version history, export, sharing or moving.

## Share and export

- **Share**: create read-only, comment or edit links with optional password and expiry;
- **Export**: one note as Markdown, HTML or PDF; a whole workspace as Markdown + attachments, HTML or JSON;
- **Back up**: automatic and manual backups with restore previews. Backups include attachments and are independent of sync.

## Shortcuts

- \`⌘/Ctrl + K\` command palette and search
- \`⌘/Ctrl + N\` new note
- \`⌘/Ctrl + S\` save now
- \`⌘/Ctrl + \\\` toggle sidebar
- \`⌘/Ctrl + J\` toggle the Info panel
- \`/\` insert menu in the editor

> Security: TLS everywhere. Attachments are encrypted at rest. In Settings → Security you can enable two-factor authentication, review signed-in devices, and save your recovery key. We do not send marketing email and do not use your notes to train AI.

Now write down the first idea that comes to mind.`,
      },
    ],
  };
}

export const seedMeta = {
  product: '360note',
  version: config.version,
};
