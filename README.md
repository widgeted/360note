# 360note / 360笔记

**把想法留下，把知识连起来。**

360note 是一个安静、快速、本地优先的笔记空间。界面统一为“午夜色书桌 + 温暖纸张”，主色为绿色；Markdown 为底层格式，数据随时可以带走。

- 中文版：<https://360biji.com>
- English: <https://360note.com>
- 仓库：<https://github.com/widgeted/360note>
- 版本：0.1.42

两个域名共用同一套账户、笔记、附件与团队空间；域名只决定界面与邮件语言。

---

## 功能

- **记录**：自动保存、草稿恢复、撤销、版本历史、离线 outbox、三向合并与冲突副本。
- **整理**：文件夹、标签、收藏/置顶、全文搜索（标题/正文/标签/附件名/OCR）、双向链接。
- **多端**：桌面三栏、移动单屏、可安装 PWA；快速捕获、网页剪藏、模板、快捷键。
- **分享与协作**：只读、评论、可编辑分享链接，支持密码与有效期；团队空间提供 owner / admin / editor / viewer 角色、邀请、审计与所有权转移。
- **安全**：TLS、scrypt、2FA、登录设备、恢复密钥、审计；附件与备份 AES-256-GCM 加密。当前**不提供 E2EE**，服务器可读正文以支持搜索、分享与备份。
- **数据可携带**：单篇 Markdown/HTML/PDF；全库 Markdown + 附件/HTML/JSON；导入 Markdown/HTML/Evernote/Notion/CSV/JSON。
- **备份**：自动/手动/恢复前备份、下载/上传、恢复预览、合并/替换与时间点恢复、可选 S3 兼容异地备份。
- **邮件**：注册验证码、找回密码验证码、密码/邮箱变更通知、团队邀请。**不发送营销邮件。**

---

## 技术栈

- 前端：React 19、TypeScript、Vite、TipTap 3、Zustand、IndexedDB、vite-plugin-pwa、cmdk、marked、DOMPurify、Turndown、node-diff3。
- 后端：Fastify 5、PostgreSQL 15+（FTS + pg_trgm）、TypeScript、zod、nodemailer、archiver、adm-zip、gray-matter、fast-xml-parser、cheerio/NodeHtmlMarkdown、qrcode、tesseract/pdftotext（可选）、Chromium（PDF）。
- 部署：Nginx、systemd、PostgreSQL、Node.js 22、Let's Encrypt（由宝塔面板管理）。

---

## 本地开发

要求：Node.js ≥ 22，PostgreSQL ≥ 15。

```bash
git clone git@github.com:widgeted/360note.git
cd 360note
npm ci

sudo -u postgres psql -c "CREATE ROLE note360 LOGIN PASSWORD 'change-me'"
sudo -u postgres createdb -O note360 note360

cp deploy/360note.env.example .env
# 编辑 .env：DATABASE_URL / SESSION_SECRET / NOTE360_MASTER_KEY / SMTP_*
npm run dev
```

- Web：<http://localhost:5173>
- API：<http://127.0.0.1:8787>
- 首次注册的用户会成为实例管理员。
- 本地开发建议设置 `PUBLIC_ORIGIN=http://localhost:5173`。

生成密钥：

```bash
openssl rand -base64 32   # NOTE360_MASTER_KEY（必须 32 字节）
openssl rand -hex 32      # SESSION_SECRET
```

重新生成 `package-lock.json` 后请提交，确保生产环境使用 `npm ci`。

---

## 生产部署

生产目录：`/opt/360note`；服务：`360note.service`；环境文件：`/etc/360note/360note.env`；数据目录：`/var/lib/360note`。

```bash
npm ci
npm run build
sudo systemctl restart 360note
curl -fsS https://360note.com/health
```

生产形态：

- Nginx 终止 TLS 并直接提供 `apps/web/dist` 静态文件；`/api/` 与 `/health` 反向代理到 `127.0.0.1:8787`。
- systemd 以 `note360` 用户运行 API。
- PostgreSQL 本地数据库 `note360`。
- 数据在 `/var/lib/360note`（0700）。
- 密钥在 `/etc/360note/360note.env`（0600）。
- 每日自动备份；备份与附件加密。
- 两个 Nginx vhost：`360note.com` 与 `360biji.com`，共用同一个 API。

完整步骤、备份恢复与故障处理见 [`docs/OPERATIONS.md`](docs/OPERATIONS.md)。

---

## 邮件配置

```env
SMTP_HOST=eu1.workspace.org
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@360note.com
SMTP_PASS=...
MAIL_FROM=noreply@360note.com
MAIL_FROM_NAME=360note
```

- 验证码 10 分钟有效，同一邮箱 60 秒内不能重复发送，每小时最多 6 次。
- 密码找回优先使用邮箱验证码，也可以使用恢复密钥。
- 修改邮箱需要验证新地址并输入当前密码。
- 测试邮件只发送到操作者明确提供的地址（记录在服务器 `/root/360note-credentials.txt`）；不要向不存在的地址发信。

---

## 测试

```bash
npm run typecheck
npm run build
npm test
```

需要登录的手工/端到端脚本在 `tests/manual/`，使用 `NH_TEST_EMAIL` / `NH_TEST_PASSWORD`。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | 设计系统：token、字体、布局、组件、响应式、可访问性 |
| [`docs/FEATURES.md`](docs/FEATURES.md) | 功能规划、实现映射与验收 |
| [`docs/QUALITY.md`](docs/QUALITY.md) | 测试矩阵、安全清单、性能预算、发布检查 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 架构、数据模型、同步/冲突、安全、备份、导入导出 |
| [`docs/MEMORY.md`](docs/MEMORY.md) | 当前状态、已知问题、重要决策 |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | 部署、运维、备份恢复、升级、事故响应 |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | 版本历史 |
| [`docs/decisions/`](docs/decisions/) | ADR 决策记录 |

---

## 已知限制

1. **不提供 E2EE**：服务端可读正文以支持搜索/分享/备份；附件与备份仅静态加密。
2. **离线仅覆盖打开过的笔记**：附件离线不可上传。
3. **没有实时协作/CRDT**：同时编辑同一笔记可能生成冲突副本。
4. **备份默认在同一服务器**：建议配置 S3 兼容异地备份并定期下载。
5. **OCR/PDF 依赖服务器环境**：tesseract/pdftotext/Chromium；未安装时降级并提示。
6. **导入不保证复杂格式 100% 保真**：预览会显示警告。

---

## 安全与隐私

- 只发送账户必需的邮件，不发送营销邮件；不把笔记用于训练 AI。Cloudflare 边缘可能注入无 Cookie 的汇总访问统计，不读取笔记正文。
- 公开分享链接可能被搜索引擎索引；分享前请确认内容。
- 报告安全问题：请阅读 [`SECURITY.md`](SECURITY.md)，不要在公开 issue 中粘贴敏感数据。
- 此网站与“奇虎360”及其相关公司、组织、产品、品牌和商标无关。

---

## License

AGPL-3.0-or-later. 见 [`LICENSE`](LICENSE)。
