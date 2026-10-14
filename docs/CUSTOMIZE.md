# 修改外观与设置

样式已定稿（见 [DESIGN.md](DESIGN.md)），这里只有内容和少量开关。

| 想改什么 | 改哪里 |
|---|---|
| 网站名、首页大标题与介绍、导航、社交图标、页脚 | `data/site.yaml`（也可在 CMS「站点设置」中改） |
| 颜色、字体、宽度、间距 | `assets/css/overrides.css` |
| 友链 / 致谢 | `data/links.yaml` / `data/credits.yaml` |
| 某个组件的结构 | `layouts/_partials/` 下对应文件 |

## data/site.yaml

```yaml
theme: auto            # 默认深浅色：auto | light | dark
accent: orange         # 强调色：orange | blue | teal | rose | violet
hero:
  title: 你好呀
  text: 这里记录一些日常……   # 支持 Markdown，可放链接
social:                # 首页「在别处」与页脚的图标
  - { icon: github, url: "https://github.com/your-name", label: GitHub }
footer:
  quote: 想记录的时候，就记下来。
  back_to_top: true
webfont: none          # 可选：关闭 Google Sans Code，全部用系统字体
```

可用图标：github x mastodon telegram bilibili douban sinaweibo instagram zhihu xiaohongshu mail link rss。新图标放进 `assets/icons/<名字>.svg`（颜色用 `currentColor`）。

## assets/css/overrides.css

```css
:root {
  --c-accent-light: #2f6f8f;   /* 浅色模式强调色 */
  --c-accent-dark: #8fc7e8;    /* 深色模式强调色 */
  --content-width: 44rem;      /* 全站宽度 */
  --font-cjk: "Songti SC", serif;  /* 中文改用宋体 */
  --spacing-unit: 1.125rem;    /* 间距整体放大 */
}
```

修改颜色后，用对比度工具检查次要文字和强调色对底色是否 ≥ 4.5:1。
