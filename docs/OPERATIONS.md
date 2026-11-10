# 360note 运维手册

> 生产域名：`360note.com` / `www.360note.com`  
> 本文包含可直接执行的部署、升级、备份、恢复与事故处理步骤。  
> 原则：先备份，再变更；所有密钥只存在于 `/etc/360note` 与离线保管处，不写入仓库。

---

## 1. 生产拓扑

```
Internet
  │ 80/443
  ▼
Nginx  (TLS, HTTP→HTTPS, proxy, 600MB body, streaming)
  │ 127.0.0.1:8787
  ▼
systemd: 360note.service  (User=note360)
  │
  ├── PostgreSQL 15 (127.0.0.1:5432)
  └── /var/lib/360note
        ├── attachments/
        ├── backups/
        ├── imports/
        └── tmp/
```

- 应用目录：`/opt/360note`
- 环境文件：`/etc/360note/360note.env`（0600）
- 数据目录：`/var/lib/360note`（0700，`note360:note360`）
- 运行用户：`note360`（非 root）
- 监听：`127.0.0.1:8787`，不直接对外

---

## 2. 一次性安装

### 2.1 系统依赖

```bash
apt-get update
apt-get install -y nginx postgresql postgresql-contrib certbot python3-certbot-nginx \
  fonts-noto-cjk chromium tesseract-ocr tesseract-ocr-chi-sim poppler-utils \
  rsync unzip curl ca-certificates
```

- Node.js ≥ 22（本机 `/usr/local/bin/node`，systemd 已按此路径配置；若不同，修改 service）。
- Chromium 用于 PDF；tesseract/poppler 用于 OCR；不装也能运行，相关功能会降级。

### 2.2 系统用户与目录

```bash
id note360 >/dev/null 2>&1 || useradd --system --home /opt/360note --shell /usr/sbin/nologin note360
install -d -m 700 -o note360 -g note360 /var/lib/360note
install -d -m 700 -o note360 -g note360 /var/lib/360note/{attachments,backups,imports,tmp}
install -d -m 750 -o root -g note360 /etc/360note
```

### 2.3 数据库

```bash
DB_PASS="$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)"
sudo -u postgres psql <<SQL
CREATE ROLE note360 LOGIN PASSWORD '${DB_PASS}';
CREATE DATABASE note360 OWNER note360;
GRANT ALL ON SCHEMA public TO note360;
SQL
echo "保存数据库密码到密码管理器：${DB_PASS}"
```

> 若数据库/角色已存在，先确认没有生产数据再重建；不要在生产上随意 `DROP`。

### 2.4 环境文件

```bash
install -d -m 750 /etc/360note
cp deploy/360note.env.example /etc/360note/360note.env
chmod 600 /etc/360note/360note.env

# 生成并填入
openssl rand -hex 32     # SESSION_SECRET
openssl rand -base64 32  # NOTE360_MASTER_KEY（必须 32 字节）
```

编辑 `/etc/360note/360note.env`：

- `PUBLIC_ORIGIN=https://360note.com`（必须与真实访问域名一致，否则分享链接/书签脚本会错）
- `DATABASE_URL=postgres://note360:<上一步密码>@127.0.0.1:5432/note360`
- `NOTE360_DATA_DIR=/var/lib/360note`
- `WEB_DIST=/opt/360note/apps/web/dist`
- `NOTE360_ENV_FILE=/etc/360note/360note.env`
- `REGISTRATION_MODE=open`（或 `invite` + `REGISTRATION_INVITE_CODE=...`）
- `BOOTSTRAP_ADMIN_EMAIL=owner@example.com`（可选，强烈建议：把首个实例管理员固定为这个邮箱；未设置时首个完成邮箱验证的注册者会成为管理员）
- `OCR_ENABLED=true`（已安装 OCR 时）
- `NODE_ENV=production`

### 邮件发送红线

- 测试期间**禁止**向不存在或未经验证的地址发送任何邮件。
- 测试用户必须使用保留域名（`@invalid.local`、`.invalid`、`.test`、`.example`）；服务端 `sendMail` 会拦截这些域名。
- 真实投递检查只允许 `access@126.com` 或操作者明确提供的地址。
- 不得通过直接调用 SMTP、绕过 `mailer.ts` 或修改测试地址来规避该规则。

**主密钥必须离线备份**（例如密码管理器）。丢失主密钥 = 加密附件与备份无法恢复。

### 2.5 部署代码

