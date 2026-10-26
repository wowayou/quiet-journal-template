# 部署（Cloudflare Workers）

网站是纯静态文件，部署为 Cloudflare Workers 的「静态资源」（无 Worker 脚本）。Cloudflare 自 2026 年起建议新项目使用 Workers 而非 Pages。访问静态资源不计请求费用。

本文件只负责博客部署。可选评论的静态面板、Waline API/管理端与数据库独立部署，见 [COMMENTS.md](COMMENTS.md)；不要把博客的静态资源计费规则当成评论服务/数据库也免费。博客构建不安装或部署 `integrations/waline/` 和 `integrations/waline-server/`。后者为 Vercel Hobby + Neon Free 的本地服务候选，仍有独立的账号授权、依赖/许可更新审查与真实上线验收，见其 [README](../integrations/waline-server/README.md)。

构建由 **Workers Builds** 完成：推送到 `main` 后 Cloudflare 拉取仓库、运行构建并发布。不使用 GitHub Actions。`npm run build` 固定 `production` 环境，依次检查有效配置、源媒体、清理并生成 Hugo 产物、检查本站链接/锚点/日期和产物媒体；任一步失败不进入部署，线上保留上一次成功版本。站点日常升级见 [UPDATING.md](UPDATING.md)。

## 一次性设置

1. 修改 `wrangler.jsonc` 的 `name`，以及 `config/_default/hugo.toml` 的 `baseURL`、`data/editor.yaml` 的 `repo`（后台配置由 Hugo 生成）。
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

- [Workers Builds 官方额度](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)（2026-10-25 复核）：Free 每月 3,000 构建分钟、同账户 1 个并发；Paid 每月含 6,000 分钟、超出 $0.005/分钟、6 个并发；单次最长均为 20 分钟。
- **接入前在控制台确认 Workers 套餐和本月账户总用量**，不能由域名的 Free 套餐推断 Workers 套餐。账户下其他项目共享额度。
- simple 模式下每次推送到 `main` 都会构建，包括保存草稿；审核流模式下只有合并到生产分支才触发生产构建。若每次耗时 1–2 分钟、每天保存 20 次，本项目估算每月 600–1,200 分钟，但这不含其他项目，也不是费用保证。
- 不启用预览构建、定时构建或自动重试；失败后先看日志、修复再触发。接近账户额度时暂停自动构建，不自动升级付费套餐。
- 搜索索引和 OG 分享图随现有 Hugo 构建生成，没有新的云端服务或独立触发器；会增加少量构建工作和产物，不能把本地耗时直接当成云端计费耗时。中文 OG 字体留在构建端，不随访客页面下载。
- 安全响应头来源是 `assets/server/headers.txt`，由 Hugo 生成 `_headers`；`/admin/` 有单独的 CSP。旧 `static/_headers` 的定制须合并后移除，不能留下两个来源。评论开启时只增加隔离面板的 frame-src，父页脚本和连接策略不放宽。

## 禁止代理注入统计脚本

