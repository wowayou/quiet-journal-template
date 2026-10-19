# 扩展契约

适用本轮体验/扩展更新。目标是让用户以小成本扩展，而不是把模板变成页面搭建平台。**配置输入与可执行代码分开**；编辑器可替换，发布始终走媒体检查 → Hugo → 产物检查。

## 所有权与边界

| 层 | 位置 | 谁修改 / 保证 |
|---|---|---|
| 内容 | `content/`、`assets/media/` | 作者；稳定 ID，不依赖 CMS 专属数据库 |
| 日常设置 | `data/site.yaml`、`links.yaml`、`widgets.yaml`、`answers.yaml` | 作者 / CMS；值是内容，不是脚本路径 |
| 页面/组件 | `layouts/` | 开发者；复用 `baseof.html`、页头页脚、链接和媒体解析 |
| 个性化样式 | `assets/css/overrides.css` | 使用者；最后加载，核心升级时保留 |
| 个性化行为 | 可选 `assets/js/custom.js` | 使用者；同源、指纹化、模块脚本，未提供则零输出 |
| 局部扩展 | `layouts/_partials/extensions/head.html`、`body-end.html` | 使用者的代码入口；默认空，不在 CMS 接受 HTML |
| 挂件类型 | `data/widget_types.yaml` + 可选 `data/widget_extensions.yaml` | 核心白名单 + 使用者白名单；不能用扩展覆盖内建名称 |
| 编辑器适配 | `static/admin/config.yml`、`editor-components.js` | 开发者；新增字段必须有渲染/验证实现，不能只画表单 |
| 可选评论 | `data/comments.yaml`、`integrations/waline/`、`integrations/waline-server/` | 博客只存开关/面板源；客户端、API/管理端、数据库与主站分开，不作为通用挂件或博客构建依赖 |

“接口稳定”指这些职责和输入契约应向后兼容，不代表所有 CSS 选择器或内部实现永不变化。破坏性变更必须在 `CHANGELOG.md` 写迁移步骤。更新时区分公共代码和用户文件，见 [UPDATING.md](UPDATING.md)。

## 新页面复用组件

只是新文字页面：在 CMS 选 `layout: page` 即可，不需要写模板。新的业务类型示例：

```html
<!-- layouts/reading.html，由开发者维护 -->
{{ define "main" }}
  {{ partial "page-header.html" (dict "page" .) }}
  <!-- 这里读取自己的结构化数据并渲染列表；不要复制整套 head/header/footer。 -->
{{ end }}
```

对应页面设 `layout: reading`，并把它加到 CMS 页面功能选项。布局文件不存在会构建失败，不偷偷渲染成另一个类型。`page-header.html` 接收 `page`，可选 `description`，包含标题、真实日期和页面正文；文章页继续使用 `page.html`。

- 文章 `kind: note | story | photo` 不等于 `layout`。前者是文章语义，后者负责页面功能。
- 链接用 `links/resolve.html` → `links/attributes.html` / `links/notice.html`；不要各处手写不一致的 `target`。返回 `url / external / new / rel`。
- 内容图片用 `media.html` / `media/resolve.html`，图标用 `icon.html`，站点图片用 `media/site-image.html`，不要直接发布 `assets/media/` 原文件。
- 页面 ID 不要占用 `admin css js fonts media og search page` 等资源路径，也不要用 `url`/`slug` 绕过保留路径。正文与导航只能引用真正发布的目标；不要移除 `/archive/` 后留下共享入口。

## 注册挂件（无需修改基础布局）

例如增加静态“此刻”挂件：

```yaml
# data/widget_extensions.yaml（代码维护，不通过 CMS 修改）
user-now:
  partial: widgets/user-now.html
  style: css/widgets/user-now.css  # 可省略
  # script: js/widgets/user-now.js # 可省略；静态组件优先
  slots: [home-after-intro, content-after, footer-before]
```

```html
<!-- layouts/_partials/widgets/user-now.html -->
<p>{{ hugo.Data.now.text }}</p>
```

```yaml
# data/now.yaml：内容层，可另给 CMS 配一个字段
text: 最近在慢慢整理照片。
```

```yaml
# 在 data/widgets.yaml 的列表中加入
- id: user-now
  type: user-now
  title: 此刻
  enabled: true
  slot: home-after-intro
```

若想让 CMS 选择这个类型，还需在 `widgets.type` 的选项中增添 `user-now`。白名单缺少模板或声明的样式/脚本时，启用会失败，不忽略故障。文件中的 `partial / script / style` 都是代码维护者指定，不能让普通表单自由输入。

### 输入与生命周期

