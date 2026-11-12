# 360note 架构

> 版本 0.1 · 2026-11-07  
> 面向开发者。用户文档见 README，设计与功能分别见 `DESIGN_SYSTEM.md`、`FEATURES.md`。

---

## 1. 系统概览

```
Browser (PWA, React)
  ├─ UI: 三栏 / 移动单屏 / 分享页
  ├─ Editor: TipTap (ProseMirror) ⇄ Markdown
  ├─ Local cache: IndexedDB (notes, summaries, drafts, outbox)
  └─ fetch /api (session cookie + CSRF header)
        │ HTTPS
        ▼
Nginx (TLS termination, proxy, security headers)
        │ 127.0.0.1:8787
        ▼
Fastify API (Node.js, TypeScript)
  ├─ Auth / sessions / 2FA / recovery
  ├─ Notes / folders / tags / search
  ├─ Attachments (AES-256-GCM at rest)
  ├─ Shares / comments / public pages
  ├─ Import / export / backups / jobs
  ├─ Team workspaces / audit
  └─ AI proxy (optional, OpenAI-compatible)
        │
        ├── PostgreSQL 15 (metadata, content, search, audit)
        └── Filesystem /var/lib/360note
              ├─ attachments/ (encrypted)
              ├─ backups/ (encrypted .3nb)
              ├─ imports/ (transient staging)
              └─ tmp/
```

### 1.1 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 内容真源 | Markdown | 可读、可 diff、可导出；长期可迁移 |
| 身份 | UUID | 重命名/移动/恢复不破坏引用 |
| 服务端 | Fastify + PostgreSQL | 多用户、团队、分享、FTS、审计；比每端 SQLite 同步更简单可靠 |
| 客户端离线 | IndexedDB 缓存 + outbox | Web/PWA 多设备可用；实现真正离线编辑与合并 |
| 冲突 | version + 行级 diff3 + 历史冲突快照 | 不静默覆盖；冲突不进入笔记列表；无需全量 CRDT |
| 附件 | 服务器 AES-256-GCM | 静止加密；分享/导出可控制 |
| E2EE | v1 不提供 | 搜索/分享/AI/恢复需要服务端读正文；不假装提供 |
| 备份 | 独立 `.3nb` + 恢复前备份 | 与同步解耦；可下载/上传/预览/恢复 |
| 邮件 | 无 | 产品约束；邀请链接 + 应用内通知 + 恢复密钥 |

### 1.2 目录结构

```
360note/
├─ apps/
│  ├─ server/        Fastify API、迁移、服务、任务
│  └─ web/           React PWA
├─ packages/shared/  共享类型与权限常量
├─ docs/             设计/质量/功能/研究/架构/决策/运维
├─ tests/manual/     Playwright 手工验收脚本（需环境变量凭据）
├─ deploy/           systemd / nginx / env 模板
└─ README.md
```

---

## 2. 数据模型（PostgreSQL）

迁移文件：`apps/server/src/migrations/001_init.sql`。

### 2.1 用户与认证

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | id, email, password_hash, role, totp_*, recovery_key_hash, prefs, templates_seeded_at, enc_* | 账户；`enc_*` 为未来 E2EE 预留，未启用 |
| `sessions` | id, user_id, token_hash, device_id, user_agent, ip, expires_at, revoked_at | 会话；令牌哈希存储；`device_id` 来自长期设备 Cookie，用于按设备聚合 |
| `totp_backup_codes` | user_id, code_hash, used_at | 一次性备用码 |
| `login_attempts` | email, ip, success, created_at | 登录审计/风控 |

密码：`scrypt(password, salt, N=32768, r=8, p=1, keylen=64)`，格式 `scrypt$N$r$p$salt$hash`。比较使用 `timingSafeEqual`。

### 2.2 工作区与团队

