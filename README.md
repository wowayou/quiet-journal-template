# Quiet Journal

一个安静、易于修改的个人生活博客模板，基于 Hugo。博客本体没有数据库，不需要服务器或统计脚本，默认只加载同源资源。可选免登录评论由隔离的面板和独立服务提供，读者主动加载后才连接。

> 当前核心 `2026-10-26.3`。更新日志见 [CHANGELOG.md](CHANGELOG.md)；已有站点更新前请读 [UPDATING.md](docs/UPDATING.md)。可选评论与邮件默认关闭，真实服务及 Safari/iPhone 新交互需各自验收。

## 用这个模板建站

1. 点 **Use this template → Create a new repository**，可见性选 **Private**（你的文章和草稿都在这个仓库里）。
2. 改 4 处配置：`wrangler.jsonc` 的 `name`、`config/_default/hugo.toml` 的 `baseURL`、`data/editor.yaml` 的 `repo`、`data/site.yaml` 的网站名和社交链接。
3. 示例文章在 `content/posts/`：删掉，或把 `draft` 改成 `true` 留着参考。
4. 按 [docs/DEPLOY.md](docs/DEPLOY.md) 接入 Cloudflare，按 [docs/EDITING.md](docs/EDITING.md) 创建写作用的访问令牌。

**后台保存不等于网站上线。** 已提交到 GitHub 的内容不会因部署失败消失；本站默认使用 Cloudflare Workers Builds，不用 GitHub Actions。后台“发布说明”与 [本地发布兜底](docs/DEPLOY.md#云构建不可用时手动本地发布兜底) 提供检查和手动回退步骤；`npm run publish:fallback -- --check` 默认只检查，绝不自动部署或转付费。

## 本地运行

需要 [Hugo](https://gohugo.io/installation/) **v0.167.0 或更高**（standard 版即可，不需要 extended），以及 Node.js 18 或更高（用于配置/媒体检查与本地内容工具）。

```bash
hugo server            # http://localhost:1313 ，改文件自动刷新
npm run build          # 有效配置 + 源媒体 + 干净生产构建 + 产物检查
npm test               # 独立测试夹具，不要求保留模板示例文章
# 私有实例用 QJ_INSTANCE=1 npm test（仓库名改检查为非占位，其余回归相同）
```

不用 npm 安装的依赖运行 Hugo 预览仍可用；完整构建/内容工具先 `npm ci` 安装锁定的本地工具依赖。推荐 Node.js 24；可选浏览器回归需要 Node 22+ 和自己安装的 Chromium，见 [UPDATING.md](docs/UPDATING.md)。

## 写一篇文章

每篇文章一个文件夹，文件夹名就是永久链接：

```
content/posts/20261013-a7x2/
├── index.md
└── photo.webp
```

```markdown
---
title: 在一个普通的下午     # 可以留空
date: 2026-10-13T16:30:00+08:00
lastmod: ""                # 有实质更新才填写；留空沿用发布时间
kind: note                 # note 短记 | story 随笔 | photo 图文
summary: ""                # 可选
cover: ""                  # 可选，分享卡片图片；默认取第一张图
draft: true                # true 时不会出现在网站上
---

正文。

![替代文本](photo.webp "图注")
```

- 链接是 `/posts/20261013-a7x2/`，**改标题不会改链接**。文件夹名不要用真名或地名。
- 草稿（`draft: true`）和未来日期的文章不会被构建，它们的图片也不会被发布。
- 没有标签和分类；可选站内搜索，支持中文标题/正文检索，关键词不离开浏览器。

## 功能

- 首页/页脚：无卡片首屏（文字在左、线描在右，手机线描在上），页脚两行（联系入口 + 版权）；图片不超出正文栏。原文案、设置及文章地址不变，见 [DESIGN.md](docs/DESIGN.md)。
- CMS 可新建普通页面；页面功能、导航内部引用与外链分开，坏的本站链接阻止发布，不自动生成空页面。
- 后台可选新上传图片质量（站点设置 / 75 / 85 / 92）；本机偏好、下次载入生效，不重压旧图，见 [EDITING.md](docs/EDITING.md#图片压缩与质量选择)。
- 本地内容工具 V2：ZIP/目录、自动检查、摘要、可分页文字比较、完整报告、确认哈希绑定及刷新/取消；不覆盖或自动发布，见 [TRANSFER.md](docs/TRANSFER.md)。
- 核心/实例分层：CMS 核心 schema 与实例连接分开，Hugo 原生配置分片、固定核心清单和只读升级预览，见 [UPDATING.md](docs/UPDATING.md)。
- 可选 Buttondown 文末邮件表单与页脚链接，默认关闭，不自动发信或添加订阅者；见 [CUSTOMIZE.md](docs/CUSTOMIZE.md)。
- 可选免登录留言/回复：默认关闭，Waline 在独立面板中运行，不与博客或写作令牌共享源；不向读者收邮箱、不发邮件。面板与 Vercel Hobby + Neon Free 服务部署包已在本地实现/验证，已处理依赖告警并提供 GPL 对应源码；云端未开通，见 [COMMENTS.md](docs/COMMENTS.md)。
- 首页图标导航；favicon 可上传位图，自定义社交/导航图标还支持静态 SVG 和 HTTPS 图片地址，列表可排序、自动换行。SVG 不内联执行，外链会由访客直接请求该源，推荐下载后上传。
- 外链默认新标签，支持全局/逐项覆盖；正文提供类似 Shopify 的“链接打开方式”组件，仍保存 Markdown。
- 搜索默认开、答案之书默认关；有可排序的插槽和代码白名单，关闭后不加载它们的资源。
- Mastodon 双向身份验证与分享作者归属（不是自动联邦发帖）；RSS 在 `<baseURL>index.xml`。
- 构建期生成中文 OG 分享图；发布时间/更新时间统一为机器可读格式；页脚只回链模板 GitHub，可一键关闭。
- 使用说明与占位清理：[CUSTOMIZE.md](docs/CUSTOMIZE.md)；扩展契约：[EXTENDING.md](docs/EXTENDING.md)；另三个优化候选：[RESEARCH.md](docs/RESEARCH.md)。

## 目录

```
config/_default/hugo.toml   实例 URL/语言/发布开关（不从模板覆盖）
config/_default/params.toml 实例媒体/时区，其余配置分片由核心维护
data/site.yaml              网站名、导航、页脚等日常设置
data/links.yaml             友链
data/credits.yaml           致谢（只列实际使用的）
data/widgets.yaml           可选挂件（启停、顺序、插槽）
data/answers.yaml           答案之书的原创示例句子
data/widget_types.yaml      代码维护的挂件类型白名单
data/comments.yaml          可选评论开关与隔离面板源（不是 API 或凭据）
data/newsletter.yaml        可选邮件表单账号与说明（默认关闭，不发信）
core-manifest.json          固定核心文件清单，用于只读升级预览
content/                    文章与页面
assets/css/                 tokens → base → components → lightbox → 按需挂件 → overrides
assets/fonts/               自托管字体（Google Sans Code，拉丁字符）
assets/og/                  仅构建端使用的中文分享图字体与底图
assets/icons/               SVG 图标
assets/media/               全站共享图片，用 /media/文件名 引用
layouts/                    模板（按组件拆分）
scripts/                    媒体/站点检查、内容传输、备份与本地回归测试
data/editor.yaml            实例 CMS 仓库/分支/工作流
assets/admin/schema.yml     核心编辑器字段，Hugo 生成 /admin/config.yml
static/admin/               写作界面入口与配套脚本
assets/server/headers.txt    Hugo 生成 _headers 的单一安全策略来源
integrations/waline/        独立评论面板项目，不随 Hugo 构建/发布
integrations/waline-server/ 独立 Waline 服务候选与手动备份；默认锁定，开通见其 README
wrangler.jsonc              Cloudflare Workers 部署配置（仅静态资源）
docs/                       写作、定制、扩展、更新、部署、取舍与研究说明
```

- 设计基线：[docs/DESIGN.md](docs/DESIGN.md)；取舍记录（什么不做、为什么）：[docs/DECISIONS.md](docs/DECISIONS.md)
- 写作与编辑器（不绑定 CMS）：[docs/EDITING.md](docs/EDITING.md)；修改设置：[docs/CUSTOMIZE.md](docs/CUSTOMIZE.md)；部署：[docs/DEPLOY.md](docs/DEPLOY.md)

## 照片与隐私

图片会经过两道元数据清除，外加一道检查：

1. 在 CMS 上传时，浏览器内转为 WebP 并去除 EXIF（已真机验证）。
2. 构建时 Hugo 重新编码每张被引用的图片；文章文件夹里的原文件**不会**被发布。
3. `scripts/check-media.mjs` 在构建前检查仓库里的图片：只要含 EXIF/XMP/IPTC、是 HEIC/GIF/视频，或无法识别，就让构建失败。

即使最终网站上的图片是干净的，含 GPS 的原图一旦提交进 Git 就会留在历史记录里。所以第 3 步检查的是源文件，而不只是产物。

这些措施只处理**文件元数据**。照片里拍到的门牌、车牌、人脸、窗外地标，需要你自己在发布前看一眼。

页面可见部分只显示日期；HTML 的机器可读时间、结构化数据和 RSS 仍包含带时区的完整时间，不是隐藏时分的隐私机制。

## 许可证

- 模板代码：[MIT](LICENSE)。
- 你用模板写的文章和照片归你所有，不受 MIT 约束（页脚默认写「版权所有」，可在 `data/site.yaml` 修改）。
- 第三方软件与素材：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 路线

- [x] Phase 1：本地模板、主题接口、媒体检查、测试
- [x] Phase 2：Sveltia CMS（`/admin/`）、草稿开关、手机 HEIC 上传去元数据（真机验证）、CSP 加固
- [x] Phase 3：公开模板仓库 + 私有实例仓库 + Cloudflare Workers Builds 自动部署（非生产分支不构建）
- [x] Phase 4：真机验收与使用文档（实例作者已确认；新建站点仍需自行验收）
- [x] 2026-10-19 体验/扩展更新：实现、本地回归与样式验收完成，随本次更新交付
- [x] 2026-10-25：配置分层、内容工具 V2/ZIP、状态修复与发布兜底
- [x] 2026-10-26：后台链接/图标/订阅/评论字段与构建规则一致，坏值在保存前拦下；精简首屏、页脚与归档，去掉重复入口，图片不再超出正文栏
- [ ] 可选评论与邮件真实服务、新交互 Safari/iPhone 真机验收：独立进行，不随代码交付自动完成

## 首发于
[Linuxdo](https://linux.do)
