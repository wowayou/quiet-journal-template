# 修改外观与设置

Sveltia CMS（内容管理系统）只是文件编辑界面。模板作者和使用者都能修改它的字段、提示、排序和工具栏：核心字段、提示和排序在 `assets/admin/schema.yml`，实例连接在 `data/editor.yaml`，新增字段/集合可用 `data/editor_extensions.yaml`；Hugo 生成后台配置，不编辑静态副本。**改配置不会自动实现新功能**，新行为仍需对应模板或脚本，见 [EXTENDING.md](EXTENDING.md)。

## 日常入口

| 想改什么 | CMS 入口 | 文件 |
|---|---|---|
| 站名、署名、首页介绍、主题色 | 站点设置 → 网站信息 | `data/site.yaml` |
| favicon（浏览器标签页图标） | 网站信息 → 网站图标 | `data/site.yaml` + `assets/media/` |
| 导航、社交图标及其顺序 | 网站信息 → 导航 / 社交链接 | `data/site.yaml` |
| 全站外链打开方式、分享封面 | 网站信息 → 链接默认行为 / 分享卡片 | `data/site.yaml` |
| 模板 GitHub 回链 | 网站信息 → 页脚 → 显示 Quiet Journal 的 GitHub 回链 | `footer.show_template_credit` |
| 搜索 / 答案之书、顺序与位置 | 站点设置 → 可选挂件 | `data/widgets.yaml` |
| 答案之书的句子 | 站点设置 → 答案之书的句子 | `data/answers.yaml` |
| 新增关于、现在、阅读指南等页面 | 页面 → 新建 | `content/<稳定 ID>.md` |
| 友链 | 站点设置 → 友链 | `data/links.yaml` |
| 字体、宽度、间距、图标动效 | 不放进写作表单；由代码维护 | `assets/css/overrides.css` |

## 首页欢迎区

首屏是单栏：线描、网站描述、欢迎标题、介绍和“开始阅读”，下面直接显示原有挂件、精选与最近文章。社交图标和 RSS 只放在页脚，首屏不再重复。

- 继续在 **CMS → 站点设置 → 网站信息** 修改：`description` 显示在欢迎标题上方，留空不显示；`hero.title` 是欢迎标题，留空用站名；`hero.text` 是现有 Markdown 介绍。
- 原生“开始阅读”跳到同页的“最近”，键盘焦点随之移动；不改文章地址、分页、归档、搜索或 `/index.xml`。
- 线描只是模板自带的静态装饰，无图片请求、动画或新增表单字段。代码在 `layouts/_partials/home/artwork.html`，外观仍可用 `assets/css/overrides.css` 定制。
- 不要求替换现有文案，也不迁移整份 `data/site.yaml`。关闭 JavaScript 后入口仍能使用，常显导航不吸顶，以免遮住锚点。

## 导航：先有页面，再有入口

```yaml
nav:
  - { type: home, label: 首页, icon: home, icon_only: true }
  - { type: page, label: 关于, page: about }
  - { type: external, label: 另一个站点, url: "https://example.org/", target: auto }
```

- **首页**默认只显示图标，名称仍用于屏幕阅读器。每项也可选择图标加文字。
- **站内页面**在 CMS 下拉选择，保存文件 ID，不保存标题；改标题不改链接。新建页面默认是草稿，先发布再加入导航。
- **外部网站**填完整 `https://` 或 `http://` 地址；不会替你新建页面或抓取对方内容。
- 缺失、草稿、未来或过期的站内目标会阻止生产构建；正文的本站坏链接和坏锚点也会被检查。**构建失败时线上保留上次成功版本，CMS 显示“已保存”不等于已上线。**
- 撤下/删除页面：先移除导航和正文里的引用，保存成功后再撤下。`/archive/` 被首页、搜索和 404 共用，不能只删这个文件；需要替换这些入口后再删除。
- 外站是否仍存在不在离线构建检查范围内；格式正确的外链也可能日后失效，请定期手工看一遍。
- 旧版 `{label, url}` 导航仍能渲染，但再次用新版 CMS 编辑前，应按上例迁移为有 `type` 的结构。

## 上传图标与社交链接

favicon 推荐正方形 **512×512**。CMS 会处理为 WebP；构建输出 32×32、192×192 PNG 以及 180×180 Apple 触屏图标。留空用模板的 `static/favicon.svg`。

社交与导航自定义图标用 `icon_image`，优先于内建 `icon`。可上传 PNG/JPEG/WebP 或静态 SVG，也可粘贴完整的 **HTTPS 图片地址**（不是个人主页）。例如 `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/linuxdo.svg`，相应的 WebP 地址也支持。外链路径须以 `.svg/.png/.jpg/.jpeg/.webp` 结尾，可带查询参数，不接受凭据或片段。构建不下载外链，由读者浏览器直接加载，并设置 `referrerpolicy=no-referrer`；配置外链即会增加对该图片源的请求/访问记录及可用性依赖，后台预览同样会请求。推荐先下载后上传，避免图标失效并保持同源加载。

