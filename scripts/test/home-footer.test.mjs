import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { checkSite, decodeEntities, tags } from "../check-site.mjs";
import { fixture, put, document, read, allFiles, build } from "./site-fixture.mjs";

const using = (fn) => {
  const f = fixture();
  // These checks concern layout and links; the existing suite covers generated share images.
  f.site.sharing.generate = false; f.saveSite();
  try { fn(f); } finally { f.cleanup(); }
};
const success = (f, extra = []) => {
  const result = build(f.root, extra);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(checkSite(join(f.root, "public")), []);
};
const hasClass = (tag, name) => (tag.attrs.class || "").split(/\s+/).includes(name);
const byClass = (html, name) => tags(html).filter((tag) => hasClass(tag, name));
const plain = (html) => decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
const footer = (html) => html.match(/<footer\b[^>]*class=(?:"site-footer"|site-footer(?=[\s>]))[^>]*>[\s\S]*?<\/footer>/)[0];
const hero = (html) => html.match(/<section\b[^>]*aria-labelledby=(?:"welcome-title"|welcome-title)[^>]*>[\s\S]*?<\/section>/)[0];

test("首页与页脚：保留配置文字、Markdown 和社交顺序，纯文字不变成可执行标记", () => using((f) => {
  f.site.title = '站名 <img src=x onerror="x">';
  f.site.description = "说明 <script>not-code</script> & 引号";
  f.site.author = '作者 <b>不是标签</b>';
  f.site.hero = { title: '问候 <em>原样</em>', text: '**现有介绍**与[关于](/about/)。' };
  f.site.footer.quote = '第一行 <script>not-code</script>\n第二行 & 原文';
  f.site.footer.content_license = '文字与照片 <b>保留版权</b>';
  f.site.social = [
    { label: "身份一", icon: "mastodon", url: "https://social.example.test/@one", me: true },
    { label: "身份二", icon: "github", url: "https://github.com/example", target: "same" },
  ];
  f.saveSite(); success(f);
  const home = read(f.root, "public/index.html"), welcome = hero(home);
  assert.ok(plain(welcome).includes(f.site.hero.title));
  assert.ok(plain(welcome).includes(f.site.description));
  assert.match(welcome, /<strong>现有介绍<\/strong>/);
  assert.ok(tags(welcome).some((tag) => tag.name === "a" && tag.attrs.href === "/about/"));
  const artwork = byClass(welcome, "hero__artwork");
  assert.equal(artwork.length, 1);
  assert.equal(artwork[0].attrs["aria-hidden"], "true");
  assert.equal(artwork[0].attrs.focusable, "false");
  const readLink = byClass(welcome, "hero__read")[0];
  assert.equal(readLink.name, "a"); assert.equal(readLink.attrs.href, "#recent-title");
  assert.equal(readLink.attrs.target, undefined);
  const recent = tags(home).find((tag) => tag.attrs.id === "recent-title");
  assert.equal(recent.name, "h2"); assert.equal(recent.attrs.tabindex, "-1");
  for (const path of ["index.html", "posts/a/index.html", "about/index.html", "404.html"]) {
    const bottom = footer(read(f.root, `public/${path}`));
    for (const value of [f.site.title, f.site.author, f.site.footer.quote, f.site.footer.content_license]) {
      assert.ok(plain(bottom).includes(value.replace(/\s+/g, " ")), `${path}: preserves text`);
    }
    const socials = tags(bottom).filter((tag) => tag.name === "a" && "data-social" in tag.attrs);
    assert.deepEqual(socials.map((tag) => tag.attrs.href), f.site.social.map((item) => item.url));
    assert.ok(socials[0].attrs.rel.split(" ").includes("me"));
    assert.equal(socials[1].attrs.target, undefined);
    for (const tag of tags(welcome + bottom)) {
      assert.ok(!["script", "iframe", "img"].includes(tag.name));
      assert.ok(!Object.keys(tag.attrs).some((attr) => /^on/i.test(attr)));
    }
  }
}));

test("首页空配置与空文章：标题有兜底，阅读锚点仍有效，不制造失效入口", () => using((f) => {
  f.site.title = "站点兜底标题"; f.site.description = ""; f.site.social = [];
  rmSync(join(f.root, "content/posts"), { recursive: true });
  for (const value of [undefined, { title: "", text: "" }]) {
    if (value === undefined) delete f.site.hero; else f.site.hero = value;
    delete f.site.footer; f.saveSite(); success(f);
    const home = read(f.root, "public/index.html");
    assert.equal(plain(home.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/)[0]), f.site.title);
    assert.equal(byClass(home, "hero__eyebrow").length, 0);
    assert.equal(byClass(home, "hero__text").length, 0);
    assert.equal(byClass(home, "hero__social").length, 0);
    assert.equal(byClass(home, "site-footer__connect").length, 0);
    assert.equal(byClass(footer(home), "back-to-top").length, 1);
    assert.match(home, /还没有文章/);
    assert.equal(byClass(home, "hero__read")[0].attrs.href, "#recent-title");
  }
}));

