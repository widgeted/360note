# 搜索引擎提交与索引

> 最后更新：2026-11-13

## 已配置

- `robots.txt` 声明中英文 sitemap，并禁止抓取 `/app`、`/api`、登录、注册、邀请等私有路径。
- 两套 sitemap：`/sitemap-en.xml`、`/sitemap-zh.xml`，由域名路由到 `/sitemap.xml`。
- 公开页面使用 canonical、hreflang、OG/Twitter 与描述；私有页面自动 `noindex, nofollow`。
- 公开分享页默认 `noindex`，不进入 sitemap，也不主动提交。

## IndexNow

IndexNow key 文件：

```text
apps/web/public/c95a76f9a17fa590aa257793af8e7792.txt
```

2026-11-13 已向 `https://api.indexnow.org/indexnow` 提交以下页面，两个域名首次提交返回 **HTTP 202**；重复提交也可能返回 **HTTP 200**：

- `https://360note.com/`
- `https://360note.com/about`
- `https://360note.com/privacy`
- `https://360note.com/terms`
- `https://360biji.com/`
- `https://360biji.com/about`
- `https://360biji.com/privacy`
- `https://360biji.com/terms`

重新提交：

```bash
npm run seo:indexnow
```

IndexNow 主要被 Bing、Yandex、Seznam、Naver 等采用。**Google 不参与 IndexNow**。

## 仍需账号验证的平台

以下平台需要站点所有者登录并完成验证，无法在没有账号权限的情况下代为提交：

- Google Search Console：提交 sitemap，查看索引与抓取问题。
- Bing Webmaster Tools：可补充 sitemap 提交与索引报告（IndexNow 已通知 Bing）。
- 百度搜索资源平台：需要站点验证与 sitemap 提交。
- 360 搜索站长平台：需要站点验证与 sitemap 提交。

这些平台的验证方式通常是 DNS TXT、HTML 文件或 meta 标签；拿到账号权限后可以再补。

## 不要提交

- `/app/**` 私有应用页面
- `/api/**`
- `/login`、`/register`、`/recover`、`/invite`
- 公开分享链接 `/s/<token>`：默认 noindex，且不应被搜索引擎收录

## 变更后

公开页面内容或 sitemap 更新后运行 `npm run seo:indexnow`。私有页面和分享页不要加入提交列表。

## 站点验证与统计代码（v0.2.5）

- 位置：实例管理 → 站点（`/app/settings/admin/site`），仅实例管理员可读写。
- 默认内置百度验证：`<meta name="baidu-site-verification" content="codeva-zUIgMMzGVb" />`。
- 注入范围：`/`、`/about`、`/privacy`、`/terms`、`/login`、`/register` 的 `<head>`；不注入 `/app` 与 `/s/`。
- 保存后立即生效，无需重新构建；HTML 响应为 `no-store`，便于验证平台抓取。
- 服务端会根据代码内容生成 CSP：内联脚本加入 `sha256` 哈希，外部脚本来源自动加入 `script-src` 与 `connect-src`。
- 部署要求：nginx 对非静态路径回退到 Node（`try_files $uri @node`），否则运行时注入不会出现在首页；CSP 由 Node 统一设置。
- PWA 导航使用 NetworkFirst，`index.html` 不进入预缓存；离线时回退到 `offline.html`。
- 百度验证通过后可在百度搜索资源平台点击“完成验证”；Google/Bing 等其他平台可复用同一输入框粘贴各自的 meta 或脚本。