| 表 | 关键字段 | 说明 |
|---|---|---|
| `workspaces` | id, name, kind(personal/team), owner_id, deleted_at | 个人空间 / 团队空间 |
| `workspace_members` | workspace_id, user_id, role(owner/admin/editor/viewer) | 成员与角色 |
| `workspace_invitations` | workspace_id, email, role, token_hash, token_cipher, status | 邀请；发送邮件并保留复制链接 |
| `audit_logs` | workspace_id, actor_id, action, target_type/id, meta, ip | 审计 |

权限：
- viewer：读、评论
- editor：读写笔记/文件夹/标签、分享
- admin：管理成员/邀请、查看审计、删除空间？
- owner：转移所有权、删除空间

服务端每个笔记请求都通过 `requireWorkspace(userId, workspaceId, action)` 检查；分享创建/列出/撤销要求 `canShare`；笔记内容操作要求 `write`。

### 2.3 内容

| 表 | 关键字段 | 说明 |
|---|---|---|
| `folders` | id, workspace_id, parent_id, name, color, icon, position, trashed_at | 树；应用层防止环 |
| `notes` | id, workspace_id, folder_id, title, content_md, excerpt, version, is_favorite, is_pinned, encrypted, created_by, updated_by, created_at, updated_at, last_opened_at, trashed_at, deleted_at, search_vector | 主内容 |
| `tags` / `note_tags` | workspace_id, name, color / note_id, tag_id | 标签多对多 |
| `note_versions` | note_id, version, title, content_md, reason(auto/manual/restore/import/conflict), created_by, created_at | 版本快照，最多 60 |
| `attachments` | id, workspace_id, note_id, filename, mime, size_bytes, sha256, storage_key, width, height, ocr_text, ocr_status | 附件元数据；文件加密落盘 |
| `note_links` | source_note_id, target_note_id, target_title | 双向链接索引 |

索引：
- `notes (workspace_id, trashed_at, updated_at DESC)`
- `notes (workspace_id, folder_id)`
- GIN `search_vector`（simple config）
- GIN trigram `title`, `content_md`、`attachments.filename`
- `note_versions (note_id, version DESC)`
- 标签唯一 `(workspace_id, lower(name))`

**标题与正文分离：** 创建/更新时，如果正文以与标题完全相同的 `# 标题` 开头，服务端会剥离该 H1（`stripTitleHeading`）。客户端加载时也做同样处理，避免编辑器/分享页重复标题。导出 Markdown 使用 frontmatter 保存标题。

### 2.4 分享与评论

| 表 | 关键字段 | 说明 |
|---|---|---|
| `share_links` | id, note_id, token_hash, token_cipher, permission(view/comment/edit), password_hash, expires_at, revoked_at, view_count, last_accessed_at | 分享链接 |
| `comments` | id, note_id, user_id, guest_name, body, resolved, ip, created_at | 评论；公开访客评论记录 IP |

分享 token：24 字节 CSPRNG base64url（192 bit）。只存 SHA-256 哈希用于查找；另以 AES-GCM 加密存一份，供笔记所有者再次复制链接。密码使用 scrypt；解锁后签发 2 小时 HMAC Token，写入 `nh_share_access` Cookie（Path=`/api/public`），用于后续 API/图片请求。

### 2.5 任务、备份、设置

| 表 | 说明 |
|---|---|
| `jobs` | 导入预览/执行、备份创建/恢复的异步任务；进度/结果/错误 |
| `backups` | 工作区备份：filename, storage_key, kind(auto/manual/pre-restore), status, note_count, attachment_count, meta |
| `templates` | id, user_id, name, description, title_template, content_template, builtin_key, created_at | 用户模板与变量；`builtin_key` 标记首次生成的默认模板 |
| `notifications` | 应用内通知（安全、邀请、评论、共享编辑） |
| `api_tokens` | 个人 API 令牌（哈希存储、前缀、scope、最后使用、撤销） |
| `instance_settings` | AI、备份策略等实例级设置；敏感值 AES-GCM 加密 |
| `login_attempts` | 登录审计 |

---

## 3. 请求与认证

### 3.1 会话

