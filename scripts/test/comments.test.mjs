import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { panelURL } from "../../assets/js/comments.js";
import { validateConfig, readThread } from "../../integrations/waline/src/config.js";
import { anonymousBody, anonymousTransport, LIMITS } from "../../integrations/waline/src/transport.js";
import { buildPanel, panelHeaders } from "../../integrations/waline/build.mjs";
import { fixture, build, put, read, allFiles, document } from "./site-fixture.mjs";
import { checkSite } from "../check-site.mjs";

const key = "/posts/fixed-id/";
const config = { blogOrigin: "https://blog.example.test", panelOrigin: "https://comments.example.test", apiOrigin: "https://api.example.test" };
const listURL = `${config.apiOrigin}/api/comment?path=${encodeURIComponent(key)}&page=1&pageSize=10&lang=zh-CN&sortBy=insertedAt_desc`;
const response = (data) => new Response(JSON.stringify({ errno: 0, errmsg: "", data }), { headers: { "Content-Type": "application/json" } });
const listData = { count: 1, totalPages: 1, data: [{ objectId: "one", nick: "读者", comment: "<p>你好</p>", time: 1704067200000, avatar: "https://avatar.example.test/x", mail: "not-for-client@example.test", ip: "192.0.2.1", ua: "private", addr: "PRIVATE_REGION", children: [] }] };
const using = (fn) => { const f = fixture(); f.site.sharing.generate = false; f.saveSite(); try { fn(f); } finally { f.cleanup(); } };
const success = (r) => assert.equal(r.status, 0, r.stderr);
const fail = (r, pattern) => { assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, pattern); };

test("评论协议：仅 HTTPS 源和稳定文章键，不把标题、查询参数或登录令牌传给面板", () => {
  const url = panelURL(config.panelOrigin, "/posts/中文-id/", "dark");
  assert.equal(url.origin, config.panelOrigin);
  assert.equal(url.search, "");
  assert.deepEqual(readThread(url), { key: "/posts/中文-id/", theme: "dark" });
  for (const origin of ["http://example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test/?token=x", "https://example.test/#x"]) assert.throws(() => panelURL(origin, key));
  for (const id of ["/admin/", "/posts/../", "/posts/x/y/", "/posts/%2f/", "/posts/\u202e/"]) assert.throws(() => panelURL(config.panelOrigin, id));
  for (const suffix of ["?token=secret#key=%2Fposts%2Fa%2F", "#key=%2Fposts%2Fa%2F&key=%2Fposts%2Fb%2F", "#key=%2Fposts%2Fa%2F&extra=x"]) assert.throws(() => readThread(new URL(config.panelOrigin + "/" + suffix)));
});

test("评论面板配置：三个源分开，禁止路径/认证/未知字段，响应头只允许博客嵌入和指定 API", () => {
  assert.deepEqual(validateConfig(config), config);
  for (const value of [{ ...config, panelOrigin: config.blogOrigin }, { ...config, apiOrigin: config.panelOrigin }, { ...config, token: "never" }, { ...config, apiOrigin: "https://u:p@example.test" }, { ...config, apiOrigin: "https://example.test/api" }, { ...config, apiOrigin: "https://example.test;bad" }]) assert.throws(() => validateConfig(value));
  const headers = panelHeaders(config);
  assert.match(headers, /script-src 'self';/);
  assert.match(headers, /img-src 'none';/);
  assert.match(headers, /frame-ancestors https:\/\/blog\.example\.test/);
  assert.match(headers, /connect-src 'self' https:\/\/api\.example\.test/);
  assert.doesNotMatch(headers, /unsafe-eval|unpkg|github/);
});

test("免登录提交：白名单字段保留正文/回复关系，不转发邮箱、网址、细粒度 UA 或伪造身份", () => {
  const body = { nick: "  读者  ", comment: "一条留言", url: key, mail: "private@example.test", link: "https://tracker.example.test", ua: "HIGH_ENTROPY_UA", role: "administrator", status: "approved", pid: "parent-1", rid: "root-1" };
  assert.deepEqual(JSON.parse(anonymousBody(JSON.stringify(body), key)), { nick: "读者", comment: "一条留言", url: key, mail: "", link: "", ua: "", pid: "parent-1", rid: "root-1" });
  for (const delta of [{ url: "/posts/other/" }, { nick: "" }, { nick: "x".repeat(61) }, { comment: "" }, { comment: "文".repeat(2001) }, { pid: "../" }, { rid: "" }]) assert.throws(() => anonymousBody(JSON.stringify({ ...body, ...delta }), key));
  assert.throws(() => anonymousBody(" ".repeat(LIMITS.requestBytes + 1), key), /过大/);
});

