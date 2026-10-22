import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { exportContent, readSnapshot, inspectContent, importContent, inventoryContent } from '../content-transfer.mjs';
import { packSnapshot, unpackSnapshot } from '../content-zip.mjs';
import { startContentUI } from '../content-ui.mjs';
import yazl from 'yazl';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { request } from 'node:http';
async function using(fn, options = {}) {
  const root=mkdtempSync(join(tmpdir(),'qj-v2-')),source=join(root,'site'),folder=join(root,'private');mkdirSync(join(source,'content'),{recursive:true});mkdirSync(folder);
  writeFileSync(join(source,'content/a.md'),'---\ntitle: A\ndraft: true\n---\nOriginal');
  let app;
  try { app=await startContentUI({source,folder,...options});const auth={Authorization:`Bearer ${new URL(app.url).hash.slice(1)}`};
    const submit=async data=>{const response=await fetch(`${app.origin}/api/action`,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({id:randomBytes(16).toString('hex'),...data})});return {status:response.status,body:await response.json()};};
    const wait=async id=>{for(let i=0;i<120;i++){const info=await(await fetch(`${app.origin}/api/status`,{headers:auth})).json();const task=info.tasks.find(t=>t.id===id);if(task&&task.status!=='running')return await (await fetch(`${app.origin}/api/task?id=${id}`,{headers:auth})).json();await new Promise(done=>setTimeout(done,25));}throw Error('timeout');};
    await fn({root,source,folder,app,auth,submit,wait});
  } finally {await app?.close();rmSync(root,{recursive:true,force:true});}
}
test('ZIP 正向：目录→ZIP→目录保留字节/中文，既有目标不覆盖',()=>using(async({root,source,folder})=>{
  writeFileSync(join(source,'content/中文.md'),'---\ntitle: 中文\n---\n内容');
  exportContent({source,output:join(folder,'snapshot'),includePrivate:true});
  const zip=await packSnapshot(join(folder,'snapshot'),join(folder,'package.zip'));
  const output=await unpackSnapshot(zip.output,join(folder,'unpacked'));assert.deepEqual(readSnapshot(output).manifest,readSnapshot(join(folder,'snapshot')).manifest);
  assert.equal(readFileSync(join(output,'files/content/中文.md'),'utf8'),readFileSync(join(source,'content/中文.md'),'utf8'));
  await assert.rejects(()=>packSnapshot(join(folder,'snapshot'),zip.output),/全新/);
  await assert.rejects(()=>unpackSnapshot(zip.output,output),/全新/);
}));
test('ZIP 拒绝路径穿越、主动代码、重复路径、特殊文件和高压缩比，清理输出',()=>using(async({folder})=>{
  const make=async(name,entries)=>{const archive=new yazl.ZipFile();for(const entry of entries)archive.addBuffer(entry.bytes||Buffer.from('x'),entry.name,{mode:entry.mode||0o100600,compress:entry.compress||false});const output=join(folder,name);const p=pipeline(archive.outputStream,createWriteStream(output));archive.end();await p;return output;};
  for(const [index,entries] of [
    [{name:'files/content/.env'}],[{name:'files/content/a.js'}],[{name:'files/assets/media/a.svg',bytes:Buffer.from('<svg onload="x"/>')}],
    [{name:'manifest.json'},{name:'manifest.json'}],[{name:'files/content/a.md',mode:0o120777}],
    [{name:'files/content/a.md',bytes:Buffer.alloc(2*1024**2),compress:true}],
  ].entries()) {const zip=await make(`bad-${index}.zip`,entries);const output=join(folder,`bad-out-${index}`);await assert.rejects(()=>unpackSnapshot(zip,output));assert.ok(!existsSync(output));}
}));
test('检查确认绑定源和目标，替换有效内容包或修改本站都拒绝旧确认',()=>using(async({root,source,folder,submit,wait})=>{
  const snapshot=join(folder,'snapshot');exportContent({source,output:snapshot,includePrivate:true});
  let task=await submit({action:'inspect',snapshot});let review=await wait(task.body.id);assert.equal(review.status,'completed');
  const donor=join(root,'donor');mkdirSync(join(donor,'content'),{recursive:true});writeFileSync(join(donor,'content/a.md'),'---\ntitle: B\ndraft: false\n---\nDifferent valid content');
  rmSync(snapshot,{recursive:true});exportContent({source:donor,output:snapshot,includePrivate:true});
  assert.ok(readFileSync(join(source,'content/a.md'),'utf8').includes('Original'));
  task=await submit({action:'import',reviewId:review.id,includePrivate:true});let result=await wait(task.body.id);assert.equal(result.status,'failed');assert.match(result.error,/改变|变化/);
  task=await submit({action:'inspect',snapshot});review=await wait(task.body.id);writeFileSync(join(source,'content/new.md'),'New target-only file');
  task=await submit({action:'import',reviewId:review.id,includePrivate:true});result=await wait(task.body.id);assert.equal(result.status,'failed');
}));
test('导入复制期间源包替换或比较目标变化会撤销输出，不覆盖当前博客',()=>using(async({source,folder})=>{
 const snapshot=join(folder,'snapshot');writeFileSync(join(source,'content/b.md'),'Second synthetic file');exportContent({source,output:snapshot,includePrivate:true});
 for(const changed of ['source','target']) {
  const review=inspectContent({source:snapshot,compare:source}),output=join(folder,`mid-copy-${changed}`);let mutated=false;
  assert.throws(()=>importContent({source:snapshot,compare:source,review,output,includePrivate:true,progress(state){
   if(state.stage==='copying'&&state.path&&state.current===1&&!mutated){mutated=true;
    if(changed==='source'){rmSync(snapshot,{recursive:true});writeFileSync(join(source,'content/a.md'),'Another valid snapshot');exportContent({source,output:snapshot,includePrivate:true});}
    else writeFileSync(join(source,'content/target-only.md'),'Concurrent local change');
   }
  }}),/改变|变化/);
  assert.equal(mutated,true);assert.equal(existsSync(output),false);assert.equal(readFileSync(join(source,'content/b.md'),'utf8'),'Second synthetic file');
 }
}));
test('摘要识别大写 Markdown，关闭设置时不混入编辑器或订阅配置',()=>using(async({source})=>{
 mkdirSync(join(source,'data'));writeFileSync(join(source,'content/UPPER.MD'),'---\ntitle: Upper\ndraft: true\n---\nSynthetic');
 writeFileSync(join(source,'data/site.yaml'),'title: Synthetic');writeFileSync(join(source,'data/editor.yaml'),'repo: PRIVATE_ONLY');writeFileSync(join(source,'data/newsletter.yaml'),'username: PRIVATE_ONLY');
 const all=inventoryContent({source}),content=inventoryContent({source,includeSettings:false});assert.equal(all.counts.pages,2);assert.equal(all.counts.images,0);assert.equal(all.counts.drafts,2);assert.equal(all.counts.settings,1);assert.equal(content.counts.settings,0);
}));
test('文字比较：大写 Markdown 与小写一致，仅返回已检查文件且拒绝源包改变',()=>using(async({source,folder,app,auth,submit,wait})=>{
 const path='content/UPPER.MD',text='---\ntitle: Upper\ndraft: true\n---\n<script>合成文字，不执行</script>';
 writeFileSync(join(source,path),text);
 const snapshot=join(folder,'snapshot');exportContent({source,output:snapshot,includePrivate:true});
 writeFileSync(join(source,path),'Changed target text');
 const checked=await submit({action:'inspect',snapshot}),review=await wait(checked.body.id);assert.equal(review.status,'completed',review.error);
 const preview=()=>fetch(`${app.origin}/api/file?id=${review.id}&path=${encodeURIComponent(path)}`,{headers:auth});
 const response=await preview();assert.equal(response.status,200);assert.deepEqual(await response.json(),{path,incoming:text,current:'Changed target text'});
 assert.equal((await fetch(`${app.origin}/api/file?id=${review.id}&path=content%2Funreviewed.md`,{headers:auth})).status,400);
 writeFileSync(join(snapshot,'files',path),'Changed snapshot text');
 assert.equal((await preview()).status,409);assert.equal(readFileSync(join(source,path),'utf8'),'Changed target text');
}));
test('任务 ID 幂等、同一时刻一任务、报告及 ZIP 下载无需另一次写入',()=>using(async({folder,app,auth,submit,wait})=>{
  const id=randomBytes(16).toString('hex');const data={id,action:'export',includePrivate:true,format:'zip'};
  const a=await submit(data),b=await submit(data);assert.equal(a.body.id,b.body.id);
  const different=await submit({...data,format:'directory'});assert.equal(different.status,409);
  const concurrent=await submit({action:'inventory'});assert.equal(concurrent.status,409);
  const result=await wait(id);assert.equal(result.status,'completed',result.error);
  const duplicate=await submit(data);assert.equal(duplicate.body.id,id);assert.equal(duplicate.body.status,'completed');
  const response=await fetch(`${app.origin}/api/download?id=${id}`,{headers:auth});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');const zip=Buffer.from(await response.arrayBuffer());assert.deepEqual(zip,readFileSync(result.result.output));
  const report=await(await fetch(`${app.origin}/api/report?id=${id}`,{headers:auth})).json();assert.equal(report.operation,'export');
  const uploadId=randomBytes(16).toString('hex');const sent=await fetch(`${app.origin}/api/upload?id=${uploadId}`,{method:'POST',headers:{...auth,'Content-Type':'application/zip'},body:zip});assert.equal(sent.status,202);
  const checked=await wait(uploadId);assert.equal(checked.status,'completed',checked.error);assert.equal(checked.result.conflicts,0);
  const ticketResponse=await fetch(`${app.origin}/api/download-ticket?id=${id}`,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'{}'});const ticket=await ticketResponse.json();
  assert.equal((await fetch(app.origin+ticket.url)).status,403);
  const cookie=ticketResponse.headers.get('set-cookie').split(';')[0];
  const native=await fetch(app.origin+ticket.url,{headers:{Cookie:cookie}});assert.equal(native.status,200);assert.deepEqual(Buffer.from(await native.arrayBuffer()),zip);
  assert.equal((await fetch(app.origin+ticket.url,{headers:{Cookie:cookie}})).status,403);
}));
test('任务超时限制是实际停止条件，较短本地限时可取消且不触碰原内容',()=>using(async({source,submit,wait})=>{
 const before=readFileSync(join(source,'content/a.md'));
 const job=await submit({action:'inventory'});const task=await wait(job.body.id);
 assert.equal(task.status,'cancelled');assert.deepEqual(readFileSync(join(source,'content/a.md')),before);
},{taskTimeoutMs:1}));