- 注册/登录成功：`createSession()` 生成 32 字节随机 token；DB 存 SHA-256；Cookie 值原始 token。
- 生产 Cookie 名 `__Host-nh_session`，`Secure; HttpOnly; SameSite=Lax; Path=/`，30 天。
- 每个 `/api/*` 请求解析 Cookie/Bearer；会话过期或撤销即拒绝。
- 会话 `last_seen_at` 最多每 5 分钟更新一次，避免写放大。

### 3.2 2FA

- `POST /api/auth/2fa/setup`：要求当前密码重新认证；生成 base32 secret，AES-GCM 加密存 DB；返回 otpauth URL + QR data URL。
- `POST /api/auth/2fa/enable`：再次校验当前密码与 TOTP（±1 step），记录 `totp_last_step` 防重放；生成 10 个备用码，SHA-256 存储。
- 登录：密码正确但启用 2FA 时返回 5 分钟签名 challenge token；`POST /api/auth/login/2fa` 校验 TOTP 或备用码；成功后创建会话。
- 禁用：需密码 + TOTP/备用码。
- 账号恢复：恢复密钥 + 新密码；禁用 2FA，撤销所有会话，生成新恢复密钥。

### 3.3 CSRF / 限流 / 安全头

- 所有非 GET 的 Cookie 请求必须带 `X-360note-CSRF: 1`（前端 fetch 统一加）。Bearer API 请求豁免。
- SameSite=Lax + 自定义头 + Origin 由浏览器同源策略共同防护。
- 全局 600 req/min/IP；登录 12/15min；注册 8/h；分享解锁 8/10min；AI 20/h；上传/导入限制由 multipart 控制。
- Helmet：CSP（self + inline style + data/blob/https images）、HSTS（生产）、Referrer-Policy、Permissions-Policy、nosniff、frame-ancestors none。
- 附件响应额外 `Content-Security-Policy: default-src 'none'`，防止 HTML/SVG 注入。

---

## 4. 笔记保存、版本与冲突

### 4.1 保存流程

```
Editor (debounce 800ms)
  → PATCH /api/notes/:id { title, contentMd, baseVersion, reason }
    → 事务:
       1. SELECT note FOR UPDATE（隐式，通过 update 条件/预检）
       2. if baseVersion !== current.version → 409 { current note }
       3. title = provided || "未命名笔记"; content = stripTitleHeading(...)
       4. version = version + 1
       5. update notes, rebuild note_links, update tags
       6. snapshotVersion(...)（>5 分钟或 manual/restore/import 时）
    → 返回完整 note
  → Client: 更新 baseVersion、缓存、清除匹配的草稿
```

### 4.2 三向合并（客户端）

`apps/web/src/stores/app.ts`：

- 本地缓存中保存 `baseContent`（最近一次服务器确认的内容）。
- 收到 409 时，从错误 `details.current` 取服务器当前 note。
- 使用 `node-diff3` 的 `diff3Merge(localLines, baseLines, remoteLines, {excludeFalseConflicts:true})`：
  - 无冲突：合并后以 `remote.version` 为 base 再次 PATCH；
  - 有冲突或 base 缺失：调用 `POST /api/notes/:id/conflicts` 将本地内容写入 `note_versions`（`reason='conflict'`），当前编辑器切换到服务器版本；
  - 编辑器显示冲突横幅，可打开右侧“历史”查看冲突快照；冲突快照不会创建笔记，也不会出现在笔记列表。
- 离线 outbox 按笔记合并，不按按键重放；联网后逐条同步。

### 4.3 版本

- 新建笔记：version 1 + 初始快照。
- 更新：version++；快照最多每 5 分钟一次；`manual/restore/import/conflict` 强制快照。
- 恢复：先创建 `reason=restore` 快照（当前内容），再以历史内容更新为新 version。
- 每个笔记最多保留 60 个快照；回收站/永久删除清理关联版本。

### 4.4 离线（IndexedDB）