```bash
cd /root/360note
npm ci
npm run build

# 同步到 /opt/360note（保留 node_modules/dist，不复制 .git/测试产物）
rsync -a --delete \
  --exclude '.git' --exclude 'storage' --exclude 'test-results' \
  --exclude 'playwright-report' --exclude 'tests' \
  /root/360note/ /opt/360note/
chown -R root:360note /opt/360note
chmod -R g+rX /opt/360note
```

> 注意：静态资源文件名带 hash；**每次 build 后必须重启 Node**，否则新 `/assets/*` 可能 404（我们已在 notFound 中避免返回错 MIME，但旧进程不会知道新文件）。

### 2.6 systemd

```bash
cp deploy/360note.service /etc/systemd/system/360note.service
systemctl daemon-reload
systemctl enable --now 360note
systemctl status 360note --no-pager
journalctl -u 360note -n 80 --no-pager
curl -fsS http://127.0.0.1:8787/health
```

若 `node` 路径不同：

```bash
command -v node
# 修改 /etc/systemd/system/360note.service 的 ExecStart
systemctl daemon-reload && systemctl restart 360note
```

### 2.7 Nginx 与 TLS

```bash
# 1) 先启用 HTTP-only 配置，确保 ACME challenge 与应用可访问
cp deploy/nginx-360note-dual-domain.conf /etc/nginx/sites-available/360note
ln -sf /etc/nginx/sites-available/360note /etc/nginx/sites-enabled/360note
rm -f /etc/nginx/sites-enabled/default
mkdir -p /var/www/html/.well-known/acme-challenge
nginx -t && systemctl reload nginx

# 2) 用 webroot 签发证书（不注册邮箱，避免任何邮件）
certbot certonly --webroot -w /var/www/html \
  -d 360note.com -d www.360note.com \
  --agree-tos --register-unsafely-without-email
systemctl list-timers | grep certbot || true

# 3) 静态错误页（API 挂掉时替代 Nginx 默认 502）
mkdir -p /var/www/360note-errors
cp deploy/errors/maintenance.html /var/www/360note-errors/maintenance.html
chmod 644 /var/www/360note-errors/maintenance.html

# 4) 切换到完整 TLS 配置
# 生产模板为 deploy/nginx-360note-dual-domain.conf（双域名 + BT 证书路径）
nginx -t && systemctl reload nginx
```

> 完整 TLS 配置由 Nginx 直接提供 SPA 静态文件，只有 `/api/` 与 `/health` 反代到 Node。因此 API 重启时登录页不会变成 502；`502/503/504` 统一显示 `maintenance.html`。每次部署修改 `deploy/errors/` 后，记得同步到 `/var/www/360note-errors/`。
>
> 缓存策略：hashed `/assets/` 长缓存（1 年），`/`、favicon、manifest 使用 `expires -1` 强制重新验证。这样部署后不会继续显示旧 CSS、旧下划线或旧图标。

> 如果证书路径不同（例如 `/etc/letsencrypt/live/www.360note.com/`），修改 Nginx 配置中的 `ssl_certificate` 路径。首次配置不能引用尚不存在的证书，所以必须先 HTTP-only。

检查：

```bash
nginx -t
curl -I http://360note.com
curl -I https://360note.com
```

应看到 301 HTTP→HTTPS，以及 200/内容响应。

### 2.8 防火墙/端口

```bash
# 示例（如使用 ufw；本机当前未启用 ufw）
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

确保 PostgreSQL(5432)、Redis(6379)、Node(8787) 只监听 127.0.0.1。检查：

```bash
ss -tlnp
```

### 2.9 健康检查

```bash
curl -fsS https://360note.com/health | jq .
# {"ok":true,"version":"0.1.38","time":"...","database":true}
```

---

## 3. 首次管理员与初始数据

首个注册账户会成为实例管理员。

**推荐做法：** 部署完成后立即通过浏览器或 API 注册管理员，保存恢复密钥，不要让公开访客抢注。

```bash
# 示例：用强密码 + 管理员邮箱注册；密码/恢复密钥只保存在密码管理器
curl -fsS -c /tmp/nh-admin.jar \
  -H 'Content-Type: application/json' -H 'X-360note-CSRF: 1' \
  -d '{"email":"admin@360note.com","displayName":"360note 管理员","password":"<强密码>","locale":"zh-CN"}' \
  https://360note.com/api/auth/register | jq .