生成的 `_headers`（来源 `assets/server/headers.txt`）中的 `Cache-Control: no-transform` 告知代理不要改写内容。Cloudflare [官方说明](https://developers.cloudflare.com/web-analytics/get-started/#sites-proxied-through-cloudflare)该指令可以阻止 Web Analytics 自动注入；仅影响当前 Worker 的响应，不必关闭整个域名区域的统计。

页面仍然每次刷新校验，带指纹的 CSS/JS/字体仍可长期缓存，`/admin/` 仍为 `no-store`。上线后用真实浏览器检查脚本列表和控制台；只用 curl 检查不足以发现所有注入行为。不要为消除报错而放宽 CSP（内容安全策略）去允许统计脚本。

## 保存成功，但网站没更新

**GitHub 提交成功不等于上线成功。** 已提交的 Markdown 和图片不会因为部署失败而消失，未保存的输入不能据此保证恢复。查看对应提交的 GitHub check 或 Cloudflare → 该 Worker → Builds 日志；同时核对草稿、发布时间、构建检查和部署权限。删除/撤下也必须部署成功才影响当前网站，失败时旧版本可能仍公开。

本站默认不用 GitHub Actions，不能把它的额度与 Workers Builds 混为一谈。云构建分钟不足不会撤销 GitHub 提交；静态访问、云构建、账户限制各有独立边界，不能仅凭“没上线”判断额度已用完。后台“发布说明”提供无脚本的处理入口，不读取账户状态、不伪造成功。

## 云构建不可用时：手动本地发布兜底

本地生成静态产物再上传到**同一个现有 Worker**，不使用 Workers Builds 的云构建过程。2026-10-25 复核[官方静态资源规则](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)：静态资源存储无额外费用、静态资源请求免费不限量；这不代表账户权限、上传/文件限制或其他服务没有约束。兜底仅支持本站纯静态配置，不启用 Worker 脚本、`run_worker_first`、新平台或付费降级。

1. **先看失败日志，修复代码/内容错误**。本地构建不绕过媒体、草稿、日期或链接检查；远端仍是有缺陷的旧代码时，应审查升级，不能用旧 `public/` 强行发布。
2. 在控制台核对实际 Workers 套餐、账户共享用量与当前规则；若涉及新增付费或无法确认限制，停止，不升级/充值。**暂停该 Worker 的自动构建并等在途构建结束**，避免旧的自动部署覆盖手动版本。脚本不会替你修改云端开关。
3. 在私人目录**另建远端最新 `main` 的干净克隆**，不要在有修复稿的开发目录 `stash/reset/pull`：

   ```bash
   git clone --branch main --single-branch <你的私有仓库地址> <新的私人目录>
   cd <新的私人目录>
   npm ci
   npm run publish:fallback -- --check
   ```

   需要已安装文档要求的 Hugo/Git，以及 **Node.js 22+（推荐 24；锁定的 Wrangler 要求 22+）**；安装依赖不需要 Cloudflare 令牌。`--check` 默认只检查：两次有超时的 `git ls-remote` 确认本地 HEAD 与实时 `origin/main` 一致，并运行完整 `npm run build`。不自动 fetch/pull/合并、不调用云端部署。未提交文件、非 main、落后/领先远端、远端不可读、检查失败或构建中内容变化，都会停止。没有此命令的旧版本先按 [UPDATING.md](UPDATING.md) 更新。
4. 检查通过后，由有权限的维护者明确确认**完整提交 SHA、现有 Worker、账户 ID**和已暂停自动构建，再执行：

   ```bash
   npm run publish:fallback -- --deploy --commit <40位提交SHA> --worker <现有Worker名称> --account <32位账户ID> --builds-paused
   ```

   该命令仍会重新完整构建，查询目标部署列表，并在部署前再检查最新提交；只运行一次 Wrangler 发布，不自动重试。使用锁定的本地 Wrangler，不用 `npx` 自动下载新版本。账户 ID 不是令牌；Cloudflare 凭据只留在本机 Wrangler 登录或安全环境中，**不放进 CMS、仓库或静态文件**。本地锁只约束本机任务，不能取代暂停云端构建；发布窗口也应协调其他设备停止发布。最后核对之后仍可能有新的 CMS 提交，这些内容留在 GitHub，需后续再部署，不能声称所有并发保存已上线。
5. 去 Deployments 核对实际版本，用浏览器检查新文章、首页、后台与草稿隔离；**超时/断线不等于没有部署**，先查实际结果再决定，不能盲重试。正常完成会释放本地锁；进程被强制结束后若留下 `.git/qj-publish-fallback.lock`，先核实本机任务和线上结果，再手动移除准确的锁文件。
6. 确认远端代码/内容与手动上线版本一致、构建错误已修复且额度可用后，再人工恢复自动构建；不要为试验制造空提交或重写 Git 历史。

以上是**发布路径回退**，不是把文章回滚到旧版本，也不是账户停用、权限不足或平台静态资源限制的通用绕过。完整检查通过不等于已上线；检查模式绝不发布。

## 回滚

Cloudflare 控制台 → 该 Worker → Deployments，选择之前的版本回滚。或在本地 `npx wrangler rollback`。回滚旧站点版本不会恢复最新文章；不要用它代替发布失败诊断，也不要覆盖新写的 Git 内容。