test("评论传输：固定匿名接口、禁止 Cookie/授权/重定向；不把服务端头像和隐私字段交给 UI", async () => {
  const requests = [];
  const transport = anonymousTransport({ apiOrigin: config.apiOrigin, key, fetch: async (...args) => { requests.push(args); return response(listData); } });
  const payload = await (await transport(listURL)).json();
  assert.equal(payload.data.data[0].avatar, "");
  for (const field of ["mail", "ip", "ua", "addr"]) assert.equal(payload.data.data[0][field], undefined);
  assert.equal(requests[0][1].credentials, "omit");
  assert.equal(requests[0][1].redirect, "error");
  assert.equal(requests[0][1].referrerPolicy, "no-referrer");
  for (const [url, options] of [[listURL, { headers: { Authorization: "Bearer private" } }], [listURL, { method: "PUT" }], [listURL.replace("/api/comment", "/api/user"), {}], [listURL.replace("api.example.test", "another.example.test"), {}], [listURL + "&type=recent", {}], [listURL.replace("pageSize=10", "pageSize=1000"), {}], [listURL.replace("fixed-id", "other-id"), {}]]) await assert.rejects(() => transport(url, options));
  assert.equal(requests.length, 1);
});

test("评论传输：待审核提交仍返回对象，服务器拒绝与网络失败不自动重发", async () => {
  let calls = 0;
  const notices = [];
  const transport = anonymousTransport({ apiOrigin: config.apiOrigin, key, onError: (message) => notices.push(message), fetch: async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).mail, "");
    if (calls === 1) return response({ objectId: "new-1", status: "waiting", time: 1704067200000, comment: "<p>待审核</p>" });
    if (calls === 2) return new Response(JSON.stringify({ errno: 1000, errmsg: "发送过于频繁" }));
    throw new Error("simulated network failure");
  } });
  const options = { method: "POST", body: JSON.stringify({ nick: "读者", comment: "留言", url: key }) };
  const result = await (await transport(`${config.apiOrigin}/api/comment?lang=zh-CN`, options)).json();
  assert.equal(result.data.status, "waiting");
  await assert.rejects(() => transport(`${config.apiOrigin}/api/comment`, options), /过于频繁/);
  await assert.rejects(() => transport(`${config.apiOrigin}/api/comment`, options), /network failure/);
  assert.equal(calls, 3);
  assert.equal(notices.length, 2);
});

test("评论传输：响应体数量和持续读取均有上限，超时不把不确定提交当作未收到", async () => {
  const oversized = anonymousTransport({ apiOrigin: config.apiOrigin, key, fetch: async () => new Response("{}", { headers: { "Content-Length": String(LIMITS.responseBytes + 1) } }) });
  await assert.rejects(() => oversized(listURL), /1 MiB/);
  const chunked = anonymousTransport({ apiOrigin: config.apiOrigin, key, fetch: async () => new Response("x".repeat(LIMITS.responseBytes + 1)) });
  await assert.rejects(() => chunked(listURL), /1 MiB/);
  let calls = 0;
  const hung = anonymousTransport({ apiOrigin: config.apiOrigin, key, timeout: 20, fetch: async (_url, { signal }) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"errno":')); signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError"))); } }));
  } });
  await assert.rejects(() => hung(`${config.apiOrigin}/api/comment`, { method: "POST", body: JSON.stringify({ nick: "读者", comment: "留言", url: key }) }), /可能已收到.*不会自动重发/);
  assert.equal(calls, 1);
  for (const data of [{ errno: 0, data: {} }, { notWaline: true }, { errno: 0, data: { count: 1, totalPages: 1, data: [null] } }]) {
    const malformed = anonymousTransport({ apiOrigin: config.apiOrigin, key, fetch: async () => new Response(JSON.stringify(data)) });
    await assert.rejects(() => malformed(listURL), /格式不兼容/);
  }
});

