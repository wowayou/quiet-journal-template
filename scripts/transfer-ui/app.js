const $ = id => document.getElementById(id);
const KEY = 'quiet-journal:content-session';
let token = location.hash.slice(1);
try { if (token) sessionStorage.setItem(KEY, token); else token = sessionStorage.getItem(KEY) || ''; } catch { /* Current page still works; reload cannot recover session. */ }
history.replaceState(null, '', '/');
let connected = false, active, review, completed, inventory, mode = 'export', page = 0, lastFocus, polling = false, shownTaskId, refreshVersion = 0;
let observing = !document.hidden;
const id = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
const size = bytes => bytes < 1024 ? `${bytes} 字节` : bytes < 1024 ** 2 ? `${(bytes/1024).toFixed(1)} KiB` : `${(bytes/1024**2).toFixed(1)} MiB`;
async function api(path, data, credentials = 'omit') {
  const response = await fetch(path, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), credentials, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || '本机操作失败。'); return value;
}
function controls() {
  for (const name of ['export','settings','format','snapshot','zip-file','directory-path','select-directory','inspect']) $(name).disabled = !connected || !!active;
  for (const name of ['refresh', 'refresh-task']) $(name).disabled = !/^[a-f0-9]{64}$/.test(token);
  $('export').disabled ||= !$('consent').checked || !inventory || inventory.includeSettings !== $('settings').checked;
  $('import').disabled = !connected || !!active || !review || !$('import-consent').checked;
  $('cancel').hidden = !active;
  for (const name of ['export-mode','import-mode']) $(name).disabled = !!active;
  $('result-section').setAttribute('aria-busy', String(!!active));
}
function switchMode(next) {
  mode = next;
  for (const name of ['export','import']) { $(`${name}-view`).hidden = name !== next; $(`${name}-mode`).setAttribute('aria-pressed', String(name===next)); $(`${name}-mode`).classList.toggle('selected',name===next); }
}
function statbox(node, counts, bytes) {
  node.replaceChildren();
  for (const [number,label] of [[counts.posts,`文章 · 含 ${counts.drafts} 篇草稿`],[counts.pages,'普通页面'],[counts.images,'图片与图标'],[size(bytes),'内容大小']]) {
    const box=document.createElement('div'),strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=number;span.textContent=label;box.append(strong,span);node.append(box);
  }
  const detail = document.createElement('p'); detail.className = 'hint'; detail.textContent = `内容设置 ${counts.settings} 份 · 未来日期 ${counts.future} 篇；所有文件原样保留。`; node.append(detail);
  if (counts.notices?.length) { const p=document.createElement('p');p.className='hint';p.textContent=`${counts.notices.length} 个文件的公开状态不能识别；全部原样保留，详情见完整报告。`;node.append(p); }
}
function renderFiles() {
  $('files').replaceChildren(); if(!review)return;
  const items=review.result.comparison.filter(e=>($('filter').value==='all'||($('filter').value==='conflict'?e.status==='conflict':e.status!=='same'))&&e.path.toLowerCase().includes($('search').value.toLowerCase()));
  page=Math.max(0,Math.min(page,Math.ceil(items.length/40)-1));
  for(const item of items.slice(page*40,(page+1)*40)) {
    const li=document.createElement('li'),path=document.createElement('span'),tag=document.createElement('span');path.textContent=item.path;tag.textContent=item.reason?'路径冲突':{add:'可新增',same:'相同',conflict:'内容不同'}[item.status];tag.title=item.reason||'';tag.className='tag';li.append(path,tag);
    if (/\.(md|yaml)$/i.test(item.path)) { const button=document.createElement('button');button.textContent='查看文字';button.addEventListener('click',async()=>{try{const data=await api(`/api/file?id=${review.id}&path=${encodeURIComponent(item.path)}`);lastFocus=button;$('diff-title').textContent=item.path;$('diff-current').textContent=data.current;$('diff-incoming').textContent=data.incoming;$('diff').showModal();}catch(e){notice(e.message);}});li.append(button); }
    $('files').append(li);
  }
  $('page-number').textContent=items.length?`第 ${page+1} / ${Math.ceil(items.length/40)} 页 · ${items.length} 项`:'没有需要关注的文件';$('previous').disabled=page===0;$('next').disabled=(page+1)*40>=items.length;
}
function showReview(task) {
  review=task;$('review').hidden=false;$('import-consent').checked=false;
  statbox($('package-summary'),task.result.counts,task.result.bytes);
  const counts={add:0,same:0,conflict:0};for(const item of task.result.comparison)counts[item.status]++;
  $('comparison').textContent=`可新增 ${counts.add} · 相同 ${counts.same} · 内容不同 ${counts.conflict} · 本站独有 ${task.result.targetOnly}（不会删除）`;
  page=0;renderFiles();controls();
}
function showInventory(task) {
  $('settings').checked = task.includeSettings;
  inventory = task.status === 'completed' ? task.result : undefined;
  if (inventory) statbox($('inventory'), inventory.counts, inventory.bytes);
  else $('inventory').textContent = task.status === 'running' ? '正在检查本次选择的内容范围…' : '内容摘要未完成，请重新检查后再导出。';
}
function notice(text) { $('result-section').hidden=false;$('result').textContent=text; }
function apply(task) {
  refreshVersion++;
  if (task.action === 'inventory') showInventory(task);
  if (task.status==='running') {active=task;completed=undefined;$('copy').hidden=true;$('download').hidden=true;$('output').textContent=task.snapshot?`检查的内容包：${task.snapshot}`:'';notice(`${{checking:'检查中',copying:'恢复文件中',packing:'打包中',unpacking:'检查解包中',receiving:'接收本机文件中',cancelling:'正在取消'}[task.stage]||'处理中'}${task.total?` · ${task.current||0}/${task.total}`:''}${task.path?` · ${task.path}`:''}`);controls();return;}
  active=undefined;shownTaskId=task.id;
  if(task.status!=='completed'){
    completed=undefined;
    if(['inspect','upload'].includes(task.action)||(task.action==='import'&&/改变|变化/.test(task.error||''))){review=undefined;$('review').hidden=true;}
    $('copy').hidden=true;$('download').hidden=true;$('output').textContent=task.snapshot?`检查的内容包：${task.snapshot}`:'';
    notice(`${task.status==='cancelled'?'已取消':'未完成'}：${task.error||'请检查任务结果。'} 不会自动重试。`);
    $('recovery').textContent='当前博客没有改变；若进程意外结束，请核对临时目录中的清单/报告。';$('result-section').focus();controls();return;
  }
  if(task.action==='inventory'){if(!completed)$('result-section').hidden=true;}
  else if(['inspect','upload'].includes(task.action)){completed=undefined;$('copy').hidden=true;$('download').hidden=true;$('output').textContent=`检查的内容包：${task.result.snapshot}`;switchMode('import');showReview(task);notice(`完整性检查通过：${task.result.files} 个文件，${size(task.result.bytes)}。请查看比较结果后确认。`);$('review').focus();}
  else {completed=task;notice(`${task.action==='export'?'导出完成':'已恢复到新的隔离目录，当前博客没有改变'}：${task.result.files} 个文件，${size(task.result.bytes)}。`);$('output').textContent=`保存位置：${task.result.output}`;$('copy').hidden=false;$('download').hidden=task.result.format!=='zip';$('recovery').textContent=task.action==='export'?'将文件保存在私人位置。这不是完整 Git 或评论数据库备份。':'比较结果继续保留。请人工合并、运行构建检查，再决定发布。';$('result-section').focus();}
  controls();
}
async function refresh() {
  const version = ++refreshVersion, pending = active;
  const data = await api('/api/status');
  if (version !== refreshVersion) return data;
  const history = [...data.tasks].reverse();
  // A response before POST is accepted is not proof that the operation was rejected.
  if(pending&&!data.active&&!data.tasks.some(task=>task.id===pending.id)){
    if (!pending.submitting) active=undefined;
    controls();return data;
  }
  const latest=history[0];
  const task=data.active?data.tasks.find(task=>task.id===data.active):pending?data.tasks.find(task=>task.id===pending.id):latest?.action==='inventory'&&latest.status!=='completed'?latest:history.find(task=>task.action!=='inventory')||latest;
  const checked=history.find(task=>['inspect','upload'].includes(task.action));
  const staleImport=task?.action==='import'&&task.status!=='completed'&&/改变|变化/.test(task.error||'');
  const needsReview=!review&&checked?.status==='completed'&&!staleImport;
  const needsTask=task&&(task.status==='running'||pending||task.id!==shownTaskId);
  const resolvedTask=needsTask&&task.status==='completed'?await api(`/api/task?id=${task.id}`):task;
  const resolvedReview=needsReview?(needsTask&&checked.id===resolvedTask?.id&&resolvedTask.status==='completed'?resolvedTask:await api(`/api/task?id=${checked.id}`)):undefined;
  if (version !== refreshVersion) return data;
  connected=true;$('source').textContent=data.source;$('folder').textContent=data.folder;$('session').textContent='已连接本机 · 所有内容操作留在这台电脑';
  const selected=$('snapshot').value;$('snapshot').replaceChildren(new Option('请选择目录快照',''),...data.snapshots.map(name=>new Option(name,name)));$('snapshot').value=selected;
  // Only the latest inventory, including running/failed tasks, owns the export scope.
  const inv=history.find(task=>task.action==='inventory');
  if(inv)showInventory(inv);
  if(resolvedReview){switchMode('import');showReview(resolvedReview);}
  if(needsTask)apply(resolvedTask);
  controls();return data;
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    for(let count=0;active&&observing&&count<130;count++) { await new Promise(done=>setTimeout(done,1000)); if(!observing)break; try{await refresh();}catch(e){notice(`连接中断：${e.message} 请刷新核对原任务，勿重复发送写操作。`);return;} }
    if(active&&observing)notice('等待达到上限，请点击核对任务，不会自动重发。');
  } finally { polling=false; }
}
async function run(action, extra={}) {
  const operation=id();
  try {
    if(active)return;if(action==='inspect'){review=undefined;$('review').hidden=true;}
    active={id:operation,action,...extra,...(action==='inventory'?{includeSettings:extra.includeSettings??$('settings').checked}:{}),status:'running',stage:'checking',submitting:true};apply(active);
    const task=await api('/api/action',{id:operation,action,...extra,...(action==='inventory'?{includeSettings:active.includeSettings}:{})});
    if(active?.id===operation)apply(task);await poll();
  }catch(e){if(active?.id!==operation)return;active.submitting=false;notice(e.message);try{await refresh();if(active)await poll();}catch(recovery){$('recovery').textContent=`无法核对任务：${recovery.message} 请恢复连接后刷新，勿重复写入。`;} controls();}
}
async function upload(file) {
  if(!file||active)return;
  if(!file.name.toLowerCase().endsWith('.zip')){notice('请选择 ZIP 内容包；目录快照可使用下面的目录入口。');return;}
  const operation=id();active={id:operation,action:'upload',status:'running',stage:'receiving',submitting:true};apply(active);review=undefined;$('review').hidden=true;
  try {const response=await fetch(`/api/upload?id=${operation}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/zip'},body:file,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(120000)});const task=await response.json();if(!response.ok)throw new Error(task.error);if(active?.id===operation)apply(task);await poll();}catch(e){if(active?.id!==operation)return;active.submitting=false;notice(`接收未完成：${e.message} 请刷新核对原任务。`);try{await refresh();if(active)await poll();}catch(recovery){$('recovery').textContent=`无法核对任务：${recovery.message} 请恢复连接后刷新，勿重复写入。`;} controls();}
}
async function download(path,name) {try{const response=await fetch(path,{headers:{Authorization:`Bearer ${token}`},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error((await response.json()).error);const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){notice(e.message);}}
$('export-mode').onclick=()=>switchMode('export');$('import-mode').onclick=()=>switchMode('import');$('consent').onchange=controls;$('import-consent').onchange=controls;
$('settings').onchange=()=>{inventory=undefined;run('inventory',{includeSettings:$('settings').checked});};
$('export').onclick=()=>!$('export').disabled&&run('export',{includePrivate:$('consent').checked,includeSettings:inventory.includeSettings,format:$('format').value});
$('snapshot').onchange=()=>{if($('snapshot').value)run('inspect',{snapshot:$('snapshot').value});};
$('select-directory').onclick=()=>run('inspect',{snapshot:$('directory-path').value});
$('inspect').onclick=()=>review&&run('inspect',{snapshot:review.result.snapshot});
$('import').onclick=()=>review&&run('import',{reviewId:review.id,includePrivate:$('import-consent').checked});
for(const name of ['refresh','refresh-task'])$(name).onclick=()=>refresh().then(()=>active&&poll()).catch(e=>notice(e.message));
document.addEventListener('visibilitychange',()=>{observing=!document.hidden;if(observing&&active)refresh().then(()=>active&&poll()).catch(e=>notice(e.message));});
window.addEventListener('pagehide',()=>{observing=false;});
window.addEventListener('pageshow',event=>{observing=!document.hidden;if(event.persisted)refresh().then(()=>active&&poll()).catch(e=>notice(e.message));});
$('zip-file').onchange=()=>upload($('zip-file').files[0]);
$('drop').ondragover=e=>e.preventDefault();$('drop').ondrop=e=>{e.preventDefault();upload(e.dataTransfer.files[0]);};
for(const name of ['filter','search'])$(name).addEventListener(name==='search'?'input':'change',()=>{page=0;renderFiles();});
$('previous').onclick=()=>{page--;renderFiles();};$('next').onclick=()=>{page++;renderFiles();};
$('report').onclick=()=>review&&download(`/api/report?id=${review.id}`,'journal-comparison.json');
$('download').onclick=async()=>{if(!completed)return;try{const ticket=await api(`/api/download-ticket?id=${completed.id}`,{},'same-origin');const a=document.createElement('a');a.href=ticket.url;a.download='journal-content.zip';a.click();$('recovery').textContent='已交给浏览器下载，请查看浏览器下载列表；不会将大包载入页面内存。';}catch(e){notice(e.message);}};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(completed.result.output);$('recovery').textContent='保存路径已复制。';}catch{$('recovery').textContent='无法使用剪贴板，请选中上方路径复制。';}};
$('cancel').onclick=()=>{if(!active)return;const operation=active.id;return api('/api/action',{action:'cancel',id:operation}).then(task=>{if(active?.id===operation)apply(task);poll();}).catch(e=>{if(active?.id===operation)notice(e.message);});};
$('diff-close').onclick=()=>$('diff').close();$('diff').addEventListener('close',()=>lastFocus?.focus());
controls();
if(/^[a-f0-9]{64}$/.test(token)){refresh().then(data=>active?poll():data.tasks.some(task=>task.action==='inventory')?undefined:run('inventory')).catch(e=>{$('session').textContent=`无法连接：${e.message}`;});}else{$('session').textContent='请运行 npm run content:ui，再用终端显示的完整地址打开。';}
