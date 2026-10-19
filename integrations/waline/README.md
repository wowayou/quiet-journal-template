# 独立 Waline 读者面板

这是**单独构建/部署的静态客户端**，不是 Hugo 的后台或 Waline 数据服务。固定官方 `@waline/client` 3.16.1，外面只有配置、匿名传输与极小父页协议；不重新实现数据库、审核和账号系统。

博客常规 `npm run build` 不安装或构建这里；Hugo 不会发布本目录。完整架构、邮件成本、服务端要求与上线验收见仓库的 [COMMENTS.md](../../docs/COMMENTS.md)。

## 前提

- Node.js 22+（推荐当前项目使用的 24）。
- 一个已配置且验收过的 Waline API/管理端，数据不在本目录；本版假定 API 在独立源根路径的 `/api/`。本仓库另有 [Vercel Hobby + Neon Free 服务候选](../waline-server/README.md)，本地依赖/组件源码交付已处理，但实际云端尚未验收，不能直接当作已经可用的服务地址。
- 三个不同的 HTTPS origin：博客、读者面板、API/管理端。不要仅换路径；不要让管理员登录此面板。
- 静态托管须应用构建的 `_headers`，或设置等价的 CSP/缓存/隐私响应头。`_headers` 适用于 Cloudflare Workers 静态资源；其他平台不会因此自动获得这些策略。
- 真实云端资源、域名、配额、服务账户和数据库仍需操作人确认，本目录不会替你创建。

## 本地构建

在本目录运行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
cp config.example.json config.local.json
# 编辑 config.local.json，填写自己的三个源；不要添加任何密钥
npm run build
```

`config.local.json`：

```json
{
  "blogOrigin": "https://blog.example.com",
  "panelOrigin": "https://comments.example.com",
  "apiOrigin": "https://waline.example.com"
}
```

不支持带路径、查询参数、片段或凭据的地址；默认端口等价的源也不能冒充不同源。构建时不请求上述地址，不代表它们已部署、可达或安全。

结果在 `dist/`，只含 **12 个公开文件**：HTML、自有 JS/CSS、固定客户端、双方 MIT 许可、公开配置、响应头和 robots。只上传这个目录到**独立面板源**，不要上传源码、`node_modules/`、配置备份或数据库。

已有输出不覆盖；`dist/` 是生成物，确认没有手放文件后自行清理再构建，也可使用一个新目录：

```sh
npm run build -- --config config.local.json --output ../panel-next
```

构建校验客户端包版本和 JS/CSS/LICENSE 的 SHA-256，拒绝缺文件或不匹配的包。`package-lock.json` 固定安装结果，`vendor-lock.json` 固定实际分发文件；不从 `latest` 或浏览器 CDN 加载客户端。

部署请走经确认的静态托管步骤；这里刻意不提供自动部署脚本、远端写入、定时任务或无人值守升级。首次部署后检查实际响应头，再从博客加载测试。仅仅上传文件成功不是验收。

## 运行边界

- 面板启动时校验自身 origin 与配置一致，只允许博客 origin 嵌入；直接窗口也可使用。
- 入口只有片段 `#key=<编码后的固定文章键>&theme=light|dark`。拒绝查询参数，尤其是旧 Waline 的 `?token=`；文章键不是访问控制，评论服务仍按自己的公开策略处理。
- 本版是免登录界面。启动前清除这个专用源的旧 Waline 持久缓存，把 SDK 的存储限制到当前窗口的 sessionStorage；清除旧登录状态，缓存中的邮箱/网址置空。不同文章不继承待发稿，管理端/博客存储不受影响。浏览器阻止跨站存储时会提示失败，可选择独立窗口。
- 官方客户端使用全局 fetch，因此 `transport.js` **只在这个专用面板窗口**内安装匿名传输边界：固定 API、当前文章、GET/POST、无 Cookie/认证头/重定向、明确体积与超时。不在博客或 CMS 页面安装它。
- 不发送邮箱、个人网址和客户端额外生成的 UA。服务仍可能记录 IP/HTTP 浏览器信息；前端过滤不等于服务端数据已经删除。
- 只提供提交、回复、按最新顺序读取和主动加载下一页。保留官方内容渲染，但禁止图片请求、上传和点赞入口；服务端仍必须清理评论内容与先审后显。
- 不配置邮件。服务器端也应不配置 SMTP/通知凭据；否则绕过此面板的请求或管理操作仍可能触发发信。
- 提交超时/响应损坏等可能发生在服务器保存之后，**不自动重发**。明确的服务端拒绝会显示理由；成功后可显示待审核状态。不要据刷新后的公开列表缺少评论就不断重发。
- 昵称和同篇待发文字仅在当前窗口会话内暂存；切换文章会清除未发送草稿，关闭窗口后不保证保留。关闭 iframe 不会删除服务端评论。SDK 的会话存储别名与 fetch 适配只存在于这个独占面板窗口。

同一源中只加载面板自身文件和指定 API；构建的响应头禁止图片与未知连接。每页上限指 10 条主评论，附带回复仍计入 1 MiB 响应预算，超过时明确失败，不悄悄截断。

## 升级与验证

升级时一起核对 `package.json`、锁文件、`vendor-lock.json`、`src/index.html` / `src/app.js` 的版本引用、服务 API 契约与许可。不要仅改包号。父页协议为 `quiet-journal-comments` / version 1，仅传 ready/error 与主题，不传评论内容或凭据。

从博客仓库根目录运行：

```sh
npm test
# 可选；本机需已有 Chromium 和 openssl，不自动下载浏览器或客户端
QJ_CHROMIUM=/path/to/chrome npm run test:comments
# 若客户端已在另一个本地目录中，可显式提供：
QJ_CHROMIUM=/path/to/chrome QJ_WALINE_CLIENT=/path/to/@waline/client npm run test:comments
```

测试使用临时证书、三个本机 HTTPS 源、固定真实客户端和内存协议夹具；只信任本次测试证书的指纹，不全局关闭证书验证，不连接真实 API 或发邮件。它验证的是接口接入和浏览器隔离，**不是生产数据库、后台审核、恢复或 Safari/iPhone 已通过**。

客户端包为 MIT，构建分发其完整许可 `LICENSE-waline.txt`，以及本项目代码的 `LICENSE-quiet-journal.txt`。Waline 服务端与其他依赖的许可应按实际使用版本另行核对，不能用客户端许可替代。
