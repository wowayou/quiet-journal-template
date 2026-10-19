# Quiet Journal

一个安静、易于修改的个人生活博客模板，基于 Hugo。博客本体没有数据库，不需要服务器或统计脚本，默认只加载同源资源。可选免登录评论由隔离的面板和独立服务提供，读者主动加载后才连接。

> 当前版本：**2026-10-19 体验与扩展更新**，见 [CHANGELOG.md](CHANGELOG.md)；已有站点更新前请读 [UPDATING.md](docs/UPDATING.md)。样式已由实例作者验收；可选评论默认关闭、独立云端服务尚未开通，新交互的 Safari/iPhone 真机验收仍需另做。

## 用这个模板建站

1. 点 **Use this template → Create a new repository**，可见性选 **Private**（你的文章和草稿都在这个仓库里）。
2. 改 4 处配置：`wrangler.jsonc` 的 `name`、`config/_default/hugo.toml` 的 `baseURL`、`static/admin/config.yml` 的 `backend.repo`、`data/site.yaml` 的网站名和社交链接。
3. 示例文章在 `content/posts/`：删掉，或把 `draft` 改成 `true` 留着参考。
4. 按 [docs/DEPLOY.md](docs/DEPLOY.md) 接入 Cloudflare，按 [docs/EDITING.md](docs/EDITING.md) 创建写作用的访问令牌。

## 本地运行

需要 [Hugo](https://gohugo.io/installation/) **v0.167.0 或更高**（standard 版即可，不需要 extended），以及 Node.js 18 或更高（仅用于检查脚本）。

```bash
hugo server            # http://localhost:1313 ，改文件自动刷新
npm run build          # 源媒体检查 + 干净生产构建 + 链接/日期/产物检查
npm test               # 独立测试夹具，不要求保留模板示例文章
# 私有实例用 QJ_INSTANCE=1 npm test（仓库名改检查为非占位，其余回归相同）
```

不用 npm 也可运行：`node scripts/check-media.mjs && hugo --gc --minify --cleanDestinationDir && node scripts/check-site.mjs`。`public/` 是可清理的生成目录，不要在里面手放文件。推荐 Node.js 24；可选浏览器回归需要 Node 22+ 和自己安装的 Chromium，见 [UPDATING.md](docs/UPDATING.md)。

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

## 本轮体验与扩展

- 首页/页脚：欢迎区分栏、手机堆叠、原生同页“开始阅读”，页脚按个人表达/联系订阅/版权分组。原文案、设置及文章地址不变；作者已于 2026-10-19 确认样式验收，见 [DESIGN.md](docs/DESIGN.md)。
- CMS 可新建普通页面；页面功能、导航内部引用与外链分开，坏的本站链接阻止发布，不自动生成空页面。
- 后台可选新上传图片质量（站点设置 / 75 / 85 / 92）；本机偏好、下次载入生效，不重压旧图，见 [EDITING.md](docs/EDITING.md#图片压缩与质量选择)。
- 本地内容导出、完整性校验/冲突比较、隔离导入；保留原文件，不覆盖或自动发布，见 [TRANSFER.md](docs/TRANSFER.md)。
- 可选免登录留言/回复：默认关闭，Waline 在独立面板中运行，不与博客或写作令牌共享源；不向读者收邮箱、不发邮件。面板与 Vercel Hobby + Neon Free 服务部署包已在本地实现/验证，已处理依赖告警并提供 GPL 对应源码；云端未开通，见 [COMMENTS.md](docs/COMMENTS.md)。
- 首页图标导航；favicon 与社交/导航图标可上传位图，列表可排序、自动换行。
- 外链默认新标签，支持全局/逐项覆盖；正文提供类似 Shopify 的“链接打开方式”组件，仍保存 Markdown。
- 搜索默认开、答案之书默认关；有可排序的插槽和代码白名单，关闭后不加载它们的资源。
- Mastodon 双向身份验证与分享作者归属（不是自动联邦发帖）；RSS 在 `<baseURL>index.xml`。
- 构建期生成中文 OG 分享图；发布时间/更新时间统一为机器可读格式；页脚只回链模板 GitHub，可一键关闭。
- 使用说明与占位清理：[CUSTOMIZE.md](docs/CUSTOMIZE.md)；扩展契约：[EXTENDING.md](docs/EXTENDING.md)；另三个优化候选：[RESEARCH.md](docs/RESEARCH.md)。

## 目录

```
config/_default/hugo.toml   构建配置（技术项）
data/site.yaml              网站名、导航、页脚等日常设置
data/links.yaml             友链
data/credits.yaml           致谢（只列实际使用的）
data/widgets.yaml           可选挂件（启停、顺序、插槽）
data/answers.yaml           答案之书的原创示例句子
data/widget_types.yaml      代码维护的挂件类型白名单
data/comments.yaml          可选评论开关与隔离面板源（不是 API 或凭据）
content/                    文章与页面
assets/css/                 tokens → base → components → lightbox → 按需挂件 → overrides
assets/fonts/               自托管字体（Google Sans Code，拉丁字符）
assets/og/                  仅构建端使用的中文分享图字体与底图
assets/icons/               SVG 图标
assets/media/               全站共享图片，用 /media/文件名 引用
layouts/                    模板（按组件拆分）
scripts/                    媒体/站点检查、内容传输、备份与本地回归测试
static/admin/               写作界面（Sveltia CMS）入口与配置
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
- [ ] 可选评论云端开通、新交互 Safari/iPhone 真机验收：独立进行，不随代码交付自动完成

## 首发于
[Linuxdo](https://linux.do)
