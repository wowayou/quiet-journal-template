#!/usr/bin/env node
// Manual, local-only integration test: official pinned client + three real HTTPS origins.
// The API is an in-memory protocol fixture, not a claim about a deployed Waline/database.
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fixture, build, allFiles } from "./test/site-fixture.mjs";
import { staticHandler } from "./test/static-server.mjs";
import { launchBrowser, wait } from "./test/browser-client.mjs";
import { buildPanel } from "../integrations/waline/build.mjs";

const vendorDirectory = process.env.QJ_WALINE_CLIENT || fileURLToPath(new URL("../integrations/waline/node_modules/@waline/client/", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "qj-comments-browser-"));
const f = fixture(); const servers = [];
let browser, count = 0, allowConfirm = false, blockApp = false, failList = false, rejectPost = false, closing = false;
const ok = (label, condition, detail = "") => { assert.ok(condition, detail ? `${label}\n${detail}` : label); count++; console.log(`✔ ${label}`); };
const requests = [], posts = [], exceptions = [], unexpectedNetwork = [], dialogs = [], protocolErrors = [];
try {
  const certFile = join(temp, "cert.pem"), keyFile = join(temp, "key.pem");
  const certResult = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", keyFile, "-out", certFile], { encoding: "utf8", timeout: 15000 });
  assert.equal(certResult.status, 0, "本地 HTTPS 测试需要 openssl；不会下载证书工具。");
  const tls = { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  const certificateSPKI = createHash("sha256").update(new X509Certificate(tls.cert).publicKey.export({ format: "der", type: "spki" })).digest("base64");
  const site = async () => {
    let handler = (_req, res) => res.writeHead(503).end();
    const server = createServer(tls, (req, res) => handler(req, res));
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    servers.push(server);
    return { url: `https://127.0.0.1:${server.address().port}`, serve: (next) => { handler = next; } };
  };
  const blog = await site(), panel = await site(), api = await site();
  const config = { blogOrigin: blog.url, panelOrigin: panel.url, apiOrigin: api.url };
  const result = buildPanel({ config, output: join(temp, "panel"), vendorDirectory });
  ok("独立面板以固定 3.16.1/哈希构建，12 个公开文件包含双方许可，无数据库、密钥或源映射", result.files === 12 && allFiles(result.output).includes("LICENSE-quiet-journal.txt") && allFiles(result.output).includes("LICENSE-waline.txt") && !allFiles(result.output).some((path) => /\.map$|\.env|node_modules|database/.test(path)));
  panel.serve(staticHandler(result.output, (req, res, path) => {
    requests.push({ origin: "panel", path });
    if (blockApp && path === "/app.js") { res.writeHead(503).end("intentional test failure"); return true; }
    return false;
  }));
  const comments = Array.from({ length: 11 }, (_, i) => ({ objectId: `root-${i + 1}`, nick: `读者${i + 1}`, comment: `<p>合成留言 ${i + 1}</p>`, time: 1704067200000, status: "approved", avatar: "https://never-fetch.example.test/avatar.png", addr: "PRIVATE_REGION", browser: "PRIVATE_UA", os: "PRIVATE_OS", children: [] }));
  comments[1].comment = '<p><a href="#root-1">回到第一条留言</a></p>';
  api.serve(async (req, res) => {
    const url = new URL(req.url, api.url);
    requests.push({ origin: "api", path: url.pathname, method: req.method, url: url.href });
    res.setHeader("Access-Control-Allow-Origin", panel.url);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    const send = (data) => res.end(JSON.stringify({ errno: 0, errmsg: "", data }));
    if (url.pathname !== "/api/comment") { res.writeHead(404).end('{}'); return; }
    if (req.method === "GET") {
      if (failList) { res.writeHead(503).end('{}'); return; }
      const page = Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("pageSize"));
      const visible = url.searchParams.get("path") === "/posts/a/" ? comments : [];
      send({ count: visible.length, totalPages: Math.ceil(visible.length / size), page, pageSize: size, data: visible.slice((page - 1) * size, page * size) });
      return;
    }
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 15000) { res.writeHead(413).end('{}'); return; } }
      const data = JSON.parse(body); posts.push({ data, headers: req.headers });
      if (rejectPost) { res.end(JSON.stringify({ errno: 1000, errmsg: "请等待审核，不要重复发送" })); return; }
      send({ ...data, objectId: `new-${posts.length}`, status: "waiting", time: 1704067200000, comment: "<p>本次提交，等待审核</p>", children: [] });
      return;
    }
    res.writeHead(405).end('{}');
  });
  f.site.sharing.generate = false; f.saveSite();
  const render = () => {
    const r = build(f.root, ["--baseURL", blog.url + "/"]); assert.equal(r.status, 0, r.stderr);
    blog.serve(staticHandler(join(f.root, "public")));
  };
  render();
  browser = await launchBrowser(undefined, { certificateSPKI });
  const ev = browser.evaluate;
  browser.on((message) => {
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const allowed = [blog.url, panel.url, api.url].includes(new URL(request.url).origin);
      if (!allowed) unexpectedNetwork.push(request.url);
      void browser.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId, ...(allowed ? {} : { errorReason: "BlockedByClient" }) }).catch((error) => { if (!closing) protocolErrors.push(error.message); });
    }
    if (message.method === "Page.javascriptDialogOpening") {
      dialogs.push(message.params.message);
      void browser.send("Page.handleJavaScriptDialog", { accept: allowConfirm }).catch((error) => { if (!closing) protocolErrors.push(error.message); });
    }
  });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(panel.url)}){localStorage.setItem('WALINE_USER',JSON.stringify({token:'MUST_NOT_LEAK',email:'private@example.test'}));localStorage.setItem('WALINE_USER_META',JSON.stringify({nick:'旧昵称',mail:'private@example.test',link:'https://never-send.example.test'}));}` });
  await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  const until = async (expression, evaluate = ev) => {
    for (let i = 0; i < 170; i++) { if (await evaluate(expression)) return; await wait(100); }
    throw new Error(`等待失败：${expression}\n${await evaluate('document.body.innerText')}`);
  };
  const go = async (url) => { await browser.send("Page.navigate", { url }); await until('document.readyState === "complete"'); await wait(200); };
  const viewport = async (width) => { await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }); await browser.send("Emulation.setTouchEmulationEnabled", { enabled: width < 600 }); };
  const tap = async ({ x, y }) => { await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] }); await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
  const click = async (selector) => {
    await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`); await wait(100);
    await tap(await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`));
  };
  const frameContext = async () => {
    const tree = await browser.send("Page.getFrameTree");
    const id = tree.frameTree.childFrames?.[0]?.frame.id; assert.ok(id, "iframe must exist");
    const { executionContextId } = await browser.send("Page.createIsolatedWorld", { frameId: id, worldName: "qj-test" });
    return async (expression) => {
      const value = await browser.send("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result?.value;
    };
  };
  await viewport(390); await go(blog.url + "/posts/a/");
  ok("关闭态没有评论入口，也没有面板/API 请求", await ev('!document.querySelector("[data-comments]")') && requests.length === 0);
  f.comments.enabled = true; f.comments.origin = panel.url; f.saveComments(); render();
  await go(blog.url + "/posts/a/?private-query=DO_NOT_FORWARD");
  await ev(`localStorage.setItem('CMS_TEST_SENTINEL','PRIVATE_FAKE_TOKEN')`);
  ok("启用后点击之前不创建框架、不连接面板或 API", await ev('!document.querySelector("iframe")') && requests.length === 0);
  await click("[data-comments-open]"); await until('document.querySelector("[data-comments]").dataset.state === "ready"');
  let fev = await frameContext();
  await until('document.querySelectorAll(".wl-card-item").length===10', fev);
  ok("真实跨源面板加载官方客户端，首批 10 条而非全量", true);
  ok("框架不包含文章查询/令牌，禁止导航父页，只向固定源通信", await ev(`(()=>{const f=document.querySelector('iframe');return !f.src.includes('DO_NOT_FORWARD')&&f.referrerPolicy==='no-referrer'&&!f.sandbox.contains('allow-top-navigation');})()`));
  ok("面板自己的旧会话/缓存邮箱已清除，不把禁用登录误当作隔离", await fev(`localStorage.getItem('WALINE_USER')===null&&!JSON.parse(sessionStorage.getItem('WALINE_USER')||'{}').token&&JSON.parse(sessionStorage.getItem('WALINE_USER_META')).mail===''`));
  ok("面板无法读取博客/CMS 的同源存储", await fev(`(()=>{try{return parent.localStorage.getItem('CMS_TEST_SENTINEL');}catch(e){return e.name;}})()`) === "SecurityError");
  ok("免登录界面不收邮箱/网址，无登录入口及可见点赞/上传入口", await fev(`!document.querySelector('#wl-mail, #wl-link')&&![...document.querySelectorAll('button')].some(b=>b.textContent.includes('登录'))&&[...document.querySelectorAll('.wl-like, label[for=wl-image-upload]')].every(n=>!n.getClientRects().length)`));
  ok("头像和服务返回的设备/地区信息不显示，也不向头像站请求", await fev(`!document.querySelector('.wl-user-avatar')&&!document.body.innerText.includes('PRIVATE_')`) && unexpectedNetwork.length === 0);
  const clickFrame = async (selector) => {
    await ev(`document.querySelector('iframe').scrollIntoView({block:'center',behavior:'instant'})`);
    await fev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`); await wait(120);
    const outside = await ev(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x,y:r.y};})()`);
    const inside = await fev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y))};})()`);
    const point = { x: outside.x + inside.x + 1, y: outside.y + inside.y + 1 };
    assert.ok(inside.hit, `Frame hit target: ${selector} ${JSON.stringify(inside)}`);
    assert.ok(await ev(`document.elementFromPoint(${point.x},${point.y})===document.querySelector('iframe')`), `Parent hit target: ${selector} ${JSON.stringify(point)}`);
    await tap(point);
  };
  const initialHash = await fev('location.hash');
  await clickFrame("#root-2 .wl-content a");
  ok("评论内部锚点跳转不覆盖 URL 中的文章键", await fev('location.hash') === initialHash);
  await clickFrame(".wl-operation button"); await until('document.querySelectorAll(".wl-card-item").length===11', fev);
  ok("读者主动加载下一页，API 单页数量固定 10", requests.filter((r) => r.origin === "api" && r.method === "GET").every((r) => new URL(r.url).searchParams.get("pageSize") === "10"));
  const fill = async (text) => fev(`(()=>{for(const[s,v]of [['#wl-nick','合成读者'],['#wl-edit',${JSON.stringify(text)}]]){const e=document.querySelector(s);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await fill("切换主题时保留的待发送文字");
  ok("官方客户端的待发文字仅进入会话存储，不写持久缓存", await fev(`sessionStorage.getItem('WALINE_COMMENT_BOX_EDITOR')?.includes('保留')&&!localStorage.getItem('WALINE_COMMENT_BOX_EDITOR')`));
  const beforeGet = requests.filter((r) => r.origin === "api" && r.method === "GET").length;
  await click("[data-theme-toggle]"); await until('document.documentElement.dataset.theme==="dark"', fev);
  ok("换主题不重载面板、不丢输入或重置评论键", await fev('document.querySelector("#wl-edit").value.includes("保留")') && beforeGet === requests.filter((r) => r.origin === "api" && r.method === "GET").length);
  await clickFrame("button.primary"); await until('document.querySelector(".wl-warning")', fev);
  ok("免登录提交显示待审核，发送字段不含邮箱、设备详情或认证头", posts.length === 1 && posts[0].data.url === "/posts/a/" && posts[0].data.mail === "" && posts[0].data.ua === "" && !posts[0].headers.authorization && !posts[0].headers.cookie);
  await clickFrame("#root-1 .wl-reply"); await until('document.querySelector("#wl-edit").placeholder.includes("读者1")', fev);
  await fill("对另一条留言的回复"); await clickFrame("button.primary"); await until('document.querySelector("#new-2")', fev);
  ok("回复保留父评论/根评论及固定文章关联", posts[1]?.data.pid === "root-1" && posts[1].data.rid === "root-1" && posts[1].data.url === "/posts/a/");
  rejectPost = true;
  await fill("拒绝后仍保留的草稿"); await clickFrame("button.primary"); await until('document.querySelector("#notice").textContent.includes("不要重复发送")', fev);
  await wait(300);
  ok("提交被拒绝：面板内提示、输入保留、不自动重发或弹出原生对话框", posts.length === 3 && await fev('document.querySelector("#wl-edit").value.includes("仍保留")') && dialogs.length === 0);
  rejectPost = false;
  const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const theme of ["light", "dark"]) {
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await until(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`, fev);
    const colors = await fev(`['#notice','#wl-edit','.wl-warning','.wl-content'].map(s=>{const e=document.querySelector(s);let parent=e;let bg='';while(parent){bg=getComputedStyle(parent).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')break;parent=parent.parentElement;}return {selector:s,fg:getComputedStyle(e).color,bg};})`);
    ok(`${theme}：错误、输入、待审核提示和正文对比度至少 4.5:1`, colors.every(({ fg, bg }) => { const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5; }), JSON.stringify(colors));
  }
  for (const width of [1280, 390, 320]) {
    await viewport(width); await wait(150);
    ok(`${width}px：博客和隔离评论内容不横向溢出`, await ev('document.documentElement.scrollWidth<=innerWidth') && await fev('document.documentElement.scrollWidth<=innerWidth'));
    if (process.env.QJ_SCREENSHOTS) {
      mkdirSync(process.env.QJ_SCREENSHOTS, { recursive: true });
      await ev(`document.querySelector('[data-comments]').scrollIntoView({block:'start'})`); await wait(150);
      const shot = await browser.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(process.env.QJ_SCREENSHOTS, `comments-${width}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  allowConfirm = true; await click("[data-comments-close]"); await until('!document.querySelector("iframe")'); allowConfirm = false;
  const afterClose = requests.length; await wait(300);
  ok("关闭销毁 iframe 并归还焦点，没有后台评论请求", afterClose === requests.length && await ev('document.activeElement.matches("[data-comments-open]")'));
  blockApp = true;
  await click("[data-comments-open]"); await until('document.querySelector("[data-comments]").dataset.state==="loading"');
  await ev(`window.dispatchEvent(new MessageEvent('message',{origin:${JSON.stringify(panel.url)},source:window,data:{protocol:'quiet-journal-comments',version:1,type:'ready'}}));window.dispatchEvent(new MessageEvent('message',{origin:'https://wrong.example.test',source:document.querySelector('iframe').contentWindow,data:{protocol:'quiet-journal-comments',version:1,type:'ready'}}));`);
  ok("伪造来源或发送窗口的 ready 消息不能伪装成功", await ev('document.querySelector("[data-comments]").dataset.state==="loading"'));
  await until('document.querySelector("[data-comments]").dataset.state==="error"');
  const afterError = requests.length; await wait(400);
  ok("面板脚本缺失：有界超时、移除框架、只允许手动重试", afterError === requests.length && await ev('!document.querySelector("iframe")&&!document.querySelector("[data-comments-open]").disabled'));
  blockApp = false; failList = true;
  await click("[data-comments-open]"); await until('document.querySelector("[data-comments]").dataset.state==="ready"');
  fev = await frameContext(); await until('document.querySelector("#notice").textContent.includes("503")', fev);
  ok("API 故障不冒称空评论，有可见错误和刷新按钮", await fev('!!document.querySelector(".wl-operation button")'));
  failList = false; await clickFrame(".wl-operation button"); await until('document.querySelectorAll(".wl-card-item").length===10', fev);
  ok("API 恢复后读者可手动刷新，过期错误提示也清除", await fev('!document.querySelector("#notice").textContent.includes("503")'));
  allowConfirm = true; await click("[data-comments-close]"); await until('!document.querySelector("iframe")'); allowConfirm = false;
  await browser.send("Emulation.setScriptExecutionDisabled", { value: true }); await go(blog.url + "/posts/a/");
  ok("无 JS 保留独立窗口入口，不显示失效加载按钮", await ev('document.querySelector("[data-comments-open]").hidden&&document.querySelector("[data-comments] a").href.includes("#key=")'));
  await browser.send("Emulation.setScriptExecutionDisabled", { value: false });
  const apiBeforeToken = requests.filter((r) => r.origin === "api").length;
  await go(panel.url + "/?token=FAKE_NOT_ALLOWED#key=%2Fposts%2Fa%2F"); await until('document.querySelector("#notice").textContent.includes("不接受查询参数")');
  ok("独立面板拒绝 URL 登录令牌，不调用会话或评论 API", apiBeforeToken === requests.filter((r) => r.origin === "api").length);
  await ev(`sessionStorage.setItem('QJ_WALINE_THREAD','/posts/a/');sessionStorage.setItem('WALINE_COMMENT_BOX_EDITOR','DO_NOT_CARRY_TO_ANOTHER_POST')`);
  await go(panel.url + "/#key=%2Fposts%2Fb%2F"); await until('document.querySelector("#wl-edit")');
  ok("进入另一篇文章不继承前一篇的待发送文字", await ev('document.querySelector("#wl-edit").value===""&&sessionStorage.getItem("QJ_WALINE_THREAD")==="/posts/b/"'));
  const beforeKeyChange = requests.filter((r) => r.origin === "api").length;
  await ev(`location.hash='key=%2Fposts%2Fc%2F'`); await until('document.querySelector("#notice").textContent.includes("文章标识已变化")');
  ok("手动改文章片段会停止旧表单，不带着旧关联继续提交", await ev('document.querySelector("#waline").hidden') && requests.filter((r) => r.origin === "api").length === beforeKeyChange);
  ok("没有越界网络请求、未捕获 JS 异常或测试协议错误", unexpectedNetwork.length === 0 && exceptions.length === 0 && protocolErrors.length === 0);
  console.log(`评论浏览器检查：${count} 项通过。仅固定客户端、三个本机 HTTPS 源和合成 API 夹具；没有远端评论、邮件或部署。`);
} finally {
  closing = true;
  await browser?.close();
  await Promise.all(servers.map((server) => new Promise((done) => { server.closeAllConnections(); server.close(done); })));
  f.cleanup(); rmSync(temp, { recursive: true, force: true });
}
