# 360note 记忆文档

> 用途：保存重要决策、debug 结论、功能变更、测试结果与待办。  
> 规则：当天发生的事当天记录；不写密码/密钥/令牌；事实优先，包含日期、文件、命令与结果。  
> 关联：`CHANGELOG.md`（对外版本）、`docs/decisions/`（架构决策）、`docs/QUALITY.md`（验收）。

---

## 2026-11-07 · 项目起点与架构定稿

### 背景

- 域名：`360note.com` / `www.360note.com`，DNS 指向本机。
- 仓库：`https://github.com/widgeted/360note.git`。
- 服务器：Debian 12，4 vCPU / 8GB RAM / 40GB，PostgreSQL 15、Nginx、Node 26、Docker；无其他生产项目。
- 要求：以九个开源笔记项目为强制参考；先文档化设计/功能/质量/记忆；统一设计；功能分 P0/P1/P2；不能发邮件；不能污染域名信誉。

### 研究

- 克隆并阅读了：Trilium、Joplin、Standard Notes、SilverBullet、Memos、Blinko、flatnotes、NoteDiscovery、Livebook。
- 报告：
  - `docs/research/big-three.md`（Trilium / Joplin / Standard Notes）
  - `docs/research/silverbullet-memos-blinko.md`
  - `docs/research/smaller-three.md`（flatnotes / NoteDiscovery / Livebook）
- 综合：`docs/RESEARCH.md`。核心共同点：稳定 ID、Markdown/可迁移、树+标签+搜索、冲突副本、透明同步、导入导出、分层性能、命令面板/树/搜索三入口。
- 关键“为什么”：笔记是长期资产，用户敢托付的前提是不丢、能走、能恢复；只有承诺离线才必须做冲突处理；权限粒度决定查询模型；安全必须是叙事而不是设置页。

### 架构选择（与竞品差异）

- **服务端权威 PostgreSQL + React PWA/IndexedDB 缓存**，而不是把全量 SQLite 放到每个客户端。原因：多用户/团队/分享/审计/FTS 需要服务端；Web 端多设备可用；实现/运维更可控。代价：未缓存的历史笔记离线不可读；附件离线不可上传。已在 `FEATURES.md`/`QUALITY.md` 标注，计划预取最近 200 篇。
- **Markdown 为唯一真源**；TipTap 只是编辑器；标题独立；重复 H1 自动剥离。
- **冲突**：`version` 乐观并发 + 客户端 `node-diff3` 行级三向合并 + 冲突副本；不做 CRDT。
- **E2EE 不提供**：不假装；附件/备份 AES-256-GCM 只是静态加密。恢复密钥只保存哈希。
- **账户邮件**：注册/找回验证码、密码与邮箱变更通知、团队邀请；SMTP 仅用于账户与安全邮件。
- **备份**：独立 `.nhbackup`（ZIP 加密存储）；自动/手动/pre-restore；合并/替换恢复；预览。
- **团队**：workspace + 角色（owner/admin/editor/viewer）+ 邀请 + 审计。
- **AI**：默认关闭；实例管理员配置 OpenAI 兼容接口；用户主动点击；不训练；加密笔记不发送。
- **设计**：午夜侧栏 + 暖纸内容 + Signal Blue；Inter/系统无衬线；深色模式；三栏→单屏。~~Newsreader 衬线标题~~ 已于 2026-11-08 废止，全站禁止衬线（见下方纠偏记录）。

### 已完成的主要实现

- Monorepo：`apps/server`（Fastify 5 + PostgreSQL）、`apps/web`（React 19 + Vite + TipTap 3）、`packages/shared`。
- 数据库迁移：用户/会话/2FA/恢复密钥/工作区/成员/邀请/文件夹/笔记/标签/附件/版本/分享/评论/链接/通知/API token/审计/备份/任务/设置/登录尝试。
- 认证：注册（首个用户 admin）、登录、2FA（TOTP + 备用码）、恢复密钥重置、修改密码、会话管理、设备列表、异常登录通知、API token。
- 笔记：CRUD、自动保存、版本、回收站、收藏/置顶、移动、批量删除/恢复、双向链接/反向链接、评论。
- 搜索：FTS + trigram + ILIKE；标题/正文/标签/附件名/OCR；命令面板。
- 编辑器：TipTap 富文本 + Markdown 源码；表格/代码/任务/图片/附件/链接；80+ 格式工具；斜杠菜单；拖入/粘贴上传；语音输入；模板。
- 离线：IndexedDB 缓存/草稿/outbox；本地新建；联网 flush；409 合并/冲突副本。
- 分享：view/comment/edit、密码、过期、撤销、公开页、附件、评论、编辑、打印。
- 团队：工作区、邀请链接、角色、审计、转移所有权、删除空间（硬删）。
- 数据：单篇 MD/HTML/PDF；全库 MD+附件/HTML/JSON/CSV；导入 MD/HTML/ENEX/Notion/CSV/JSON/ZIP，带预览/执行。
- 备份：自动/手动/pre-restore；下载/上传；预览；合并/替换恢复；保留策略。
- 设置：账户/外观/编辑器/安全/数据/团队/API/AI/关于；命令面板覆盖低频功能。
- PWA：manifest、service worker、快捷方式 `/new` `/search`、分享目标 `/clip`；图标。
- 安全：scrypt、CSRF header、限流、Helmet CSP、附件 AES-GCM、备份 AES-GCM、路径校验、分享 token 哈希、TOTP 防重放。
- 文档：设计系统、功能规划、质量规范、架构、研究、ADR、CHANGELOG、本记忆、部署/运维。

### 关键文件

```
apps/server/src/index.ts              API 启动/静态/安全头/调度
apps/server/src/migrations/001_init.sql
apps/server/src/services/notes.ts     笔记/版本/链接
apps/server/src/services/backups.ts   备份/恢复
apps/server/src/lib/import-parser.ts  导入解析
apps/server/src/services/export.ts    导出
apps/server/src/routes/*.ts           路由
apps/web/src/stores/app.ts            同步/冲突/离线
apps/web/src/lib/offline.ts           IndexedDB
apps/web/src/components/editor/*      编辑器
apps/web/src/pages/*                  应用/登录/分享/法律
apps/web/src/styles/tokens.css        设计 token
```

### 调试记录（重要）