`apps/web/src/lib/offline.ts`：
- `workspace:<id>`：摘要列表 + 文件夹 + 标签。
- `note:<id>`：笔记正文 + `baseContent`。
- `draft:<id>`：输入中的草稿（标题/正文/baseVersion/时间）。
- `outbox`：待同步的 create/update 项，按 note 合并。
- 打开过的笔记可离线阅读/编辑；工作区加载后后台缓存最近 120 篇（`/api/notes/offline-bundle`）。
- 本地新建笔记先使用 `local-*` ID，联网后转正式 ID 并替换 URL。
- 附件离线不支持上传（UI 明确提示）；这是当前已知限制。

---

## 5. 搜索

### 5.1 API

- `GET /api/notes?workspaceId=&filter=&folderId=&tagId=&sort=&limit=&offset=`
- `GET /api/search?workspaceId=&q=&limit=&offset=`

查询条件：
```sql
n.workspace_id = $1 AND n.deleted_at IS NULL AND n.trashed_at IS NULL
AND (
  n.search_vector @@ websearch_to_tsquery('simple', $2)
  OR n.title ILIKE $3 ESCAPE '\'
  OR n.content_md ILIKE $3 ESCAPE '\'
  OR EXISTS (tags t WHERE t.name ILIKE $3)
  OR EXISTS (attachments a WHERE a.filename ILIKE $3 OR a.ocr_text ILIKE $3)
)
ORDER BY rank DESC, is_pinned DESC, updated_at DESC
```

- 英文用 `ts_rank_cd`；中文因 `simple` 分词限制，依赖 trigram + ILIKE 兜底。
- 附件名/OCR 文本匹配单独返回（最多 12 条）。
- 前端带 240ms debounce；结果限制 60；命令面板限制 8；列表 100。

### 5.2 性能边界

- 目标库规模：1–5 万笔记（单工作区）。
- 建议在 1 万笔记数据集上验证：首屏 < 1s、搜索 < 300ms、打开笔记 < 300ms。
- 若超过 10 万笔记，需要改为 keyset 分页、独立搜索服务（Meilisearch/Typesense）或按工作区拆分。

---

## 6. 附件

### 6.1 上传

`POST /api/notes/:id/attachments`：
1. `requireAuth` + 笔记 `canEdit`；
2. multipart 限制 25MB（可通过 `MAX_UPLOAD_BYTES` 调整）；
3. MIME 嗅探（PNG/JPEG/GIF/WebP/PDF/ZIP 等）+ 文件名安全化；
4. `image-size` 读取宽高；
5. AES-256-GCM 加密后写入 `/var/lib/360note/attachments/<workspace>/<attachment>.nh`；启用对象存储时写入 S3 的 `prefix/attachments/<workspace>/<attachment>.nh`；
6. DB 记录 SHA-256 / storage_key / 元数据；`storage_key` 决定读取位置（本机相对路径或 `s3:` 前缀），外部 URL 不受影响；
7. 若 `OCR_ENABLED=true`，异步队列调用 tesseract（图片）或 pdftotext（PDF），结果写入 `ocr_text`，失败标记 `failed`。

### 6.2 读取

- 内部：`GET /api/attachments/:id/content`，要求工作区读权限；解密后返回，支持 ETag/304，CSP 防注入。
- 公开分享：`GET /api/public/shares/:token/attachments/:id`，需通过分享密码 Cookie；只返回该笔记附件。

### 6.3 存储加密

- 主密钥 `NOTE360_MASTER_KEY` 为 32 字节 base64；缺失时生产启动失败。
- 文件格式：`[version=1][iv 12][tag 16][ciphertext]`，AAD=`360note:attachment`。
- 启用/停用对象存储时按行迁移：上传完成后才更新 `storage_key`；回迁时先写入本机并校验，再更新 `storage_key`。迁移期间新上传保持在本机，结束后补迁，避免快照遗漏。
- 备份也用同一主密钥加密，AAD=`360note:backup`。
- 丢失主密钥 = 附件/备份不可读；运行手册要求离线保存密钥。

---

## 7. 分享与公开页

### 7.1 创建

`POST /api/notes/:id/shares`：
- 校验 `note.canShare`（editor/admin/owner）；
- 生成 24 字节 token；
- 存 SHA-256 哈希 + AES-GCM 加密 token（用于再次复制）；
- 密码 scrypt；过期时间；权限 view/comment/edit；
- 返回 `https://360note.com/s/<token>`。