test("独立面板打包：配置/版本/哈希失败及已有输出不覆盖，不向博客静态目录输出", () => {
  const root = mkdtempSync(join(tmpdir(), "qj-panel-builder-"));
  try {
    const vendor = join(root, "vendor"), output = join(root, "out");
    mkdirSync(vendor);
    writeFileSync(join(vendor, "package.json"), JSON.stringify({ name: "@waline/client", version: "0.0.0" }));
    assert.throws(() => buildPanel({ config, output, vendorDirectory: vendor }), /版本不匹配/);
    assert.equal(existsSync(output), false);
    writeFileSync(join(vendor, "package.json"), JSON.stringify({ name: "@waline/client", version: "3.16.1" }));
    mkdirSync(join(vendor, "dist")); writeFileSync(join(vendor, "dist/waline.js"), "tampered");
    assert.throws(() => buildPanel({ config, output, vendorDirectory: vendor }), /完整性/);
    assert.equal(existsSync(output), false);
    mkdirSync(output); writeFileSync(join(output, "keep.txt"), "KEEP");
    assert.throws(() => buildPanel({ config, output, vendorDirectory: vendor }), /不覆盖/);
    assert.equal(readFileSync(join(output, "keep.txt"), "utf8"), "KEEP");
    put(root, "site/config/_default/hugo.toml", ""); mkdirSync(join(root, "site/public"));
    assert.throws(() => buildPanel({ config, output: join(root, "site/public/panel"), vendorDirectory: vendor }), /不能输出到博客/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("评论关闭：无入口/脚本/样式/第三方面板权限，独立项目及私密文件不进入 Hugo 产物", () => using((f) => {
  const marker = "QJ_PRIVATE_INTEGRATION_SENTINEL";
  // fixture() deliberately excludes integrations. Put representative files back
  // so this assertion checks a real boundary, not an absent source directory.
  for (const path of ["integrations/waline/config.local.json", "integrations/waline/dist/index.html", "integrations/waline-server/.env.local", "integrations/waline-server/.vercel/project.json", "integrations/waline-server/api/index.js", "integrations/waline-server/comments.dump"]) put(f.root, path, marker);
  success(build(f.root));
  const home = read(f.root, "public/index.html"), post = read(f.root, "public/posts/a/index.html");
  assert.doesNotMatch(home + post, /data-comments|comments\.min/);
  assert.doesNotMatch(read(f.root, "public/_headers").split("/admin/*")[0], /frame-src|__QJ/);
  const output = allFiles(join(f.root, "public"));
  assert.ok(!output.some((p) => /integrations|vendor\/|server\//.test(p)));
  for (const path of output) assert.ok(!read(f.root, `public/${path}`).includes(marker), `Private integration file leaked to ${path}`);
  assert.equal(checkSite(join(f.root, "public")).length, 0);
}));

test("评论开启：只在允许的公开文章渲染，保留正文/订阅隔离，CSP 仅增加固定 iframe 源", () => using((f) => {
  f.comments.enabled = true; f.comments.origin = config.panelOrigin; f.saveComments();
  const common = { date: "2020-01-01T00:00:00Z", draft: false };
  for (const [id, extra] of [["closed", { comments: false }], ["unlisted", { noindex: true }], ["draft", { draft: true }], ["future", { date: "2099-01-01T00:00:00Z" }], ["expired", { expiryDate: "2021-01-01T00:00:00Z" }]]) put(f.root, `content/posts/${id}/index.md`, document({ title: id, ...common, ...extra }, "正文"));
  success(build(f.root));
  assert.match(read(f.root, "public/posts/a/index.html"), /data-comments/);
  for (const path of ["index.html", "archive/index.html", "about/index.html", "posts/closed/index.html", "posts/unlisted/index.html", "index.xml"]) assert.doesNotMatch(read(f.root, `public/${path}`), /data-comments|comments\.min/);
  for (const id of ["draft", "future", "expired"]) assert.equal(existsSync(join(f.root, `public/posts/${id}`)), false);
  const headers = read(f.root, "public/_headers");
  assert.match(headers.split("/admin/*")[0], /script-src 'self';/);
  assert.match(headers.split("/admin/*")[0], /connect-src 'self'; frame-src https:\/\/comments\.example\.test;/);
  assert.doesNotMatch(headers.split("/admin/*")[1], /comments\.example\.test/);
  assert.equal(checkSite(join(f.root, "public")).length, 0);
}));

test("评论键不跟随标题/语义地址/域名改变；源文件身份冲突会失败", () => using((f) => {
  f.comments.enabled = true; f.comments.origin = config.panelOrigin; f.saveComments();
  put(f.root, "content/posts/a/index.md", document({ title: "改过标题", date: "2020-01-01T00:00:00Z", url: "/a-readable-url/" }, "正文"));
  success(build(f.root, ["--baseURL", "https://another.example.test/journal/"]));
  assert.match(read(f.root, "public/a-readable-url/index.html"), /data-key=(?:"|')?\/posts\/a\//);
  for (const [dir, url] of [["one", "/first/"], ["two", "/second/"]]) put(f.root, `content/posts/${dir}/duplicate/index.md`, document({ title: dir, date: "2020-01-01T00:00:00Z", url }, "正文"));
  fail(build(f.root), /评论文章 ID 重复/);
}));

test("评论配置、遗留响应头和字段类型错误在构建时拒绝", () => using((f) => {
  for (const origin of ["", "http://comments.example.test", "https://example.test:443/", "https://comments.example.test/path", "https://u:p@comments.example.test", "https://comments.example.test;unsafe", "https://comments.example.test:65536"]) {
    put(f.root, "data/comments.yaml", JSON.stringify({ enabled: true, origin }));
    fail(build(f.root), /comments\.origin|跨源/);
  }
  for (const invalid of [[], { enabled: "false", origin: "" }, { enabled: false, script: "x" }]) { put(f.root, "data/comments.yaml", JSON.stringify(invalid)); fail(build(f.root), /评论配置|comments.enabled|comments.yaml/); }
  f.saveComments();
  put(f.root, "content/posts/a/index.md", document({ date: "2020-01-01T00:00:00Z", comments: "false" }));
  fail(build(f.root), /comments 必须是布尔/);
  put(f.root, "content/posts/a/index.md", document({ date: "2020-01-01T00:00:00Z" }));
  put(f.root, "static/_headers", "DO_NOT_SILENTLY_REPLACE");
  fail(build(f.root), /移除旧文件/);
}));