1. **dotenv 找不到根 `.env`**：npm workspace 的 cwd 是 `apps/server`，`import 'dotenv/config'` 读不到根目录。改为显式 `dotenv.config({ path: repoRoot/.env })`。
2. **静态资源返回 text/html**：Fastify `@fastify/static` 在启动时注册文件路由；重新 build 后新 hash 文件未被注册，SPA fallback 把 `/assets/*.css` 返回 index.html。修复：`notFound` 对 `/assets/*` 和常见静态扩展直接 404；生产 build 后重启服务。开发用 Vite。
3. **分享链接指向 localhost:5173**：`PUBLIC_ORIGIN` 是 dev Vite 地址。改为实际访问 origin；生产为 `https://360note.com`。
4. **标题重复 H1**：笔记标题字段 + 正文 H1 显示两次。服务端 `stripTitleHeading` + 客户端 `stripDuplicateTitle`；保存/加载/分享/HTML/PDF 均处理。此变更会规范化旧笔记。
5. **TOTP 立即重登失败**：启用时记录了 `totp_last_step`，同一 30 秒 code 再用于登录被重放保护拒绝。真实用户不会立即重登；测试时使用下一窗口 code 或备用码。不要关闭重放保护。
6. **2FA 关闭只接受 TOTP**：UI 写“验证码或备用码”；已修复后端 disable 接受备用码并标记已用。
7. **分享权限文字挤在一行**：`.share-permission-name/desc` 需 `display:block; text-align:left`。
8. **公开分享编辑会把公开附件 URL 写回正文**：保存时服务端把 `/api/public/shares/<token>/attachments/<id>` 归一化回 `/api/attachments/<id>/content`；否则后续应用内图片失效。
9. **分享管理列表越权**：原列表接口只检查读权限；已改为 `canShare`（editor/admin/owner）。
10. **PDF meta 与标题重叠**：导出 HTML `.meta` 负数 margin 改为正常间距；PDF 已验证 1 页可读、含图片。
11. **全库 Markdown 附件相对路径**：原实现写成 `attachments/...`；已改为根据笔记层级加 `../` 前缀；单篇 ZIP 保持根相对。
12. **全库 HTML wiki link**：补 `data-note-title` 允许属性，导出时按标题映射到相对 HTML 文件。
13. **标签创建后 context 不显示**：原因是先更新笔记后刷新标签，乐观 note tags 为空；改为先 `refreshTags` 再 `updateNoteMeta`。仍需在真实 UI 复测。
14. **服务器进程被 SIGTERM**：开发时用 `pkill -f` 会匹配当前 shell 的命令行，导致误杀。生产使用 systemd；调试用 `ss -tlnp` 取 PID 后 kill。
15. **备份替换已验证**：备份 5 篇/1 文件夹/1 评论/7 版本；replace 后笔记数 5，自动生成 pre-restore（12 篇）备份；merge 生成 12 篇副本。0 错误。
16. **异地备份（S3）已验证**：本地 s3rver 模拟，配置/连接测试/备份上传/列表 badge/删除全部通过；测试后已删除 offsite 设置与测试备份，避免污染生产。

### 测试记录

- **性能基准（10,000 篇，PostgreSQL 本机）**：列表查询 8.7ms；中文关键词搜索（含标题/正文/标签 OR）55ms；count 59ms。目标“1 万笔记搜索 < 300ms”通过。测试库已删除。
- 登录/注册/自动保存/刷新持久化：通过（Playwright）。
- 分享只读公开页（无登录）：通过；`/s/<token>` 渲染标题/正文/作者/日期。
- 新建笔记、标签、评论、历史、命令面板、搜索：通过（标签 UI 显示待复测）。
- 备份创建/下载/预览/合并/替换：通过；pre-restore 生成。
- 导入 sample ZIP（2 篇 + 1 图片 + 2 文件夹）：通过；预览/执行/完成。
- 单篇 MD ZIP/HTML/PDF：通过；PDF 1 页、图片内嵌；字体/中文正常。
- 全库 MD/HTML ZIP：通过；层级/附件相对路径/wiki link 已验证。
- 2FA 开启、登录（下一窗口 code）、关闭：通过；备用码生成 10 个。
- 暗色桌面、移动端登录/列表/编辑器/设置截图：通过；无 JS errors。
- `npm run typecheck` server/web：通过；`npm run build` web：通过。

### 待办（按优先级）

- [ ] 生产部署：systemd、Nginx、TLS（360note.com/www）、环境密钥、管理员账户。
- [ ] 重置生产数据库为干净状态（当前为测试数据）；重新注册管理员并妥善保存恢复密钥。
- [ ] 将 deploy key 加入 GitHub 并 push 全仓；若未加，需用户操作。
- [x] 明确 v0.1 中文优先；语言切换暂时隐藏，避免中英混排；英文完整翻译为 P1。
- [ ] 离线最近 200 篇预取；附件离线队列（P1）。
- [x] 异地备份 S3 兼容（P1）已实现并验证；WebDAV/远端直接恢复待加。
- [x] 1 万笔记性能基准：列表 8.7ms / 搜索 55ms；5 万待测。
- [x] 最近 120 篇离线预取；离线刷新/编辑/联网合并实测通过。
- [x] S3 兼容异地备份实现并在本地 s3rver 验证；生产测试配置已清理。
- [x] 批量选择、实例管理页、API token scope 限制、OCR/ENEX 导入验证。
- [ ] 2FA/备份/恢复/导入导出 E2E 自动化固化。
- [ ] 生产监控/日志/告警、备份定时器验证。
- [ ] 清理测试用户/测试笔记/测试分享/测试备份；保留干净初始状态。
- [ ] 替换内存中的 `360note.com` OG 图/社交预览（可选）。
- [ ] 完整审查英文/隐私/条款与实际行为一致性。

### 环境/凭据（不入库）

- 生产密钥只放 `/etc/360note/360note.env`，权限 0600；不写入仓库/文档。
- 测试账户仅用于开发，部署前删除。

### 决策链接

- `docs/decisions/001-web-first-offline-cache.md`
- `002-markdown-truth-and-title.md`
- `003-conflict-version-merge.md`
- `004-security-no-email.md`
- `005-backup-independent.md`
- `006-e2ee-deferred.md`
- `007-no-crdt-realtime.md`

---

## 2026-11-08 · 生产上线

### 部署结果

- 域名：`https://360note.com`（`www` 301 到 apex）；HTTP 301 到 HTTPS。
- TLS：Let's Encrypt，证书到期 2027-02-05；`certbot.timer` 已启用；无邮箱注册。
- 服务：systemd `360note.service` 运行 `/opt/360note/apps/server/dist/index.js`，`127.0.0.1:8787`；Nginx 终止 TLS。
- 数据库：PostgreSQL 本地；生产库已重置为干净状态。
- 数据目录：`/var/lib/360note`（0700）；env：`/etc/360note/360note.env`（0600）。
- 最终状态：1 个管理员、3 篇种子笔记、0 会话、0 分享、0 备份、0 附件、0 团队空间；管理员与恢复密钥保存在 `/root/360note-admin-initial.txt`（0600），生产密钥备份在 `/root/360note-secrets-backup.txt`（0600，应复制到离线后删除）。
- 未配置 AI、未配置 S3 异地；注册模式 `open`。
- Git：`main` 已推送到 `github.com:widgeted/360note`（deploy key 已添加）；最终提交 `cf29d55`。

