import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { rankPages, normalize } from "../../assets/js/widgets/search.js";
import { nextIndex } from "../../assets/js/widgets/answers.js";
import { validTimestamp, checkedURL, tags, decodeEntities } from "../check-site.mjs";
import { checkDir, inspect } from "../check-media.mjs";
import { fixture, put } from "./site-fixture.mjs";

const pages = [
  { title: "雨后散步", summary: "走进书店", text: "从小路走回家" },
  { title: "Another day", summary: "reading", text: "雨后在书店 Reading a book" },
];
test("搜索：中文子串、多词 AND、标题优先、空输入与字面特殊符号", () => {
  assert.deepEqual(rankPages(pages, "雨后 书店").map((item) => item.page.title), ["雨后散步", "Another day"]);
  assert.equal(rankPages(pages, "雨后 不存在").length, 0);
  assert.equal(rankPages(pages, "   ").length, 0);
  assert.equal(rankPages(pages, "<.*>[a-z]").length, 0);
  assert.equal(rankPages(pages, "READING")[0].page.title, "Another day");
  assert.equal(normalize("ＡＢＣ１２"), "abc12");
});
test("答案之书：不连续重复、不会越界、单条退化行为可预测", () => {
  for (let length = 2; length < 12; length++) for (let current = 0; current < length; current++) for (const random of [0, 0.4, 0.999999]) {
    const next = nextIndex(current, length, () => random);
    assert.ok(next >= 0 && next < length && next !== current);
  }
  assert.equal(nextIndex(0, 1), 0);
});
test("时间检查：必须含时区，拒绝不存在的日期", () => {
  for (const value of ["2024-02-29T10:20:30+08:00", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00.123Z"]) assert.ok(validTimestamp(value));
  for (const value of ["2023-02-29T00:00:00Z", "2024-02-30T00:00:00Z", "2020-01-01", "2020-01-01T10:20:30", "2020-01-01T24:20:30Z", "invalid"]) assert.equal(validTimestamp(value), false);
});
test("地址检查：协议、凭证、控制符与反斜杠防线", () => {
  const base = "https://example.test/";
  for (const value of ["/about/", "#main", "https://remote.test/a?x=1&y=2", "mailto:a@example.test", "tel:+1234567"]) assert.doesNotThrow(() => checkedURL(value, base));
  for (const value of ["javascript:alert(1)", "DaTa:text/html,x", "//remote.test", "https://user:pass@example.test/", "https:\\example.test", "https://exa\nmple.test", ""]) assert.throws(() => checkedURL(value, base));
});
test("产物属性解析：保留空 alt，正确处理引号、& 和压缩 HTML", () => {
  const [img, link] = tags('<img alt width=32 height="32" src="/x.png"><a title="a &quot; &gt;" href="https://e.test/?a=1&amp;b=2" target=_blank>');
  assert.equal(img.attrs.alt, ""); assert.equal(img.attrs.width, "32");
  assert.equal(link.attrs.title, 'a " >'); assert.equal(link.attrs.href, "https://e.test/?a=1&b=2");
  assert.equal(decodeEntities("&#x4e2d;&#25991;&amp;colon;"), "中文&colon;");
});
test("编辑器链接组件：文本/地址往返，拒绝把内容变成 HTML 或 shortcode", () => {
  let component;
  vm.runInNewContext(readFileSync(new URL("../../static/admin/editor-components.js", import.meta.url), "utf8"), {
    CMS: { registerEditorComponent: (value) => { component = value; } },
    document: { createElement: () => ({ textContent: "" }) },
  });
  const data = { text: '<img onerror="x"> {{< bad >}}', url: 'https://e.test/?x="a"&y=2', target: "same", title: "引号 & 文本" };
  const block = component.toBlock(data);
  assert.ok(!block.includes("{{< bad"));
  assert.ok(!block.includes("<img"));
  const parsed = component.fromBlock(block.match(component.pattern));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), data);
  assert.equal(component.toPreview(data).textContent, `${data.text} · 当前标签页`);
  assert.doesNotThrow(() => component.toBlock({}));
  assert.doesNotThrow(() => component.toPreview({}));
});
test("SVG 图标仅接受被动图形；正文 SVG、SMIL、外部资源和构建字体仍拒绝", () => {
  for (const content of ['<svg><foreignObject/></svg>', '<svg><animate attributeName="href" to="javascript:x"/></svg>', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>', '<svg><use href="#x"/></svg>']) {
    assert.ok(inspect(Buffer.from(content), "logo.svg").problems.length);
  }
  const f = fixture();
  try {
    put(f.root, "assets/media/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.ok(!checkDir(join(f.root, "assets"), "assets", f.root).some((issue) => issue.level === "FAIL" && issue.file.endsWith("logo.svg")));
    put(f.root, "content/posts/a/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.ok(checkDir(join(f.root, "content"), "content", f.root).some((issue) => issue.level === "FAIL" && issue.file.endsWith("logo.svg")));
    put(f.root, "public/og/font.otf", "font");
    assert.ok(checkDir(join(f.root, "public"), "public", f.root).some((issue) => issue.level === "FAIL"));
  } finally { f.cleanup(); }
});