test("页脚：RSS、技术回链、模板回链与回到顶部独立开关，不影响作者或社交", () => using((f) => {
  const off = { show_rss: false, show_built_with: false, show_template_credit: false, back_to_top: false };
  const cases = [
    { flags: off, social: false },
    { flags: off, social: true },
    ...Object.keys(off).map((key) => ({ flags: { ...off, [key]: true }, social: false })),
    { flags: Object.fromEntries(Object.keys(off).map((key) => [key, true])), social: true },
  ];
  for (const { flags, social } of cases) {
    f.site.footer = { quote: "", content_license: "", ...flags };
    f.site.social = social ? [{ label: "联系", icon: "link", url: "https://example.org/" }] : [];
    f.saveSite(); success(f);
    const bottom = footer(read(f.root, "public/index.html")), elements = tags(bottom);
    const links = elements.filter((tag) => tag.name === "a");
    assert.equal(byClass(bottom, "site-footer__rss").length, Number(flags.show_rss));
    assert.equal(links.some((tag) => tag.attrs.href === "https://gohugo.io/"), flags.show_built_with);
    assert.equal(byClass(bottom, "template-credit").length, Number(flags.show_template_credit));
    assert.equal(byClass(bottom, "back-to-top").length, Number(flags.back_to_top));
    assert.equal(byClass(bottom, "site-footer__connect").length, Number(social || flags.show_rss));
    assert.equal(links.filter((tag) => "data-social" in tag.attrs).length, Number(social));
    assert.equal(byClass(bottom, "site-footer__quote").length, 0);
    assert.equal(byClass(bottom, "site-footer__credits").length, Number(flags.show_built_with || flags.show_template_credit));
    assert.ok(plain(bottom).includes(f.site.author));
  }
}));

test("无 RSS 输出时不留下空的联系分组，已有社交入口仍可用", () => using((f) => {
  const config = read(f.root, "config/_default/hugo.toml");
  assert.ok(config.includes('home = ["html", "rss"]'));
  put(f.root, "config/_default/hugo.toml", config.replace('home = ["html", "rss"]', 'home = ["html"]'));
  for (const social of [[], [{ label: "个人主页", icon: "link", url: "https://example.org/" }]]) {
    f.site.social = social; f.saveSite(); success(f);
    const home = read(f.root, "public/index.html");
    assert.equal(byClass(home, "hero__rss").length, 0);
    assert.equal(byClass(home, "site-footer__rss").length, 0);
    assert.equal(byClass(home, "site-footer__connect").length, Number(social.length > 0));
  }
}));

test("欢迎区不改文章地址、分页与订阅；子路径和草稿隔离保留", () => using((f) => {
  put(f.root, "config/_default/hugo.toml", read(f.root, "config/_default/hugo.toml").replace("pagerSize = 12", "pagerSize = 1"));
  put(f.root, "content/posts/a/index.md", document({ title: "精选文章", date: "2020-01-02T00:00:00Z", featured: true }, "正文。"));
  put(f.root, "content/posts/hidden/index.md", document({ title: "HIDDEN_HOME_MARKER", date: "2020-01-01T00:00:00Z", featured: true, draft: true }));
  put(f.root, "content/posts/future/index.md", document({ title: "FUTURE_HOME_MARKER", date: "2099-01-01T00:00:00Z", featured: true }));
  success(f);
  const routes = allFiles(join(f.root, "public")).filter((file) => /\.(html|xml)$/.test(file)).sort();
  f.site.hero.title = "完全不同的欢迎标题"; f.site.description = "新的测试介绍";
  f.site.footer.quote = "另一句测试文字"; f.saveSite(); success(f);
  assert.deepEqual(allFiles(join(f.root, "public")).filter((file) => /\.(html|xml)$/.test(file)).sort(), routes);
  success(f, ["--baseURL", "https://example.test/journal/"]);
  for (const path of ["index.html", "page/2/index.html"]) {
    const html = read(f.root, `public/${path}`), elements = tags(html);
    assert.equal(byClass(html, "hero__read")[0].attrs.href, "#recent-title");
    assert.equal(byClass(html, "site-footer__rss")[0].attrs.href, "/journal/index.xml");
    assert.ok(elements.some((tag) => tag.name === "a" && tag.attrs.href === "/journal/archive/"));
    const expectedPost = path === "index.html" ? "b" : "a";
    assert.ok(elements.some((tag) => tag.name === "a" && tag.attrs.href === `/journal/posts/${expectedPost}/`));
    assert.equal(elements.some((tag) => tag.attrs.id === "featured-title"), path === "index.html");
  }
  const files = allFiles(join(f.root, "public"));
  assert.ok(files.includes("posts/a/index.html") && files.includes("posts/b/index.html"));
  assert.ok(!files.includes("posts/hidden/index.html") && !files.includes("posts/future/index.html"));
  for (const file of files.filter((file) => /\.(html|xml|json)$/.test(file))) {
    assert.doesNotMatch(read(f.root, `public/${file}`), /HIDDEN_HOME_MARKER|FUTURE_HOME_MARKER/);
  }
  assert.doesNotMatch(read(f.root, "public/index.xml"), /hero__artwork|site-footer__identity/);
}));