```

响应中的 `recoveryKey` 只显示一次，必须立即保存。首个用户 `role=admin`。

> 如果数据库里已有测试用户，部署前重建数据库：删除 `360note` 数据库与用户，再按 2.3 创建；否则测试用户会成为管理员/占用邮箱。

---

## 4. 更新与回滚

### 4.1 更新

```bash
# 1) 备份
curl -fsS -b admin.jar -X POST https://360note.com/api/workspaces/<workspaceId>/backups | jq .
# 或使用 UI：设置 → 数据与备份 → 立即备份 / 下载

# 2) 拉取/同步代码
cd /root/360note
git pull   # 或 rsync 新代码
npm ci
npm run build

# 3) 迁移（服务启动时会自动执行；建议先手动确认）
# 迁移是增量、幂等的；先看 CHANGELOG/迁移文件
sudo systemctl stop 360note
rsync -a --delete ... /root/360note/ /opt/360note/
chown -R root:360note /opt/360note
sudo systemctl start 360note
sudo systemctl status 360note --no-pager
curl -fsS https://360note.com/health
```

### 4.2 回滚

- 代码回滚：保留上一个发布目录/commit；恢复 `/opt/360note` 并重启。
- 数据库：迁移只增；如果新迁移破坏兼容，使用**发布前备份**恢复（见第 5 节）。
- 静态资源：回滚后重新 build/restart，确保 hash 资源匹配。
- 不要在未备份时执行替换恢复或手工 DROP。

---

## 5. 备份与恢复

### 5.1 自动备份

- 应用内调度：每天约 03:15，最多每 6 小时检查一次；每工作区。
- 保留：14 份自动 + 30 天（`BACKUP_RETENTION_DAYS`）。
- 备份文件：`/var/lib/360note/backups/*.3nb`，AES-256-GCM 加密。
- 备份包含：notes/folders/tags/versions/comments/attachments。不含分享链接/API token/密码。
- **默认在同一服务器**：管理员可在 实例管理→存储管理 配置 S3 兼容存储；仍建议定期下载。
- 异地备份上传的是同一个已加密 `.3nb`；S3 侧无法读取内容。
- 可同时启用附件对象存储：先迁移本机附件，再切换新上传；停用前会把所有附件取回并校验。附件 URL 不变。
- 对象存储用量按 bucket 内 `prefix/attachments/` 与备份对象统计；本机用量按 `/var/lib/360note/attachments` 实际文件统计。
- 有远端附件时修改连接配置会被拒绝，需先停用并取回全部附件。
- 迁移成功并校验远端后会自动清理本机副本；需要手动释放历史本机副本时使用存储管理的“清理本机副本”。

### 对象存储浏览、校验与恢复

- 实例管理 → 存储管理 → 对象存储文件：浏览对象、大小和更新时间。
- 校验会下载对象、解密并检查备份/附件结构；附件和整站备份可下载。
- 工作区备份可在管理端“恢复为副本”，以工作区所有者身份合并恢复，不覆盖当前内容。
- 整站备份只支持校验和下载，数据库级恢复仍按 `pg_dump` 运维流程执行。
- 恢复演练可在整站备份区域手动执行或按频率自动执行，验证数据库导出与附件可解密读取。

### 对象存储回归测试

测试会创建临时数据库、临时数据目录和本地 S3 兼容服务，不会触碰生产附件：

```bash
cd /opt/360note
sudo bash -c 'set -a; source /etc/360note/360note.env; set +a; \
  PATH=/opt/node22/bin:$PATH /opt/node22/bin/node tests/manual/object-storage-e2e.mjs'
```

覆盖：本机上传/缩略图、连接测试、启用迁移、新附件直传、停用取回、重复启用按大小跳过、删除清理远端、整站备份包含远端附件并自动上传。

### 5.2 手动备份 + 下载

```bash
# 通过 UI：设置 → 数据与备份 → 立即备份；点击下载
# 或 API（登录 Cookie）
curl -fsS -b admin.jar "https://360note.com/api/workspaces/<workspaceId>/backups" | jq .
curl -fsS -b admin.jar -o 360note-backup.zip \
  "https://360note.com/api/backups/<backupId>/download?workspaceId=<workspaceId>"
unzip -t 360note-backup.zip     # 验证 ZIP 完整性
unzip -l 360note-backup.zip | head
```

### 5.3 恢复

**通过 UI（推荐）：**
1. 设置 → 数据与备份 → 上传备份文件 或 选择已有备份。
2. 恢复预览：核对笔记/附件/文件夹/版本/评论、来源工作区、警告。
3. 选择“合并为副本”（安全）或“替换当前空间”（会先自动创建 pre-restore 备份）。
4. 确认并等待任务完成；刷新验证笔记/附件/版本/评论。

**通过 API：**

```bash
# 预览
curl -fsS -b admin.jar \
  "https://360note.com/api/backups/<backupId>/preview?workspaceId=<workspaceId>" | jq .
# 执行（mode=merge|replace）
curl -fsS -b admin.jar -H 'Content-Type: application/json' -H 'X-360note-CSRF: 1' \
  -d '{"mode":"merge"}' \
  "https://360note.com/api/backups/<backupId>/restore?workspaceId=<workspaceId>" | jq .
# 轮询 /api/jobs/<jobId>
```

**上传备份恢复：**

```bash
curl -fsS -b admin.jar -F "file=@360note-backup.zip" \
  "https://360note.com/api/workspaces/<workspaceId>/backups/upload" | jq .
# 返回 uploadId，再 POST /api/backups/uploads/<uploadId>/restore {"mode":"merge"}
```

### 5.4 数据库级备份（运维，非用户备份）

用户级 `.3nb` 不包含用户/设置。若需要实例级灾难恢复：

```bash
sudo -u postgres pg_dump -Fc 360note > /secure/offsite/360note-$(date +%F).dump
# 恢复（停机）
sudo systemctl stop 360note
sudo -u postgres pg_restore --clean --if-exists -d 360note /secure/offsite/360note-YYYY-MM-DD.dump
sudo systemctl start 360note
```

同时备份 `/var/lib/360note` 与 `/etc/360note/360note.env`（离线加密保存）。

### 5.5 恢复演练（发布前/每月）

1. 创建测试工作区：嵌套文件夹、标签、图片、PDF、10 个版本、3 条评论。
2. 创建备份并下载；检查 manifest/workspace.json/attachments。
3. 修改/删除部分内容。
4. 合并恢复：验证新副本、附件可打开、原内容不变。
5. 替换恢复：确认自动 pre-restore；恢复后计数/版本/评论/附件一致；可回退。
6. 记录耗时、差异、修复项到 `docs/MEMORY.md`。

---

## 6. 监控与日志

```bash
systemctl status 360note
journalctl -u 360note -f
journalctl -u nginx -f
curl -fsS https://360note.com/health
```

- `/health` 返回数据库状态；可接 Uptime Kuma/外部监控。
- 日志包含 request id、状态码、耗时；敏感头已脱敏。
- 审计日志在应用内（设置→团队）与 `audit_logs` 表。
- 建议监控：证书到期、磁盘空间、PostgreSQL 连接数、备份任务失败、5xx 比例。

---

## 7. 密钥与凭据

| 密钥 | 位置 | 轮换影响 |
|---|---|---|
| `SESSION_SECRET` | `/etc/360note/360note.env` | 轮换会使所有会话失效、分享访问 Cookie 失效；用户重新登录 |
| `NOTE360_MASTER_KEY` | 同上 | 轮换会导致现有附件/备份不可读；必须先用旧钥解密重加密迁移，勿直接换 |
| 数据库密码 | 同上 + PostgreSQL | 轮换后同步更新 env，重启 API |
| 管理员密码 | 密码管理器 | 设置→安全→修改密码；会登出其他设备 |
| 恢复密钥 | 离线 | 设置→安全→更新恢复密钥；旧钥立即失效 |

**永远不要**把 env 文件、主密钥、恢复密钥、用户数据提交到 Git。

---

## 8. 事故响应

1. **评估**：登录、数据、分享、附件、备份、证书。
2. **止血**：回滚最近部署；必要时关闭注册（改成 invite）或维护页。
3. **保护现场**：保留 journal、nginx 日志、审计、数据库快照。
4. **恢复**：优先从最近备份/时间点恢复；先预览；不要直接覆盖。
5. **通知**：应用内公告为主；账户与安全事件可通过 SMTP 发送，营销邮件禁止。
6. **复盘**：写 MEMORY/CHANGELOG；补测试/告警。
7. **验证**：健康检查 + 登录 + 打开笔记 + 备份/恢复演练核心集。

---

## 9. 常见问题

### 9.1 静态资源 404 / MIME 错误

- 原因：build 后未重启，旧进程静态路由未注册新 hash 文件；或 `WEB_DIST` 指向错误。
- 处理：`npm run build` → `systemctl restart 360note`；确认 `/opt/360note/apps/web/dist/index.html` 存在；`curl -I /assets/<hash>.css` 应为 `text/css`。

### 9.2 分享链接指向 localhost / 5173

- `PUBLIC_ORIGIN` 错。改为 `https://360note.com`，重启；旧分享链接仍可用（路径相对），新建链接/书签脚本会正确。

### 9.3 PDF 导出 501

- 未安装 Chromium 或路径不在 `/usr/bin/chromium` / `chromium` / `google-chrome`；可用 `CHROMIUM_PATH=/usr/bin/chromium` 指定。
- systemd 非 root 运行时 Chromium 需要可写的 `HOME`/`XDG_*` 与 `--user-data-dir`；应用已自动创建临时目录。检查 journal 中的 `PDF export failed`。
- 仍失败可改用 HTML 打印为 PDF。

### 9.4 OCR 不工作

- `OCR_ENABLED=false`、未安装 tesseract/pdftotext、或语言包缺失。检查日志中的 OCR failed；安装 `tesseract-ocr-chi-sim`；重新上传文件（旧附件不会自动重跑）。

### 9.5 登录被锁

- 连续失败 10 次锁定 15 分钟；或触发限流。等待/换 IP；管理员不能绕过密码，但可用恢复密钥重置（若持有）。

### 9.6 忘记管理员密码/恢复密钥

- 没有后门。若数据库可访问，可由服务器管理员重置用户密码哈希（属于高权限操作，需书面流程）。用户可用邮箱验证码或恢复密钥自助找回；请提醒用户离线保存恢复密钥。

### 9.7 磁盘空间

```bash
du -sh /var/lib/360note/*
df -h
# 清理旧导入临时文件（应用每 6 小时自动清理 48h 以上）
# 不要手工删除 backups/attachments 正在引用的文件
```

### 9.8 备份加密文件无法读

- 主密钥不匹配/丢失。确认 `NOTE360_MASTER_KEY` 与创建备份时一致。没有主密钥无法恢复。

---

## 10. 命令速查

```bash
# 服务
systemctl status 360note
systemctl restart 360note
journalctl -u 360note -n 100 --no-pager

# 构建/部署
cd /root/360note && npm ci && npm run build
rsync -a --delete --exclude .git --exclude storage /root/360note/ /opt/360note/
chown -R root:360note /opt/360note
systemctl restart 360note

# 数据库
sudo -u postgres psql -d 360note
sudo -u postgres pg_dump -Fc 360note > /secure/offsite/360note-$(date +%F).dump

# 健康
curl -fsS https://360note.com/health
curl -I https://360note.com
```

---

## 11. 发布检查

见 `docs/QUALITY.md` 第 8 节。生产发布最低要求：

- [ ] 备份已创建并下载；
- [ ] typecheck/build 通过；
- [ ] 迁移在测试库通过；
- [ ] 健康检查 + 登录 + 新建笔记 + 分享 + 导出 smoke；
- [ ] 证书/域名/密钥/注册模式确认；
- [ ] SMTP 仅用于账户与安全邮件，未配置营销邮件；
- [ ] 回滚 commit/目录可用。

## 双域名与邮件（2026-11 上线）

### 域名

- `360biji.com` / `www.360biji.com`：固定中文界面与中文邮件。
- `360note.com` / `www.360note.com`：固定英文界面与英文邮件。
- 两个 vhost 的 `root` 都指向 `/opt/360note/apps/web/dist`，`/api/` 与 `/health` 代理到同一个 `127.0.0.1:8787`。
- 分享与邀请链接使用请求所在域名生成；不要硬编码单一 `PUBLIC_ORIGIN`。

### 邮件

- 配置在 `/etc/360note/360note.env` 的 `SMTP_*` 与 `MAIL_FROM*`。
- 生产使用 `eu1.workspace.org:465`（SMTPS）和 `noreply@360note.com`。
- 修改 SMTP 后重启服务并检查日志；不要在日志中输出密码。
- 验证码：10 分钟有效、同邮箱 60 秒冷却、每小时最多 6 次、最多 5 次尝试。
- 测试邮件只能发送到操作者明确提供的地址（记录在 `/root/360note-credentials.txt`）。

### 账户

- 管理员与演示账户由 `scripts/provision-accounts.mjs` 创建；脚本不会发信。
- 凭据只保存在 `/root/360note-credentials.txt`（0600）。
- 用户修改邮箱需要新邮箱验证码 + 当前密码；旧邮箱会收到通知。

### 上线检查

```bash
curl -fsS https://360note.com/health
curl -fsS https://360biji.com/health
sudo systemctl status 360note --no-pager
sudo journalctl -u 360note -n 80 --no-pager
```

- 中文域名显示中文、英文域名显示英文。
- 两个域名使用同一账户可读到同一批笔记。
- 公开分享与密码分享按预期工作。
- `tests/manual/security-audit.mjs` 全部通过后再对外宣布。
