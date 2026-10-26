#!/usr/bin/env node
// Optional browser regression; uses only synthetic content and local servers.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportContent } from "./content-transfer.mjs";
import { packSnapshot } from "./content-zip.mjs";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { startContentUI } from "./content-ui.mjs";
import { fixture, put, build, read } from "./test/site-fixture.mjs";
import { staticServer } from "./test/static-server.mjs";
import { launchBrowser, wait } from "./test/browser-client.mjs";
const root = mkdtempSync(join(tmpdir(), "qj-ui-browser-"));
const source = join(root, "site"), folder = join(root, "private");
mkdirSync(join(source, "content"), { recursive: true }); mkdirSync(folder);
const text = "---\ntitle: 合成草稿\ndraft: true\n---\n合成内容。\n";
writeFileSync(join(source, "content/post.MD"), text);
let app, browser, server, f, uploadRequest, count = 0;
const ok = (name, value) => { assert.ok(value, name); console.log(`✔ ${name}`); count++; };
try {
  app = await startContentUI({ source, folder }); browser = await launchBrowser();
  const ev = browser.evaluate, exceptions = [], csp = [], external = [];
  browser.on((message) => {
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Log.entryAdded" && /Content Security Policy|Refused to/.test(message.params.entry.text)) csp.push(message.params.entry.text);
    if (message.method === "Network.requestWillBeSent" && /^https?:/.test(message.params.request.url) && !message.params.request.url.startsWith("http://127.0.0.1:")) external.push(message.params.request.url);
  });
  const until = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await ev(expression)) return; await wait(100); }
    throw new Error(`等待失败：${expression}\n${await ev("document.body.innerText")}`);
  };
  const click = async (selector) => {
    await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const p = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
  };
  const auth = { Authorization: `Bearer ${new URL(app.url).hash.slice(1)}` };
  const state = async () => (await fetch(`${app.origin}/api/status`, { headers: auth })).json();
  const settled = async (id) => {
    for(let i=0;i<120;i++){const task=(await state()).tasks.find(task=>task.id===id);if(task&&task.status!=='running')return task;await wait(50);}
    throw new Error(`任务未结束：${id}`);
  };
  const openZIP = async (path) => {
    const dom=await browser.send('DOM.getDocument'),node=await browser.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#zip-file'});
    await browser.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path]});
  };
  await browser.send("Page.navigate", { url: app.url });
  await until(`document.querySelector('#session')?.textContent.includes('已连接')`);
  ok("会话键从地址移除，只保留当前 tab 会话、不用持久存储", await ev(`!location.hash && localStorage.length===0 && sessionStorage.length===1`));
  ok("未确认私人内容时不允许导出和导入", await ev(`document.querySelector('#export').disabled && document.querySelector('#import').disabled`));
  await until(`!document.querySelector('#export').disabled || document.querySelector('#inventory').textContent.includes('文章')`);
  await click("#consent"); await click("#export");
  await until(`document.querySelector('#result').textContent.includes('导出完成') && !document.querySelector('#snapshot').disabled`);
  ok("导出显示中文结果、数量与 ZIP 保存路径", await ev(`document.querySelector('#result').textContent.includes('1 个文件') && document.querySelector('#output').textContent.includes('journal-content.zip')`));
  ok("未检查前仍不可导入", await ev(`document.querySelector('#import').disabled`));
  const downloads = [];
  browser.on(message => { if (message.method === 'Browser.downloadProgress') downloads.push(message.params.state); });
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: root, eventsEnabled: true });
  await click('#download');
  await until(`document.querySelector('#recovery').textContent.includes('交给浏览器下载')`);
  for(let i=0;i<30&&!downloads.includes('completed');i++)await wait(100);
  ok('原生下载实际完成，不通过 Blob 载入大包', downloads.includes('completed'));
  const snapshot = join(folder, 'snapshot');
  // More than 100 real entries must remain accessible, not silently truncated by the UI.
  for(let i=0;i<125;i++)writeFileSync(join(source,`content/extra-${String(i).padStart(3,'0')}.md`),`---\ntitle: Extra ${i}\ndraft: true\n---\nSynthetic`);
  exportContent({ source, output: snapshot, includePrivate: true });
  for(let i=0;i<125;i++)rmSync(join(source,`content/extra-${String(i).padStart(3,'0')}.md`));
  writeFileSync(join(source, "content/post.MD"), "Changed locally");
  await click('#import-mode');
  await ev(`document.querySelector('#import-view details').open=true;document.querySelector('#directory-path').value=${JSON.stringify(snapshot)}`);
  await click('#select-directory'); await until(`document.querySelector('#comparison').textContent.includes('内容不同 1')`);
  ok('真实比较分页保留全部 126 条，默认只展示前 40 条',await ev(`document.querySelectorAll('#files li').length===40&&document.querySelector('#page-number').textContent.includes('126 项')`));
  await click('#next');await click('#next');await click('#next');ok('第 4 页可以查看初始页之外的文件',await ev(`document.querySelector('#page-number').textContent.includes('第 4 / 4 页')&&document.querySelectorAll('#files li').length===6`));
  await ev(`document.querySelector('#search').value='extra-120';document.querySelector('#search').dispatchEvent(new Event('input'))`);
  ok('搜索涵盖完整比较，不只搜索当前分页',await ev(`document.querySelectorAll('#files li').length===1&&document.querySelector('#files').textContent.includes('extra-120')`));
  await click('#report');
  for(let i=0;i<80&&!existsSync(join(root,'journal-comparison.json'));i++)await wait(100);
  const report=JSON.parse(readFileSync(join(root,'journal-comparison.json'),'utf8'));
  ok('完整比较报告实际下载，包含全部 126 条与源/目标指纹',report.comparison.length===126&&report.snapshotFingerprint.length===64&&report.targetFingerprint.length===64);
  await ev(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'));document.querySelector('#filter').value='conflict';document.querySelector('#filter').dispatchEvent(new Event('change'))`);
  await click('#files button');await until(`document.querySelector('#diff').open`);
  ok('大写 Markdown 的文字差异显示两侧实际内容，不执行正文',await ev(`document.querySelector('#diff-current').textContent==='Changed locally'&&document.querySelector('#diff-incoming').textContent.includes('合成草稿')`));
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(`!document.querySelector('#diff').open`);ok('差异弹窗 Escape 关闭并回到查看按钮',await ev(`document.activeElement.closest('#files')!==null`));
  await click('#import-consent');
  await until(`!document.querySelector('#import').disabled`);
  ok("比较清楚显示冲突和原文件路径，不自动覆盖", await ev(`document.querySelector('#comparison').textContent.includes('内容不同 1') && document.querySelector('#files').textContent.includes('content/post.MD')`));
  await click("#import"); await until(`document.querySelector('#result').textContent.includes('已恢复到新的隔离目录')`);
  const restored = readdirSync(folder).find((name) => name.startsWith("journal-import-"));
  ok("实际恢复保留草稿字节且当前博客不变", readFileSync(join(folder, restored, "review/content/post.MD"), "utf8") === text && readFileSync(join(source, "content/post.MD"), "utf8") === "Changed locally");
  for (const width of [1280, 390, 320]) for (const theme of ["light", "dark"]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    ok(`向导 ${width}px / ${theme} 无溢出，操作触控区域不小于 44px`, await ev(`document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('button,select,summary,label')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)`));
    if (process.env.QJ_SCREENSHOTS) {
      mkdirSync(process.env.QJ_SCREENSHOTS, { recursive: true }); await ev("scrollTo(0,0)");
      const shot = await browser.send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(process.env.QJ_SCREENSHOTS, `transfer-${width}-${theme}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  await browser.send("Page.reload"); await until(`document.querySelector('#session')?.textContent.includes('已连接')`);
  ok("页面刷新可恢复会话和比较结果，不重发写操作", await ev(`document.querySelector('#comparison').textContent.includes('内容不同 1') && !document.querySelector('#review').hidden`));
  const tasksBefore=(await state()).tasks.length;await click('#refresh-task');await wait(100);
  ok('完成后核对状态不会重新发送写入或清空比较', (await state()).tasks.length===tasksBefore&&await ev(`!document.querySelector('#review').hidden`));
  await ev(`document.querySelector('#import-view details').open=true;document.querySelector('#directory-path').value=${JSON.stringify(join(root,'missing'))}`);await click('#select-directory');
  await until(`document.querySelector('#result').textContent.includes('目录不存在')`);
  ok('选择无效目录明确显示原因、解锁操作，不复活旧成功结果',await ev(`!document.querySelector('#export-mode').disabled&&document.querySelector('#copy').hidden&&!document.querySelector('#result').textContent.includes('已恢复')`));
  const invalidZIP=join(root,'invalid.zip');writeFileSync(invalidZIP,'Not a ZIP');await openZIP(invalidZIP);
  await until(`document.querySelector('#result').textContent.includes('未完成')&&!document.querySelector('#import-mode').disabled`);
  ok('无效 ZIP 明确失败且不保留可恢复的旧确认',await ev(`document.querySelector('#review').hidden&&document.querySelector('#import').disabled`));
  await browser.send('Page.reload');await until(`document.querySelector('#session')?.textContent.includes('已连接')`);
  ok('刷新优先显示最新失败，不显示较早导出成功',await ev(`document.querySelector('#result').textContent.includes('未完成')&&document.querySelector('#review').hidden`));
  const id=randomBytes(16).toString('hex');uploadRequest=request(`${app.origin}/api/upload?id=${id}`,{method:'POST',headers:{...auth,'Content-Type':'application/zip'}});uploadRequest.on('error',()=>{});uploadRequest.on('response',response=>response.resume());uploadRequest.write('PK');
  for(let i=0;i<80&&(await state()).active!==id;i++)await wait(50);
  await browser.send('Page.reload');await until(`document.querySelector('#result').textContent.includes('接收本机文件中')`);
  ok('上传过程中刷新仍能核对与取消，不重发上传',await ev(`!document.querySelector('#cancel').hidden&&document.querySelector('#export-mode').disabled&&document.querySelector('#download').hidden`));
  await click('#cancel');const cancelled=await settled(id);await click('#refresh-task');await until(`document.querySelector('#result').textContent.includes('已取消')`);
  ok('实际点击取消停止上传并释放控制，当前博客仍未覆盖',cancelled.status==='cancelled'&&readFileSync(join(source,'content/post.MD'),'utf8')==='Changed locally');uploadRequest.destroy();uploadRequest=undefined;
  const validZIP=(await packSnapshot(snapshot,join(root,'valid.zip'))).output;await openZIP(validZIP);
  await until(`document.querySelector('#comparison').textContent.includes('可新增 125')&&!document.querySelector('#review').hidden`);
  ok('真实文件选择接入 ZIP 检查，恢复同一包的完整比较',await ev(`document.querySelector('#comparison').textContent.includes('内容不同 1')`));
  await until(`!document.querySelector('#zip-file').disabled`);const beforeDrop=(await state()).tasks.length;
  await ev(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(readFileSync(validZIP).toString('base64'))}),c=>c.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'drop.zip',{type:'application/zip'}));document.querySelector('#drop').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}));})()`);
  for(let i=0;i<100;i++){const status=await state();if(status.tasks.length===beforeDrop+1&&!status.active)break;await wait(100);}
  await until(`!document.querySelector('#zip-file').disabled`);
  ok('拖放 ZIP 使用同一真实引擎，完成后保留完整比较', (await state()).tasks.length===beforeDrop+1&&await ev(`document.querySelector('#comparison').textContent.includes('可新增 125')`));
  ok("向导没有第三方网络请求、CSP 或 JavaScript 异常", external.length === 0 && csp.length === 0 && exceptions.length === 0);

  f = fixture();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 5 90 90"><defs><style>.a {fill:#feb005;} .b {fill:#efefef;}</style></defs><circle class="b" cx="50" cy="50" r="45"/><path class="a" d="M10 50h80v20H10Z"/></svg>';
  put(f.root, "assets/media/linuxdo.svg", svg);
  f.site.nav[0].icon_image = "/media/linuxdo.svg";
  f.site.social = [{ label: "Linuxdo", url: "https://linux.do/u/test/summary", icon_image: "https://icons.example.test/linuxdo.svg" }]; f.saveSite();
  const built = build(f.root); assert.equal(built.status, 0, built.stderr);
  server = await staticServer(join(f.root, "public"));
  await browser.send("Fetch.enable", { patterns: [{ urlPattern: "https://icons.example.test/*" }] });
  browser.on((message) => { if (message.method === "Fetch.requestPaused") browser.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "image/svg+xml" }], body: Buffer.from(svg).toString("base64") }).catch(() => {}); });
  await browser.send("Page.navigate", { url: server.url });
  await until(`document.querySelectorAll('img.icon--uploaded').length===2 && [...document.querySelectorAll('img.icon--uploaded')].every(e=>e.complete&&e.naturalWidth>0)`);
  ok("浏览器实际解码本地与 HTTPS SVG；导航和页脚社交图标可见", await ev(`[...document.querySelectorAll('img.icon--uploaded')].every(e=>e.naturalWidth>0&&getComputedStyle(e).objectFit==='contain')`));
  for (const width of [1280, 320]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    ok(`图标 ${width}px 不挤出导航布局`, await ev(`document.documentElement.scrollWidth<=innerWidth`));
  }
  assert.deepEqual({ csp, exceptions }, { csp: [], exceptions: [] });
  ok("SVG 图标没有 CSP 或 JavaScript 异常", true);
  console.log(`本地向导与图标浏览器回归：${count} 项通过。外部图标响应由本机夹具拦截，无线上写入。`);
} finally { uploadRequest?.destroy(); await browser?.close(); await server?.close(); await app?.close(); f?.cleanup(); rmSync(root, { recursive: true, force: true }); }