### 最终验证

- HTTPS 健康检查通过；CSP/HSTS/XFO DENY/Permissions-Policy 存在；`www` 重定向。
- PWA：manifest 3 icons、2 shortcuts、share_target `/clip`；service worker 已控制；离线刷新/编辑/联网合并通过。
- 桌面/移动/暗色/设置/分享弹窗/实例管理页无 JS 错误。
- 分享密码/错误密码/解锁/撤销 404；公开页渲染正常。
- 2FA 开启/登录/关闭、TOTP 防重放；恢复密钥机制。
- 备份创建/下载/预览/合并/替换；pre-restore 生成；S3 兼容异地备份在 s3rver 验证后清理。
- 导入 Markdown ZIP、ENEX（修复 XML prolog 后）、OCR 图片；搜索/附件命中。
- API token read-only：GET 200、POST 403、auth 403；撤销后 401。
- 10k 笔记基准：列表 8.7ms、搜索 55ms。
- 单元测试：server 7、web 3；typecheck/build 通过。
- npm audit：0 high/critical；5 moderate（archiver 7 → readdir-glob → minimatch DoS；ZIP 输入由本应用控制，记录待上游修复）。

### 上线后事故与修复

- 尝试升级 `archiver@8` 以消除 moderate audit：其 ESM 无 default export，导致服务启动失败（502）。快速回滚到 `archiver@7.0.1`，重新构建/部署，健康恢复。教训：依赖 major 升级必须在独立 staging 启动验证；本次已记录。
- PDF 在生产 501：systemd 非 root 下 Chromium 需要可写 HOME/XDG 目录与 `--user-data-dir`；已修复 `pdfFromHtml`，PDF 导出恢复（311KB/2 页验证）。静态首页/导出/备份不受影响。
- 当前生产会话已清理；管理员需重新登录。

### 未完成/后续

- 全库离线预取仅最近 120 篇；附件离线不可上传。
- 无 E2EE、无实时协同/CRDT、无 @提及/Webhook/MCP。
- 英文 UI 暂不开放。
- 异地备份无应用内远端浏览/直接恢复。
- 5 万笔记性能、自动备份定时实跑、恢复演练自动化待补。
- 管理员初始密码需用户登录后修改；恢复密钥需离线保存。

---

## 2026-11-08 · 入口重构、视觉纠偏与“即时推送”铁律

### 用户反馈（原意）

- 首页非常丑：使用了宋体；部分文字小到离谱（“隐私政策”“服务条款”“忘记密码”）；hover 出现下划线/按钮上浮；相邻元素边框可能重叠；按钮缺少统一分级；logo 像 AI 生成；整页 AI 味重、风格割裂；报错方式本身也是错的。
- 注册时出现 Nginx 502 原始 HTML；即使暂不可注册，也必须提供可用管理员账号先查看内容。
- 相比营销首页，直接打开登录页/笔记页更好。
- **每次更新都必须第一时间推送到 GitHub**，避免本服务器代码发生意外。

### 已执行的纠正

1. **移除营销首页**：`/` 直接重定向 `/app`，未登录显示登录页。删除 `LandingPage.tsx` 与营销样式；新增 `AuthLayout`：顶部仅文字品牌，中央登录表单，底部 14px 隐私/条款与版权。
2. **全站去衬线**：移除 `@fontsource-variable/newsreader`、`--font-serif`、`.prose.serif`、编辑器“衬线”偏好；`tokens.css` 仅保留 Inter + 系统中文字体。登录、笔记标题、分享页、导出、503 页统一无衬线。
3. **字号下限 13px**：全站 CSS/内联字号扫描并提升；`--text-xs` 改为 13px；隐私/条款/忘记密码/时间戳/错误说明不小于 13px；登录输入 44px、按钮 44px。
4. **去掉廉价的 hover/active 效果**：删除全局 `a:hover { text-decoration: underline }`、按钮 `translateY/scale`、列表快捷操作上移、主题卡选中 ring、脑内链接下划线；hover 仅改颜色/背景。弹窗/抽屉/Toast 的进入动效保留。
5. **边框纪律**：选中态不再叠加 `box-shadow: 0 0 0 1px`；菜单/列表/输入只保留一层 1px 边框；搜索行加 `min-width: 0`，修复新建按钮溢出；按钮统一 36px 标准/30px 小号/44px 大号，圆角 8/7px。
6. **品牌重做**：放弃“圆角方块 + N 字形”的 AI 感图标，改为文字标识 **360note.**（蓝色句点）；PWA/favicon 为同源 “N.”；折叠侧栏显示 “N.”。删除分享页/邀请页/剪藏页中的旧图形 mark。
7. **错误体验**：Nginx 静态直出 SPA，API 反代；502/503/504 统一返回 `/var/www/360note-errors/maintenance.html` 品牌 503 页；前端 `api.ts` 把网关错误转为可读中文，不再渲染 Nginx HTML。
8. **502 根因与修复**：尝试 `archiver@8` 消除 moderate audit，但其 ESM 无 default export 导致 API 启动失败。回滚 `archiver@7.0.1`，重建部署，健康恢复。依赖 major 升级必须先 staging 启动验证，已写入运维教训。
9. **注册验证**：临时账号 `temp-reg-check@360note.com` 注册成功（HTTP 200），验证后删除；生产恢复为 1 管理员 + 3 篇种子笔记。
10. **清理 AI 痕迹**：移除种子笔记中的 👋 emoji（避免无 emoji 字体环境出现豆腐块）；空状态改用书写图标 `PenLine`，不用 Sparkles/机器人；移除玻璃拟态/backdrop-filter（侧栏、顶栏、弹窗遮罩只保留实色）。

### 铁律（后续必须遵守）

- **每次代码/文档/部署变更完成后，立即 `git add -A && git commit && git push` 到 `github.com:widgeted/360note`。** 不允许在本机积累多轮未推送改动；推送失败视为任务未完成。
- 任何视觉改动必须先对照 `docs/DESIGN_SYSTEM.md`；新增字体、字号、按钮变体、图标风格都先更新规范。
- 禁止：衬线/宋体、<13px 文字、hover 下划线/上浮/缩放、双边框/边框重叠、营销首页、AI 味 logo、服务器原始错误页。

### 验收

