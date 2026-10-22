# 未来：把图片放到 Cloudflare R2（未启用）

第一版**不使用** R2：没有 bucket、密钥、SDK 或 Worker。这里只说明预留的接口。

## 现在的约定

正文只写「逻辑引用」，不写存储地址：

| 写法 | 含义 |
|---|---|
| `![说明](photo.webp)` | 文章文件夹里的图片 |
| `![说明](/media/photo.webp)` | 全站共享图片（`assets/media/photo.webp`） |

全站只有 `layouts/_partials/media/resolve.html` 知道**正文图片**实际在哪儿。favicon 的全站上传图由 `media/site-image.html` 处理，仍只接受本地位图；自定义社交/导航图标改由 `media/icon-source.html` 处理，支持本地位图、被动 SVG 或显式 HTTPS 图片外链，不随 R2 提供方切换。分享封面也不随正文媒体提供方切换。

## 切换方式（届时）

`config/_default/params.toml`：

```toml
[media]
  provider = "r2"
  [media.r2]
    baseURL = "https://media.example.com"
    prefix = "journal"
```

解析顺序：先找本地文件（旧文章照常工作），本地没有时拼成 R2 地址：

- `photo.webp`（文章 `20261013-a7x2`）→ `<baseURL>/<prefix>/posts/20261013-a7x2/photo.webp`
- `/media/photo.webp` → `<baseURL>/<prefix>/media/photo.webp`

R2 上的图片不经过 Hugo 处理：没有响应式尺寸，也没有构建时的第二次元数据清除。所以上传到 R2 之前必须已经去除元数据。构建不会下载 R2 图片来生成 OG 卡片；若文章仅有远程图片，分享图使用本地全站默认图或自动文字卡片。

`scripts/smoke-test.mjs` 的「媒体 provider」测试覆盖了上述两种地址拼接。

## 启用前必须先评估

- Sveltia CMS 的 R2 集成需要在浏览器中提供访问密钥：密钥权限范围、存放位置、如何轮换。
- CORS 设置，以及公开 bucket 是否允许被列出目录。
- 存储与请求费用。
- 草稿图片：R2 上的文件没有「只发布被引用文件」的机制，草稿图片一旦上传，URL 就能直接访问。
