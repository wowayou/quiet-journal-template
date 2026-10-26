#!/usr/bin/env node
// Optional, manual, offline CMS regression. Supply the pinned bundle yourself; never downloads it.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fixture, build, put, read, allFiles } from "./test/site-fixture.mjs";
import { staticServer } from "./test/static-server.mjs";
import { launchBrowser, wait } from "./test/browser-client.mjs";
import { jpegWithGps } from "./test/fixtures.mjs";
import { inspect } from "./check-media.mjs";
import { checkSite, tags } from "./check-site.mjs";

if (!process.env.QJ_CMS_BUNDLE) throw new Error("设置 QJ_CMS_BUNDLE 指向已下载、与 admin/index.html 的 SRI 一致的 CMS 主程序；测试不会下载或访问 GitHub。");
const f = fixture();
let browser, server, count = 0, blockBundle = false, blockPart = "", failInit = false;
const ok = (name, condition) => { assert.ok(condition, name); count++; console.log(`✔ ${name}`); };
const storage = `(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('sveltia-cms-test');const out=[];async function walk(dir,prefix=''){for await(const [name,entry]of dir.entries()){if(entry.kind==='directory')await walk(entry,prefix+name+'/');else{const file=await entry.getFile();out.push([prefix+name,Array.from(new Uint8Array(await file.arrayBuffer()))]);}}}await walk(root);return out;})()`;
try {
  const bundle = readFileSync(process.env.QJ_CMS_BUNDLE);
  const integrity = `sha384-${createHash("sha384").update(bundle).digest("base64")}`;
  ok("离线主程序与固定 SRI 一致", read(f.root, "static/admin/index.html").includes(integrity));
  // A non-default global value proves that the 'site' choice really preserves the file config.
  put(f.root, "assets/admin/schema.yml", read(f.root, "assets/admin/schema.yml").replace("quality: 85", "quality: 67"));
  f.site.sharing.generate = false;
  f.site.social = [
    { label: "SVG roundtrip", url: "https://example.org/", icon: "link", icon_image: "" },
    { label: "HTTPS SVG", url: "https://example.org/", icon: "link", icon_image: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/linuxdo.svg" },
  ];
  f.saveSite();
  assert.equal(build(f.root).status, 0);
  server = await staticServer(join(f.root, "public"), (_req, res, path) => {
    if (blockPart && path === `/admin/${blockPart}`) { res.writeHead(503).end("Intentional missing host script"); return true; }
    if (failInit && path === "/admin/editor.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end("CMS.init = () => { throw new Error('Intentional initialization failure'); };\n" + read(f.root, "public/admin/editor.js"));
      return true;
    }
    if (path === "/admin/vendor.js") {
      if (blockBundle) { res.writeHead(503).end("Intentional offline test"); return true; }
      res.setHeader("Content-Type", "text/javascript"); res.end(bundle); return true;
    }
    if (path === "/admin/" || path === "/admin/index.html") { res.setHeader("Content-Type", "text/html"); res.end(read(f.root, "public/admin/index.html").replace("https://unpkg.com/@sveltia/cms@0.235.1/dist/sveltia-cms.js", "/admin/vendor.js")); return true; }
    if (path === "/admin/config.yml") { const config = JSON.parse(read(f.root, "public/admin/config.yml")); config.backend.name = "test-repo"; res.setHeader("Content-Type", "text/yaml"); res.end(JSON.stringify(config)); return true; }
    return false;
  });
  browser = await launchBrowser(); const ev = browser.evaluate; const exceptions = [];
  browser.on((m) => { if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails.text); });
  const until = async (expression) => { for (let i = 0; i < 120; i++) { if (await ev(expression)) return; await wait(100); } throw new Error(`等待失败：${expression}\n${await ev("document.body.innerText")}`); };
  const press = async (key, code) => { await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code }); await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code }); };
  const signIn = async () => {
    await until(`document.querySelector('#nc-root button')`);
    await ev(`[...document.querySelectorAll('#nc-root button')].find(b=>b.textContent.includes('Work with Test Repository'))?.click()`);
    await wait(700);
  };
  const setTitle = async (value) => { await until(`document.querySelector('[data-key-path="title"] input')`); await ev(`(()=>{const input=document.querySelector('[data-key-path="title"] input');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`); };
  const save = async () => { await until(`[...document.querySelectorAll('#nc-root button')].some(b=>b.textContent.trim()==='Save'&&!b.disabled)`); await ev(`[...document.querySelectorAll('#nc-root button')].find(b=>b.textContent.trim()==='Save'&&!b.disabled).click()`); };
  const upload = async (field, file) => {
    await until(`document.querySelector('[data-key-path="${field}"] input[type=file]')`);
    await ev(`document.querySelector('[data-key-path="${field}"]').scrollIntoView({block:'center'})`);
    const dom = await browser.send("DOM.getDocument");
    const node = await browser.send("DOM.querySelector", { nodeId: dom.root.nodeId, selector: `[data-key-path="${field}"] input[type=file]` });
    await browser.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [file] });
    await until(`document.querySelector('[data-key-path="${field}"]').innerText.includes(${JSON.stringify(file.split("/").at(-1).replace(/\.jpg$/, ".webp"))})`);
  };
  await browser.send("Network.setBlockedURLs", { urls: ["https://*"] });
  await browser.send("Page.navigate", { url: server.url }); await wait(400);
  const seed = allFiles(f.root).filter((p) => /^(content|data)\/.+\.(md|yaml)$/.test(p)).map((p) => [p, read(f.root, p)]);
  await ev(`(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('sveltia-cms-test',{create:true});for(const[path,text]of ${JSON.stringify(seed)}){const parts=path.split('/');const file=parts.pop();let dir=root;for(const part of parts)dir=await dir.getDirectoryHandle(part,{create:true});const handle=await dir.getFileHandle(file,{create:true});const stream=await handle.createWritable();await stream.write(text);await stream.close();}})()`);
  const jpegBase64 = await ev(`(()=>{const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1200;const ctx=canvas.getContext('2d');const grad=ctx.createLinearGradient(0,0,2400,1200);grad.addColorStop(0,'#96432a');grad.addColorStop(.5,'#4b8bae');grad.addColorStop(1,'#bec179');ctx.fillStyle=grad;ctx.fillRect(0,0,2400,1200);ctx.font='24px sans-serif';for(let y=20;y<1200;y+=45)for(let x=15;x<2400;x+=150){ctx.fillStyle=(x+y)%3?'#eaeaea':'#283347';ctx.fillText('QJ '+x+' '+y,x,y);ctx.strokeRect(x,y,110,20);}return canvas.toDataURL('image/jpeg',.94).split(',')[1];})()`);
  const input = jpegWithGps(Buffer.from(jpegBase64, "base64"));
  assert.ok(input.length < 2 * 1024 ** 2);
  const inputBase64 = input.toString("base64");
  const reference = async (quality, width) => Buffer.from(await ev(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(inputBase64)}),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));const canvas=new OffscreenCanvas(${width},${width / 2});canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();const blob=await canvas.convertToBlob({type:'image/webp',quality:${quality / 100}});return Array.from(new Uint8Array(await blob.arrayBuffer()));})()`));
  const stored = async () => new Map((await ev(storage)).map(([path, bytes]) => [path, Buffer.from(bytes)]));
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.send("Page.navigate", { url: `${server.url}/admin/` }); await signIn();
  for (const width of [1280, 390, 320]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.send("Emulation.setTouchEmulationEnabled", { enabled: width < 600 }); await wait(250);
    ok(`${width}px：独立工具栏不溢出，也不覆盖 CMS 挂载区`, await ev(`(()=>{const bar=document.querySelector('#qj-admin-bar').getBoundingClientRect();const root=document.querySelector('#nc-root').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth && root.top>=bar.bottom-1 && bar.bottom<=70;})()`));
    ok(`${width}px：发布说明入口可点、另开标签且不假报成功`, await ev(`(()=>{const link=document.querySelector('a[href="./publishing.html"]');const r=link.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===link&&link.target==='_blank'&&link.title.includes('不等于网站上线');})()`));
    if (process.env.QJ_SCREENSHOTS) {
      mkdirSync(process.env.QJ_SCREENSHOTS, { recursive: true });
      const shot = await browser.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(process.env.QJ_SCREENSHOTS, `cms-list-${width}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  await ev(`location.hash='#/collections/pages/new'`); await setTitle("尚未保存的质量测试");
  for (const width of [1280, 390, 320]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.send("Emulation.setTouchEmulationEnabled", { enabled: width < 600 }); await wait(500);
    ok(`${width}px：编辑页的质量入口实际可点，不被 CMS 固定层遮住`, await ev(`(()=>{const button=document.querySelector('#qj-quality-open');const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#qj-quality-open')===button;})()`));
  }
  const qualityPoint = await ev(`(()=>{const r=document.querySelector('#qj-quality-open').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...qualityPoint, id: 0 }] });
  await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(`document.querySelector('#qj-quality-dialog').open`);
  await wait(500); // Let the native page view transition finish before inspecting the modal.
  if (process.env.QJ_SCREENSHOTS) {
    const shot = await browser.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(process.env.QJ_SCREENSHOTS, "cms-quality-320.png"), Buffer.from(shot.data, "base64"));
  }
  await ev(`document.querySelector('#qj-quality-select').value='high';document.querySelector('#qj-quality-dialog form').requestSubmit()`);
  ok("更换偏好不自动重载，不改变本次有效档位或未保存标题", await ev(`document.querySelector('[data-key-path="title"] input').value==='尚未保存的质量测试'&&document.querySelector('#qj-quality-open').textContent.includes('站点设置')&&document.querySelector('#qj-quality-status').textContent.includes('下次')`));
  // Return the pending preference to site; no reload or draft loss occurred.
  await ev(`document.querySelector('#qj-quality-select').value='site';document.querySelector('#qj-quality-dialog form').requestSubmit()`);
  await press("Escape", 27); await wait(100);
  ok("质量对话框 Escape 关闭并恢复焦点", await ev(`!document.querySelector('#qj-quality-dialog').open && document.activeElement.id==='qj-quality-open'`));
  await save(); await wait(600);
  const sizes = {};
  for (const [profile, quality] of [["site", 67], ["compact", 75], ["balanced", 85], ["high", 92]]) {
    await ev(`localStorage.setItem('quiet-journal:upload-quality:v1',${JSON.stringify(profile)})`);
    await browser.send("Page.navigate", { url: `${server.url}/admin/` }); await signIn();
    await ev(`location.hash='#/collections/pages/new'`); await setTitle(`上传质量 ${profile}`);
    const file = join(f.root, `probe-${profile}.jpg`); put(f.root, `probe-${profile}.jpg`, input);
    await upload("cover", file); await save();
    await until(`(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('sveltia-cms-test');try{const assets=await root.getDirectoryHandle('assets');const media=await assets.getDirectoryHandle('media');await media.getFileHandle('probe-${profile}.webp');return true;}catch{return false;}})()`);
    const bytes = (await stored()).get(`assets/media/probe-${profile}.webp`);
    assert.deepEqual(bytes, await reference(quality, 2048));
    ok(`${profile}：实际上传等于 quality=${quality}、2048×1024 的转换结果，且无元数据`, inspect(bytes, `probe-${profile}.webp`).problems.length === 0);
    sizes[profile] = bytes.length;
  }
  ok("合成测试图不同质量得到不同字节量", sizes.compact < sizes.balanced && sizes.balanced < sizes.high);
  await ev(`location.hash='#/collections/settings/entries/site'`);
  put(f.root, "probe-icon.jpg", input); await upload("favicon", join(f.root, "probe-icon.jpg")); await save(); await wait(600);
  let saved = await stored();
  assert.deepEqual(saved.get("assets/media/probe-icon.webp"), await reference(90, 512));
  ok("图标字段仍是 512×256 / quality=90，没有被普通图片的高质量覆盖", inspect(saved.get("assets/media/probe-icon.webp"), "probe-icon.webp").problems.length === 0);
  ok("CMS 设置往返仍保留导航页面 ID", /page: about/.test(saved.get("data/site.yaml").toString()));
  // Exercise the real image widget's SVG acceptance and field-level overrides.
  await ev(`location.hash='#/collections/settings/entries/site'`);
  await until(`document.querySelector('[data-key-path="social"]')`);
  await ev(`document.querySelector('[data-key-path="social"]').scrollIntoView({block:'center'})`);
  await wait(400);
  await ev(`document.querySelector('[data-key-path="social"] button[aria-expanded="false"]')?.click()`);
  await wait(400);
  await ev(`[...document.querySelectorAll('[data-key-path="social"] button')].find(button=>button.textContent.trim()==='Expand All')?.click()`);
  await wait(400);
  await ev(`document.querySelector('[data-key-path="social"]').scrollIntoView({block:'center'})`);
  await wait(400);
  await ev(`document.querySelector('[data-key-path="social"] button[aria-controls$="-item-0-body"][aria-expanded="false"]')?.click()`);
  await wait(400);
  const vector = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><defs><style>.a{fill:#feb005;}</style></defs><circle class="a" cx="10" cy="10" r="9"/></svg>';
  put(f.root, "probe-vector.svg", vector);
  await upload("social.0.icon_image", join(f.root, "probe-vector.svg")); await save(); await wait(600); saved = await stored();
  const uploadedVector = saved.get("assets/media/probe-vector.svg");
  ok("CMS 自定义图标接受真实 SVG 上传，不转成位图且可通过媒体检查", !!uploadedVector && inspect(uploadedVector, "probe-vector.svg").problems.length === 0 && /icon_image: \/media\/probe-vector.svg/.test(saved.get("data/site.yaml").toString()));
  ok("CMS 保存设置仍保留 HTTPS SVG 地址，不改成资源路径", saved.get("data/site.yaml").toString().includes("icon_image: https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/linuxdo.svg"));

  // Preserve the previous editor-component and stable-ID regression with the new host wrapper.
  await ev(`location.hash='#/collections/pages/new'`); await setTitle("LINK_ROUNDTRIP_MARKER");
  await ev(`document.querySelector('[contenteditable=true]').focus();[...document.querySelectorAll('#nc-root button')].find(b=>b.textContent.trim().startsWith('Insert')).click()`);
  await until(`[...document.querySelectorAll('[role=menuitem]')].some(b=>b.textContent.includes('链接（打开方式）'))`);
  await ev(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('链接（打开方式）')).click()`);
  await until(`document.querySelector('dialog[open] button[role=radio][value=same]')`);
  await ev(`(()=>{const dialog=document.querySelector('dialog[open]');for(const[name,value]of Object.entries({text:'另一个站点',url:'https://example.org/?a=1&b=2',title:'说明'})){const input=dialog.querySelector('[data-key-path$=":'+name+'"] input');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}dialog.querySelector('button[role=radio][value=same]').click();})()`);
  await until(`document.querySelector('dialog[open] button[role=radio][value=same]').getAttribute('aria-checked')==='true'`);
  await ev(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='Insert').click()`);
  await until(`document.querySelector('[data-component-name="x-qj-link"]')?.textContent.includes('另一个站点')`);
  await wait(500); // Upstream synchronizes rich text to Markdown with a short delay.
  await ev(`document.querySelector('[data-key-path="draft"]').scrollIntoView({block:'center'});document.querySelector('[data-key-path="draft"] [role=switch], [data-key-path="draft"] [role=checkbox], [data-key-path="draft"] input[type=checkbox]').click()`);
  await save(); await wait(600); saved = await stored();
  const created = [...saved.keys()].find((path) => /^content\/page-[a-z0-9]+\.md$/.test(path) && saved.get(path).toString().includes("LINK_ROUNDTRIP_MARKER"));
  ok("新页面保存为稳定随机 ID", !!created);
  assert.match(saved.get(created).toString(), /target="same"/);
  assert.match(saved.get(created).toString(), /lastmod: ['"]{2}/);
  ok("链接组件和空 lastmod 保留", true);
  const id = created.replace(/^content\//, "").replace(/\.md$/, "");
  await ev(`location.hash='#/collections/settings/entries/site'`); await wait(350);
  await ev(`location.hash='#/collections/pages/entries/${id}'`);
  await until(`document.querySelector('[data-component-name="x-qj-link"]')`);
  await ev(`document.querySelector('[data-component-name="x-qj-link"]').click()`);
  await until(`document.querySelector('dialog[open] button[role=radio][value=same]')`);
  ok("重新打开页面仍恢复单条链接的当前标签选项", await ev(`document.querySelector('dialog[open] button[role=radio][value=same]').getAttribute('aria-checked')==='true'`));
  await ev(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='Cancel').click()`);
  await setTitle("LINK_RENAMED_MARKER"); await save(); await wait(500); saved = await stored();
  ok("改标题仍保存同一文件 ID，不留下旧标题副本", saved.get(created)?.toString().includes("LINK_RENAMED_MARKER") && ![...saved.entries()].some(([path, bytes]) => /\.md$/.test(path) && bytes.toString().includes("LINK_ROUNDTRIP_MARKER")));
  // New comment settings must survive real CMS serialization, not just hand-written YAML.
  await ev(`location.hash='#/collections/settings/entries/comments'`);
  await until(`document.querySelector('[data-key-path="origin"] input')`);
  await ev(`(()=>{const input=document.querySelector('[data-key-path="origin"] input');input.value='https://comments.example.test';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-key-path="enabled"] [role=switch], [data-key-path="enabled"] [role=checkbox], [data-key-path="enabled"] input[type=checkbox]').click();})()`);
  await save(); await wait(500); saved = await stored();
  ok("CMS 评论配置保存为布尔开关和面板源，不混入站点/凭据", /enabled: true/.test(saved.get("data/comments.yaml").toString()) && /origin: https:\/\/comments\.example\.test/.test(saved.get("data/comments.yaml").toString()));
  // A value the build would reject must be stopped by the CMS before it reaches the repository.
  const setOrigin = (value) => ev(`(()=>{const input=document.querySelector('[data-key-path="origin"] input');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await ev(`location.hash='#/collections/posts'`); await wait(200); await ev(`location.hash='#/collections/settings/entries/comments'`);
  await until(`document.querySelector('[data-key-path="origin"] input')?.value==="https://comments.example.test"`);
  await setOrigin("https://comments.example.test/path"); await save(); await wait(500);
  const blocked = (await stored()).get("data/comments.yaml").toString();
  ok("构建会拒绝的面板源在后台保存前被拦下并给出中文原因，仓库文件不变", blocked.includes("origin: https://comments.example.test\n") && await ev(`document.querySelector('#nc-root').innerText.includes('不带路径、查询或账号')`));
  await setOrigin("https://comments.example.test"); await wait(300); // Back to the saved value; nothing left unsaved.
  await ev(`location.hash='#/collections/posts'`);
  await until(`[...document.querySelectorAll('#entry-list [role=row]')].some(row=>row.textContent.includes('中文回忆'))`);
  await ev(`[...document.querySelectorAll('#entry-list [role=row]')].find(row=>row.textContent.includes('中文回忆')).click()`);
  await until(`document.querySelector('[data-key-path="comments"]')`);
  await ev(`document.querySelector('[data-key-path="comments"] [role=switch], [data-key-path="comments"] [role=checkbox], [data-key-path="comments"] input[type=checkbox]').click()`);
  await save(); await wait(500); saved = await stored();
  ok("CMS 可保存单篇关闭留言，不改文章文件 ID", /comments: false/.test(saved.get("content/posts/a/index.md").toString()));
  await ev(`location.hash='#/collections/settings/entries/newsletter'`);
  await until(`document.querySelector('[data-key-path="username"] input')`);
  await ev(`(()=>{for(const[name,value]of Object.entries({username:'synthetic-user',heading:'合成订阅标题',text:'合成说明，不发送邮件'})){const field=document.querySelector('[data-key-path="'+name+'"] input, [data-key-path="'+name+'"] textarea');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('[data-key-path="enabled"] [role=switch], [data-key-path="enabled"] [role=checkbox], [data-key-path="enabled"] input[type=checkbox]').click();})()`);
  await save(); await wait(500); saved = await stored();
  ok("CMS 邮件订阅保存独立账号和布尔开关，不混入评论配置或凭据", /enabled: true/.test(saved.get('data/newsletter.yaml').toString()) && /username: synthetic-user/.test(saved.get('data/newsletter.yaml').toString()) && !saved.get('data/comments.yaml').toString().includes('synthetic-user'));
  await ev(`location.hash='#/collections/posts'`); await wait(200); await ev(`location.hash='#/collections/settings/entries/newsletter'`);
  await until(`document.querySelector('[data-key-path="username"] input')`);
  ok("重新打开仍保留订阅账号与中文说明", await ev(`document.querySelector('[data-key-path="username"] input').value==='synthetic-user'&&document.querySelector('[data-key-path="text"] textarea').value==='合成说明，不发送邮件'`));
  for (const [path, bytes] of saved) if (/^(content|data|assets\/media)\//.test(path)) put(f.root, path, bytes);
  assert.equal(build(f.root).status, 0);
  ok("CMS 评论配置往返后仅未关闭的文章显示入口", !read(f.root, "public/posts/a/index.html").includes("data-comments") && read(f.root, "public/posts/b/index.html").includes("data-comments"));
  ok("CMS 保存订阅后仅文章生成原生表单与精确提交策略", read(f.root,'public/posts/a/index.html').includes('embed-subscribe/synthetic-user') && read(f.root,'public/_headers').includes("form-action 'self' https://buttondown.com/api/emails/embed-subscribe/synthetic-user") && !read(f.root,'public/about/index.html').includes('newsletter__form'));
  ok("组件往返后 HTML 保持当前标签打开", tags(read(f.root, `public/${id}/index.html`)).some((tag) => tag.name === "a" && tag.attrs.href === "https://example.org/?a=1&b=2" && !tag.attrs.target));
  ok("CMS 实际保存内容可重新构建，完整产物检查通过", checkSite(join(f.root, "public")).length === 0);
  await browser.send("Page.navigate", { url: `${server.url}/admin/tools.html` }); await wait(250);
  ok("导入导出说明在 320px 无横向溢出，不要求登录或新增密钥", await ev(`document.documentElement.scrollWidth<=innerWidth && document.querySelectorAll('script').length===0 && document.body.innerText.includes('隔离目录')`));
  for (const width of [320, 1280]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.send("Page.navigate", { url: `${server.url}/admin/publishing.html` }); await wait(250);
    ok(`${width}px：发布兜底说明无脚本、无横向溢出，明确不读取实际状态`, await ev(`document.documentElement.scrollWidth<=innerWidth && document.querySelectorAll('script,iframe,form').length===0 && document.body.innerText.includes('保存到仓库不等于网站已上线') && document.body.innerText.includes('这里不读取云端状态') && document.body.innerText.includes('不会发布')`));
    if (process.env.QJ_SCREENSHOTS) {
      const shot = await browser.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(process.env.QJ_SCREENSHOTS, `cms-publishing-${width}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  blockBundle = true;
  await browser.send("Page.navigate", { url: `${server.url}/admin/` });
  await until(`document.querySelector('#qj-startup-status')?.textContent.includes('未能加载')`);
  ok("主程序加载失败有明确提示，不自动换 CDN 或显示质量已应用", await ev(`!document.querySelector('#qj-startup-status').hidden && typeof CMS==='undefined' && document.querySelector('#qj-quality-open').disabled && document.querySelector('#qj-quality-open').textContent.includes('未应用')`));
  blockBundle = false;
  for (const part of ["manual-init.js", "editor-components.js"]) {
    blockPart = part;
    await browser.send("Page.navigate", { url: `${server.url}/admin/` });
    await until(`document.querySelector('#qj-startup-status')?.textContent.includes('配套脚本不完整')`);
    ok(`${part} 缺失时停止进入，不假装质量或正文组件已应用`, await ev(`getComputedStyle(document.querySelector('#nc-root')).display==='none' && document.querySelector('#qj-quality-open').disabled`));
  }
  blockPart = ""; failInit = true;
  await browser.send("Page.navigate", { url: `${server.url}/admin/` });
  await until(`document.querySelector('#qj-startup-status')?.textContent.includes('初始化失败')`);
  ok("初始化抛错时停止进入，质量显示未应用且不能继续操作", await ev(`getComputedStyle(document.querySelector('#nc-root')).display==='none' && document.querySelector('#qj-quality-open').disabled && document.querySelector('#qj-quality-open').textContent.includes('未应用')`));
  ok("CMS 没有未捕获 JavaScript 异常", exceptions.length === 0);
  console.log(`CMS 离线回归：${count} 项通过。上传字节量：${JSON.stringify(sizes)}。仅合成内容和临时 test-repo，无真实 GitHub 写入。`);
} finally { await browser?.close(); await server?.close(); f.cleanup(); }