- `npm run typecheck`、`npm test`（server 14 + web 3）、`npm run build` 通过；生产 `/health` 200，版本 `0.1.1`。
- Playwright 桌面/移动：登录、列表、编辑器、注册页无 JS 错误；搜索按钮不溢出；字体为 Inter/系统无衬线；“忘记密码？”14px，页脚链接 14px。
- API 停止时：`/login` 静态页 200，`/api/*` 返回品牌 503 页。
- 生产清理：1 管理员、3 篇种子笔记、0 会话、0 分享、0 备份、0 附件、0 通知、0 API token；临时注册账号已删除。
- 本轮改动已 `git commit` 并推送到 GitHub；管理员首登改密、恢复密钥离线保存仍需用户完成。

---

## 2026-11-08 · 第二轮全站体验修正（v0.1.2）

### 用户新反馈

- 编辑器内仍有大量宋体；侧栏折叠后 logo、通知、折叠图标排版错误且图标不切换。
- 切到浅色主题后左侧仍是深色。
- 鼠标悬停 logo 仍出现下划线。
- 实例管理“运行概况”中“用户”卡片高度不一致。
- 新建文件夹使用弹窗不自然，应改为列表顶部的内联命名。
- 系统出现两种浏览器图标且都丑。
- 共享笔记被编辑/评论后只有通知，无法直接查看评论和修改内容。
- 要求全站主动排查，而不是只修点名问题；代码要语义化、可读、可维护。

### 根因与修复

1. **宋体根因**：富文本表面没有显式 `font-family`；Markdown 源码/代码块使用 `--font-mono`，中文在该栈中回退到 SimSun/Songti；服务端 `exportHtmlDocument` 和全库 HTML 索引仍写着 Newsreader/Songti/Georgia。
   - `.prose` 显式 `font-family: var(--font-ui)`。
   - `--font-mono` 在 generic monospace 前加入 PingFang/Noto Sans CJK/Source Han Sans/Microsoft YaHei。
   - 导出 HTML/PDF 和工作区索引全部改为 Inter/系统无衬线；导出中的 `a:hover` 也不再下划线。
2. **浅色主题侧栏仍深色**：侧栏 token 被固定成 `--ink-900`，且大量硬编码 `#c9c7c1/#fff`。新增浅色侧栏 token（暖纸 #f1eee7、深字、蓝 accent）与深色覆盖；workspace mark、nav、树、标签、用户区全部改用 token。迁移外观预览的迷你侧栏颜色。
3. **折叠侧栏布局**：折叠时 `.sidebar-brand` 改为纵向两行：`N.` 一行，通知 + 展开按钮一行；按钮 24px，间距 4px，品牌高 70px。`PanelLeftClose`/`PanelLeftOpen` 随 `sidebarCollapsed` 切换，`aria-label/title` 同步。
4. **Logo 下划线**：给 `.sidebar-brand > a`、`.brand-lockup` 及子元素加 `text-decoration:none`（含 hover/focus）；同时给 Nginx 的 `/` 加 `expires -1`、hashed `/assets/` 长缓存，避免旧 CSS/旧 favicon 被浏览器/SW 继续使用；Workbox 开启 `cleanupOutdatedCaches/skipWaiting/clientsClaim`。
5. **管理员统计卡高度**：根因是 `.setting-card + .setting-card { margin-top:10px }` 误作用到 grid 子项。改为 `.admin-stats` 专用 grid（`grid-auto-rows:1fr`，清除 sibling margin，统一 min-height），实测 6 张卡均为 99.2px。
6. **文件夹/标签命名**：删除新建/重命名的名称弹窗；`InlineNameInput` 在文件夹树顶部或原名位置内联渲染，Enter/失焦保存，Esc 取消；标签同样处理。删除确认仍保留弹窗（破坏性操作）。
7. **通知深链**：
   - 分享评论链接 `/app/note/<id>?panel=comments&comment=<commentId>`；分享编辑链接 `/app/note/<id>?panel=history&version=<n>`。
   - AppPage 读取 `panel` 并打开上下文面板；ContextPanel 读取 `comment/version`，滚动并高亮目标评论，或自动加载目标版本预览。
   - 登录用户评论他人笔记时也写入通知（此前只有公开分享评论会通知）。
   - 通知行增加“查看评论/查看修改/查看安全设置”动作词。
8. **图标统一**：favicon/PWA/apple-touch 全部由同一个几何 N. SVG 生成；删除 Globe2 浏览器式图标，分享链接改 Link2；登录设备统一为 `MonitorSmartphone` 单一设备图标，不再混用 Laptop/Smartphone。
9. **信息面板遮挡**：上下文面板的抽屉断点从 1600px 改为 1240px（与设计系统一致）；1440px 下并排，实测 panel x=1096、main right=1096，无重叠。
10. **边框/按钮统一**：设置导航增加透明占位边框，避免 active 时 1px 位移；移除 new-note 按钮残留 transform 过渡；移除死代码旧 auth/marketing 样式中的无用规则。

### 验证

- `npm run typecheck`、server 14 + web 3 tests、`npm run build` 通过。
- Playwright：浅色侧栏 `rgb(241,238,231)`、深色侧栏 `rgb(6,9,21)`；logo hover 无下划线；折叠后 logo/bell/toggle 分别为 y=13/38/38，不重叠。
- 新建文件夹内联框出现；Esc 取消无残留；新建/重命名/标签均不弹窗。
- 1440px 信息面板并排，无遮挡；管理员 6 张统计卡等高。
- 实际创建 share + 访客评论，通知点击后 URL 带 `panel=comments&comment=...`，评论面板打开并高亮目标；手动插入版本通知后点击自动加载版本预览。
- 导出字体源中已无 Newsreader/Songti/Georgia；Markdown source 计算字体栈包含中文字体回退。
- 测试临时文件夹、评论、分享、通知、临时版本通知均已清理；用户已有笔记与登录设备未删除。

### 待办

- [x] 已清理测试产生的 HeadlessChrome 会话；保留用户自己的 3 个 Firefox 登录设备。
- 若用户仍看到旧图标，强制刷新一次；Nginx/Workbox 已做缓存失效。
- 版本 v0.1.2 已构建部署，`/health` 返回 `0.1.2`。

---

## 2026-11-08 · 第三轮全站 bug 与控件规范（v0.1.3）

### 反馈与根因

