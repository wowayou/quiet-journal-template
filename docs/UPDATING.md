# 模板更新与维护

本仓库是 GitHub Template，不是会自动同步的主题子模块。使用模板创建的仓库有独立历史，**模板后续更新不会自动进入你的博客**。默认选择可审查的手工更新，不新增机器人、定时任务或 GitHub Actions。

2026-10-22 已完成本地验收与提交：Hugo 原生配置分片、核心 CMS schema + 实例 editor 连接，以及固定核心清单/只读三方升级预览。详见 [EVOLUTION.md](EVOLUTION.md)。仍没有自动同步或自动应用器，更新按本文审查、合并、验证。

**文件分层不等于独立发布，也不代表线上已经升级。** 当前文章、日常设置与核心设计仍通过一次 Hugo 整站构建。发布前须用最新远端个人输入验证待发布核心与后台规则兼容，发布后再核验实际版本；不能把“升级不覆盖个人文件”当作“正常设置不可能影响构建”的证明。分离保证与未完成边界见 [EVOLUTION.md](EVOLUTION.md)。

## 更新前

1. 在原设备保存 CMS 工作，暂时不要同时编辑；查看远端是否有新提交。本地工作区应干净，未提交改动先单独保存，不用 `reset --hard` 覆盖。
2. `git pull --ff-only`，记录当前提交；用 `scripts/backup.sh <owner/repo>` 备份完整镜像，妥善保存在本机。不要把私有备份上传到公开模板仓库。
3. 阅读目标版本 `CHANGELOG.md` 和本文件，确认 Hugo/CMS/Node 版本、配置迁移、授权和新增依赖；不是“复制目录再祈祷”。Hugo 推荐沿用已验收的 **0.167.0**，升级另测。
4. 新建本地更新分支。保持云端预览构建关闭；本地测试不触发构建用量。

## 哪些文件如何更新

| 文件 | 处理方式 |
|---|---|
| `content/**`、`assets/media/**` | **不从模板覆盖**，包括草稿、图片、about 的个性化正文 |
| `data/site.yaml`、`links.yaml`、`widgets.yaml`、`answers.yaml`、`comments.yaml` | 保留用户数据与接入选择，只合并新增键/迁移结构，不用示例替换 |
| `config/_default/hugo.toml`、`params.toml`、`wrangler.jsonc` | 实例所有，保留 URL/时区/媒体/域名；技术变更按需迁移，不复制模板示例 |
| 同目录 `frontmatter/markup/cascade/permalinks/module/outputs/pagination.toml` | 核心配置，更新后运行有效配置与媒体/草稿检查 |
| `assets/admin/schema.yml` | 核心 CMS 字段；升级不覆盖实例连接 |
| `data/editor.yaml`、可选 `editor_extensions.yaml`、`newsletter.yaml` | 实例连接/扩展/订阅，保留；不含令牌。`/admin/config.yml` 由 Hugo 生成，不编辑或保留静态副本 |
| `assets/css/overrides.css`、可选 `assets/js/custom.js` | 使用者文件，保留 |
| `data/widget_extensions.yaml`、扩展 partial/CSS/JS、全局钩子 | 使用者文件，保留并回归 |
| 核心 `layouts/`、CSS/JS、`scripts/`、依赖清单、`assets/server/headers.txt` | 按差异更新；若有本地定制，人工合并，不整目录删除 |
| `integrations/waline/` | 独立面板代码按差异更新，保留私有的 `config.local.json`；博客构建不安装/部署它，数据库另备份 |
| `integrations/waline-server/` | 独立服务候选；保留私密环境、Vercel 项目关联和数据库，不能复制示例凭据覆盖。代码、锁文件、SQL、`vendor/` 分发和对应源码归档一起审查，不随博客更新自动开通 |
| `data/credits.yaml`、`THIRD_PARTY_NOTICES.md`、许可证 | 新增真实依赖的来源与许可证，保留仍在使用的旧条目 |

可以下载两个版本作本地文件比较，也可添加只读上游 remote 查看提交；**不要直接把无关历史强行合并或强推覆盖实例**。模板更新说明是迁移指南，不是无差别同步脚本。

