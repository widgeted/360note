#!/usr/bin/env node
/**
 * Provision the instance administrator and a public demo account, then seed a
 * realistic bilingual demo workspace through the normal HTTP API.
 *
 * Required environment:
 *   DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_EMAIL, DEMO_PASSWORD
 * Optional:
 *   BASE_URL (default http://127.0.0.1:8787)
 *
 * This script never sends email. It must be run on the server, from /opt/360note.
 */
import pg from 'pg';
import { hashPassword } from '../apps/server/dist/lib/passwords.js';
import { generateRecoveryKey, hashRecoveryKey } from '../apps/server/dist/lib/crypto.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEMO_EMAIL = process.env.DEMO_EMAIL;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (!process.env.DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD || !DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error('DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_EMAIL and DEMO_PASSWORD are required.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

async function upsertUser({ email, password, displayName, role, locale = 'zh-CN' }) {
  const existing = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [email]);
  if (existing.rows[0]) {
    if (role === 'admin' && existing.rows[0].role !== 'admin') {
      await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [existing.rows[0].id]);
      existing.rows[0].role = 'admin';
    }
    return { user: existing.rows[0], recoveryKey: null, created: false };
  }
  const passwordHash = await hashPassword(password);
  const recoveryKey = generateRecoveryKey();
  const result = await pool.query(
    `INSERT INTO users (email, display_name, password_hash, role, avatar_color, recovery_key_hash, email_verified_at, prefs)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7::jsonb) RETURNING *`,
    [email, displayName, passwordHash, role, role === 'admin' ? '#17865b' : '#0f766e', hashRecoveryKey(recoveryKey), JSON.stringify({ locale })],
  );
  const user = result.rows[0];
  await pool.query(
    `INSERT INTO workspaces (name, kind, icon, color, owner_id)
     VALUES ($1, 'personal', $2, $3, $4) RETURNING id`,
    [role === 'admin' ? '我的空间 / My space' : '示例空间 / Demo', role === 'admin' ? '📔' : '🧭', role === 'admin' ? '#17865b' : '#0f766e', user.id],
  ).then(async (workspace) => {
    await pool.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      workspace.rows[0].id,
      user.id,
    ]);
  });
  return { user, recoveryKey, created: true };
}

async function login(email, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-360note-csrf': '1' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`login ${email} failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

function api(cookie) {
  async function request(path, options = {}) {
    const headers = {
      cookie,
      'x-360note-csrf': '1',
      'x-forwarded-host': '360note.com',
      'x-forwarded-proto': 'https',
      ...(options.headers ?? {}),
    };
    let body = options.body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(`${BASE}${path}`, { method: options.method ?? 'GET', headers, body });
    if (!response.ok) {
      throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${await response.text()}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }
  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    delete: (path) => request(path, { method: 'DELETE' }),
    upload: (path, buffer, filename, type) => {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type }), filename);
      return request(path, { method: 'POST', body: form });
    },
  };
}

async function ensureWorkspace(client, { name, kind, icon, color }) {
  const data = await client.get('/api/workspaces');
  const existing = data.workspaces.find((workspace) => workspace.name === name && workspace.kind === kind);
  if (existing) return existing;
  const created = await client.post('/api/workspaces', { name, kind, icon, color });
  return created.workspace;
}

async function ensureFolder(client, workspaceId, name, parentId = null) {
  const data = await client.get(`/api/folders?workspaceId=${workspaceId}`);
  const existing = data.folders.find((folder) => folder.name === name && (folder.parentId ?? null) === parentId);
  if (existing) return existing;
  const created = await client.post('/api/folders', { workspaceId, name, parentId });
  return created.folder;
}

async function ensureNote(client, workspaceId, title, contentMd, { folderId, tagNames, isFavorite, isPinned } = {}) {
  const created = await client.post('/api/notes', { workspaceId, title, contentMd, folderId, tagNames });
  if (isFavorite || isPinned) {
    await client.patch(`/api/notes/${created.note.id}`, { isFavorite: Boolean(isFavorite), isPinned: Boolean(isPinned) });
  }
  return created.note;
}

function makeRoadmapSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640">
  <rect width="1200" height="640" fill="#f6f4ef"/>
  <text x="72" y="92" font-family="Inter, sans-serif" font-size="34" font-weight="700" fill="#181a1f">360note roadmap · 2026</text>
  <text x="72" y="126" font-family="Inter, sans-serif" font-size="18" fill="#6b6a66">Capture → organize → share → back up</text>
  <g font-family="Inter, sans-serif">
    <rect x="72" y="180" width="250" height="360" rx="18" fill="#ffffff" stroke="#e4dfd4"/>
    <rect x="346" y="180" width="250" height="360" rx="18" fill="#ffffff" stroke="#e4dfd4"/>
    <rect x="620" y="180" width="250" height="360" rx="18" fill="#ffffff" stroke="#e4dfd4"/>
    <rect x="894" y="180" width="234" height="360" rx="18" fill="#ffffff" stroke="#e4dfd4"/>
    <text x="96" y="222" font-size="17" font-weight="700" fill="#17865b">Q1 · Foundation</text>
    <text x="370" y="222" font-size="17" font-weight="700" fill="#17865b">Q2 · Collaboration</text>
    <text x="644" y="222" font-size="17" font-weight="700" fill="#17865b">Q3 · Portability</text>
    <text x="918" y="222" font-size="17" font-weight="700" fill="#17865b">Q4 · Scale</text>
    <g font-size="15" fill="#4c4a44">
      <text x="96" y="266">Autosave + drafts</text><text x="96" y="298">Markdown source</text><text x="96" y="330">Full-text search</text>
      <text x="370" y="266">Roles + invitations</text><text x="370" y="298">Audit log</text><text x="370" y="330">Shared comments</text>
      <text x="644" y="266">Markdown + HTML</text><text x="644" y="298">PDF export</text><text x="644" y="330">Encrypted backup</text>
      <text x="918" y="266">Offsite S3</text><text x="918" y="298">PWA offline</text><text x="918" y="330">API tokens</text>
    </g>
    <rect x="96" y="380" width="202" height="10" rx="5" fill="#e5f4ec"/><rect x="96" y="380" width="168" height="10" rx="5" fill="#17865b"/>
    <rect x="370" y="380" width="202" height="10" rx="5" fill="#e5f4ec"/><rect x="370" y="380" width="124" height="10" rx="5" fill="#17865b"/>
    <rect x="644" y="380" width="202" height="10" rx="5" fill="#e5f4ec"/><rect x="644" y="380" width="84" height="10" rx="5" fill="#17865b"/>
    <rect x="918" y="380" width="186" height="10" rx="5" fill="#e5f4ec"/><rect x="918" y="380" width="52" height="10" rx="5" fill="#17865b"/>
  </g>
</svg>`;
}

function makePdf() {
  return Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 160>>stream
BT /F1 20 Tf 60 760 Td (360note release brief) Tj /F1 12 Tf 0 -32 Td (Demo attachment: PDF export and attachment preview.) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`, 'utf8');
}

function makeCsv() {
  return Buffer.from(
    'phase,owner,status,notes\nFoundation,demo,done,Autosave and search\nCollaboration,demo,in progress,Roles and audit\nPortability,demo,planned,Export and backup\n',
    'utf8',
  );
}

async function addAttachments(client, noteId) {
  const image = await client.upload(`/api/notes/${noteId}/attachments`, Buffer.from(makeRoadmapSvg()), 'roadmap-2026.svg', 'image/svg+xml');
  const pdf = await client.upload(`/api/notes/${noteId}/attachments`, makePdf(), 'release-brief.pdf', 'application/pdf');
  const csv = await client.upload(`/api/notes/${noteId}/attachments`, makeCsv(), 'roadmap.csv', 'text/csv');
  return { image: image.attachment, pdf: pdf.attachment, csv: csv.attachment };
}