1. **“新建笔记”按钮是黑点**：`.new-note-btn` 深色底仍使用 `--sidebar-text-strong`；浅色主题下该 token 是深色，图标与背景融成黑点。改为蓝底白字（深色主题蓝底深色字），并统一为 36px。
2. **通知浮层一滚就消失**：`Dropdown` 在全屏捕获 `scroll` 时无条件 `setOpen(false)`，连面板自身滚轮/滚动条滚动也会关闭。改为：滚动事件目标在面板内则忽略；pointerdown 若落在面板几何区域内（含原生滚动条）也不关闭。
3. **折叠后图标拥挤**：品牌/通知/展开由同一行改为纵向分层；`N.`、通知、展开各占一行；底部隐藏“更多”图标，头像本身即账户菜单入口，避免头像与更多挤在一行。
4. **标签**：侧栏圆点改为 `#` 图标；标签列表改为 `flex-wrap` chips，一行可多个；标签区底部 padding 16px + margin 12px，与设置分隔线实测间距 28px。ContextPanel 标签 chip 也改用 `#`。
5. **输入框过大**：基础 `.input/.select` 由 9px padding 的 44px 高改为 36px 标准；新增 30px `.input-sm/.select-sm`、42px `.input-lg`、认证页 44px。ContextPanel 标签搜索和团队角色选择统一 30px。
6. **数据与备份卡片不等高**：有两个根因。其一，全局 `.setting-card + .setting-card { margin-top:10px }` 漏进所有 Grid；其二，数据/导入步骤使用 `.principles-grid` 但该类从未设置 `display:grid`，实际是 block 堆叠，`gap` 也不生效。删除全局 sibling margin；补上 `.principles-grid { display:grid }`；为 `.export-grid/.steps-grid/.restore-counts/.import-counts/.principles-grid/.admin-stats` 增加 `align-items:stretch`、`grid-auto-rows:1fr` 与子卡 `height:100%`。实测导出卡 164.6px×3、导入步骤 100.4px×3、About 129.8px×3、管理员 99.2px×6 全部等高。
7. **勾选态黑点风险**：`.note-check.checked` 原用 `--sidebar-text-strong`，在蓝底上对比错误；改为白/深色显式对比。
8. **全站同类扫描**：设置页所有 `.settings-inner .input/.select` 实测 36px；各设置页卡片 Grid 无行高差异；Dropdown 统一修复；深色底图标使用显式对比色。

### 验证

- typecheck、server 14 + web 3 tests、build 通过。
- Playwright 1440×980：通知面板滚轮/滚动条滚动后仍存在；折叠侧栏 bell y=36、toggle y=64，纵向分层；头像 y≈941，More 隐藏。
- 标签 chips：3 个标签 2 行显示，最后 chip 到分隔线 28px；`#` 图标显示。
- 账号输入 36px；数据页输入 36px；导出卡全部 164.6px；步骤卡全部 79.6px；管理员卡全部 99.2px。
- 浅色侧栏 `rgb(241,238,231)`、深色 `rgb(6,9,21)`；新笔记按钮浅色蓝底白字、深色蓝底深色字。
- 用户正在使用的笔记/文件夹/标签/会话未被删除；仅新增测试会话在验证后清理。

### 版本

- v0.1.3；文档同步 DESIGN_SYSTEM 0.4、QUALITY、CHANGELOG。

---

## 2026-11-08 · 第四轮通知、菜单、空间与编辑器底栏（v0.1.4）

### 反馈与根因

1. **共享笔记的编辑/评论看不到**：既有通知是在深链功能之前写入数据库的，link 只有 `/app/note/<id>`；新前端虽会读 `panel`，旧通知没有参数，所以只打开笔记。
   - 前端按通知类型补全：评论 → `?panel=comments`，共享编辑 → `?panel=history&preview=latest`；点击后同时关闭浮层，避免下次点击铃铛反而把面板关掉。
   - 历史数据同步更新：评论通知补 `panel=comments`，共享编辑通知补 `panel=history&preview=latest`。
   - 历史面板在 `preview=latest` 时自动预览最新版本；新通知仍带准确 `version`。
2. **蓝点不消失**：生产库里有两类未读“新的登录设备”，来自我们自己的 Headless Playwright 登录（IP 118.26.37.116），不是用户操作。已删除测试安全通知并把剩余真实通知标记已读；以后测试结束必须清理测试会话/通知。
3. **折叠头像热区超出头像**：`.sidebar-user` 在折叠时仍是整行宽度 + 7px 上下 padding。改为 26×26 按钮、26×26 头像、padding 0、margin auto，热区严格等于头像边界。
4. **空间切换 popover 偏左**：`Dropdown` 用外层 `<span>` 的矩形定位，工作区触发器外层 span 从 x=0 开始，导致面板 left=0。改为使用第一个真实子元素（按钮）的 rect；x 从 0 修正为 10，宽度统一 180。
5. **创建/管理空间同页**：侧栏两个入口都跳 `/app/settings/team`（仅 query 不同），页面没有读取 `?create=1`，所以表现一样。现在创建入口打开独立“创建团队空间”弹窗；管理入口只进入当前空间设置；关闭弹窗会移除 query。
6. **菜单不统一**：文件夹 170、标签 160、用户 210、排序 186、编辑器 226、工作区 238。全部统一为 180px（通知中心 320 作为信息面板例外）；图标“…”右对齐，全宽触发器左对齐。
7. **“安全”图标是标签**：Sidebar 用户菜单误用 `Tag` 图标；改为 `ShieldCheck`。
8. **source-footer 对齐/重复统计**：原来右侧显示“字数 · 字符数”，且 footer 跟随内容高度，短内容时停在中部。改为左侧仅 Markdown、右侧仅字符数；`.source-mode` 最小高度 `calc(100dvh - 300px)`、footer `margin-top:auto`，实测底边 878px < 视口 980px。
9. **全站附带修正**：普通菜单宽度/对齐扫描；设置页输入/卡片高度扫描；通知蓝点；空间弹窗；头像热区；源码底栏。

### 验证

- 通知蓝点 DOM span 数 0；旧评论通知点击后 URL `?panel=comments`，评论面板和评论内容可见。
- 旧共享编辑通知对应链接 `?panel=history&preview=latest`，历史面板自动加载版本预览。
- 空间 popover x=10、width=180；用户菜单 x=10、width=180；文件夹/标签/排序/编辑器菜单统一 180。
- 创建空间：`/app/settings/team?create=1` 打开模态框；关闭后 URL 去掉 `create=1` 且模态框消失；管理空间无模态框。
- 折叠头像按钮与头像均为 26×26，坐标完全一致。
- Markdown source footer 文本 `Markdown | {n} 字符`，bottom 878 < viewport 980。
- typecheck、server 14 + web 3 tests、build 通过；用户已有笔记/文件夹/标签未删除。

### 版本

- v0.1.4；DESIGN_SYSTEM 0.5、QUALITY、CHANGELOG 同步。

---

## 2026-11-08 · 第五轮分享、表格、导出、并发与视觉收敛（v0.1.5）

### 新增反馈与修复