### 7.2 访问

- `GET /api/public/shares/:token`：
  - 查找 token（哈希），检查撤销/过期；
  - 密码保护：无有效签名 Cookie 时只返回标题与 `requiresPassword`；
  - 有权限：返回标题、正文（附件 URL 改写为公开路径）、附件、评论（comment/edit）、作者/工作区/发布时间；
  - 浏览量 +1。
- 密码解锁：`POST /unlock`，scrypt 校验，签 2h HMAC token，写 Cookie。
- 公开编辑：`PUT /api/public/shares/:token/note`，要求 edit + 有效 access；保存时把公开附件 URL 归一化回内部 URL；`baseVersion` 冲突返回 409。
- 评论：`POST /api/public/shares/:token/comments`，guest_name 可选；通知笔记创建者。

### 7.3 安全

- token 高熵 + 哈希存储；密码 scrypt；过期/撤销；限流。
- 公开页不加载应用侧栏和敏感 API。
- 分享页可能被索引；UI 明确警告。
- 分享创建/更新/撤销进审计日志。

---

## 8. 备份与恢复

### 8.1 格式

`.3nb` = ZIP：

```
manifest.json        # format, version, createdAt, workspace, counts
workspace.json       # folders, tags, notes, noteTags, attachments meta, versions, comments
attachments/<sha256>.bin  # 相同内容只存一份（备份内去重）
```

- ZIP 由 `archiver` 流式生成；明文 ZIP 用 AES-256-GCM（v2 流式格式，兼容 v1）加密后存储，下载时解密到临时文件并流式发送。
- 预览、合并恢复、替换恢复使用 `yauzl` 流式读取 ZIP；单个附件先落临时文件，再加密写入本地或对象存储，不把整个归档载入内存。
- 分享链接、API 令牌、用户密码、2FA 密钥**不在备份中**；替换恢复会保留同工作区分享链接，合并恢复不会回放分享；评论作者账号不在备份中，评论按访客名恢复。
- 备份包含回收站中的笔记与文件夹（带 `trashedAt`），便于完整灾难恢复。

### 8.2 自动备份

- 服务启动后调度，每天约 03:15；实际以最多 6 小时检查一次，若 20 小时内已有自动备份则跳过。
- 每个工作区分别备份；保留 14 份自动备份，最多 30 天（可配置）。
- 创建手动备份 / 恢复前自动创建 `pre-restore` 备份。
- 旧备份删除时同时删除加密文件。

### 8.3 恢复

- 上传备份（≤600MB）或从列表选择，也可从对象存储直接恢复工作区备份；
- 解析 manifest/workspace.json，展示预览：笔记/文件夹/标签/附件/版本/评论；同工作区判断；
- **合并为副本**：把备份转换为 ParsedImport，在“恢复副本 YYYY-MM-DD”文件夹下创建新笔记/附件；不覆盖当前内容；不回放版本/评论/分享；
- **替换当前空间**：先创建 pre-restore 安全备份，附件先暂存到目标存储，再在事务内删除当前 notes/folders/tags 后按原 ID 恢复笔记/文件夹/标签/版本/评论/附件与分享链接，清理旧附件文件；只允许同工作区，并用工作区 advisory lock 串行执行。
- 恢复任务异步，前端轮询进度；恢复完成后刷新工作区与当前笔记。
- 恢复流程可验证：使用 `docs/OPERATIONS.md` 的手动 drill 步骤，并记录到 `MEMORY.md`。

### 8.4 异地存储（S3 兼容）

- 实例管理员可在 实例管理 → 存储管理 配置 S3 兼容存储（AWS S3 / MinIO / R2 / Backblaze 等）。
- 每次创建备份（自动/手动/恢复前）在加密落盘后，把同一个已加密 `.3nb` 上传到配置的 bucket/prefix；备份列表显示“异地已上传/失败”。
- 删除/保留策略会同时删除远端对象；连接测试使用 ListObjectsV2。
- 异地备份除复制外，实例管理员可在“对象存储文件”中校验并直接恢复工作区备份；整站备份仍按运维手册恢复数据库。
- 凭证（secretAccessKey）AES-GCM 加密存 `instance_settings`；界面不回显。建议私有 bucket + 最小权限。

