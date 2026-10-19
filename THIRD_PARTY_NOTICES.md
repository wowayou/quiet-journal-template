# Third-Party Notices

只列本模板**实际使用**的软件与资源。新增/移除依赖时同步更新本文件与 `data/credits.yaml`。模板代码的 MIT 许可不替代以下资源的许可，也不涵盖作者自己的文章/照片。

## 构建工具与构建专用字体

| 名称 | 用途 | 许可证 | 来源 |
|---|---|---|---|
| Hugo v0.167.0 | 外部静态网站生成程序，代码不在仓库中分发 | Apache-2.0 | https://github.com/gohugoio/hugo |
| Noto Sans SC Regular 2.004 | 构建中文 OG 卡片，字体随模板分发但不发布给访客 | SIL OFL 1.1；© 2014–2021 Adobe | https://github.com/notofonts/noto-cjk |

Hugo 许可证：https://github.com/gohugoio/hugo/blob/master/LICENSE 。

Noto 原始字体文件为上游 `Sans/SubsetOTF/SC/NotoSansSC-Regular.otf`，未再次裁剪或修改。仓库路径 `assets/og/NotoSansSC-Regular.otf`，许可全文 `assets/og/OFL.txt`，版权信息也保留在字体名称表中。2026-10-14 核对的 Git blob 为 `fc0fda9394367c16c1af7555a2ae4d5e2e6a6f02`，SHA-256 为 `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`。分享图片本身不受字体 OFL 的再分发要求约束。

## 随网站分发的字体、图标与代码

| 名称 | 用途 | 许可证 | 来源 |
|---|---|---|---|
| Google Sans Code | 自托管拉丁字符网页字体，来自 `@fontsource-variable/google-sans-code` 5.3.2 | SIL OFL 1.1，全文见 `assets/fonts/google-sans-code/OFL.txt` | https://github.com/googlefonts/googlesans-code |
| Simple Icons 16.35.0 | 社交品牌图标 | CC0-1.0；图标代表的商标仍归各自所有者 | https://simpleicons.org/ |
| 示例渐变图片、默认 favicon 与非品牌图标 | 模板原创示例素材，不是真实照片 | CC0-1.0 | 本模板 |

博客父页面的 CSS、主题/灯箱/搜索/答案/评论桥接脚本均由本模板独立编写，按 MIT 分发，没有引入前端框架、搜索库或动效库。可选评论面板是下面的独立项目，不在父页面运行其框架。

## 独立评论面板（默认关闭，单独构建/部署）

| 名称 | 用途 | 许可证 | 来源 |
|---|---|---|---|
| @waline/client 3.16.1 | 免登录留言/回复的官方客户端，包含其打包的前端依赖；只在跨源面板运行 | MIT（© 2021–PRESENT Mr.Hope）；构建分发 `LICENSE-waline.txt` | https://github.com/walinejs/waline/tree/main/packages/client |

依赖只声明在 `integrations/waline/package.json`，不是博客常规构建的依赖。`package-lock.json` 固定安装结果，`vendor-lock.json` 核对客户端 JS/CSS/LICENSE 的 SHA-256；打包保留原分发文件与许可，不复制源映射到产物。模板自己的隔离/传输适配代码按 MIT，独立产物同时附 `LICENSE-quiet-journal.txt`；此客户端许可不替代独立 Waline 服务端及其依赖的许可。服务端代码/数据库没有随博客分发，真实服务尚未开通。

## 独立评论数据服务（候选，云端未开通）

| 名称 | 用途 | 许可证/来源 |
|---|---|---|
| `@waline/vercel` 1.43.4 / `@waline/admin` 0.36.0 | 独立 API、作者账号/审核与自托管管理端；显式精简/源码重建分发 | GPL-2.0（准确上游 README 与实际 LICENSE；不沿用 npm 的 MIT 元数据）；https://github.com/walinejs/waline |
| `pg` 8.23.1 | 独立服务的 PostgreSQL 驱动，启用证书与主机名校验 | MIT；https://github.com/brianc/node-postgres |

声明、锁文件、下游分发包和对应源码归档在 `integrations/waline-server/`，不进入博客安装/构建和内容包。Quiet Journal 原创包装、配置、测试和图形仍按该目录 `LICENSE` 的 MIT 条款提供；**该许可不涵盖 `vendor/` 中的 Waline 组件及其第三方代码**。

原始 npm MIT 字段与实际许可不一致；准确源码提交的 README 也明确 GPL-2.0，故保留完整 GPL 许可并按它交付组件，不自行将上游改成 MIT。服务端仅剔除本部署未启用的适配器/依赖，保留变更清单与原始哈希；管理端从准确源码重建。管理外壳提供同源许可和源码下载，管理端归档含实际构建锁文件、映射源码及打包模块的源码/许可证，已在新目录离线重建并逐字节对照。来源、构建变化、依赖与再分发边界见 [UPSTREAM.md](integrations/waline-server/UPSTREAM.md)。这不是任意运行依赖镜像的许可批准。客户端 3.16.1 的实际 MIT 许可独立保留。

## 写作界面（仅作者打开 `/admin/` 时加载）

| 名称 | 用途 | 许可证 | 来源 |
|---|---|---|---|
| Sveltia CMS 0.235.1 | 网页内容编辑器 | MIT（© Kohei Yoshino） | https://github.com/sveltia/sveltia-cms |

`static/admin/index.html` 从 unpkg 加载固定版本并校验主脚本 SRI，其代码不包含在本仓库。CMS 还会按需从 unpkg 加载依赖（如 HEIC 解码）、从 jsDelivr 加载界面字体、请求 githubstatus.com；这些仅在作者浏览器发生。`editor-components.js` 是模板自己的适配代码，不是对 CMS 上游的 fork。

## 设计与交互参考（未复制其代码/文字/图片）

`data/credits.yaml` 列出 AstroPaper（主要单栏风格和轻量反馈参考）、StarFoxRyan（点图放大）、snarfed.org（长期身份、真实日期和持久内容的实践）。Shopify 官方富文本帮助只作为操作流程研究参考；并未采用 TinyMCE 或其嵌入代码。