1. **分享后编辑提醒**：分享对话框存在有效链接时显示信息提示；创建链接的 toast 说明“访客看到的是最新版本，后续编辑会立即反映”。分享页始终读取最新正文（非快照）。
2. **PDF 字体过大**：导出 HTML 的打印样式加入 A4 页面、10.5pt 正文、22pt 标题、9pt 代码/表格；PDF 实测 A4 827×1170px、字体接近编辑器在合适宽度下的阅读效果。
3. **上传/导出时分享弹窗闪烁与冲突副本**：根因是自动保存没有串行化；800ms 定时保存与手动保存/切换模式可以用同一个 `baseVersion` 并发 PATCH，后一个请求 409 后触发冲突副本。现在编辑器保存改为**单飞 + 合并排队**：同一时间最多一个 PATCH，在途期间只标记一次后续保存，响应后更新 baseVersion 再保存最新内容。持续输入、上传附件、导出 PDF 不再制造同 baseVersion 竞争。
4. **表格操作**：TipTap 表格上下文栏加入行/列菜单：
   - 上方/下方添加行、删除当前行；
   - 左侧/右侧添加列、删除当前列；
   - 直接删除表格，无需先选中整表。
5. **附件删除仍显示**：ContextPanel 之前根本没有删除附件的入口；增加每项删除按钮，两次点击确认，删除后 `reloadNote()` 刷新附件列表。附件列表还只显示仍被正文引用的附件，从正文移除或删除 DB 后都不会继续显示。实测上传→删除→列表为 0。
6. **切换板块延迟**：切换全部/最近/收藏/回收站时，旧列表会停留到请求完成。`setFilter` 现在立即清空旧列表并显示 loading skeleton，再请求对应板块，避免看到不匹配的旧数据。
7. **同步/保存状态重复**：删除侧栏“已同步”状态、移动端 sync dot；只保留编辑器右上角 save status。底部 `.editor-footbar` 移除“字数”，只保留字符数、版本和聚焦/模式；字数只在上方元信息。
8. **新建按钮太扎眼**：搜索框右侧按钮从蓝色实心块改为白底细边框、蓝色图标、36px 高度，与搜索框等高，hover 才出现淡蓝底。
9. **历史“保存版本”虚线**：`.context-add-tag` 改为实线细边框，和整体控件一致。
10. **编辑模式重置**：EditorPane 原先在每次 note 加载 effect 里强制 `setMode(user.prefs.defaultNoteFormat)`。删除该重置；模式选择持久化到 `localStorage['nh-editor-mode']`，切笔记/返回后恢复。
11. **聚焦模式**：移除右上角悬浮 `.focus-exit`；编辑器底栏聚焦按钮根据 `focusMode` 切换为“退出聚焦”，点击即可退出。
12. **Markdown 模式冗余**：删除顶部“Markdown 源码模式 · 所有更改都会自动保存”提示条和 `.source-footer`，只保留 `.editor-footbar`。
13. **空间模型**：个人空间和团队空间都可以创建多个。个人空间私有、可重命名、不可邀请；删除时必须保证账户至少保留一个空间。团队空间支持成员/角色/邀请/审计。设置页改名为“空间”，新增空间概览、切换、个人/团队说明；创建弹窗可选择个人/团队，管理入口管理当前空间。
- **空间命名只输入一个字**：根因是 Modal 的焦点管理 effect 依赖每次渲染都变化的 `onClose`；每次 keystroke 都重新聚焦弹窗关闭按钮。现改为只依赖 `open`，保存最新 onClose ref，并优先聚焦输入/文本域。同时修复分享/上传窗口被父组件重渲染打断的闪烁。
14. **菜单宽度再收敛**：普通菜单从 220px 降到 **180px**（通知中心 320 面板例外）；Dropdown 用真实触发按钮定位，工作区/用户菜单 x=10。（第六轮改为内容自适应，见下方。）
15. **Banner/Toast 对齐**：统一为 16px 图标列 + 文本列 + 固定关闭列的网格；图标与首行文字顶部对齐，文本 `min-width:0`。安全页提示与“端到端加密”标题间距通过 `.banner + .settings-section` 统一为 30px。
16. **账户排版**：显示名称、邮箱、保存按钮放入同一个 `profile-fields` 列；输入与保存按钮均 36px，头像圆形。
17. **头像/logo/浏览器图标**：头像改圆形白字；Logo 改为几何 `N.` 标记 + `360note` 文字；favicon/PWA/apple-touch 由同一 SVG 源生成；favicon URL 添加 `?v=5` 缓存失效。（第六轮改为默认文字标识，折叠时才显示 `N.`。）
18. **深色表面**：`--ink-900/950` 由深蓝海军色改为暖炭色，toast/代码块不再与淡黄纸面形成冷暖冲突。
19. **Modal 焦点与闪烁**：`Modal` 的焦点管理 effect 依赖每次父组件渲染都会变化的 `onClose`，导致空间命名弹窗等每输入一个字符就重新聚焦关闭按钮；分享/上传父组件重渲染时也会闪烁。改为 `onCloseRef` + 只依赖 `open`，优先聚焦输入/文本域。
20. **个人空间创建**：后端 `POST /api/workspaces` 接受 `kind=personal|team`；设置页创建弹窗可选择类型；个人空间可创建多个，删除时账户至少保留一个空间。
21. **账户菜单去重**：用户菜单只保留退出登录，账户/外观/安全统一由设置导航进入。
22. **移动端底部栏**：快速栏改为四等分 grid（笔记/搜索/收藏/设置），移除底部重复新建；顶部新建按钮与桌面共用 `.new-note-btn` 样式。（第七轮已移除底部快速栏。）
23. **移动端去重**：底部快速栏移除 `.mobile-quick-new`；新建只保留顶部 `.new-note-btn`，与桌面同一套白底细边框/蓝图标样式。快速栏为四等分，第一项改用 FileText 图标，避免与新建图标相同。（第七轮已移除底部快速栏。）
24. **分享页增强**：公开页增加复制链接按钮；打印样式与元信息已在 0.1.5 前完成。
25. **Demo 账号**：当前演示账户由 `scripts/provision-accounts.mjs` 创建，包含中英文、Markdown/富文本、表格、图片、附件、标签、文件夹、评论、版本、分享、回收站、第二个人空间、团队空间和一份备份；密码与恢复密钥保存在服务器 `/root/360note-credentials.txt`，不写入仓库。
26. **打印**：分享页新增专用 `@media print`，隐藏评论、目录、按钮、分享品牌；打印元信息包含发布、更新、打印时间，格式 `yyyy年MM月dd日 HH:mm`；正文/代码/表格使用浅色打印样式。（第六轮改为“更新相对时间 + 发布/打印完整时间”。）

### 验证