本地引用为 `/media/my-icon.svg` 或 `/media/my-icon.webp`。位图仍会重编码，CMS 最长边 512、上传限 2 MiB。SVG 最多 256 KiB，只接受基础静态图形和 `.class { fill: #颜色; }` 一类简单颜色样式；不支持脚本、事件、外部引用、`use`、动画、任意 CSS 或编辑器元数据。复杂 SVG 请先转换为 PNG/WebP。SVG 作为带指纹的 `<img>` 发布，绝不以内联代码执行；外链文件不在构建检查范围内。显示时保留完整比例，请检查透明图标在深浅色下都看得清。

```yaml
social:
  - label: 我的个人站点
    url: https://example.org/
    icon: link
    icon_image: /media/my-icon.webp
    target: auto
    me: true
```

- 列表顺序就是显示顺序，可在 CMS 拖动；多了自动换行，不藏进横向滚动条。显示在每页页脚。
- 内建图标：`home search calendar link github x mastodon telegram bilibili douban sinaweibo instagram zhihu xiaohongshu mail rss`。未知但格式合法的图标名显示通用链接图标；新增内建 SVG 属于代码维护。
- **favicon 仍只接受本地 PNG/JPEG/WebP，正文不接受 SVG**；SVG 只用于共享图标区并通过媒体检查，ICO 不开放上传。不要通过 SVG 安装插件。自定义图标地址非法或文件不存在时，构建明确失败，不能把远程仓库已保存误认为线上已更新；请同时核对部署检查。
- `me: true` 表示“这是我自己的身份主页”，不是“我喜欢这个链接”。不要给友链、模板仓库或赞助活动页加身份声明。

## 邮件订阅（可选）

在 CMS“邮件订阅”或 `data/newsletter.yaml` 设置：

```yaml
enabled: true
username: your-buttondown-name
heading: 喜欢这些记录？
text: 偶尔把新文章和近况寄给你。确认邮箱后开始接收，随时退订。
```

须先自行开通账号、核对实际套餐及免费范围；默认关闭，不能填示例账号就当开通。仅公开文章文末提供原生邮箱表单、页脚留邮件链接；无第三方脚本/iframe/预连接，提交才前往 Buttondown 验证。生成的 CSP 只对含表单的文章放行精确提交地址，`/admin/` 策略不扩大。单纯改这里不会发信、创建自动化、导入名单或开启 RSS-to-email；后者需单独核价授权，见 [RESEARCH.md](RESEARCH.md)。

每篇表单使用独立的精确路径策略；Cloudflare 静态响应头最多 100 条路径规则、每行 2,000 字符，构建按字节作保守校验。自定义规则与文章合计超限会停止，不截断文章策略，也不自动放宽到全站。规模接近限额时先重新设计并验收路径规则；临时可关闭本可选入口，不据此开启付费能力。

## 链接与分享

`links.external_target: new` 默认把非本站网页开在新标签；设为 `same` 则在当前标签打开。本站链接默认当前标签，邮件/电话由设备处理。每条导航、社交、友链可用 `target: auto | same | new` 覆盖；正文用“链接（打开方式）”组件，见 [EDITING.md](EDITING.md)。新标签链接包含 `noopener noreferrer`，并向辅助技术说明打开方式。

Open Graph（OG，分享卡片元数据）的图片优先级：**单页 `cover` → 正文首图 → 全站 `sharing.image` → 自动文字卡片**。图片只在构建期生成 1200×630 JPEG，无远程图片 API；8 MB 的中文字体只留在构建端，访客不下载它。自动卡片可以用 `sharing.generate: false` 关闭，已有封面仍生效。全站图片同样从 `/media/` 上传，封面最好同时填写替代文本。远程图片不会被下载来生成卡片；建议分享封面使用本地上传文件。分享平台可能缓存旧卡片，不能保证保存后立即刷新。

## 可选挂件

- **搜索**默认启用：首页介绍后显示，页头提供图标入口。首次输入才下载本站全文索引，支持中文连续文字、多词同时匹配；关键词不发送给服务器，不保存搜索历史。失败可重试，也保留归档入口。
- **答案之书**默认关闭：原创示例句子，可全部替换；只是一句思考提示，不是远程 AI 或决策服务。
- 两者都可关闭或拖动排序。位置可选 `home-after-intro`（首页介绍之后）、`content-after`（每页正文后）、`footer-before`（每页页脚前）。同一位置按列表顺序显示。
- 最多配置 8 个挂件；关闭后不输出该挂件的 HTML、脚本、样式或数据。搜索从草稿/未来内容之外的已发布页面生成，`search_exclude` 或 `noindex` 页面不入索引；原始索引超过 2 MiB 会报错，不暗中截断正文。
- 答案 2–100 条，每条不超过 600 UTF-8 字节；无 JavaScript 时保留一句静态文字，搜索则保留归档链接。