- 实例字段：`id`、`type`、`title`、`enabled`、`slot`。`id` 符合 `[a-z][a-z0-9-]{0,31}`，全站唯一，含关闭项最多 8 个。
- 类型模板接收 `dict "page" <Hugo 页面> "widget" <实例配置>`。外层自动生成 `<section id="widget-<id>" data-widget="<type>">` 和带关联 ID 的二级标题；不要重复生成相同 ID。
- `home-after-intro` 只在首页（含首页分页）渲染；`content-after` 在每页正文后；`footer-before` 在页脚前。同插槽按配置列表排序。
- 样式/脚本只在实际承载组件的页面加载，同一文件去重。`overrides.css` 总在最后。关闭项不发布 HTML、数据和资源。
- 脚本是独立 ES module（JavaScript 模块），`type="module"` 延后执行；只操作自己根节点下的 `data-*`，避免全局状态/定时器。不自动打包依赖或发布相对 import 的文件；内建挂件无依赖。
- 可选 `custom.js` 会在全站加载，不要把仅一页使用的重逻辑塞进去。组件专属逻辑应使用注册的 `script`。

### 安全、性能与交互门槛

1. 默认无第三方请求、无后台 API、无令牌；不允许 CMS 上传 JS、HTML 或 SVG 来“安装插件”。普通扩展不放宽 CSP（Content Security Policy，内容安全策略）。可选评论是单独审查的跨源面板，仅由专用生成器放行一个 frame-src；不允许给父页增加第三方脚本或连接权限，见 [COMMENTS.md](COMMENTS.md)。
2. 字段按文本转义，动态内容用 `textContent`，不要把搜索词、答案等拼进 `innerHTML`。需要传数据时用安全序列化，不手拼 JSON/脚本。
3. HTML 先可用，JS 只增强：无 JS/失败/空数据状态必须明确；按钮有可访问名称，键盘可操作，触控区至少 44px。尊重 `prefers-reduced-motion`，不自动播放或持续移动。
4. 资源在构建期生成并带内容指纹；不轮询，不自动重试远程服务。新依赖/新自动化要重新核对授权、用量、费用和维护人。
5. 内建搜索索引硬上限 **2 MiB（原始 JSON）**，首次非空输入才取，8 秒超时，失败只由用户触发重试，最多展示前 20 项并明确告知总数；不会截断索引。规模增长时先测再决定是否替换，不先搭搜索服务器。
6. 图片源与产物继续通过 `check-media`；草稿/未来内容不能进入搜索、RSS、分享图或静态资源。`noindex`/`search_exclude` 仅是发现策略，不是安全策略。
7. 新挂件须有启用/关闭、错误配置、资源缺失、手机/键盘、无 JS 和安全回归测试；不因“功能可用”就跳过关闭态。

## 图标动效与全局钩子

内建悬停反馈只使用 CSS transform，不改变布局；变量是 `--icon-hover-y`、`--icon-hover-rotate`、`--icon-hover-scale`，放在 `overrides.css` 调整即可。也可针对 `[data-social="mastodon"]` 设置局部变量。新增动画必须限定在 `(prefers-reduced-motion: no-preference)`，不能只有悬停才能获知重要信息。

全局 HTML 钩子只供可信开发者使用。脚本优先放 `custom.js` 或挂件注册，不往钩子里插内联 JS、远程脚本、追踪像素、任意 iframe。能编辑仓库代码的人本来就能改变网站，白名单和媒体扫描不能把不可信的开发者变成可信开发者。

## 内容与 SEO 契约

- 文章用 `BlogPosting`，普通页用 `WebPage`，首页用 `WebSite`；JSON-LD（JavaScript Object Notation for Linked Data，结构化数据）由模板生成并转义，不让作者在 CMS 粘贴任意 JSON。
- `<time datetime>`、文章的发布时间/更新时间元数据、JSON-LD 和站点地图使用带时区的 RFC 3339 时间；RSS `pubDate` 使用其 RFC 822 格式，另以 `atom:updated` 表示实质更新时间。
- `date / lastmod` 只读内容字段；不拿 Git 克隆时间、构建时间冒充更新时间。普通页面无可靠日期则不输出虚构时间。
- 首页分页 canonical（规范地址）自指，404 为 noindex 且不声明主页为 canonical。`noindex` 页面不进 sitemap 或站内搜索。
- OG 自动图只在构建端生成；字体 `assets/og/NotoSansSC-Regular.otf` 不发布，替换时需核对授权、字符覆盖与版式。若有特殊字符或需要艺术化封面，用上传图片覆盖，不保证字体包含所有 emoji。
- 本地 `npm run build` 才包含完整发布检查，直接 `hugo` 只是渲染，不等价。产物检查不访问外站，也不保证外站永久可用或搜索平台一定收录。
