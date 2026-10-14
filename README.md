# Quiet Journal

一个安静、易于修改的个人生活博客模板，基于 Hugo。没有数据库，不需要服务器，没有统计脚本，访客页面不加载任何第三方资源。

> 当前状态：**设计 v1.0 定稿。** 手机写作与照片去元数据已真机验证。

## 用这个模板建站

1. 点 **Use this template → Create a new repository**，可见性选 **Private**（你的文章和草稿都在这个仓库里）。
2. 改 4 处配置：`wrangler.jsonc` 的 `name`、`config/_default/hugo.toml` 的 `baseURL`、`static/admin/config.yml` 的 `backend.repo`、`data/site.yaml` 的网站名和社交链接。
3. 示例文章在 `content/posts/`：删掉，或把 `draft` 改成 `true` 留着参考。
4. 按 [docs/DEPLOY.md](docs/DEPLOY.md) 接入 Cloudflare，按 [docs/EDITING.md](docs/EDITING.md) 创建写作用的访问令牌。

## 本地运行

需要 [Hugo](https://gohugo.io/installation/) **v0.167.0 或更高**（standard 版即可，不需要 extended），以及 Node.js 18 或更高（仅用于检查脚本）。

```bash
hugo server            # http://localhost:1313 ，改文件自动刷新
npm run build          # 媒体检查 + 生产构建，输出到 public/
npm test               # 单元测试 + 端到端冒烟测试
```

不用 npm 也可以直接运行：`node scripts/check-media.mjs && hugo --gc --minify`。

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
- 没有标签和分类。

## 目录

```
config/_default/hugo.toml   构建配置（技术项）
data/site.yaml              网站名、导航、页脚等日常设置
data/links.yaml             友链
data/credits.yaml           致谢（只列实际使用的）
content/                    文章与页面
assets/css/                 tokens.css → base → components → lightbox → overrides
assets/fonts/               自托管字体（Google Sans Code，拉丁字符）
assets/icons/               SVG 图标
assets/media/               全站共享图片，用 /media/文件名 引用
layouts/                    模板（按组件拆分）
scripts/                    check-media、smoke-test、backup 与单元测试
static/admin/               写作界面（Sveltia CMS）入口与配置
wrangler.jsonc              Cloudflare Workers 部署配置（仅静态资源）
docs/                       DESIGN、DECISIONS、EDITING、CUSTOMIZE、DEPLOY、R2_FUTURE
```

- 设计定稿：[docs/DESIGN.md](docs/DESIGN.md)；取舍记录（什么不做、为什么）：[docs/DECISIONS.md](docs/DECISIONS.md)
- 写作与编辑器（不绑定 CMS）：[docs/EDITING.md](docs/EDITING.md)；修改设置：[docs/CUSTOMIZE.md](docs/CUSTOMIZE.md)；部署：[docs/DEPLOY.md](docs/DEPLOY.md)

## 照片与隐私

图片会经过两道元数据清除，外加一道检查：

1. 在 CMS 上传时，浏览器内转为 WebP 并去除 EXIF（已真机验证）。
2. 构建时 Hugo 重新编码每张被引用的图片；文章文件夹里的原文件**不会**被发布。
3. `scripts/check-media.mjs` 在构建前检查仓库里的图片：只要含 EXIF/XMP/IPTC、是 HEIC/GIF/视频，或无法识别，就让构建失败。

即使最终网站上的图片是干净的，含 GPS 的原图一旦提交进 Git 就会留在历史记录里。所以第 3 步检查的是源文件，而不只是产物。

这些措施只处理**文件元数据**。照片里拍到的门牌、车牌、人脸、窗外地标，需要你自己在发布前看一眼。

页面只显示日期，不显示具体时间；RSS 按规范包含完整时间。

## 许可证

- 模板代码：[MIT](LICENSE)。
- 你用模板写的文章和照片归你所有，不受 MIT 约束（页脚默认写「版权所有」，可在 `data/site.yaml` 修改）。
- 第三方软件与素材：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 路线

- [x] Phase 1：本地模板、主题接口、媒体检查、测试
- [x] Phase 2：Sveltia CMS（`/admin/`）、草稿开关、手机 HEIC 上传去元数据（真机验证）、CSP 加固
- [ ] Phase 3：公开模板与私有实例已创建、Worker 已部署；Git 自动构建接入与验证待完成
- [ ] Phase 4：真机验收与使用文档