## Mastodon 与 RSS

一个账号可以验证多个网站，不要求一个站点一个账号：

1. 在本站社交列表填**自己的个人资料完整 URL**，打开 `me`。模板在 HTML 中输出 `rel="me"`，无需 JavaScript。
2. 在 Mastodon“编辑个人资料”的资料字段填本站完整 HTTPS 地址，然后保存。**每个要验证的网站都必须各自回链同一个账号**；验证一个子域名不会自动认证其他子域名。
3. 官方标准资料栏为 **4 行**，实例可能自定义；多站是否能同时展示要看实例限制，不承诺无限字段。失败可等片刻或删除该字段后重新添加保存。
4. 如需文章被分享时关联作者，另填 `fediverse.creator: "@you@your-instance.example"`，并在 Mastodon“验证 → 作者归属 → 允许署名的网站”中加入本站域名（仅域名，不带路径）。模板不会操作你的账号。

`rel=me` 是双向身份验证；`fediverse:creator` 是分享时的作者归属。它们**不是 ActivityPub 联邦发布**，不会让人直接关注博客收件箱，也不会自动发帖。细节以 [Mastodon 官方文档](https://docs.joinmastodon.org/user/profile/#verification)为准。

RSS（Really Simple Syndication，订阅源）固定为 **`<baseURL>index.xml`**，页头有自动发现声明，页脚有入口。它输出最近 20 篇公开文章的全文与绝对图片/链接，不包含普通页面；不要改成参考站的 `rss.xml` 或订阅参考站的地址。

## 页脚文字与个人表达

可以借鉴个人博客的页脚层次，但不需要加插件：**CMS → 站点设置 → 网站信息 → 页脚** 已提供一句话、内容版权说明、技术/模板回链、RSS 和回到顶部。对应键如下，只修改你需要的键，不要用示例覆盖整份站点设置：

```yaml
footer:
  quote: 把日子慢慢写下来。
  content_license: 文字与照片版权所有，转载请先联系作者。
  show_built_with: false
  show_template_credit: true
  show_rss: true
  back_to_top: true
```

`quote` 和 `content_license` 是纯文字，自动折行，不解释 HTML/脚本；`quote` 保留显式换行，留空就不显示。前者表达个人语气，后者说明作者作品的使用条件，不把二者混成“模板许可证”。关闭回链不改变应保留的代码许可证。

页脚是三行：一句话；社交 / 邮件 / RSS 与回到顶部；版权与回链小字。站名已在页头，不重复。窄屏自动换行，不新增设置。没有社交且页脚 RSS 关闭或未生成订阅源时，不留下空的联系行。`show_rss` 是页面上唯一的 RSS 入口开关；关闭后订阅源仍然生成，阅读器仍可通过页头自动发现找到。

参考 [Linexic](https://www.linexic.top/) 的个人宣言与链接分组即可，不照抄别人的句子、建站日期或秒级计时脚本。版权年份当前按已发布文章的最早年份与当前年生成，并非一个精确的“建站年龄”；不要拿它当永久运行时长。确有真实起始日期、计时或更多页脚链接需求时再单独实现；现有文字不需要定时任务、统计请求或放宽安全策略。本站订阅路径仍为 `/index.xml`，个人主页可放到已有社交列表。

更多参考及 Koi 代码许可边界见 [RESEARCH.md](RESEARCH.md#2026-10-16-新增的阅读页与首页参考)。本轮未替作者改写实际页脚文字。

## 个性化 CSS 与占位文字

```css
/* assets/css/overrides.css */
:root {
  --c-accent-light: #2f6f8f;
  --c-accent-dark: #8fc7e8;
  --content-width: 44rem;
  --spacing-unit: 1.125rem;
  --icon-hover-y: -2px;
  --icon-hover-rotate: 0deg;
  --icon-hover-scale: 1.05;
}
```

如需只用系统字体，可在 `data/site.yaml` 设置 `webfont: none`，不再发布 Google Sans Code；字体族仍可在 `overrides.css` 通过 `--font-body` / `--font-cjk` 调整。

把动效三个值设为 `0px / 0deg / 1` 可关闭移动、旋转、缩放；系统“减少动态效果”自动禁用这些变换。更复杂的行为用扩展接口，不要改每个页面。文字和强调色对背景的对比度应 ≥ 4.5:1。

`Quiet Journal`、`示例作者`、`example.com`、`OWNER/REPO`、示例文章/友链/默认 favicon 都是占位，不是你的真实身份。模板默认社交列表为空，Mastodon 账号也为空。页脚的 Quiet Journal GitHub 链接是**模板项目回链**，不是你的个人 GitHub；关闭 `footer.show_template_credit` 即可一键移除，不影响功能。分发模板代码时仍需保留仓库里的 MIT 与第三方许可证文件。
