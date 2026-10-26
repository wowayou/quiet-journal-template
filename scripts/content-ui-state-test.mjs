#!/usr/bin/env node
// Manual local regression for transfer selections, failure recovery and previous-package compatibility.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { startContentUI } from './content-ui.mjs';
import { exportContent, readSnapshot } from './content-transfer.mjs';
import { launchBrowser, wait } from './test/browser-client.mjs';

const root=mkdtempSync(join(tmpdir(),'qj-transfer-state-')),source=join(root,'site'),folder=join(root,'private');
mkdirSync(join(source,'content/posts'),{recursive:true});mkdirSync(join(source,'data'));mkdirSync(folder);
const text='---\ntitle: Synthetic state test\ndate: 2020-01-01T00:00:00Z\ndraft: true\n---\nNot real content';
writeFileSync(join(source,'content/posts/a.md'),text);writeFileSync(join(source,'data/site.yaml'),'title: PRIVATE_SYNTHETIC_SETTING');
let app,browser,holdInventory=false,count=0;
const held=[];
const ok=(name,condition)=>{assert.ok(condition,name);console.log(`✔ ${name}`);count++;};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try {
 app=await startContentUI({source,folder});browser=await launchBrowser();const ev=browser.evaluate;
 const auth={Authorization:`Bearer ${new URL(app.url).hash.slice(1)}`},errors=[],requests=[];
 const get=async path=>{const response=await fetch(app.origin+path,{headers:auth,signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return response.json();};
 const status=()=>get('/api/status');
 const until=async expression=>{for(let i=0;i<240;i++){if(await ev(expression))return;await wait(50);}throw Error(`UI timeout: ${expression}\n${await ev('document.body.innerText')}`);};
 const click=async selector=>{
  await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  const point=await ev(`(()=>{const element=document.querySelector(${JSON.stringify(selector)}),r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(${JSON.stringify(selector)})===element};})()`);
  assert.equal(point.hit,true,`Actual hit target: ${selector}`);
  await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
 };
 browser.on(message=>{
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
  if(message.method==='Log.entryAdded'&&/Content Security Policy|Refused to/.test(message.params.entry.text))errors.push(message.params.entry.text);
  if(message.method==='Network.requestWillBeSent'&&message.params.request.url===app.origin+'/api/action')requests.push(JSON.parse(message.params.request.postData));
  if(message.method==='Fetch.requestPaused'){
   const {requestId,request}=message.params;
   if(holdInventory&&request.method==='POST'&&JSON.parse(request.postData).action==='inventory')held.push(requestId);
   else browser.send('Fetch.continueRequest',{requestId}).catch(error=>errors.push(error.message));
  }
 });
 await browser.send('Network.setBlockedURLs',{urls:['https://*']});
 await browser.send('Page.navigate',{url:app.url});await until(`document.querySelector('#inventory')?.textContent.includes('内容设置 1 份')&&!document.querySelector('#settings').disabled`);
 const release=async()=>{holdInventory=false;while(held.length)await browser.send('Fetch.continueRequest',{requestId:held.shift()});};
 const pendingSelection=async()=>{for(let i=0;i<100&&!held.length;i++)await wait(20);assert.equal(held.length,1);};
 const summary=async(settings)=>ev(`document.querySelector('#settings').checked===${settings}&&document.querySelector('#inventory').textContent.includes('内容设置 ${settings?1:0} 份')&&!document.querySelector('#settings').disabled`);
 await browser.send('Fetch.enable',{patterns:[{urlPattern:app.origin+'/api/action',requestStage:'Request'}]});
 // Keep a real POST in flight before reservation; query history must not interpret it as rejection.
 holdInventory=true;await click('#settings');await pendingSelection();
 await click('#refresh-task');
 ok('摘要请求尚未受理时核对状态，不回填旧范围或解锁导出',await ev(`!document.querySelector('#settings').checked&&document.querySelector('#settings').disabled&&document.querySelector('#export').disabled`));
 await release();await until(`!document.querySelector('#settings').disabled`);
 ok('快速摘要完成后的选择和摘要都排除设置',await summary(false));
 await click('#settings');await until(`document.querySelector('#inventory').textContent.includes('内容设置 1 份')&&!document.querySelector('#settings').disabled`);
 ok('再次选择包含设置可恢复一致的摘要',await summary(true));
 // Actual bounded workload, no fake delay in processing. The pre-reservation POST is separately held above.
 const fields=Array.from({length:120},(_,i)=>`field_${i}: "synthetic value ${i}"`).join('\n');
 const extra='---\ntitle: Synthetic\ndate: 2020-01-01T00:00:00Z\ndraft: true\n'+fields+'\n---\nSynthetic';
 for(let i=0;i<1600;i++)writeFileSync(join(source,`content/posts/extra-${i}.md`),extra);
 await click('#settings');await until(`!document.querySelector('#settings').disabled`);
 ok('慢摘要跨过状态查询，用户排除设置不会被旧成功覆盖',await summary(false));
 await click('#import-mode');await click('#import-view details summary');await click('#refresh');await click('#export-mode');
 await browser.send('Page.reload');await until(`document.querySelector('#session').textContent.includes('已连接')&&!document.querySelector('#settings').disabled`);
 ok('慢摘要后手动核对及整页刷新仍保留排除设置',await summary(false));
 await ev(`document.querySelector('#format').value='directory'`);await click('#consent');await click('#export');
 await until(`document.querySelector('#result').textContent.includes('导出完成')&&!document.querySelector('#settings').disabled`);
 const exported=(await status()).tasks.filter(task=>task.action==='export').at(-1);
 const payload=readSnapshot(exported.result.output);
 ok('实际导出请求和清单均排除设置，仍保留全部文章',requests.filter(request=>request.action==='export').at(-1).includeSettings===false&&payload.manifest.files.length===1601&&!payload.manifest.files.some(file=>file.path.startsWith('data/')));
 if(process.env.QJ_SCREENSHOTS){mkdirSync(process.env.QJ_SCREENSHOTS,{recursive:true});const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(process.env.QJ_SCREENSHOTS,'state-scope-consistent.png'),Buffer.from(shot.data,'base64'));}
 for(let i=0;i<1600;i++)rmSync(join(source,`content/posts/extra-${i}.md`));
 await click('#settings');await until(`document.querySelector('#inventory').textContent.includes('内容设置 1 份')&&!document.querySelector('#settings').disabled`);
 await browser.send('Fetch.disable');
 // Fixed-layout lists must preserve old first-level snapshots, including after service restart.
 const legacy=join(folder,'legacy');exportContent({source,output:legacy,includePrivate:true});
 await click('#import-mode');await click('#import-view details summary');await click('#refresh');await wait(100);
 const selected=relative(folder,exported.result.output).replaceAll('\\','/');
 ok('导出目录与旧一层包都列出，不需手填路径',(await status()).snapshots.includes(selected)&&(await status()).snapshots.includes('legacy')&&await ev(`[...document.querySelector('#snapshot').options].some(option=>option.value===${JSON.stringify(selected)})`));
 await ev(`document.querySelector('#snapshot').value=${JSON.stringify(selected)};document.querySelector('#snapshot').dispatchEvent(new Event('change'))`);
 await until(`!document.querySelector('#review').hidden&&!document.querySelector('#inspect').disabled`);
 ok('选择刚导出的目录自动检查，并明确实际包身份',await ev(`document.querySelector('#output').textContent.includes(${JSON.stringify(exported.result.output)})`));
 await click('#import-consent');await click('#import');await until(`document.querySelector('#result').textContent.includes('已恢复到新的隔离目录')`);
 const restored=(await status()).tasks.filter(task=>task.action==='import').at(-1);
 ok('列表导入保留原字节，当前博客不覆盖且比较继续保留',readFileSync(join(restored.result.output,'content/posts/a.md'),'utf8')===text&&readFileSync(join(source,'content/posts/a.md'),'utf8')===text&&await ev(`!document.querySelector('#review').hidden`));
 const missing=join(root,'missing');await ev(`document.querySelector('#directory-path').value=${JSON.stringify(missing)}`);await click('#select-directory');await until(`document.querySelector('#result').textContent.includes('目录不存在')&&!document.querySelector('#select-directory').disabled`);
 const failed=(await status()).tasks.filter(task=>task.action==='inspect').at(-1);
 ok('不存在的目录形成可查询失败任务，不保留旧比较确认',failed.status==='failed'&&failed.snapshot===missing&&await ev(`document.querySelector('#review').hidden&&document.querySelector('#import').disabled&&!document.querySelector('#copy').offsetParent`));
 const failedTaskCount=(await status()).tasks.length;
 for(let i=0;i<2;i++){await browser.send('Page.reload');await until(`document.querySelector('#session').textContent.includes('已连接')&&document.querySelector('#result').textContent.includes('目录不存在')`);}
 ok('失败后的多次整页刷新保留失败包身份、不复活旧成功或重发',(await status()).tasks.length===failedTaskCount&&await ev(`document.querySelector('#review').hidden&&document.querySelector('#import').disabled&&document.querySelector('#output').textContent.includes(${JSON.stringify(missing)})`));
 // Restart must still list directory output; task history alone is not the locator.
 await app.close();app=await startContentUI({source,folder});auth.Authorization=`Bearer ${new URL(app.url).hash.slice(1)}`;
 await browser.send('Page.navigate',{url:app.url});await until(`document.querySelector('#session').textContent.includes('已连接')&&!document.querySelector('#settings').disabled`);
 await click('#import-mode');await click('#import-view details summary');await click('#refresh');await wait(100);
 ok('服务重启仍找到嵌套目录包和旧包，清空过期任务身份',(await status()).snapshots.includes(selected)&&(await status()).snapshots.includes('legacy')&&(await status()).tasks.length===1);
 await ev(`document.querySelector('#snapshot').value='legacy';document.querySelector('#snapshot').dispatchEvent(new Event('change'))`);await until(`!document.querySelector('#review').hidden&&!document.querySelector('#inspect').disabled`);
 const original=readFileSync(join(legacy,'files/content/posts/a.md')),changed=Buffer.from('---\ntitle: Another valid package\ndraft: false\n---\nDifferent');
 writeFileSync(join(legacy,'files/content/posts/a.md'),changed);const manifest=JSON.parse(readFileSync(join(legacy,'manifest.json')));const entry=manifest.files.find(entry=>entry.path==='content/posts/a.md');entry.bytes=changed.length;entry.sha256=hash(changed);writeFileSync(join(legacy,'manifest.json'),JSON.stringify(manifest));readSnapshot(legacy);
 await click('#import-consent');await click('#import');await until(`document.querySelector('#result').textContent.includes('已改变')&&!document.querySelector('#select-directory').disabled`);
 ok('列表衔接与刷新修复不绕过旧确认哈希；有效换包仍拒绝',await ev(`document.querySelector('#review').hidden&&document.querySelector('#import').disabled`)&&readFileSync(join(source,'content/posts/a.md'),'utf8')===text);
 writeFileSync(join(legacy,'files/content/posts/a.md'),original);entry.bytes=original.length;entry.sha256=hash(original);writeFileSync(join(legacy,'manifest.json'),JSON.stringify(manifest));
 // Latest inventory failure must not reuse an earlier successful summary or automatically retry on reload.
 await click('#export-mode');writeFileSync(join(source,'content/unsafe.js'),'Synthetic code');await click('#settings');await until(`document.querySelector('#result').textContent.includes('未完成')&&!document.querySelector('#settings').disabled`);
 ok('最新摘要失败清除旧摘要，不能按旧范围导出',await ev(`document.querySelector('#export').disabled&&document.querySelector('#inventory').textContent.includes('未完成')`));
 const beforeReload=(await status()).tasks.length;await browser.send('Page.reload');await until(`document.querySelector('#session').textContent.includes('已连接')&&document.querySelector('#result').textContent.includes('未完成')`);
 ok('摘要失败后刷新仍禁导出、不偷偷重试',(await status()).tasks.length===beforeReload&&await ev(`document.querySelector('#export').disabled&&document.querySelector('#inventory').textContent.includes('未完成')`));
 rmSync(join(source,'content/unsafe.js'));await click('#export-mode');await click('#settings');await until(`!document.querySelector('#settings').disabled&&document.querySelector('#inventory').textContent.includes('内容设置 1 份')`);
 ok('修正来源后重新选择可恢复，不遗留活动锁',await summary(true));
 ok('新状态回归无脚本/CSP 异常',errors.length===0);
 console.log(`内容工具状态浏览器回归：${count} 项通过；仅临时合成内容与本机请求。`);
} finally {holdInventory=false;for(const requestId of held)await browser?.send('Fetch.continueRequest',{requestId}).catch(()=>{});await browser?.close();await app?.close();rmSync(root,{recursive:true,force:true});}