async function main() {
  const admin = await upsertUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, displayName: '360note 管理员', role: 'admin', locale: 'zh-CN' });
  const demo = await upsertUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: 'Demo 用户', role: 'user', locale: 'en' });

  const adminClient = api(await login(ADMIN_EMAIL, ADMIN_PASSWORD));
  const demoClient = api(await login(DEMO_EMAIL, DEMO_PASSWORD));

  const adminWorkspaces = await adminClient.get('/api/workspaces');
  const adminSpace = adminWorkspaces.workspaces.find((workspace) => workspace.kind === 'personal');
  const demoSpaces = await demoClient.get('/api/workspaces');
  let demoSpace = demoSpaces.workspaces.find((workspace) => workspace.kind === 'personal');
  if (!demoSpace) throw new Error('demo personal workspace missing');

  // A useful first note for the administrator.
  const adminNotes = await adminClient.get(`/api/notes?workspaceId=${adminSpace.id}&limit=1`);
  if (!adminNotes.notes?.length) {
    await ensureNote(adminClient, adminSpace.id, '管理员使用说明', `# 管理员使用说明

你的账户是这个实例的管理员。日常使用与其他账户一致，额外的能力集中在 **设置 → 实例管理**。

## 建议先完成

- 在 **设置 → 安全** 中开启两步验证，并保存恢复密钥。
- 在 **设置 → 数据与备份** 中创建第一份备份，并下载到独立位置。
- 检查 **实例管理** 中的注册模式、备份保留天数与审计日志。
- 如果需要发送系统邮件，确认服务器上的 SMTP 配置可用。

> 管理员不能绕过笔记的权限控制。团队空间中的角色与普通成员一样生效。
`, { tagNames: ['管理员 / Admin', '入门 / Start'] });
  }

  const marker = await demoClient.get(`/api/notes?workspaceId=${demoSpace.id}&limit=100`);
  if (marker.notes?.some((note) => note.title === '欢迎来到 360笔记')) {
    console.log(JSON.stringify({ admin: { email: ADMIN_EMAIL, created: admin.created, recoveryKey: admin.recoveryKey }, demo: { email: DEMO_EMAIL, created: demo.created, recoveryKey: demo.recoveryKey }, seeded: false }, null, 2));
    await pool.end();
    return;
  }

  const folderStart = await ensureFolder(demoClient, demoSpace.id, '开始使用 / Getting started');
  const folderProduct = await ensureFolder(demoClient, demoSpace.id, '产品与设计 / Product');
  const folderMeetings = await ensureFolder(demoClient, demoSpace.id, '会议记录 / Meetings');
  const folderReading = await ensureFolder(demoClient, demoSpace.id, '阅读笔记 / Reading');
  const folderTemplates = await ensureFolder(demoClient, demoSpace.id, '模板 / Templates');
  await ensureFolder(demoClient, demoSpace.id, '发布检查 / Release checks', folderProduct.id);

  const team = await ensureWorkspace(demoClient, { name: '产品团队 / Product team', kind: 'team', icon: '👥', color: '#0f766e' });
  const teamFolder = await ensureFolder(demoClient, team.id, '项目 Alpha / Project Alpha');
  const teamRelease = await ensureFolder(demoClient, team.id, '发布计划 / Releases');

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [team.id, admin.user.id],
  );

  const welcome = await ensureNote(demoClient, demoSpace.id, '欢迎来到 360笔记', `# 欢迎来到 360笔记

这是一个**真实可用的示例账户**。它展示了 360笔记 的主要功能：Markdown 与富文本、文件夹、标签、搜索、分享、附件、版本历史与团队空间。

## 从三个动作开始

1. **写下来。** 按 \`⌘/Ctrl + N\` 新建笔记，内容会自动保存。
2. **找回来。** 按 \`⌘/Ctrl + K\` 搜索标题、正文、标签或附件名。
3. **带得走。** 在 **设置 → 数据与备份** 中导出 Markdown、HTML、JSON 或 PDF。

> 提示：输入 \`/\` 打开插入菜单；输入 \`#\` 创建标题；工具栏可以上传图片与附件。

## 功能清单

- [x] Markdown 与富文本编辑
- [x] 文件夹、标签、收藏与置顶
- [x] 全文搜索与双向链接
- [x] 图片与附件
- [x] 分享链接与评论
- [x] 版本历史与备份
- [ ] 写下你自己的第一条笔记

## 双向链接

试试打开 [[Markdown 与排版速查]]，右侧信息面板会显示反向链接。

## 一个小表格

| 能力 | 说明 | 状态 |
| --- | --- | --- |
| 自动保存 | 停止输入后自动保存 | 已启用 |
| 离线编辑 | 断网后继续写 | 已启用 |
| 导出 | Markdown / HTML / PDF / JSON | 已启用 |

![产品路线图](/api/attachments/__ROADMAP_IMAGE__/content)
`, { folderId: folderStart.id, tagNames: ['入门 / Start', '模板 / Template', '产品 / Product'], isFavorite: true, isPinned: true });

  const attachments = await addAttachments(demoClient, welcome.id);
  await demoClient.patch(`/api/notes/${welcome.id}`, {
    contentMd: `# 欢迎来到 360笔记

这是一个**真实可用的示例账户**。它展示了 360笔记 的主要功能：Markdown 与富文本、文件夹、标签、搜索、分享、附件、版本历史与团队空间。

## 从三个动作开始

1. **写下来。** 按 \`⌘/Ctrl + N\` 新建笔记，内容会自动保存。
2. **找回来。** 按 \`⌘/Ctrl + K\` 搜索标题、正文、标签或附件名。
3. **带得走。** 在 **设置 → 数据与备份** 中导出 Markdown、HTML、JSON 或 PDF。

> 提示：输入 \`/\` 打开插入菜单；输入 \`#\` 创建标题；工具栏可以上传图片与附件。

## 功能清单

- [x] Markdown 与富文本编辑
- [x] 文件夹、标签、收藏与置顶
- [x] 全文搜索与双向链接
- [x] 图片与附件
- [x] 分享链接与评论
- [x] 版本历史与备份
- [ ] 写下你自己的第一条笔记

## 双向链接

试试打开 [[Markdown 与排版速查]]，右侧信息面板会显示反向链接。

## 一个小表格

| 能力 | 说明 | 状态 |
| --- | --- | --- |
| 自动保存 | 停止输入后自动保存 | 已启用 |
| 离线编辑 | 断网后继续写 | 已启用 |
| 导出 | Markdown / HTML / PDF / JSON | 已启用 |

![产品路线图](/api/attachments/${attachments.image.id}/content)

附件：发布简报 PDF、路线图 CSV 已上传到这篇笔记，可以在右侧「附件」面板查看和下载。
`,
    reason: 'manual',
    isFavorite: true,
    isPinned: true,
  });

  const markdownGuide = await ensureNote(demoClient, demoSpace.id, 'Markdown 与排版速查', `# Markdown 与排版速查

360笔记 的正文以 **Markdown** 为底层格式，同时提供所见即所得的编辑体验。你可以在编辑器底部随时切换 Markdown 源码模式，这个选择只影响当前笔记。

## 常用语法

| 想要 | 输入 |
| --- | --- |
| 标题 | \`# 一级标题\` 到 \`###### 六级标题\` |
| 加粗 / 斜体 | \`**加粗**\` / \`*斜体*\` |
| 删除线 | \`~~删除~~\` |
| 行内代码 | \`code\` |
| 链接 | \`[文字](https://example.com)\` |
| 任务 | \`- [x] 已完成\` |
| 引用 | \`> 引用\` |

## 代码块

\`\`\`ts
export function greeting(name: string) {
  return \`Hello, \${name}\`;
}
\`\`\`

## 任务列表

- [x] 上传一张图片
- [x] 创建一个表格
- [ ] 尝试分享链接
- [ ] 开启两步验证

> 格式只是工具，内容才是目的。切换模式不会改变笔记的 Markdown 源文件。
`, { folderId: folderStart.id, tagNames: ['入门 / Start', '参考 / Reference'] });

  const roadmap = await ensureNote(demoClient, demoSpace.id, '产品路线图 2026', `# 产品路线图 2026

## 季度目标

| 季度 | 主题 | 关键结果 |
| --- | --- | --- |
| Q1 | 基础体验 | 自动保存、搜索、Markdown |
| Q2 | 团队协作 | 角色、邀请、审计 |
| Q3 | 数据可携带 | 导出、备份、PDF |
| Q4 | 规模化 | 异地备份、API、PWA |

![2026 路线图](/api/attachments/__ROADMAP_IMAGE_2__/content)

## 本周重点

- [x] 统一中英文界面
- [x] 邮箱验证码注册
- [ ] 完成团队权限回归测试
- [ ] 整理发布检查清单

> 方向比速度重要。每一季度只承诺少量真正完成的能力。
`, { folderId: folderProduct.id, tagNames: ['产品 / Product', 'Roadmap'] });
  const roadmapAttachments = await addAttachments(demoClient, roadmap.id);
  await demoClient.patch(`/api/notes/${roadmap.id}`, {
    contentMd: `# 产品路线图 2026

## 季度目标

| 季度 | 主题 | 关键结果 |
| --- | --- | --- |
| Q1 | 基础体验 | 自动保存、搜索、Markdown |
| Q2 | 团队协作 | 角色、邀请、审计 |
| Q3 | 数据可携带 | 导出、备份、PDF |
| Q4 | 规模化 | 异地备份、API、PWA |

![2026 路线图](/api/attachments/${roadmapAttachments.image.id}/content)

## 本周重点

- [x] 统一中英文界面
- [x] 邮箱验证码注册
- [ ] 完成团队权限回归测试
- [ ] 整理发布检查清单

> 方向比速度重要。每一季度只承诺少量真正完成的能力。
`,
    reason: 'manual',
  });
  await demoClient.patch(`/api/notes/${roadmap.id}`, {
    contentMd: `# 产品路线图 2026

## 季度目标

| 季度 | 主题 | 关键结果 |
| --- | --- | --- |
| Q1 | 基础体验 | 自动保存、搜索、Markdown |
| Q2 | 团队协作 | 角色、邀请、审计 |
| Q3 | 数据可携带 | 导出、备份、PDF |
| Q4 | 规模化 | 异地备份、API、PWA |

![2026 路线图](/api/attachments/${roadmapAttachments.image.id}/content)

## 本周重点

- [x] 统一中英文界面
- [x] 邮箱验证码注册
- [x] 完成团队权限回归测试
- [ ] 整理发布检查清单

> 方向比速度重要。每一季度只承诺少量真正完成的能力。

附件：路线图 CSV 与发布简报 PDF。
`,
    reason: 'manual',
  });

  const meeting = await ensureNote(demoClient, demoSpace.id, '每周产品会议 · 第 42 周', `# 每周产品会议 · 第 42 周

**日期：** 2026-11-06  
**参与人：** 产品、设计、工程  
**目标：** 确认公开注册与双语版本的上线范围

## 议程

1. 注册与邮箱验证
2. 双域名语言策略
3. 团队空间权限
4. 发布检查

## 决定

- 注册必须验证邮箱验证码，验证码 10 分钟内有效。
- 360biji.com 固定中文界面，360note.com 固定英文界面，账户与内容共享。
- 团队空间角色保持 owner / admin / editor / viewer 四档。
- 发布前完成权限与数据安全回归。

## 行动项

- [x] 完成 SMTP 发信测试
- [x] 完成双域名部署
- [ ] 完成权限矩阵测试
- [ ] 下载第一份生产备份

> 会议记录只保留决定与行动项，讨论过程不进入正文。
`, { folderId: folderMeetings.id, tagNames: ['会议 / Meeting', '产品 / Product'] });

  const reading = await ensureNote(demoClient, demoSpace.id, '阅读笔记：《深度工作》', `# 阅读笔记：《深度工作》

## 核心观点

- 深度工作是在无干扰状态下专注进行职业活动的能力。
- 这种能力越来越少，同时价值越来越高。
- 日程应该围绕深度工作的时段来安排，而不是剩余时间。

## 摘录

> 高质量工作产出 = 时间 × 专注度

## 我的行动

- [x] 每天上午保留 90 分钟无通知时段
- [ ] 把会议集中到下午
- [ ] 每周复盘一次注意力去向

标签：阅读、效率、长期主义。
`, { folderId: folderReading.id, tagNames: ['阅读 / Reading', '效率 / Focus'] });

  await ensureNote(demoClient, demoSpace.id, '模板：项目简报', `# 模板：项目简报

**项目：**  
**负责人：**  
**目标：**  

## 背景

## 范围

- 包含：
- 不包含：

## 里程碑

| 日期 | 交付物 | 负责人 |
| --- | --- | --- |
|  |  |  |

## 风险

## 决策记录
`, { folderId: folderTemplates.id, tagNames: ['模板 / Template'] });

  const englishWelcome = await ensureNote(demoClient, demoSpace.id, 'Welcome to 360note', `# Welcome to 360note

This is a **real demo account** for the English edition. It shows how notes, folders, tags, attachments, sharing, version history and team workspaces work together.

## Start with three actions

1. **Write it down.** Press \`⌘/Ctrl + N\`. Your work is saved automatically.
2. **Find it again.** Press \`⌘/Ctrl + K\` to search titles, body text, tags and attachment names.
3. **Take it with you.** Export Markdown, HTML, JSON or PDF from **Settings → Data & backup**.

> Tip: type \`/\` for the insert menu, or upload images and files from the toolbar.

## What to try

- [x] Switch between rich text and Markdown for this note
- [x] Open the backlinks panel
- [x] Download an attachment
- [ ] Share this note with a friend
- [ ] Create your own note

## A small table

| Capability | What it does | Status |
| --- | --- | --- |
| Autosave | Saves after you stop typing | On |
| Offline | Keeps writing when the network drops | On |
| Export | Markdown / HTML / PDF / JSON | On |

![Roadmap](/api/attachments/__ROADMAP_IMAGE_3__/content)
`, { folderId: folderStart.id, tagNames: ['English', 'Getting started'], isFavorite: true });
  const englishAttachments = await addAttachments(demoClient, englishWelcome.id);
  await demoClient.patch(`/api/notes/${englishWelcome.id}`, {
    contentMd: `# Welcome to 360note

This is a **real demo account** for the English edition. It shows how notes, folders, tags, attachments, sharing, version history and team workspaces work together.

## Start with three actions

1. **Write it down.** Press \`⌘/Ctrl + N\`. Your work is saved automatically.
2. **Find it again.** Press \`⌘/Ctrl + K\` to search titles, body text, tags and attachment names.
3. **Take it with you.** Export Markdown, HTML, JSON or PDF from **Settings → Data & backup**.

> Tip: type \`/\` for the insert menu, or upload images and files from the toolbar.

## What to try

- [x] Switch between rich text and Markdown for this note
- [x] Open the backlinks panel
- [x] Download an attachment
- [ ] Share this note with a friend
- [ ] Create your own note

## A small table

| Capability | What it does | Status |
| --- | --- | --- |
| Autosave | Saves after you stop typing | On |
| Offline | Keeps writing when the network drops | On |
| Export | Markdown / HTML / PDF / JSON | On |

![Roadmap](/api/attachments/${englishAttachments.image.id}/content)

Two attachments (PDF and CSV) are included in this note.
`,
    reason: 'manual',
  });

  await ensureNote(demoClient, demoSpace.id, 'Release checklist', `# Release checklist

Use this checklist before every public release.

## Verification

- [ ] Typecheck and production build pass
- [ ] Health endpoint returns \`{ ok: true }\`
- [ ] Both domains resolve and redirect HTTP to HTTPS
- [ ] Chinese edition shows Chinese; English edition shows English
- [ ] Registration sends a verification code
- [ ] Password reset works with an email code and a recovery key
- [ ] A viewer cannot edit; an editor can edit but cannot manage members
- [ ] Public share links respect password and expiry
- [ ] Attachments require workspace membership
- [ ] A fresh backup downloads successfully

## Rollback

\`\`\`bash
sudo systemctl restart 360note
curl -fsS https://360note.com/health
\`\`\`

If a release fails, restore the previous build and database backup, then verify both domains.
`, { folderId: folderProduct.id, tagNames: ['English', 'Checklist', 'Reference'] });

  await ensureNote(demoClient, demoSpace.id, 'API quick start', `# API quick start

Create a scoped token in **Settings → API & integrations**.

## List notes

\`\`\`bash
curl -H "Authorization: Bearer nh_xxx" \\
  "https://360note.com/api/notes?workspaceId=YOUR_WORKSPACE_ID&limit=20"
\`\`\`

## Create a note

\`\`\`bash
curl -X POST https://360note.com/api/notes \\
  -H "Authorization: Bearer nh_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"workspaceId":"YOUR_WORKSPACE_ID","title":"From API","contentMd":"# Hello"}'
\`\`\`

| Scope | Access |
| --- | --- |
| notes:read | list, read, search, export |
| notes:write | create, update, attach |

Tokens are shown once. Store them like passwords.
`, { folderId: folderProduct.id, tagNames: ['English', 'Reference', 'API'] });

  const teamGuide = await ensureNote(demoClient, team.id, '团队协作说明', `# 团队协作说明

团队空间用于多人共享文件夹、标签与笔记。这个示例空间由 Demo 用户拥有，管理员账户是其中的 admin 成员。

## 角色

| 角色 | 读取 | 编辑笔记 | 管理成员 | 删除空间 / 转移所有权 |
| --- | --- | --- | --- | --- |
| owner | 是 | 是 | 是 | 是 |
| admin | 是 | 是 | 是 | 否 |
| editor | 是 | 是 | 否 | 否 |
| viewer | 是 | 否 | 否 | 否 |

## 邀请

- 在「空间 → 邀请成员」中输入邮箱和角色。
- 系统会发送邀请邮件，也可以复制链接手动发送。
- 邀请 14 天内有效，接受后按角色获得权限。

## 审计

成员变更、邀请、分享、备份等操作会写入审计日志，只有 owner 与 admin 可以查看。

## 分享与团队的区别

团队空间是**成员制**，需要登录并加入空间；分享链接是**能力制**，任何拿到链接的人都可以按链接权限访问。分享链接可以设置密码与过期时间。

> 权限检查在服务端完成。隐藏按钮只是界面提示，不是安全边界。
`, { folderId: teamFolder.id, tagNames: ['团队 / Team', '权限 / Permissions'] });

  await ensureNote(demoClient, team.id, 'Team collaboration guide', `# Team collaboration guide

Team workspaces let members share folders, tags and notes. This demo workspace is owned by the demo user; the administrator account is an admin member.

## Roles

| Role | Read | Edit notes | Manage members | Delete / transfer |
| --- | --- | --- | --- | --- |
| owner | yes | yes | yes | yes |
| admin | yes | yes | yes | no |
| editor | yes | yes | no | no |
| viewer | yes | no | no | no |

## Invitations

- Invite by email and choose a role.
- The app sends an invitation email and also shows a copyable link.
- Invitations expire after 14 days.

## Audit

Member changes, invitations, shares and backups are recorded. Only owners and admins can read the audit log.

## Sharing versus teams

A team workspace is membership-based: you must sign in and join. A share link is capability-based: anyone with the link can access it according to its permission, optionally with a password and expiry.

> Authorization is enforced on the server. Hiding a button is not a security boundary.
`, { folderId: teamFolder.id, tagNames: ['English', 'Team', 'Security'] });

  const releasePlan = await ensureNote(demoClient, team.id, '项目 Alpha · 发布计划', `# 项目 Alpha · 发布计划

**目标：** 在 11 月底完成公开测试  
**负责人：** Demo 用户  
**状态：** 进行中

## 里程碑

| 日期 | 交付物 | 状态 |
| --- | --- | --- |
| 11-12 | 权限矩阵回归 | 进行中 |
| 11-18 | 移动端布局检查 | 待开始 |
| 11-24 | 数据备份演练 | 待开始 |
| 11-30 | 公开测试 | 待开始 |

## 风险

- 邮件送达率需要持续观察。
- 移动端编辑器的工具栏需要压缩。
- 备份恢复必须先在测试空间验证。

## 任务

- [x] 完成双域名部署
- [x] 创建演示账户
- [ ] 完成安全测试
- [ ] 下载生产备份
`, { folderId: teamRelease.id, tagNames: ['产品 / Product', '发布 / Release', 'Project Alpha'] });

  // Comments, share links and a notification for the demo account.
  await demoClient.post(`/api/notes/${teamGuide.id}/comments`, { body: '这份角色表很清楚，发布前请再核对一次 viewer 的写权限。' });
  await adminClient.post(`/api/notes/${teamGuide.id}/comments`, { body: '已核对：viewer 只能读取，服务端会拒绝写入。' });
  const share = await demoClient.post(`/api/notes/${welcome.id}/shares`, { permission: 'view' });
  const protectedShare = await demoClient.post(`/api/notes/${roadmap.id}/shares`, { permission: 'comment', password: 'demo360' });

  console.log(JSON.stringify({
    admin: { email: ADMIN_EMAIL, created: admin.created, recoveryKey: admin.recoveryKey },
    demo: { email: DEMO_EMAIL, created: demo.created, recoveryKey: demo.recoveryKey },
    seeded: true,
    workspace: { personal: demoSpace.id, team: team.id },
    notes: { welcome: welcome.id, roadmap: roadmap.id, englishWelcome: englishWelcome.id, teamGuide: teamGuide.id, releasePlan: releasePlan.id },
    shares: { public: share.share?.url, passwordProtected: protectedShare.share?.url, password: 'demo360' },
  }, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