- typecheck、server 14 + web 3 tests、build 通过；`/health` 0.1.5。
- PDF：`pdfinfo` A4、827×1170px 首屏，10.5pt 正文；`pdftoppm` 无字体溢出。
- 表格：插入表格后出现上下文栏，行菜单可添加/删除；截图确认。
- 附件：上传 1 个附件→信息面板 1 项→两次点击删除→0 项。
- 分享：创建分享后对话框显示“访客看到最新版本”提示；分享页读取最新正文。
- 模式：切换富文本后刷新回到编辑仍为富文本；Markdown 模式无提示条/第二个 footer。
- 菜单/头像/空间/品牌均按上述尺寸验证；测试临时笔记、附件、分享、会话已清理。

### 版本

- v0.1.5；DESIGN_SYSTEM 0.8、QUALITY、CHANGELOG 同步。


---

## 2026-11-08 · 第六轮移动端、注册、分享、Wiki 与安全审计

### 根因与修复

1. **移动端侧栏阴影**：`.sidebar` 在 `responsive.css` 的移动端媒体查询里仍有 `box-shadow: var(--shadow-lg)`；删除后实测 `box-shadow: none`。
2. **菜单图标位置与重复**：移动端展开按钮原先在列表操作区，使用与设置相同的滑块图标。移到搜索框左侧，改为 `PanelLeftOpen`（面板展开语义），设置仍用 `SlidersHorizontal`；实测按钮 x=14、搜索框 x=47。
3. **“我的空间”点击无效（关键 bug）**：空间切换菜单能打开，但被移动端侧栏盖住。`--z-dropdown` 原为 40，移动端侧栏为 60，Playwright 报“回收站拦截点击”。把 `--z-dropdown` 提升到 70（Modal 80、Toast 100），菜单即可点击；实测切换到“产品团队”成功后侧栏关闭，重新打开切换回“演示空间”。
4. **文件夹/标签间距过大**：侧栏树使用 `flex:1` 吃掉剩余高度。改为 `flex:0 1 auto; max-height:38vh`，标签区紧跟在文件夹后，同时保留滚动能力。
5. **账户菜单**：整行用户信息不再是触发器；只有右侧“…”按钮打开“退出登录”。菜单宽度由固定 180/210px 改为内容自适应（140–360px），退出菜单实测 140px；笔记更多菜单 161.6px。全宽空间触发器左对齐，“…”触发器右对齐。
6. **Logo**：默认为 `360note.`（深色文字 + 蓝色句点），不再默认显示几何 N 标记；折叠侧栏 56px 时才显示 `N.`。修复登录/注册/分享顶栏链接继承全局蓝色导致整词变蓝的问题；这些顶栏现在显式继承深色文字。（第七轮改为便签 mark + wordmark。）
7. **Wiki 链接**：
   - 旧 demo 内容被 Turndown 转义成 `\[\[...\]\]`，导致只显示字面量、不能点击；已迁移为 `[[...]]`。
   - 编辑器 decoration 现在隐藏 `[[`、`]]` 与别名前缀，只显示标题；默认普通单击跳转（不再要求 ⌘/Ctrl）。
   - 目标不在当前过滤列表时，`onWikiOpen` 通过 `/api/search?workspaceId=...&q=标题` 精确解析，找不到才提示。
   - 分享页/版本预览的 `wikiLinkify` 仍显示纯标题。
8. **本地摘要**：删除 `/api/ai/local-summary` 路由、SummaryDialog 的本地生成分支、命令面板入口和“本地摘要仍可用”的设置文案；只在 `instance.aiEnabled` 时显示“生成摘要”。
9. **冲突副本进入历史**：新增 `addConflictVersion` 服务与 `POST /api/notes/:id/conflicts`；客户端冲突时把本地内容写入 `note_versions(reason='conflict')`，编辑器打开历史面板。原来 11 条 `标题（冲突副本 时间）` 笔记已迁移到 `note_versions`，`notes` 中冲突副本为 0；新增幂等迁移 `002_conflict_history.sql` 供其他实例升级。历史 UI 标签改为“冲突副本”，不显示版本号。
10. **打印时间**：分享页更新信息改为 `formatRelative`（如“大约 1 小时前”）；打印元信息保留完整发布/打印时间。
11. **注册页排版**：根因是 `.auth-form` 只有 `gap` 却没有 `display:flex`，字段实际没有间距。补 `display:flex; flex-direction:column; gap:17px`；注册页使用 560px 卡片与 2×2 字段网格，移动端单列；首次聚焦/错误/按钮间距恢复。
12. **分享页排版**：元数据分“作者/发布/更新 + 右侧操作”两组；评论表单卡片化；附件使用图标列表；页脚去掉“由 360note 发布”重复品牌；顶栏 CTA 使用次级按钮；移动端 390px 无横向溢出。
13. **HTML 表格与摘要清理**：5 篇 demo 笔记的 HTML 表格转为 GFM Markdown；`excerpt()` 先移除 HTML 再走 Markdown 清理，避免 `<table style=` 泄漏；`markdownToPlainText` 移除表格分隔行和任务复选框；回填全部 27 篇笔记摘要。
14. **样式审计**：Playwright 扫描 1440×960 与 390×844 的登录、注册、分享、应用首页、账户、外观、移动首页/分享页，无 <13px 可见文字、无横向溢出；`font-size` 的 em 写法加 `max(13px, …)` 下限。
15. **安全修复与审计**：
    - 反向链接查询增加 `n.workspace_id = $3`，阻止跨工作区标题碰撞泄漏。
    - 个人空间禁止创建邀请（服务端 403）。
    - 导入 zip 在解压前检查条目声明大小，防 zip 炸弹。
    - 公开分享评论/编辑分别限流 20/10min、30/10min。
    - API token scopes 只接受 `notes:read` / `notes:write`。
    - 通知未读数改为独立 count，不再只数最近 50 条。
    - Nginx 只转发 `X-Forwarded-For: $remote_addr`，避免伪造代理链；登录/注册 `next` 拒绝 `//` 与反斜杠跳转。
    - 回收站中的笔记不能新建分享；公开分享正文、编辑、评论和附件端点都显式排除 `trashed_at` 笔记。
    - 实测 note/folder/attachment IDOR 均 404、`/api/admin/stats` 403、无 CSRF 头 403、XSS 载荷被 DOMPurify 清除、`../../evil.txt` 存储为 `evil.txt`、只读 token 写入 403、`next=//example.com` 登录后停留 `/app`。
    - `npm audit --omit=dev` 仍有 5 个 moderate（archiver/minimatch）；升级 archiver@8 曾在生产失败，暂不升级，记录在 QUALITY 3.4。

### 验证

