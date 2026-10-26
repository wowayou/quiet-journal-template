import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkSite, tags, decodeEntities } from "../check-site.mjs";
import { clean } from "./fixtures.mjs";
import { fixture, put, document, read, allFiles, build } from "./site-fixture.mjs";

const success = (result) => assert.equal(result.status, 0, result.stderr || result.stdout);
const failed = (result, pattern) => { assert.notEqual(result.status, 0); assert.match(result.stderr + result.stdout, pattern); };
const pageTags = (root, path = "index.html") => tags(read(root, `public/${path}`));
const meta = (elements, property) => elements.find((tag) => tag.name === "meta" && (tag.attrs.property || tag.attrs.name) === property)?.attrs.content;
const jsonLd = (html) => JSON.parse(html.match(/<script type=["']?application\/ld\+json["']?>([\s\S]*?)<\/script>/)[1]);
const using = (fn) => { const f = fixture(); try { fn(f); } finally { f.cleanup(); } };

// The broken nav entry disappears, the rest of the site still builds, and the author is told why.
const navSkipped = (f) => {
  const result = build(f.root); success(result);
  assert.ok(!/href=["']?\/now\//.test(read(f.root, "public/index.html").match(/<nav[\s\S]*?<\/nav>/)[0]));
  // Public status uses the ordinal only; the label and page ID stay in the build log.
  const status = read(f.root, "public/build.json");
  assert.match(JSON.parse(status).warnings.join(), /第 \d+ 条导航指向的页面不存在或未发布/);
  assert.ok(!status.includes("现在") && !/\bnow\b/.test(status), status);
  assert.match(result.stderr + result.stdout, /导航“现在”指向的页面“now”不存在或未发布/);
};

test("生产输出：日期、页面类型、文字 OG、RSS、无字体下载与完整内部链接", () => using((f) => {
  success(build(f.root));
  assert.deepEqual(checkSite(join(f.root, "public")), []);
  const home = pageTags(f.root);
  const about = pageTags(f.root, "about/index.html");
  const post = pageTags(f.root, "posts/a/index.html");
  assert.equal(meta(home, "og:type"), "website");
  const homeCSS = home.find((tag) => tag.name === "link" && tag.attrs.rel === "stylesheet").attrs.href;
  const aboutCSS = about.find((tag) => tag.name === "link" && tag.attrs.rel === "stylesheet").attrs.href;
  assert.notEqual(homeCSS, aboutCSS);
  assert.match(read(f.root, `public${homeCSS}`), /\.search-form/);
  assert.doesNotMatch(read(f.root, `public${aboutCSS}`), /\.search-form/);
  assert.equal(meta(about, "og:type"), "website");
  assert.equal(meta(pageTags(f.root, "posts/index.html"), "og:type"), "website");
  assert.equal(meta(post, "og:type"), "article");
  assert.equal(meta(post, "article:published_time"), "2020-01-02T08:00:00+08:00");
  assert.equal(meta(post, "article:modified_time"), "2024-02-03T09:10:11+08:00");
  const html = read(f.root, "public/posts/a/index.html");
  assert.match(html, /发布于/); assert.match(html, /更新于/);
  assert.equal(jsonLd(html).dateModified, meta(post, "article:modified_time"));
  assert.equal(jsonLd(read(f.root, "public/about/index.html"))["@type"], "WebPage");
  assert.ok(!("datePublished" in jsonLd(read(f.root, "public/about/index.html"))));
  for (const elements of [home, about, post]) {
    const path = new URL(meta(elements, "og:image")).pathname;
    assert.ok(existsSync(join(f.root, "public", path)));
    assert.equal(meta(elements, "og:image:width"), "1200");
    assert.equal(meta(elements, "og:image:height"), "630");
    assert.equal(meta(elements, "twitter:card"), "summary_large_image");
  }
  assert.ok(!allFiles(join(f.root, "public")).some((file) => /\.(otf|ttf)$/.test(file)));
  const rss = read(f.root, "public/index.xml");
  assert.match(rss, /<lastBuildDate>Sat, 03 Feb 2024 09:10:11 \+0800<\/lastBuildDate>/);
  assert.match(rss, /<dc:creator>Test Author<\/dc:creator>/);
  assert.match(rss, /<atom:updated>2024-02-03T09:10:11\+08:00<\/atom:updated>/);
  assert.equal(meta(pageTags(f.root, "404.html"), "robots"), "noindex, follow");
}));

test("站内、外链和每项覆盖：HTML 转义、邮箱、rel=me 和作者归属可以共存", () => using((f) => {
  f.site.fediverse.creator = "@tester@social.example.test";
  f.site.social = [{ icon: "mastodon", label: 'Mastodon "身份"', url: "https://social.example.test/@tester", me: true }];
  f.site.nav.push({ type: "external", label: "旧站", url: "https://other.example.test/", target: "same" });
  f.saveSite();
  put(f.root, "content/about.md", document({ title: 'About </script><img src=x onerror="x">', draft: false }, '[External](https://remote.test/?a=1&b=2) [Own](https://example.test/archive/) [Mail](mailto:test@example.test)\n\n{{< link text="&lt;img src=x onerror=&quot;x&quot;&gt; &#123;&#123;&lt; bad &gt;&#125;&#125;" url="https://remote.test/?a=1&amp;b=2" target="same" title="&quot;&gt;&lt;img src=x&gt;" >}}\n\n{{< link text="Open archive" url="/archive/" target="new" >}}'));
  success(build(f.root));
  assert.deepEqual(checkSite(join(f.root, "public")), []);
  const elements = pageTags(f.root, "about/index.html");
  const links = elements.filter((tag) => tag.name === "a").map((tag) => tag.attrs);
  assert.ok(links.some((a) => a.href === "https://remote.test/?a=1&b=2" && a.target === "_blank" && a.rel.includes("noopener")));
  assert.ok(links.some((a) => a.href === "https://remote.test/?a=1&b=2" && !a.target));
  assert.ok(links.some((a) => a.href === "/archive/" && a.target === "_blank"));
  assert.ok(links.some((a) => a.href === "https://example.test/archive/" && !a.target));
  assert.ok(links.some((a) => a.href === "mailto:test@example.test" && !a.target));
  assert.ok(links.some((a) => a.href === "https://other.example.test/" && !a.target));
  assert.ok(links.some((a) => a.rel?.split(" ").includes("me") && a.target === "_blank"));
  assert.ok(elements.some((tag) => tag.name === "link" && tag.attrs.rel === "me"));
  assert.ok(!elements.some((tag) => "onerror" in tag.attrs));
  assert.equal(meta(elements, "fediverse:creator"), "@tester@social.example.test");
  assert.equal(jsonLd(read(f.root, "public/about/index.html")).name, 'About </script><img src=x onerror="x">');
  f.site.links.external_target = "same"; f.saveSite(); success(build(f.root));
  assert.ok(pageTags(f.root, "about/index.html").some((tag) => tag.name === "a" && tag.attrs.href === "https://remote.test/?a=1&b=2" && !tag.attrs.target));
}));

test("favicon 和社交图标只输出重新编码位图，封面覆盖自动 OG", () => using((f) => {
  put(f.root, "assets/media/upload.png", clean.png());
  f.site.favicon = "/media/upload.png";
  f.site.social = [{ label: "自己的网站", url: "https://other.test/", icon_image: "/media/upload.png" }]; f.saveSite();
  put(f.root, "content/about.md", document({ title: "About", cover: "/media/upload.png", cover_alt: "A square" }));
  success(build(f.root));
  const elements = pageTags(f.root);
  const icons = elements.filter((tag) => tag.name === "link" && ["icon", "apple-touch-icon"].includes(tag.attrs.rel));
  assert.equal(icons.length, 3);
  for (const icon of icons) {
    assert.match(icon.attrs.href, /_hu_.*\.png$/);
    const bytes = readFileSync(join(f.root, "public", icon.attrs.href));
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.attrs.sizes);
  }
  assert.ok(elements.some((tag) => tag.name === "img" && /upload_hu_.*\.webp$/.test(tag.attrs.src)));
  assert.ok(!existsSync(join(f.root, "public/media/upload.png")));
  assert.equal(meta(pageTags(f.root, "about/index.html"), "og:image:alt"), "A square");
  assert.deepEqual(checkSite(join(f.root, "public")), []);
}));

test("分享封面降级不请求远程图片，替代文本只来自实际采用的图", () => using((f) => {
  put(f.root, "assets/media/global.png", clean.png());
  put(f.root, "content/posts/a/local.png", clean.png());
  f.site.sharing.image = "/media/global.png"; f.site.sharing.image_alt = "全站默认封面"; f.saveSite();
  put(f.root, "content/about.md", document({ title: "About", cover: "https://remote.test/image.png", cover_alt: "未采用的远程封面" }));
  put(f.root, "content/posts/a/index.md", document({ title: "A", date: "2020-01-01T00:00:00Z" }, "![本地图](local.png)"));
  success(build(f.root));
  const about = pageTags(f.root, "about/index.html");
  assert.match(meta(about, "og:image"), /global_hu_/);
  assert.equal(meta(about, "og:image:alt"), "全站默认封面");
  const post = pageTags(f.root, "posts/a/index.html");
  assert.match(meta(post, "og:image"), /local_hu_/);
  assert.equal(meta(post, "og:image:alt"), "A的分享封面");
}));

test("列表型页面复用页头，保留可编辑正文和真实发布/更新时间", () => using((f) => {
  for (const layout of ["archive", "links", "credits"]) {
    put(f.root, `content/${layout}.md`, document({ title: layout, layout, date: "2020-01-01T00:00:00Z", lastmod: "2024-01-01T00:00:00Z" }, `BODY_${layout}_MARKER`));
  }
  f.site.hero.text = '{{< link text="跳到归档" url="/archive/" target="new" title="" >}}'; f.saveSite();
  success(build(f.root));
  assert.deepEqual(checkSite(join(f.root, "public")), []);
  for (const layout of ["archive", "links", "credits"]) {
    const html = read(f.root, `public/${layout}/index.html`);
    assert.ok(html.includes(`BODY_${layout}_MARKER`));
    assert.match(html, /发布于/); assert.match(html, /更新于/);
    assert.equal(pageTags(f.root, `${layout}/index.html`).filter((t) => t.name === "time").length >= 2, true);
    assert.equal(jsonLd(html).dateModified, "2024-01-01T00:00:00Z");
  }
  assert.ok(pageTags(f.root).some((tag) => tag.name === "a" && tag.attrs.href === "/archive/" && tag.attrs.target === "_blank"));
}));

test("新页面复用通用组件；改标题不改 URL；导航指向草稿/未来/过期/已删页面时只跳过这一项并在网站状态中提示", () => using((f) => {
  f.site.nav.push({ type: "page", label: "现在", page: "now" }); f.saveSite();
  put(f.root, "content/now.md", document({ title: "Now", layout: "page", draft: false }, "当前在做什么。"));
  success(build(f.root)); assert.ok(existsSync(join(f.root, "public/now/index.html")));
  put(f.root, "content/now.md", document({ title: "完全不同的标题", layout: "page", draft: false }, "当前在做什么。"));
  success(build(f.root)); assert.match(read(f.root, "public/now/index.html"), /完全不同的标题/);
  for (const fields of [{ draft: true }, { date: "2099-01-01T00:00:00Z" }, { expiryDate: "2001-01-01T00:00:00Z" }]) {
    put(f.root, "content/now.md", document({ title: "Now", ...fields }));
    navSkipped(f);
  }
  rmSync(join(f.root, "content/now.md")); navSkipped(f);
}));

test("错误配置阻止构建：页面类型、图标、URL、日期与身份字段", () => using((f) => {
  for (const value of ["javascript:alert(1)", "DATA:text/html,x", "//remote.test", "https://user:pass@remote.test", "https:\\remote.test"]) {
    f.site.social = [{ label: "Bad", icon: "link", url: value }]; f.saveSite();
    assert.notEqual(build(f.root).status, 0, value);
  }
  f.site.social = []; f.site.favicon = "/media/../og/background.png"; f.saveSite(); failed(build(f.root), /不能包含/);
  f.site.favicon = "/media/missing.png"; f.saveSite(); failed(build(f.root), /找不到站点图片/);
  f.site.favicon = "/media/logo.svg"; f.saveSite(); failed(build(f.root), /图标\/站点图片/);
  f.site.favicon = ""; f.site.fediverse.creator = "just-a-name"; f.saveSite(); failed(build(f.root), /fediverse.creator/);
  f.site.fediverse.creator = ""; f.saveSite();
  put(f.root, "content/extra.md", document({ title: "x", layout: "nonexistent" })); failed(build(f.root), /没有对应布局/);
  rmSync(join(f.root, "content/extra.md"));
  put(f.root, "content/posts/a/index.md", document({ title: "A", date: "2020-01-01T00:00:00Z", lastmod: "2019-01-01T00:00:00Z" })); failed(build(f.root), /lastmod 不得早于/);
  put(f.root, "content/posts/a/index.md", document({ title: "A", date: "2020-01-01T00:00:00Z", lastmod: "2099-01-01T00:00:00Z" })); failed(build(f.root), /lastmod 不得晚于/);
}));

test("产物检查拦截正文坏链接、失效锚点与旧式导航坏路径", () => using((f) => {
  put(f.root, "content/about.md", document({ title: "About" }, "[bad](/missing/) [anchor](/archive/#not-real)"));
  f.site.nav.push({ label: "Old", url: "/also-missing/" }); f.saveSite(); success(build(f.root));
  const errors = checkSite(join(f.root, "public")).join("\n");
  assert.match(errors, /站内目标不存在：\/missing\//);
  assert.match(errors, /站内目标不存在：\/also-missing\//);
  assert.match(errors, /站内锚点不存在/);
}));

test("搜索隐私：草稿/未来/未引用图片不发布，noindex/exclude 不入索引", () => using((f) => {
  put(f.root, "content/private/index.md", document({ title: "DRAFT_PAGE_MARKER", draft: true, cover: "draft-marker.png" }, "DRAFT_PAGE_BODY_MARKER"));
  put(f.root, "content/private/draft-marker.png", clean.png());
  put(f.root, "content/future.md", document({ title: "FUTURE_PAGE_MARKER", date: "2099-01-01T00:00:00Z" }));
  put(f.root, "content/noindex.md", document({ title: "NOINDEX_MARKER", noindex: true }));
  put(f.root, "content/excluded.md", document({ title: "EXCLUDED_MARKER", search_exclude: true }));
  success(build(f.root));
  const files = allFiles(join(f.root, "public"));
  const indexFile = files.find((file) => file.startsWith("search/") && file.endsWith(".json"));
  const index = read(f.root, `public/${indexFile}`);
  for (const marker of ["DRAFT_PAGE", "FUTURE_PAGE", "NOINDEX_MARKER", "EXCLUDED_MARKER"]) assert.ok(!index.includes(marker));
  for (const file of files.filter((file) => /\.(html|xml|json)$/.test(file))) assert.doesNotMatch(read(f.root, `public/${file}`), /DRAFT_PAGE|FUTURE_PAGE/);
  assert.ok(!files.some((file) => file.includes("draft-marker")));
  assert.ok(!read(f.root, "public/sitemap.xml").includes("/noindex/"));
  assert.ok(existsSync(join(f.root, "public/noindex/index.html")));
  assert.equal(meta(pageTags(f.root, "noindex/index.html"), "robots"), "noindex, follow");
}));

test("启停与排序：关闭清除挂件 HTML/脚本/数据；关闭回链不影响版权", () => using((f) => {
  f.widgets[1].enabled = true; f.widgets[1].slot = "home-after-intro"; f.widgets.reverse(); f.saveWidgets();
  success(build(f.root));
  const html = read(f.root, "public/index.html");
  assert.ok(html.indexOf('id=widget-book') < html.indexOf('id=widget-find'));
  assert.ok(!pageTags(f.root, "about/index.html").some((tag) => tag.name === "script" && /search|answers/.test(tag.attrs.src)));
  for (const widget of f.widgets) widget.enabled = false; f.saveWidgets();
  f.site.footer.show_template_credit = false; f.site.sharing.generate = false; f.saveSite();
  success(build(f.root));
  const off = read(f.root, "public/index.html");
  assert.doesNotMatch(off, /data-widget=|data-search|template-credit|og:image/);
  assert.ok(!allFiles(join(f.root, "public")).some((file) => /search\/|(?:search|answers)\.min\.|^og\//.test(file)));
  const css = pageTags(f.root).find((tag) => tag.name === "link" && tag.attrs.rel === "stylesheet").attrs.href;
  assert.doesNotMatch(read(f.root, `public${css}`), /\.search-form|\.answer\{/);
  assert.match(off, /Test Author/);
}));

test("挂件白名单、重复 ID、插槽、空答案和资源缺失在构建时失败", () => using((f) => {
  f.widgets[0].type = "not-a-plugin"; f.saveWidgets(); failed(build(f.root), /未注册的挂件/);
  f.widgets[0].type = "search"; f.widgets[1].id = "Bad ID"; f.saveWidgets(); failed(build(f.root), /ID 无效/);
  // A duplicate ID keeps the first widget and reports the rest; it no longer blocks the site.
  f.widgets[1].id = "find"; f.widgets[1].enabled = true; f.widgets[1].slot = "home-after-intro"; f.saveWidgets();
  const duplicate = build(f.root); success(duplicate);
  assert.equal((read(f.root, "public/index.html").match(/id=["']?widget-find/g) || []).length, 1);
  const status = read(f.root, "public/build.json");
  assert.match(JSON.parse(status).warnings.join(), /第 2 个与前面的挂件 ID 重复/);
  assert.ok(!status.includes("find") && !status.includes(f.widgets[1].title), status);
  assert.match(duplicate.stderr + duplicate.stdout, /挂件 ID“find”重复/);
  f.widgets[1].enabled = false; f.widgets[1].slot = "content-after";
  f.widgets[1].id = "book"; f.widgets[0].slot = "random"; f.saveWidgets(); failed(build(f.root), /不支持插槽/);
  f.widgets[0].slot = "home-after-intro"; f.widgets[1].enabled = true; f.saveWidgets();
  put(f.root, "data/answers.yaml", '["only one"]'); failed(build(f.root), /需要 2–100/);
  put(f.root, "data/answers.yaml", '["one", "two"]');
  put(f.root, "data/widget_extensions.yaml", JSON.stringify({ sample: { partial: "widgets/sample.html", script: "js/not-here.js", slots: ["content-after"] } }));
  put(f.root, "layouts/_partials/widgets/sample.html", "Example");
  f.widgets[1].type = "sample"; f.saveWidgets(); failed(build(f.root), /挂件资源不存在/);
  put(f.root, "assets/js/not-here.js", "console.info('fixture');"); success(build(f.root));
  assert.match(read(f.root, "public/about/index.html"), /widget--sample/);
}));

test("搜索索引体积预算失败关闭，不静默截断内容", () => using((f) => {
  f.site.sharing.generate = false; f.saveSite();
  put(f.root, "content/large.md", document({ title: "Large" }, "中".repeat(800000)));
  failed(build(f.root), /搜索索引超过 2 MiB/);
}));

test("RSS 图片/相对链接转绝对地址，正文封面和附件保持一致", () => using((f) => {
  put(f.root, "content/posts/a/photo.png", clean.png());
  put(f.root, "content/posts/a/index.md", document({ title: "Photo", date: "2020-01-01T00:00:00Z", draft: false }, "![Photo](photo.png)\n\n[About](/about/) [Other](../b/)"));
  success(build(f.root));
  const rss = decodeEntities(read(f.root, "public/index.xml"));
  assert.match(rss, /src="https:\/\/example.test\/posts\/a\/photo_hu_/);
  assert.match(rss, /href="https:\/\/example.test\/about\/"/);
  assert.match(rss, /href="https:\/\/example.test\/posts\/b\/"/);
  assert.doesNotMatch(rss, /srcset=|sizes=/);
}));

test("分页 canonical 自指、子路径部署与移除已发布内容不留旧产物", () => using((f) => {
  put(f.root, "config/_default/pagination.toml", read(f.root, "config/_default/pagination.toml").replace("pagerSize = 12", "pagerSize = 1"));
  success(build(f.root));
  const page2 = pageTags(f.root, "page/2/index.html");
  assert.equal(page2.find((tag) => tag.name === "link" && tag.attrs.rel === "canonical").attrs.href, "https://example.test/page/2/");
  assert.deepEqual(checkSite(join(f.root, "public")), []);
  success(build(f.root, ["--baseURL", "https://example.test/journal/"]));
  assert.deepEqual(checkSite(join(f.root, "public")), []);
  put(f.root, "content/posts/b/index.md", document({ title: "Withdrawn", date: "2022-01-01T00:00:00Z", draft: true }));
  success(build(f.root));
  assert.ok(!existsSync(join(f.root, "public/posts/b/index.html")));
  assert.ok(!existsSync(join(f.root, "public/page/2/index.html")));
}));
