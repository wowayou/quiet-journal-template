# 写作与编辑器

网站不依赖任何编辑器。内容就是文件夹里的 Markdown 和图片；编辑器只是改这些文件的一种方式，可以随时换掉。删除 `static/admin/` 后网站照常构建（`scripts/smoke-test.mjs` 会检查）。

## 内容约定（所有编辑器都必须遵守）

```
content/posts/<稳定 ID>/index.md      一篇文章（文件夹名 = 链接，如 20261014-a7x2b9c1）
content/posts/<稳定 ID>/*.webp        这篇文章的图片
assets/media/*.webp                   全站共享图片，正文用 /media/文件名 引用
data/site.yaml、data/links.yaml       站点设置、友链
```

```yaml
---
title: ""            # 可空
date: 2026-10-14T00:43:00+08:00
kind: note           # note 短记 | story 随笔 | photo 图文（图片更宽）
summary: ""          # 可空
cover: ""            # 可空，分享卡片用；默认取正文第一张图
featured: false      # 首页「精选」
draft: true          # true = 不公开（正文和图片都不会出现在网站上）
---
正文。![替代文本](photo.webp "图注")
```

模板只读这些字段，其他字段会被忽略。

**隐私不依赖编辑器**：不管用什么上传，构建前的 `scripts/check-media.mjs` 都会拒绝带 EXIF/GPS 的图片、HEIC、视频；Hugo 发布的每张图都重新编码。但图片一旦提交进 Git 就留在历史里，所以编辑器最好在上传前就去掉元数据。

## 默认编辑器：Sveltia CMS（`/admin/`）

两种保存方式，在 `static/admin/config.yml` 中切换：

| | simple（默认） | editorial_workflow（审核流） |
|---|---|---|
| 保存 | 直接提交到 `main` | 进入 `cms/*` 分支和 PR，不动 `main` |
| 公开 | 关掉文章的「草稿」再保存 | 点「发布」合并 PR |
| 撤下 | 打开「草稿」再保存 | 打开「草稿」再发布，或删除 |
| 草稿存放 | `main` 上（私有仓库），网站不构建 | 分支上，`main` 完全没有 |
| 每次保存的请求数 | 1 次提交 | 建分支、提交、开 PR、打标签等多次（手机网络下更易失败） |
| 令牌权限 | Contents 读写 | Contents + Pull requests 读写 |
| 配置改动 | — | `publish_mode: editorial_workflow`，并把 `draft` 字段的 `default` 改为 `false` |

两种方式下草稿都不会出现在网站上。单人写作建议 simple；想让草稿完全不进 `main`，或以后多人写作时用审核流。

- 发布后大约 1–2 分钟上线。
- 手机照片（含 HEIC）在浏览器里转成 WebP，最长边 2048，去掉 EXIF。已在真机验证：Git 里的文件不含 EXIF/XMP/GPS。
- 登录：GitHub Fine-grained 访问令牌，只授权这一个仓库，权限 **Contents: Read and write**（审核流另加 Pull requests），有效期 30–90 天。
- **不要在两台设备上同时打开同一篇文章编辑**：后保存的一方会冲突或失败。换设备前先在原设备保存。
- 令牌存在这个浏览器里。只在自己的设备上登录；丢手机或怀疑泄露时，到 GitHub → Settings → Developer settings → Fine-grained tokens 删除它。

### 升级 Sveltia CMS

`static/admin/index.html` 固定了版本号和 SRI（子资源完整性校验，文件被篡改时浏览器拒绝执行）。升级时两处一起改：

```bash
V=0.235.1   # 换成新版本，版本记录见 https://github.com/sveltia/sveltia-cms/releases
curl -sL "https://unpkg.com/@sveltia/cms@$V/dist/sveltia-cms.js" | openssl dgst -sha384 -binary | openssl base64 -A
```

把 `src` 里的版本号和 `integrity="sha384-…"` 替换掉，推送后登录 `/admin/` 确认能打开文章列表、上传一张图。出问题就把这个文件改回旧版本。

## 其他编辑方式

| 方式 | 适合 | 注意 |
|---|---|---|
| 本地编辑器（VS Code、Obsidian 等）+ `git push` | 电脑上写长文 | 图片要自己转 WebP、去元数据；推送前运行 `node scripts/check-media.mjs` |
| GitHub 网页 | 改错字 | 不要从这里上传手机原图 |
| 换别的 Git CMS（Decap、Pages CMS 等） | Sveltia 不可用时 | 只需按上面的「内容约定」写配置；确认它能在上传前去除元数据 |

## 备份

`scripts/backup.sh <owner/repo>` 把仓库完整镜像到本地（含全部历史），建议每周一次。GitHub 免费账号的私有仓库没有分支保护，令牌泄露后仓库可能被改写，本地镜像是最后的保险。