- `npm run typecheck` 通过；`npm test` server 14 + web 3 通过；`npm run build` 通过。
- 部署：rsync `apps/web/dist` 与 `apps/server/dist` 到 `/opt/360note`，更新 Nginx 配置，`systemctl restart 360note`；`/health` 0.1.5。
- Playwright 关键结果：Wiki 5 个链接、普通单击跳转成功；冲突历史含 v3 `conflict`；笔记列表无“冲突副本”；更多菜单无“生成摘要”；移动端无阴影、四项快速栏、空间切换成功、账户菜单仅“…”可开；打印元信息含“打印于”和相对更新；注册 560px/2×2；样式扫描 0 个 <13px。（第七轮移除底部快速栏。）
- 清理：测试临时笔记/附件/分享/token 已删除；15 个 HeadlessChrome 会话与 2 条未读测试安全通知已删除；admin/demo 未读均为 0。

### 待办 / 已知风险

- archiver 5 个 moderate 暂不升级；如需升级必须 staging 验证导出/备份。
- PDF 导出依赖 Chromium `--no-sandbox`（容器环境）；输入 HTML 已 sanitize，但仍是已知攻击面，后续可加独立低权限 worker。
- 无实时协作/CRDT；冲突以历史快照恢复。

### 版本

- v0.1.5（同日第六轮补丁）；DESIGN_SYSTEM 0.9、QUALITY、CHANGELOG、DEMO、ARCHITECTURE、FEATURES 同步；新增 ADR-009。


---

## 2026-11-08 · 第七轮品牌、空间菜单与移动导航

### 用户反馈

- Logo 反复修改仍不满意；用户给出“手写便签 + 笔”的参考，要求类似的方向。
- 点击“空间”后下拉菜单对齐不正确。
- 移动端底部快速栏没有必要：搜索在列表顶部，收藏/设置/空间在侧栏抽屉里；应移除。
- 设置页需要针对移动端优化访问深度；继续参考优秀开源项目的移动/桌面布局、菜单和功能，保持整体一致。

### 实现

1. **新品牌 mark**：`Logo.tsx` 改为暖墨色圆角底 + 米色便签（三条手写墨迹）+ 金色钢笔。默认完整显示 mark + `360note.` wordmark；折叠侧栏只显示 mark。favicon.svg、favicon.png/.ico、PWA 192/512、maskable、apple-touch 全部由同一 SVG 重新生成；`index.html` 缓存版本更新为 `?v=6`。之前“纯文字标识/N. 标记”的决定被本轮取代。
2. **空间菜单对齐**：`Dropdown` 新增 `width="trigger"`；空间切换菜单使用触发器实际宽度。桌面菜单 229px、移动端 237px，左右边缘与空间切换器完全对齐；其他普通菜单仍为内容自适应 140–360px，账户菜单 140px。
3. **移除移动端底部快速栏**：删除 `.mobile-quickbar` JSX、CSS 与 print 选择器；列表底部 padding 从 86px 降为 `20px + safe-area`。移动端搜索在列表顶部，收藏/设置/空间在侧栏抽屉；新建只在搜索框右侧出现一次。
4. **移动设置访问深度**：
   - 设置导航在 ≤760px 改为 3×3 网格（管理员 10 项时自动 4 行），9 个分区一屏、一触达，不再三组换行。
   - 设置分区切换保留 `location.state.from`；从笔记进入设置后，“返回笔记”回到原笔记 URI，而不是无条件回列表。
   - 移动端设置页隐藏重复的右上“返回笔记”文字按钮，只保留左上返回箭头。
   - 设置内容独立滚动，导航不被内容滚走；内容底部 padding 使用 safe-area。
5. **一致性清理**：空间/账户/标签菜单宽度规则统一；账户菜单仍只由右侧“…”触发；移动端不再有与顶部搜索/抽屉重复的底栏；设置页的移动端标题、返回、导航层级与桌面同一套 token。

### 参考与判断

- 移动端采用 Trilium/Joplin/Standard Notes 的“抽屉 + 列表/编辑器单屏栈”结构，而不是把桌面四宫格做成底栏。
- 设置页采用 Notion/iOS 设置的“扁平一屏分区”，所有分区一触达；返回保留来源上下文，减少“从笔记进设置后回不到笔记”的深度损失。
- 空间菜单采用 Notion/Linear 的空间切换器模式：全宽触发器与菜单同宽，避免 140px 小浮层悬在宽按钮下方。

### 验证

- Playwright 390×844：`.mobile-quickbar` 数量 0；列表底部 padding 20px；设置导航 9 项、3 列 149px 高（单项 40px）、无重复返回按钮；空间菜单 237px = 触发器 237px；侧栏无阴影；logo mark 数量 1。
- 桌面 1440×960：空间菜单 229px = 触发器 229px；从笔记进入设置后返回 URL 恢复 `/app/note/caac...`。
- 登录页：新 mark + wordmark 显示正常，文本仍 ≥13px。
- typecheck/build 通过；生产 `/health` 0.1.5。
- 清理：删除测试中误建的空“未命名笔记”；demo 仍为 10 篇活跃笔记 + 1 篇回收站笔记。

### 版本

- v0.1.5（第七轮补丁）；DESIGN_SYSTEM 1.0、QUALITY、CHANGELOG、DEMO、FEATURES 同步；新增 ADR-010（移动端抽屉与设置扁平导航）。

## 2026-11-08 生产上线状态

- 生产路径 `/opt/360note`，服务 `360note.service`，环境 `/etc/360note/360note.env`，数据 `/var/lib/360note`。
- Node 22 位于 `/opt/node22/bin/node`；Nginx 两个 vhost 共用 `127.0.0.1:8787`。
- 管理员与演示账户凭据保存在服务器 `/root/360note-credentials.txt`（0600），不进入 Git。
- 演示数据由 `scripts/provision-accounts.mjs` 通过真实 API 创建，覆盖中英文、附件、分享、评论、版本与团队空间。
- 安全回归：`tests/manual/security-audit.mjs`，当前 54/54 通过。
- SMTP 使用 `eu1.workspace.org:465`（noreply@360note.com）；测试邮件只发送到操作者明确提供的地址。
- 域名语言由 `domainLocale()` 固定，不依赖 localStorage 或用户偏好。
- 空间图标/颜色存储在 `workspaces.icon` / `workspaces.color`；编辑模式存储在 `nh-editor-mode:<noteId>`。

## 2026-11-09 细节回归

- 修复保存/恢复笔记时 PATCH 返回体缺失聚合字段（tags、attachmentCount）导致客户端标签丢失；服务端现在重新读取 SUMMARY_SELECT 行。
- 侧栏收起时只显示图标（`brand-icon`），完整 wordmark 不再溢出 56px 侧栏。
- 移动端通知按钮使用独立 `sidebar-icon-btn`，不再被 `.sidebar-collapse` 的移动端隐藏规则影响。
- 公开分享页任务列表保留 checkbox 并设置 `data-type=taskList`，与编辑器一致。
- 生产安全审计扩展为 65 项，当前 65/65 通过。