## 固定核心与升级预览

当前 `core-manifest.json` 给出固定版本和受管文件 SHA-256，实例配置、内容、媒体、个人样式与声明扩展不进入清单。`data/widget_extensions.yaml` 引用的 partial/CSS/JS 按实际声明归为使用者文件；全局扩展钩子及独立服务的本地配置/环境、部署关联和备份也排除。只有列出的七个 `_default` 配置分片归核心，环境配置和其他实例分片保留。未声明的同路径定制仍做三方冲突比较，不能据此删除。不要把清单当可信签名；来源仍须可信。更新时在私人备份和干净分支上执行：

```sh
node scripts/core-upgrade.mjs preview /可信的新核心目录 /旧核心清单.json
```

比较旧核心基线、实例现有文件和新发行：same/update/remove/conflict，若新核心恰好使用已声明个人扩展的路径则标为 protected（受保护），仅生成报告，不写入、不删文件、不执行 Git。已有定制冲突须人工合并；任何一方文件在比较期间变化会拒绝报告；输出带旧/新清单指纹供核对。准备新的发行清单时用 `manifest <明确版本>`，已有清单不会自动覆盖，先审查新版本内容。

从旧单文件配置迁移：把媒体/显示时区移入 `params.toml`，日期/渲染等移入对应核心分片，核对有效值与原配置一致；CMS repo/branch/publish_mode 移入 `data/editor.yaml`，原字段归入核心 schema 或显式扩展，再移除 `static/admin/config.yml`。不要留双份来源，直接 Hugo 与 npm 构建都能生成后台配置。

## 从 v1.0 迁移到本轮更新

1. 合并共享模板、脚本、图标、`assets/og/` 与 CMS 组件；构建专用字体的许可证也要带上。
2. 在核心 `frontmatter.toml` 保留 date/lastmod；在 `cascade.toml` 关闭所有 bundle 原资源发布。实例 `hugo.toml` 不启用草稿/未来/过期。直接 Hugo 也校验普通页、栏目和首页，拒绝强制发布草稿、过期页和未来 `date`/`publishDate`；聚合页不会只因未发布子页面的继承日期而失败。Hugo 内建 `modified` 别名仍会出现在有效配置中，页面校验明确拒绝该字段，要求用 `lastmod`。
3. `data/site.yaml` 原有站名、署名、介绍、社交链接全部保留，按 [CUSTOMIZE.md](CUSTOMIZE.md) 新增 `favicon`、`links`、`sharing`、`fediverse` 和页脚 `show_template_credit`。Mastodon 账号必须填自己的；没有就留空。
4. 旧导航 `{label, url}` 改为首页 `type: home`、站内 `type: page` + 文件 ID、外站 `type: external` + `url`。普通页面 ID 从实际 `content/` 文件读取，不从标题猜。
5. 添加 `data/widgets.yaml`、`answers.yaml`（已有文件则仅合并）。搜索默认启用、答案之书默认关闭，可以两个都关。旧文章不用批量加 `lastmod`，留空沿用 `date`；不要批量改发布时间。
6. build 必须包含 `check-config`、源媒体检查、干净 Hugo 构建和 `check-site`。**`public/` 是纯生成目录**，清理构建会删旧产物；不要往里面手放需要保留的文件。
7. 新版“页面”集合兼容已有根目录 `.md`，不会迁移其 URL。首次在 CMS 保存设置前检查导航类型和字段值；CMS 可能重排 YAML 或去掉注释，这是格式变化，不应丢失值。
8. 合并后台入口时一并带上 `manual-init.js`、`editor.js`、`host.css`、`tools.html` 和正文组件；保留“先禁止自动初始化 → 固定 CMS → 组件注册 → 手动初始化”的顺序。仍由核心 schema + 实例 `data/editor.yaml` 生成字段与连接，只覆盖显式选择的上传质量，不替换你的仓库配置。旧图不会重新压缩。
9. 内容传输脚本与 `content:ui / content:export / content:inspect / content:import` 是可选本地操作，不放入 build/deploy。更新图形向导时一起带上 `scripts/transfer-ui/`；它只在本机启动，不能放进 `static/`。更新模板本身不要求导出再导入文章；只有需要迁移内容时才按 [TRANSFER.md](TRANSFER.md) 使用，绝不把快照放到网站发布目录。
10. **迁移响应头来源**：把旧 `static/_headers` 的自定义策略合并到 `assets/server/headers.txt`，保留 `__QJ_COMMENT_FRAME_POLICY__` 占位符，然后移除旧文件。Hugo 生成 `_headers`；留下两份或删除占位符会阻止构建，避免策略被静默覆盖。不要编辑 `public/_headers`。
11. 新增 `data/comments.yaml`（已有则保留）；先保持 `enabled: false`，不要自动填示例服务地址。合并文章 `comments` 开关及 CMS 对应文件字段。评论必须完成独立面板、API/管理端、数据库和真实交互验收后才开启，见 [COMMENTS.md](COMMENTS.md)。
12. 新版首页/页脚需要一起合并 `layouts/home.html`、`layouts/_partials/home/artwork.html`、`layouts/_partials/footer.html` 和 `assets/css/components.css`；不增加配置字段或欢迎页路由，不用模板文案覆盖 `description`、`hero`、社交列表或 `footer`。若有个人样式，核对新分组在深浅色和手机上的效果。