### 8.4.1 附件对象存储与缤纷云 CoreIX

- 附件存储与备份异地存储可分别配置：`attachmentStorage` 负责加密附件和公开分享图片的媒体副本，`offsite` 负责 `.3nb` 备份副本。
- 未保存独立附件配置时回退到旧 `offsite` 配置，保证已有远程附件可继续读取；已有远程附件时禁止直接更换 Endpoint/Bucket/Prefix。
- 缤纷云 S4 推荐配置：Endpoint `https://s3.bitiful.net`，Region `cn-east-1`，Path-style。
- 只有**公开分享中的图片**才会生成 `media/` 前缀下的未加密媒体副本；原附件仍为 AES-256-GCM 加密。媒体副本通过服务端代理输出，分享密码、权限、过期与撤销逻辑不被绕过。
- CoreIX 参数：`fmt=auto|webp|jpg`、`q=40..95`、`w=最大宽度`；图片分析使用 `fmt=tags`，仅在启用标签分析时异步执行。
- 媒体域名留空时自动回退原图；配置 CDN 鉴权 Key 后，服务端生成缤纷云高级鉴权 URL。

### 8.5 已知限制

- 备份默认在同一台服务器；异地存储需管理员配置。对象存储文件浏览/校验/工作区恢复已内置，但整站数据库恢复仍是运维操作。
- 备份不含 E2EE 密钥（v1 无 E2EE）、API 令牌；合并恢复不回放分享链接。
- 恢复替换为工作区级，不是实例级；多用户各自工作区独立备份。

---

## 9. 导入 / 导出

### 9.1 导入

端点：
- `POST /api/import/upload?workspaceId=...`（multipart）→ jobId。
- `GET /api/import/:jobId` → 分析进度/预览。
- `POST /api/import/:jobId/execute` → 创建新 job，执行导入。

解析器（`apps/server/src/lib/import-parser.ts`）：
- ZIP 安全解压（拒绝 zip-slip、限制条目/总大小）；
- Markdown：gray-matter frontmatter、标题、标签、文件夹路径、本地图片/附件引用；
- HTML：NodeHtmlMarkdown；
- ENEX：fast-xml-parser + base64 resources + NodeHtmlMarkdown；
- Notion zip：Markdown + CSV（CSV → Markdown 表格）；
- CSV：解析引号/换行，生成 Markdown 表格（最多 2000 行）；
- JSON：360note workspace 导出格式（data.json）；其他 JSON 作为纯文本笔记。
- 附件先暂存到 job 目录，执行时加密写入 storage，并把 `360note-attachment://<key>` 替换为正式 URL。
- 限制：3000 篇笔记 / 250MB / 40 文件；超限截断并警告。

### 9.2 导出

- 单篇：
  - `GET /api/notes/:id/export?format=md`：无附件返回 `.md`；有附件返回 ZIP（正文 + attachments）。
  - `format=html`：独立 HTML，图片 base64 内嵌，附件列表 base64 下载。
  - `format=pdf`：Chromium headless 打印 HTML；失败返回 501 提示用 HTML 打印。
- 全库：
  - `GET /api/export?workspaceId=&format=md|html|json`，流式 ZIP：
    - md：`notes/<层级>/<title>-<id>.md` + `attachments/<noteId>/<id>-filename` + manifest + notes.csv + README；
    - html：每篇静态 HTML + index.html + attachments + notes.csv；wiki link 转为相对 HTML 链接；
    - json：data.json + attachments + notes.csv。
  - 保留文件夹层级、标签、时间戳；Markdown 附件引用使用相对路径；HTML 内嵌或相对引用附件。

### 9.3 互操作

