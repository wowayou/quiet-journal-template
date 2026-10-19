# 部署（Cloudflare Workers）

网站是纯静态文件，部署为 Cloudflare Workers 的「静态资源」（无 Worker 脚本）。Cloudflare 自 2026 年起建议新项目使用 Workers 而非 Pages。访问静态资源不计请求费用。

本文件只负责博客部署。可选评论的静态面板、Waline API/管理端与数据库独立部署，见 [COMMENTS.md](COMMENTS.md)；不要把博客的静态资源计费规则当成评论服务/数据库也免费。博客构建不安装或部署 `integrations/waline/` 和 `integrations/waline-server/`。后者为 Vercel Hobby + Neon Free 的本地服务候选，仍有独立的账号授权、依赖/许可更新审查与真实上线验收，见其 [README](../integrations/waline-server/README.md)。

构建由 **Workers Builds** 完成：推送到 `main` 后 Cloudflare 拉取仓库、运行构建并发布。不使用 GitHub Actions。`npm run build` 依次检查源媒体、清理并生成 Hugo 产物、检查本站链接/锚点/日期和产物媒体；任一步失败不进入部署，线上保留上一次成功版本。站点日常升级见 [UPDATING.md](UPDATING.md)。

## 一次性设置

1. 修改 `wrangler.jsonc` 的 `name`，以及 `config/_default/hugo.toml` 的 `baseURL`、`static/admin/config.yml` 的 `backend.repo`。
2. Cloudflare 控制台 → Workers & Pages → 创建 → 导入 Git 仓库，选择你的私有仓库。
   - 如果 Worker 已通过本地 Wrangler 创建，不要重复新建：打开该 Worker → **Settings → Builds → Connect**，连接私有仓库。
   - Worker 名称必须与 `wrangler.jsonc` 的 `name` 一致。
   - GitHub App 授权时选 **Only select repositories**；已有授权时只增选当前私有仓库，不取消其他项目已有的授权。
3. 构建设置：

   | 项 | 值 |
   |---|---|
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | 环境变量（构建） | `HUGO_VERSION` = `0.167.0` |

4. Settings → Build → Branch control：生产分支 `main`，**取消勾选 Enable Preview Builds**（不为其他分支生成公开预览地址）。
5. `wrangler.jsonc` 中已设置 `"preview_urls": false`，不生成版本预览地址；这不能代替上一步的分支构建控制。
6. 接入后用一次必要的提交验证自动部署成功，并确认非生产分支没有触发构建。仅本地执行 `wrangler deploy` 成功不代表 Git 自动部署已经接通。

构建使用 **Cloudflare API token**，与登录 CMS 的 **GitHub 访问令牌**不同；不要把 CMS 令牌填到构建设置里。Cloudflare 可自动生成部署令牌（[官方权限说明](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)），其默认权限还包含本项目不用的 KV/R2。令牌权限与有效期应单独审查，不要为省事扩大为全部账户权限。

## 绑定自己的域名

在 `wrangler.jsonc` 加上：

```jsonc
"workers_dev": false,
"routes": [{ "pattern": "blog.example.com", "custom_domain": true }]
```

Cloudflare 会自动创建 DNS 记录和证书。该域名必须托管在同一个 Cloudflare 账户中。执行前先导出 DNS 记录备份，并确认该子域名没有被其他服务使用。

## 用量

- [Workers Builds 官方额度](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)（2026-10-19 复核）：Free 每月 3,000 构建分钟、同账户 1 个并发；Paid 每月含 6,000 分钟、超出 $0.005/分钟、6 个并发；单次最长均为 20 分钟。
- **接入前在控制台确认 Workers 套餐和本月账户总用量**，不能由域名的 Free 套餐推断 Workers 套餐。账户下其他项目共享额度。
- simple 模式下每次推送到 `main` 都会构建，包括保存草稿；审核流模式下只有合并到生产分支才触发生产构建。若每次耗时 1–2 分钟、每天保存 20 次，本项目估算每月 600–1,200 分钟，但这不含其他项目，也不是费用保证。
- 不启用预览构建、定时构建或自动重试；失败后先看日志、修复再触发。接近账户额度时暂停自动构建，不自动升级付费套餐。
- 搜索索引和 OG 分享图随现有 Hugo 构建生成，没有新的云端服务或独立触发器；会增加少量构建工作和产物，不能把本地耗时直接当成云端计费耗时。中文 OG 字体留在构建端，不随访客页面下载。
- 安全响应头来源是 `assets/server/headers.txt`，由 Hugo 生成 `_headers`；`/admin/` 有单独的 CSP。旧 `static/_headers` 的定制须合并后移除，不能留下两个来源。评论开启时只增加隔离面板的 frame-src，父页脚本和连接策略不放宽。

## 禁止代理注入统计脚本

生成的 `_headers`（来源 `assets/server/headers.txt`）中的 `Cache-Control: no-transform` 告知代理不要改写内容。Cloudflare [官方说明](https://developers.cloudflare.com/web-analytics/get-started/#sites-proxied-through-cloudflare)该指令可以阻止 Web Analytics 自动注入；仅影响当前 Worker 的响应，不必关闭整个域名区域的统计。

页面仍然每次刷新校验，带指纹的 CSS/JS/字体仍可长期缓存，`/admin/` 仍为 `no-store`。上线后用真实浏览器检查脚本列表和控制台；只用 curl 检查不足以发现所有注入行为。不要为消除报错而放宽 CSP（内容安全策略）去允许统计脚本。

## 回滚

Cloudflare 控制台 → 该 Worker → Deployments，选择之前的版本回滚。或在本地 `npx wrangler rollback`。