自定义图标更新需同时合并 `media/icon-source.html`、`icon.html`、`scripts/svg.mjs`、媒体/传输检查和 CMS 字段。后台 CSP 只扩展 HTTPS 图片预览，不增加脚本或 API 信任源；保留你已有的其他策略。原 `icon_image` 无需迁移，HTTPS 图片地址现在可直接显示；仅图标区支持被动 SVG，favicon/正文限制不变。外链图标会由访客直接请求该源，默认模板仍无外链图标，详见 [CUSTOMIZE.md](CUSTOMIZE.md#上传图标与社交链接)。

## 本地验证

```bash
npm run build                  # 检查真实内容 + 生成干净产物 + 离线链接/日期/媒体检查
npm test                       # 公开模板：单元、独立夹具集成、冒烟回归
QJ_INSTANCE=1 npm test          # 私有实例：仓库名改检查为“非占位”，其余回归相同
# 可选，Node 22+，自行提供已安装的 Chromium，不会自动下载浏览器
QJ_CHROMIUM=/path/to/chrome npm run test:browser
# 可选本地向导 / SVG 实际渲染回归：合成内容、临时目录，无线上写入
QJ_CHROMIUM=/path/to/chrome npm run test:transfer
# 可选 CMS 回归：自行提供与入口 SRI 一致的固定主程序，测试不自动下载
QJ_CHROMIUM=/path/to/chrome QJ_CMS_BUNDLE=/path/to/sveltia-cms.js npm run test:cms
# 可选邮件表单回归：原生 POST 全部本机拦截，不发真实邮件
QJ_CHROMIUM=/path/to/chrome npm run test:newsletter
# 可选评论回归：本机还需 openssl，以及自行安装/提供的固定客户端包目录
QJ_CHROMIUM=/path/to/chrome QJ_WALINE_CLIENT=/path/to/@waline/client npm run test:comments
```

测试使用独立生成的文章/图片，不要求保留、公开或恢复模板示例，也不把真实文章/照片复制进夹具。`QJ_INSTANCE=1` 仅切换模板/实例的 CMS 仓库名断言，不跳过草稿、媒体或安全检查；实例真实内容仍由 `npm run build` 检查。`test:cms` 用离线 test-repo 和临时浏览器存储、阻止外部 HTTPS 请求，验证质量输出、字段覆盖、链接组件和保存往返；不会登录真实 GitHub。离线屏蔽会让上游图标字体显示为字名，这不等于线上字体故障；真机字体、HEIC 和软键盘仍须另验。

`test:browser` 也覆盖欢迎区/页脚的长文字、320/390/1280px 布局、阅读入口的键盘焦点与真实触控、无 JS 锚点，以及五种强调色下阅读按钮切换主题时的对比度。沿用手动运行方式，不新增云端触发器或浏览器下载。本轮样式已由实例作者于 2026-10-19 确认；其他站点仍须自行验收个性化效果，样式确认不代替 Safari/iPhone 或线上验证。

`test:comments` 使用临时证书和三个本机 HTTPS 源、固定官方客户端及合成 API，测试不会连接真实 Waline、部署或发信。只对该测试证书的指纹放行，不全局关闭证书验证。

服务候选在自己的目录用 `npm test`、可选 `test:postgres` / `test:admin` 验证；后两项需要预先准备的本机 PostgreSQL 镜像/固定模式，管理端还需本机 Chromium 和完整仓库检出，详见 [独立服务 README](../integrations/waline-server/README.md#本地安装与检查)。它们不是博客 build 的一部分，不自动下载数据库/浏览器或开通云端。首次初始化还须执行单账号索引与最小权限 SQL；已有数据不可直接套入“新空库”步骤。

真实云端、备份保管、平台代理 IP/并发滥用及 Safari/iPhone 仍另验。本地依赖告警和组件源码交付已处理，但升级必须重跑运行/管理构建两类审计、分发差异检查和源码重建；0 项报告与本机回归都不能代替生产验收。

浏览器回归使用沙箱；只有无法启用沙箱的隔离测试容器才考虑显式 `QJ_CHROMIUM_NO_SANDBOX=1`，不要拿它浏览不可信网站或登录真实账号。可设置 `QJ_SCREENSHOTS` 保存本地截图，不应提交含个人内容的截图。

手工再检查：320/390px 与桌面、深浅色、菜单和搜索键盘操作、无 JS 降级；自定义图标、文字/图片分享卡片、普通页面、RSS、404、Mastodon 的 `rel=me`。改过 CMS 时做一次 **新建→保存→重新打开**，包含新页面、图标上传、导航选择、链接组件和空的更新时间。Chromium 模拟不等于 iPhone/Safari 真机验证。

## 发布与回滚

- 先审查实际 diff：不能出现私有内容进公开仓库、真实令牌、调试代码、意外的 `public/` 或缓存文件。
- **从 2026-10-21 的未定稿本地稿迁移**：一起更新内容服务、工作线程、页面脚本及测试；不能只换界面样式。新版确认绑定源/目标哈希，刷新优先恢复最新任务；慢上传、取消与重复请求使用同一任务记录，见 [TRANSFER.md](TRANSFER.md)。2026-10-22 的后续状态修复也须一起合并：任务范围驱动摘要/导出、固定目录包定位与路径失败记录；不要只拷贝页面脚本。`test:transfer` 会同时验证基础流程与这些失败/刷新组合。
- **推送 `main` 会触发生产构建**。确认账户额度、窗口和改动后再推送；只推一次必要批次，不为测试随便制造空提交。额度和分支控制见 [DEPLOY.md](DEPLOY.md)。本轮无新增定时构建、远程 OG 服务、自动重试或付费资源。
- 云构建不可用时按 [DEPLOY.md](DEPLOY.md#云构建不可用时手动本地发布兜底) 在最新远端 main 的独立干净克隆中使用 `publish:fallback`，先检查再显式确认发布；不要把未提交开发稿或旧内容直接部署。更新时一起带上 `scripts/publish-fallback.mjs`、package 命令和后台 `publishing.html` / 工具栏样式，保留实例 Worker/域名与个人输入；不新增 Actions 或自动重试。
- 上线后用浏览器核验实际 DOM、CSP、第三方资源请求与手机页面；检查部署成功不是只看 CMS 保存成功。Mastodon 验证由账号本人保存资料触发；分享卡片刷新由平台决定。
- 本地未推送时可放弃更新分支而保留备份；已上线出问题时按部署文档回滚站点，再修复 Git 配置。不要为了回滚覆盖期间新写的文章或重写共享历史。
- 核心小改不需要每次做完整线上草稿探针；修改发布/媒体/权限边界时才做有界的端到端验证。保留本地安全回归，避免用省测试成本的理由去掉隐私保障。