- 导入 Obsidian 风格 frontmatter / wikilink；
- Evernote ENEX 附件；
- Notion markdown + CSV；
- 导出 Markdown 可被 Obsidian/Logseq/SilverBullet 等直接读取（frontmatter 标准 YAML）；
- 无专有锁。

---

## 10. 团队与审计

- 工作区 `kind=personal|team`；个人空间默认只有 owner。
- 邀请：管理员/所有者创建；已注册用户收到应用内通知，未注册用户需要复制链接；接受时邮箱必须匹配。
- 角色：owner/admin/editor/viewer；管理员不能直接移除 owner，需先转移所有权。
- 审计：登录、2FA、密码、恢复密钥、成员/角色、邀请接受、分享、备份、导入/导出、工作区删除等。
- 每请求权限检查；列表查询始终带 workspace 成员关系，不依赖 UI 过滤。
- 反向链接查询同时限制 source/target 的工作区，避免跨空间标题碰撞泄漏。
- 公开分享评论与编辑端点分别限流（20/10 分钟、30/10 分钟）；个人空间禁止创建成员邀请。

---

## 11. AI（可选）

- 实例管理员在设置中启用并配置 OpenAI 兼容接口（base URL + model + API key）。
- API key 用 AES-256-GCM 加密存 `instance_settings`。
- 用户必须主动点击“AI 摘要”；只发送当前笔记标题 + 正文（≤30k 字符）；不发送其他笔记、账户密码或恢复密钥；加密笔记不发送。
- 请求超时 45s；不自动重试；失败返回 502。
- 本地摘要已移除（它只是重复正文前段）；AI 摘要仅在管理员启用且用户主动触发时使用。
- 未配置/关闭时，AI 入口显示为不可用；不弹窗、不后台请求。

---

## 12. 部署与运行

详细步骤见 `docs/OPERATIONS.md`。生产结构：

- systemd `360note.service` 运行 Node（127.0.0.1:8787）；
- Nginx 终止 TLS，代理 `/` 到 Fastify；HTTP 重定向 HTTPS；
- Let's Encrypt（BT Panel 证书路径）为 `360note.com` / `www.360note.com` 签发；
- PostgreSQL 本地；
- 数据目录 `/var/lib/360note`，权限 0700；
- 环境文件 `/etc/360note/360note.env`（0600），包含 `DATABASE_URL`、`SESSION_SECRET`、`NOTE360_MASTER_KEY`、`PUBLIC_ORIGIN=https://360note.com`；
- 日志 journald；每日自动备份；部署前 `npm run build` 后重启；
- 健康检查 `GET /health`。

---

## 13. 备份/恢复演练与验证

必须定期做（至少发布前）：

1. 创建手动备份并下载；
2. 在独立测试数据库/工作区上传并恢复；
3. 验证：笔记数、附件可打开、版本历史、评论、标签、文件夹层级；
4. 验证替换恢复：先自动生成 pre-restore 备份，恢复后原内容可回退；
5. 记录时间与结果到 `MEMORY.md`。

---

## 14. 已知限制

1. **E2EE 未提供**：服务端可读正文；隐私政策明确。
2. **离线仅缓存打开过的笔记**：未预取全库；附件离线不可上传。
3. **没有实时协作/CRDT**：多人同时编辑同一笔记时会保留冲突快照到版本历史；分享编辑为保存式。
4. **已支持可选的 S3 兼容异地备份与对象存储附件**：备份在同一服务器；建议定期下载。
5. **搜索中文依赖 ILIKE/trigram**：未接中文分词；超大规模库可能变慢。
6. **OCR 需服务器安装 tesseract/pdftotext**；默认关闭，按环境开启。
7. **账户邮件**：注册/找回依赖邮箱验证码；恢复密钥可作为离线备用方式。
8. **导入不保证复杂格式 100% 保真**（如 Notion 数据库关系、Evernote 复杂样式）；导入前预览警告。
9. **PDF 导出依赖 Chromium**；未安装时返回明确错误，可改用 HTML 打印。

这些限制在 `FEATURES.md` 中标注 P1/P2，并进入后续路线。
