# Third-Party Notices

只列出本模板**实际使用**的第三方软件与资源。新增依赖时同步更新本文件与 `data/credits.yaml`。

## 构建时使用（不随网站分发）

| 名称 | 用途 | 许可证 | 来源 |
|---|---|---|---|
| Hugo v0.167.0 | 静态网站生成器 | Apache-2.0 | https://github.com/gohugoio/hugo |

Hugo 作为外部程序运行，其代码不包含在本仓库或生成的网站中。许可证全文：
https://github.com/gohugoio/hugo/blob/master/LICENSE

## 网站运行时（随网站分发给访客）

无第三方代码。CSS、`assets/js/theme.js`、`assets/js/lightbox.js` 均为本模板原创，按 MIT 许可证发布。

## 写作界面（仅作者打开 `/admin/` 时加载）

| 名称 | 用途 | 许可证 | 来源 |
|---|---|---|---|
| Sveltia CMS 0.235.1 | 网页写作界面 | MIT（© Kohei Yoshino） | https://github.com/sveltia/sveltia-cms |

由 `static/admin/index.html` 从 unpkg 加载固定版本并做 SRI 校验，代码不包含在本仓库中。运行时它还会按需从 unpkg 加载其依赖（如 HEIC 解码），并从 jsDelivr 加载界面字体、请求 githubstatus.com 显示 GitHub 状态。这些请求只发生在作者的浏览器中，访客页面不受影响。

## 设计参考（未使用其代码）

见 `data/credits.yaml` 的 inspirations（网站「致谢」页会显示）：AstroPaper（MIT，整体风格的主要参考）、StarFoxRyan（点图放大的交互）。本模板未复制其代码、样式或图片。
