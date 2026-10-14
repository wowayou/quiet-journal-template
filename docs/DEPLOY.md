# 部署（Cloudflare Workers）

网站是纯静态文件，部署为 Cloudflare Workers 的「静态资源」（无 Worker 脚本）。Cloudflare 自 2026 年起建议新项目使用 Workers 而非 Pages。访问静态资源不计请求费用。

构建由 **Workers Builds** 完成：推送到 `main` 后 Cloudflare 拉取仓库、运行构建并发布。不使用 GitHub Actions。

## 一次性设置

1. 修改 `wrangler.jsonc` 的 `name`，以及 `config/_default/hugo.toml` 的 `baseURL`、`static/admin/config.yml` 的 `backend.repo`。
2. Cloudflare 控制台 → Workers & Pages → 创建 → 导入 Git 仓库，选择你的私有仓库。
   - GitHub App 授权时选 **Only select repositories**，只勾选这一个仓库。
3. 构建设置：

   | 项 | 值 |
   |---|---|
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | 环境变量（构建） | `HUGO_VERSION` = `0.167.0` |

4. Settings → Build → Branch control：生产分支 `main`，**取消勾选 Enable Preview Builds**（不为其他分支生成公开预览地址）。
5. `wrangler.jsonc` 中已设置 `"preview_urls": false`，不生成版本预览地址。

## 绑定自己的域名

在 `wrangler.jsonc` 加上：

```jsonc
"workers_dev": false,
"routes": [{ "pattern": "blog.example.com", "custom_domain": true }]
```

Cloudflare 会自动创建 DNS 记录和证书。该域名必须托管在同一个 Cloudflare 账户中。执行前先导出 DNS 记录备份，并确认该子域名没有被其他服务使用。

## 用量

- Workers Builds 免费额度：每月 3,000 构建分钟，同一账户同时 1 个构建，单次最长 20 分钟。
- 每次推送到 `main` 构建一次（约 1–2 分钟）：CMS 中每次保存（包括保存草稿）都会触发。草稿不会出现在网站上，只是消耗构建分钟；按每天保存 20 次估算，每月约 600–1,200 分钟，在 3,000 分钟免费额度内。
- 安全响应头（CSP 等）在 `static/_headers`；`/admin/` 有单独的 CSP。

## 回滚

Cloudflare 控制台 → 该 Worker → Deployments，选择之前的版本回滚。或在本地 `npx wrangler rollback`。