test('未完成的本机上传仍能查询和取消，断线/超时清理且不遗留活动锁',()=>using(async({source,folder,app,auth,submit,wait})=>{
 const before=readFileSync(join(source,'content/a.md'));
 for(const action of ['cancel','disconnect']) {
  const id=randomBytes(16).toString('hex'),upload=request(`${app.origin}/api/upload?id=${id}`,{method:'POST',headers:{...auth,'Content-Type':'application/zip'}});
  upload.on('error',()=>{});upload.on('response',response=>response.resume());upload.write('PK');
  try {
   for(let i=0;i<80;i++){const status=await(await fetch(`${app.origin}/api/status`,{headers:auth})).json();if(status.active===id)break;await new Promise(done=>setTimeout(done,10));}
   const receiving=await(await fetch(`${app.origin}/api/task?id=${id}`,{headers:auth})).json();assert.equal(receiving.stage,'receiving');
   assert.equal((await submit({action:'inventory'})).status,409);
   if(action==='cancel')await submit({action:'cancel',id});else upload.destroy();
   const finished=await wait(id);assert.equal(finished.status,action==='cancel'?'cancelled':'failed');assert.equal((await(await fetch(`${app.origin}/api/status`,{headers:auth})).json()).active,undefined);
   assert.deepEqual(readdirSync(folder),[]);assert.deepEqual(readFileSync(join(source,'content/a.md')),before);
  }finally{upload.destroy();}
 }
 const next=await submit({action:'inventory'});assert.equal((await wait(next.body.id)).status,'completed');
}));
test('慢上传超时是实际取消条件，体积提前拒绝不创建输出',()=>using(async({folder,app,auth,wait})=>{
  const uid = randomBytes(16).toString('hex');
  const oversized=await new Promise((done,reject)=>{const req=request(`${app.origin}/api/upload?id=${uid}`,{method:'POST',headers:{...auth,'Content-Type':'application/zip','Content-Length':String(1024**3+8*1024**2+1)}},response=>{response.resume();done(response.statusCode);});req.on('error',reject);req.end();});
 assert.equal(oversized,413);assert.deepEqual(readdirSync(folder),[]);
 const id=randomBytes(16).toString('hex'),upload=request(`${app.origin}/api/upload?id=${id}`,{method:'POST',headers:{...auth,'Content-Type':'application/zip'}});
 upload.on('error',()=>{});upload.on('response',response=>response.resume());upload.write('PK');
 try {const finished=await wait(id);assert.equal(finished.status,'failed');assert.match(finished.error,/abort|超时/i);assert.deepEqual(readdirSync(folder),[]);}finally{upload.destroy();}
},{taskTimeoutMs:150}));
test('内容操作可取消，已完成后取消不把成功结果改为失败',()=>using(async({submit,wait})=>{
 const job=await submit({action:'inventory'});await submit({action:'cancel',id:job.body.id});const task=await wait(job.body.id);assert.ok(['completed','cancelled'].includes(task.status));
 const after=await submit({action:'cancel',id:job.body.id});assert.equal(after.body.status,task.status);
}));
