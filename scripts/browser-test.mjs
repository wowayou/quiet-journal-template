#!/usr/bin/env node
// Offline, opt-in browser regression. No new CI jobs or automatic browser downloads.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, build, put, document } from "./test/site-fixture.mjs";
import { pngSized } from "./test/fixtures.mjs";
import { staticServer } from "./test/static-server.mjs";
import { launchBrowser, wait } from "./test/browser-client.mjs";

const f = fixture();
let server, browser;
let checks = 0;
const ok = (label, condition) => { assert.ok(condition, label); checks++; console.log(`✔ ${label}`); };
try {
  f.site.social = Array.from({ length: 24 }, (_, i) => ({ label: `社交 ${i + 1}`, icon: i % 2 ? "github" : "mastodon", url: `https://profiles.example.test/${i}` }));
  f.site.social[0].icon_image = "/media/tall-icon.png";
  put(f.root, "assets/media/tall-icon.png", pngSized(4, 128));
  f.site.title = "一个有比较长名字的生活手记";
  f.site.hero.title = "一段很长很长的欢迎标题ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  f.site.description = "保留作者自己的介绍，不用模板文案覆盖。";
  f.site.footer.quote = "第一行个人表达。\n第二行ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  f.site.footer.content_license = "文字与照片的版权说明保持独立，也可以很长很长。";
  f.site.footer.show_built_with = true;
  f.saveSite();
  f.widgets[1].enabled = true; f.widgets[1].slot = "home-after-intro"; f.saveWidgets();
  put(f.root, "content/posts/a/index.md", document({ title: "中文回忆", date: "2020-01-01T00:00:00Z", lastmod: "2024-01-01T00:00:00Z" }, "雨后的书店。\n\n![雨后街道](/media/rainy-street.webp)"));
  put(f.root, "content/posts/wide/index.md", document({ title: "宽图", date: "2020-01-03T00:00:00Z", kind: "photo" }, "一张很宽的图。\n\n![宽图](wide.png)\n\n![甲](wide.png) ![乙](wide.png)"));
  put(f.root, "content/posts/wide/wide.png", pngSized(2400, 600));
  const built = build(f.root); assert.equal(built.status, 0, built.stderr);
  let indexFails = false;
  server = await staticServer(join(f.root, "public"), (_req, response, path) => {
    if (indexFails && path.startsWith("/search/")) { response.writeHead(503).end("test failure"); return true; }
    return false;
  });
  browser = await launchBrowser();
  const errors = [], requests = [];
  browser.on((message) => {
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.method === "Log.entryAdded" && /Content Security Policy|Refused to/.test(message.params.entry.text)) errors.push(message.params.entry.text);
    if (message.method === "Network.requestWillBeSent") requests.push(message.params.request.url);
  });
  const ev = browser.evaluate;
  const key = async (key, code) => {
    await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, ...(key === "Enter" ? { text: "\r" } : {}) });
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
  };
  const until = async (expression) => { for (let i = 0; i < 80; i++) { if (await ev(expression)) return; await wait(100); } throw new Error(`等待超时：${expression}`); };
  const go = async (path = "/") => { await browser.send("Page.navigate", { url: server.url + path }); await until('document.readyState === "complete"'); await wait(200); };
  const viewport = async (width) => {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.send("Emulation.setTouchEmulationEnabled", { enabled: width < 600 });
  };
  const input = async (value) => ev(`(() => { const input = document.querySelector('[data-search-input]'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const activate = async (selector, touch = false) => {
    const selected = JSON.stringify(selector);
    await ev(`document.querySelector(${selected}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
    const point = await ev(`(() => {
      const a = document.querySelector(${selected}), r = a.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x, y, hit: a.contains(document.elementFromPoint(x, y)) };
    })()`);
    assert.ok(point.hit, `${selector}: actual hit target must not be obscured`);
    const { x, y } = point;
    if (touch) {
      await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    }
  };
  const readingReached = `(() => {
    const title = document.querySelector('#recent-title'), r = title.getBoundingClientRect();
    return location.hash === '#recent-title' && document.activeElement === title &&
      r.top >= Math.max(0, document.querySelector('.site-header').getBoundingClientRect().bottom) - 1 && r.bottom <= innerHeight;
  })()`;
  const shot = async (name) => {
    if (!process.env.QJ_SCREENSHOTS) return;
    mkdirSync(process.env.QJ_SCREENSHOTS, { recursive: true });
    const image = await browser.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(process.env.QJ_SCREENSHOTS, `${name}.png`), Buffer.from(image.data, "base64"));
  };

  for (const width of [1280, 390, 320]) {
    await viewport(width); await go();
    ok(`${width}px：长站名和 24 个图标不横向溢出`, await ev("document.documentElement.scrollWidth <= innerWidth"));
    ok(`${width}px：社交图标触控区至少 44px`, await ev("[...document.querySelectorAll('.social a')].every(a => a.getBoundingClientRect().width >= 44 && a.getBoundingClientRect().height >= 44)"));
    ok(`${width}px：窄长上传图标不撑大布局且不裁切`, await ev("[...document.querySelectorAll('.icon--uploaded')].every(icon => { const r = icon.getBoundingClientRect(); return r.width === 20 && r.height === 20 && getComputedStyle(icon).objectFit === 'contain'; })"));
    ok(`${width}px：首页导航是有名称的图标`, await ev("!!document.querySelector('.nav-icon[aria-label] svg')"));
    ok(`${width}px：挂件组合加载了自己的样式`, await ev("document.querySelector('[data-search-input]').getBoundingClientRect().height >= 44 && getComputedStyle(document.querySelector('.search-form')).display === 'flex'"));
    if (width < 600) {
      await ev("document.querySelector('[data-menu-toggle]').click()");
      ok(`${width}px：菜单可展开`, await ev("document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded') === 'true'"));
      await key("Escape", 27);
      ok(`${width}px：Esc 收起并归还焦点`, await ev("document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded') === 'false' && document.activeElement.matches('[data-menu-toggle]')"));
    }
    const previous = await ev("document.documentElement.dataset.theme");
    await ev("document.querySelector('[data-theme-toggle]').click()");
    ok(`${width}px：深浅色按钮有反馈`, await ev(`document.documentElement.dataset.theme !== ${JSON.stringify(previous)}`));
    await wait(550);
    ok(`${width}px：首屏宽屏文字左、线描右（不留大块空白），窄屏线描在上；都不超出正文栏`, await ev(`(() => {
      const hero = document.querySelector('.hero').getBoundingClientRect(), art = document.querySelector('.hero__artwork').getBoundingClientRect();
      const text = ['.hero__title', '.hero__text', '.hero__read'].map((s) => document.querySelector(s).getBoundingClientRect());
      const inside = [art, ...text].every((r) => r.left >= hero.left - 1 && r.right <= hero.right + 1);
      const ordered = text.every((r, i) => i === 0 || r.top >= text[i - 1].bottom - 1);
      const layout = ${width} > 704 ? art.left >= Math.max(...text.map((r) => r.right)) - 1 && art.right >= hero.right - 2 : art.bottom <= text[0].top + 1;
      return inside && ordered && layout;
    })()`));
    ok(`${width}px：页脚居中纵向排列：一句话 → 图标 → 版权 → 回到顶部`, await ev(`(() => {
      const box = document.querySelector('.site-footer__inner').getBoundingClientRect(), mid = box.left + box.width / 2;
      const parts = ['.site-footer__quote', '.site-footer__connect', '.site-footer__legal', '.site-footer .back-to-top'].map((s) => document.querySelector(s).getBoundingClientRect());
      return parts.every((r, i) => Math.abs(r.left + r.width / 2 - mid) < 3 && (i === 0 || r.top >= parts[i - 1].bottom - 1));
    })()`));
    ok(`${width}px：阅读与页脚操作区至少 44px`, await ev("[...document.querySelectorAll('.hero__read, .site-footer a')].every(a => { const r = a.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })"));
    ok(`${width}px：另一主题下长欢迎标题和页脚也不溢出`, await ev("document.documentElement.scrollWidth <= innerWidth"));
    await shot(`widgets-${width}`);
  }
  ok("首次打开不下载搜索索引", !requests.some((url) => url.includes("/search/")));

  // Browser translation (or very long nav labels) can make the header too wide for one row.
  // Simulate Chrome's translated <font> text in the header and check it folds into the menu instead of wrapping.
  const headerState = `(() => { const h = document.querySelector('.site-header'), bar = document.querySelector('.site-header__bar'), title = document.querySelector('.site-title');
    const lis = [...document.querySelectorAll('.site-nav li')];
    return { compact: document.documentElement.classList.contains('nav-compact'), height: Math.round(h.getBoundingClientRect().height),
      titleOneLine: title.getBoundingClientRect().height <= parseFloat(getComputedStyle(title).lineHeight) * 1.5 + 8,
      rows: new Set(lis.map((li) => Math.round(li.getBoundingClientRect().top))).size, overflow: document.documentElement.scrollWidth > innerWidth }; })()`;
  const translateHeader = `(() => { const ul = document.querySelector('.site-nav ul');
    for (const label of ['Archive', 'Friendly links', 'Acknowledgments', 'Photography and travel notes']) {
      const li = document.createElement('li'); li.dataset.translated = ''; li.innerHTML = '<a href="/about/"><span><font style="vertical-align: inherit;">' + label + '</font></span></a>'; ul.append(li); } })()`;
  const nextFrames = () => ev("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
  for (const width of [1280, 768]) {
    await viewport(width); await go();
    const original = await ev(headerState);
    ok(`${width}px：原导航一行放得下时不收进菜单`, !original.compact && original.rows === 1 && original.height <= 73 && !await ev("getComputedStyle(document.querySelector('[data-menu-toggle]')).display !== 'none'"));
    await ev(translateHeader); await nextFrames();
    const translated = await ev(headerState);
    ok(`${width}px：导航被翻译变长后收进菜单，页头保持一行、站名不折行、不横向溢出`, translated.compact && translated.height <= 73 && translated.titleOneLine && !translated.overflow);
    await ev("document.querySelector('[data-menu-toggle]').focus()"); await key("Enter", 13); await wait(250);
    ok(`${width}px：收进的菜单可用键盘打开，长导航都可见且不溢出`, await ev(`document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded') === 'true' && getComputedStyle(document.querySelector('#site-nav')).visibility === 'visible' && [...document.querySelectorAll('.site-nav a')].every((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }) && document.documentElement.scrollWidth <= innerWidth`));
    await key("Escape", 27);
    ok(`${width}px：菜单 Esc 收起并归还焦点`, await ev("document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded') === 'false' && document.activeElement.matches('[data-menu-toggle]')"));
    await ev("document.querySelector('[data-menu-toggle]').click()");
    await ev("document.querySelectorAll('[data-translated]').forEach((li) => li.remove())"); await nextFrames();
    const restored = await ev(headerState);
    ok(`${width}px：文字恢复后导航回到一行，展开的菜单同时收起`, !restored.compact && restored.rows === 1 && await ev("document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded') === 'false'"));
  }
  await viewport(1280); await go();
  ok("站名与模板/生成器名称标为不翻译，其余文字仍可翻译", await ev(`document.querySelector('.site-title').translate === false && [...document.querySelectorAll('.site-footer__credits [translate=no]')].map((n) => n.textContent).join('|') === 'Hugo|Quiet Journal' && document.querySelector('.site-footer__credits a .visually-hidden')?.translate !== false && document.querySelector('.site-nav').translate !== false && document.documentElement.translate !== false`));

  await viewport(1280); await go();
  for (let i = 0; i < 80 && !await ev("document.activeElement.matches('.hero__read')"); i++) await key("Tab", 9);
  ok("开始阅读可按 Tab 到达且有可见焦点", await ev("document.activeElement.matches('.hero__read:focus-visible')"));
  await key("Enter", 13); await until(readingReached);
  ok("键盘开始阅读只跳同页，标题获焦且不被吸顶页头遮挡", await ev("location.pathname === '/'"));
  await key("Tab", 9);
  ok("继续按 Tab 可进入最近文章，而不是跳回欢迎区", await ev("document.activeElement === document.querySelector('#recent-title + .post-list a')"));
  for (const width of [390, 320]) {
    await viewport(width); await go(); await activate('.hero__read', true); await until(readingReached);
    ok(`${width}px：实际触控开始阅读并交还阅读焦点`, true);
  }
  for (const accent of ["orange", "blue", "teal", "rose", "violet"]) for (const theme of ["light", "dark"]) {
    // Measure the settled colours: links cross-fade for --motion-fast after a theme change.
    await ev(`document.documentElement.dataset.accent = ${JSON.stringify(accent)}; document.documentElement.dataset.theme = ${JSON.stringify(theme)};`);
    await wait(400);
    const contrast = await ev(`(() => {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      const luminance = (color) => {
        ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const x = luminance(getComputedStyle(document.querySelector('.hero__read')).color), y = luminance(getComputedStyle(document.body).backgroundColor);
      return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
    })()`);
    ok(`${accent}/${theme}：开始阅读链接切换主题时对比度 ≥ 4.5:1`, contrast >= 4.5);
    await wait(180);
  }
  await ev("document.documentElement.dataset.accent = 'orange'; document.documentElement.dataset.theme = 'light'");
  await wait(180);
  await input("雨后"); await until("document.querySelector('[data-search-results] li')");
  ok("中文正文搜索返回正确文章", await ev("document.querySelector('[data-search-results] a').textContent === '中文回忆'"));
  ok("索引只向本站请求一次", requests.filter((url) => url.includes("/search/")).length === 1);
  await input("不存在的关键词"); await until("document.querySelector('[data-search-status]').textContent.includes('没有找到')");
  ok("空结果有解释而不是空白", await ev("document.querySelectorAll('[data-search-results] li').length === 0"));
  await input(""); await until("document.querySelector('[data-search-status]').textContent.includes('支持中文')");
  ok("清空恢复提示，不留下旧结果", await ev("document.querySelectorAll('[data-search-results] li').length === 0"));
  await ev("document.querySelector('[data-search-input]').dispatchEvent(new CompositionEvent('compositionstart'))");
  await input("雨后"); await wait(300);
  ok("输入法组词期间不抢先检索", await ev("document.querySelector('[data-search-status]').textContent.includes('支持中文')"));
  await ev("document.querySelector('[data-search-input]').dispatchEvent(new CompositionEvent('compositionend'))");
  await until("document.querySelector('[data-search-results] li')");
  ok("输入法提交后可检索", true);
  const before = await ev("document.querySelector('[data-answer]').textContent");
  await ev("document.querySelector('[data-answer-button]').click()");
  ok("答案之书可翻页且不连续重复", await ev(`document.querySelector('[data-answer]').textContent !== ${JSON.stringify(before)}`));
  ok("两个挂件均有无障碍状态提示", await ev("[...document.querySelectorAll('[data-search-status], [data-answer]')].every(node => node.getAttribute('aria-live') === 'polite')"));

  indexFails = true; await go();
  ok("搜索可用时不重复显示归档入口", await ev("getComputedStyle(document.querySelector('.search-fallback')).display === 'none'"));
  await input("雨后");
  await until("document.querySelector('[data-search-status]').textContent.includes('重试')");
  ok("搜索网络失败有重试与可见的归档入口", await ev("getComputedStyle(document.querySelector('.search-fallback')).display !== 'none'"));
  indexFails = false;
  await ev("document.querySelector('[data-search-form]').requestSubmit()");
  await until("document.querySelector('[data-search-results] li')");
  ok("网络恢复后重试成功，不缓存失败，归档入口重新收起", await ev("getComputedStyle(document.querySelector('.search-fallback')).display === 'none'"));

  for (const width of [1280, 390]) {
    await viewport(width); await go("/posts/wide/");
    ok(`${width}px：图文文章的单图和同段多图都不超出正文栏`, await ev(`(() => {
      const prose = document.querySelector('.prose').getBoundingClientRect();
      const boxes = [...document.querySelectorAll('.prose .media, .prose img')].map((n) => n.getBoundingClientRect());
      return boxes.length >= 4 && boxes.every((r) => r.left >= prose.left - 1 && r.right <= prose.right + 1) && document.documentElement.scrollWidth <= innerWidth;
    })()`));
    ok(`${width}px：文章页只有页脚一个回到顶部`, await ev("document.querySelectorAll('.back-to-top').length === 1 && !!document.querySelector('.site-footer .back-to-top')"));
  }
  await viewport(1280); await go("/posts/a/");
  await ev("document.querySelector('.media__zoom').click()");
  await until("document.querySelector('dialog.lightbox')?.open");
  ok("新功能未破坏图片放大", true);
  await key("Escape", 27);
  await until("!document.querySelector('dialog.lightbox').open && document.activeElement.matches('.media__zoom')");
  ok("图片 Esc 关闭并归还焦点", true);
  await ev("scrollTo(0, document.documentElement.scrollHeight)"); await wait(400);
  await activate('.site-footer .back-to-top'); await until("scrollY === 0");
  ok("页脚回到顶部实际点击仍然有效", true);
  await go();
  await ev("document.querySelector('.social a').scrollIntoView({ block: 'center', behavior: 'instant' })");
  const coordinate = await ev("(() => { const r = document.querySelector('.social a').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...coordinate }); await wait(300);
  ok("图标悬停有轻量反馈", await ev("getComputedStyle(document.querySelector('.social .icon')).transform !== 'none'"));
  await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await wait(100);
  ok("减少动态效果时不移动图标", await ev("getComputedStyle(document.querySelector('.social .icon')).transform === 'none'"));

  await browser.send("Emulation.setScriptExecutionDisabled", { value: true }); await viewport(390); await go();
  ok("无 JS 时导航可见", await ev("getComputedStyle(document.querySelector('#site-nav')).visibility === 'visible'"));
  ok("无 JS 时搜索不显示失效输入框，归档可用", await ev("document.querySelector('[data-search-form]').hidden && document.querySelector('[data-widget=search] a').getAttribute('href') === '/archive/' && getComputedStyle(document.querySelector('.search-fallback')).display !== 'none'"));
  ok("无 JS 时答案保留静态句子", await ev("document.querySelector('[data-answer]').textContent.length > 0 && document.querySelector('[data-answer-button]').hidden"));
  ok("无 JS 时常显导航随页面滚动，不遮挡阅读锚点", await ev("getComputedStyle(document.querySelector('.site-header')).position === 'static'"));
  for (const width of [390, 320]) {
    await viewport(width); await go(); await activate('.hero__read', true); await until(readingReached);
    ok(`${width}px：无 JS 时开始阅读仍可触控、聚焦且不溢出`, await ev("document.documentElement.scrollWidth <= innerWidth"));
  }
  await browser.send("Emulation.setScriptExecutionDisabled", { value: false });
  ok("访客页面没有第三方资源请求", requests.filter((url) => /^https?:/.test(url)).every((url) => url.startsWith(`${server.url}/`)));
  ok("实际 CSP 下无脚本异常或拦截", errors.length === 0);
  console.log(`\n浏览器检查：${checks} 项通过（Chromium，未代替 Safari/iPhone 真机测试）`);
} finally {
  await browser?.close(); await server?.close(); f.cleanup();
}
