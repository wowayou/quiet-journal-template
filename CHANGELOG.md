# Changelog

## 1.0.0 — 2026-10-14（设计定稿）

- 强调色默认改为橙色，可选蓝、青绿、玫红、紫（`data/site.yaml` 的 `accent`）。
- CMS 保存方式可选：simple（默认，单人模式）或 editorial_workflow（审核流），见 docs/EDITING.md。
- 唯一风格：参考 AstroPaper 的文字单栏（等宽字体、强调色标题列表、虚线链接、波浪线导航）；冷灰底色，文字与强调色全部达到 AA 对比度。
- 删除：风格预设（雾/夜/文楷）与文楷字体、卡片首页、轮播、滚动渐显、固定目录、页头页脚布局选项、缩略图条、类型标签、头像。理由见 docs/DECISIONS.md。
- CMS 单人模式：保存直接提交 main，用「草稿」开关控制公开；令牌只需 Contents 读写。
- 安全：全站 CSP（禁止第三方脚本），`/admin/` 单独 CSP；新增 `scripts/backup.sh`。
- 修复：回到顶部无效（锚点指向吸顶页头，浏览器不滚动）；锚点被吸顶页头遮挡。
- 新增：分享卡片图片（og:image）、页面切换淡入淡出（View Transitions）、docs/EDITING.md（不绑定编辑器）、docs/DECISIONS.md。

## 0.2（已被 1.0 取代）

- `/admin/`：Sveltia CMS 0.235.1（固定版本 + SRI），仅允许访问令牌登录；文章走 Editorial Workflow，站点设置、友链、关于页直接保存。
- 上传图片在浏览器内转为 WebP（最长边 2048，质量 85）；文件名转为 ASCII。
- 动效：滚动渐显、封面悬停放大、点图放大（原生 `<dialog>`）、文章级轮播（`gallery: carousel`，默认不自动播放）。尊重「减少动态效果」，可在 `data/site.yaml` 关闭。
- 部署改为 Cloudflare Workers 静态资源（`wrangler.jsonc`），`_headers` 增加基础安全响应头，`robots.txt` 禁止抓取 `/admin/`。
- 日期统一按 `params.timeZone` 显示；front matter 为 UTC 时也不会差一天。
- 新默认风格 `mono`（版式参考 AstroPaper）：首页 `home_layout: list`（大标题 + 精选 + 最近），等宽字体 Google Sans Code（拉丁，OFL）。
- 页头：手机三条线菜单；新的太阳/月亮变形图标；`header.layout`、`nav_style`、`sticky`、`border`、`show_avatar`。
- 页脚：`footer.layout` split / center / columns、一句话、社交图标（simple-icons，CC0）、回到顶部。
- 致谢页列出实际参考的站点与主题。
- 设计系统：`tokens.css` 增加字号、间距、圆角、阴影、宽度刻度；颜色用 `light-dark()` 成对定义；新增 `docs/DESIGN.md`。
- 三个风格预设 `style: mist | night | wenkai`（`assets/css/presets/`）；`wenkai` 自托管霞鹜文楷屏幕阅读版（OFL 1.1）。
- 界面重做：吸顶页头、头像与首页简介、按年分组的时间流、卡片（封面、缩略图条、类型标签、字数）、文章导语、目录（宽屏固定在右侧）、上下篇卡片、归档时间线、友链卡片。
- `theme` 取值改为 `auto | light | dark`；示例图片改为冷色调。
- 配色改为冷色调：浅色 `#f2f5f8` / 深色 `#14191e`，强调色改为蓝色；正文、次要文字、链接对比度均 ≥ 4.5:1（旧配色次要文字为 4.28:1，未达 WCAG AA）。

## 0.1.0 — 2026-10-13（Phase 1，仅本地）

- 原创 Quiet Journal 主题：首页时间流、单篇、归档（年/月）、关于、友链、致谢、404、RSS。
- 单一 `posts` 集合，`kind: note | story | photo` 只影响卡片外观。
- 稳定链接 `/posts/<文件夹名>/`，改标题不改 URL。
- 主题接口：`assets/css/tokens.css`（paper / ink / auto 三种配色）、`overrides.css`、`data/site.yaml`、按组件拆分的 partials。
- 图片：唯一的 Markdown render hook → `media.html` → `media/resolve.html`；本地图片统一由 Hugo 重新编码为 WebP 并生成响应式尺寸，原文件不发布；`r2` provider 只预留了接口。
- `scripts/check-media.mjs`：发布前的媒体元数据检查，失败即关闭。
- `scripts/smoke-test.mjs`：端到端构建测试（草稿隔离、元数据、稳定链接、provider）。
