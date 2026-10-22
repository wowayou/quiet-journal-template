import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, put, build, read, repo } from './site-fixture.mjs';
import { tags, checkSite } from '../check-site.mjs';
import { checkConfig } from '../check-config.mjs';
import { coreManifest, previewUpgrade, ownership } from '../core-upgrade.mjs';

test('配置分层：直接 Hugo 生成 CMS，两组实例参数、无静态副本、扩展不可覆盖核心',()=>{
 const f=fixture();try {
  const original=read(f.root,'assets/admin/schema.yml'),hugo=read(f.root,'config/_default/hugo.toml'),params=read(f.root,'config/_default/params.toml');
  for(const [repo,branch,mode,timeZone,quality,baseURL] of [['alice/journal','main','simple','UTC',75,'https://alice.example.test/'],['bob/private','writing','editorial_workflow','Asia/Tokyo',90,'https://bob.example.test/']]) {
   put(f.root,'data/editor.yaml',JSON.stringify({repo,branch,publish_mode:mode}));
   put(f.root,'config/_default/hugo.toml',hugo.replace('https://example.com/',baseURL).replace('Asia/Shanghai',timeZone));put(f.root,'config/_default/params.toml',params.replace('Asia/Shanghai',timeZone).replace('quality = 82',`quality = ${quality}`));
   assert.deepEqual(checkConfig(f.root),[]);const result=build(f.root,['--baseURL',baseURL]);assert.equal(result.status,0,result.stderr);
   assert.equal(tags(read(f.root,'public/index.html')).find(tag=>tag.name==='link'&&tag.attrs.rel==='canonical').attrs.href,baseURL);
   const config=JSON.parse(read(f.root,'public/admin/config.yml'));assert.equal(config.backend.repo,repo);assert.equal(config.backend.branch,branch);assert.equal(config.publish_mode,mode);assert.ok(config.collections.some(c=>c.name==='posts'));
  }
  assert.equal(read(f.root,'assets/admin/schema.yml'),original);
  put(f.root,'data/editor_extensions.yaml',JSON.stringify({fields:{posts:[{name:'mood',widget:'string',required:false}]}}));assert.equal(build(f.root).status,0);assert.ok(JSON.parse(read(f.root,'public/admin/config.yml')).collections[0].fields.some(field=>field.name==='mood'));
  put(f.root,'data/editor_extensions.yaml',JSON.stringify({fields:{posts:[{name:'title'}]}}));assert.notEqual(build(f.root).status,0);
  rmSync(join(f.root,'data/editor_extensions.yaml'));put(f.root,'data/editor.yaml',JSON.stringify({repo:'alice/journal',token:'SHOULD_NOT_PUBLISH'}));assert.notEqual(build(f.root).status,0);
 }finally{f.cleanup();}
});
test('实例安全检查不允许发布草稿、任意 HTML 或原始资源',()=>{
 const f=fixture();try {
  assert.ok(JSON.parse(read(repo,'package.json')).scripts.build.includes('hugo --environment production'), '检查与渲染必须使用相同的生产环境');
  assert.deepEqual(checkConfig(f.root),[]);
  let config=read(f.root,'config/_default/hugo.toml');put(f.root,'config/_default/hugo.toml',config.replace('buildDrafts = false','buildDrafts = true'));assert.ok(checkConfig(f.root).length);put(f.root,'config/_default/hugo.toml',config);
  const markup=read(f.root,'config/_default/markup.toml');put(f.root,'config/_default/markup.toml',markup.replace('unsafe = false','unsafe = true'));assert.ok(checkConfig(f.root).length);put(f.root,'config/_default/markup.toml',markup);
  put(f.root,'config/_default/cascade.toml','[build]\npublishResources=true\n');assert.ok(checkConfig(f.root).length);
 }finally{f.cleanup();}
});
test('直接 Hugo 的强制构建不能发布未来 publishDate 或草稿/未来/过期栏目页',()=>{
 for(const [path,fields,flag,reason] of [
  ['content/posts/a/index.md','publishDate: "2099-01-01T00:00:00Z"','--buildFuture',/未来/],
  ['content/private/_index.md','title: Private\ndraft: true','--buildDrafts',/草稿/],
  ['content/later/_index.md','title: Later\ndate: "2099-01-01T00:00:00Z"','--buildFuture',/未来/],
  ['content/later/_index.md','title: Later\npublishDate: "2099-01-01T00:00:00Z"','--buildFuture',/未来/],
  ['content/older/_index.md','title: Older\nexpiryDate: "2001-01-01T00:00:00Z"','--buildExpired',/过期/],
 ]) {
  const f=fixture();try {
   const text=path==='content/posts/a/index.md'?read(f.root,path).replace('---\n',`---\n${fields}\n`):`---\n${fields}\n---\nSynthetic`;
   if(path.endsWith('/_index.md')) put(f.root,'content/_index.md','---\ntitle: Home without an explicit date\n---\nSynthetic home');
   put(f.root,path,text);const normal=build(f.root);assert.equal(normal.status,0,normal.stderr);
   const forced=build(f.root,[flag]);assert.notEqual(forced.status,0,path);assert.match(forced.stderr,reason,path);
  }finally{f.cleanup();}
 }
});
test('邮件订阅默认关闭；仅公开文章原生表单，CSP 精确路径、无 JS 和脚本不扩大',()=>{
 const f=fixture();try {
  put(f.root,'data/newsletter.yaml',JSON.stringify({enabled:false}));assert.equal(build(f.root).status,0);assert.ok(!read(f.root,'public/posts/a/index.html').includes('newsletter__form'));
  put(f.root,'data/newsletter.yaml',JSON.stringify({enabled:true,username:'synthetic-user',heading:'<unsafe>',text:'测试订阅，不发送'}));const result=build(f.root);assert.equal(result.status,0,result.stderr);
  assert.deepEqual(checkSite(join(f.root,'public')),[]);
  const post=read(f.root,'public/posts/a/index.html'),elements=tags(post);const form=elements.find(t=>t.name==='form');assert.equal(form.attrs.action,'https://buttondown.com/api/emails/embed-subscribe/synthetic-user');assert.equal(form.attrs.method,'post');
  assert.ok(elements.some(t=>t.name==='label'&&t.attrs.for==='newsletter-email'));assert.ok(!elements.some(t=>t.name==='unsafe'));assert.ok(!elements.some(t=>t.name==='script'&&t.attrs.src?.startsWith('https:')));
  assert.ok(!read(f.root,'public/about/index.html').includes('newsletter__form'));
  const headers=read(f.root,'public/_headers');assert.match(headers,/\/posts\/a\/\n  ! Content-Security-Policy\n  Content-Security-Policy:.*form-action 'self' https:\/\/buttondown.com\/api\/emails\/embed-subscribe\/synthetic-user/);
  assert.ok(!headers.slice(headers.indexOf('/admin/*'),headers.indexOf('/posts/')).includes('buttondown'));
  for(const enabled of [0,'',null,'false']) {put(f.root,'data/newsletter.yaml',JSON.stringify({enabled}));const invalid=build(f.root);assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/布尔/);}
  for(const username of ['','https://evil.test','user@host','../x']) {put(f.root,'data/newsletter.yaml',JSON.stringify({enabled:true,username}));assert.notEqual(build(f.root).status,0);}
 }finally{f.cleanup();}
});
test('精确订阅响应头遵守部署限额，不静默截断文章策略',()=>{
 const f=fixture();try {
  put(f.root,'data/newsletter.yaml',JSON.stringify({enabled:true,username:'synthetic-user'}));
  const headers=read(f.root,'assets/server/headers.txt');
  put(f.root,'assets/server/headers.txt',headers+Array.from({length:93},(_,i)=>`\n/custom-${i}\n  X-Test: bounded\n`).join(''));assert.equal(build(f.root).status,0);
  put(f.root,'assets/server/headers.txt',headers+Array.from({length:94},(_,i)=>`\n/custom-${i}\n  X-Test: bounded\n`).join(''));
  const limited=build(f.root);assert.notEqual(limited.status,0);assert.match(limited.stderr,/100.*规则|响应头.*限额/);
  put(f.root,'assets/server/headers.txt',headers+'\n/long\n  X-Test: '+ 'x'.repeat(1990)+'\n');assert.equal(build(f.root).status,0);
  put(f.root,'assets/server/headers.txt',headers+'\n/long\n  X-Test: '+ 'x'.repeat(2001)+'\n');
  const long=build(f.root);assert.notEqual(long.status,0);assert.match(long.stderr,/2,000|2000/);
  put(f.root,'assets/server/headers.txt',headers.replace("form-action 'self'","form-action 'none'"));
  const blocked=build(f.root);assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/form-action/);
 }finally{f.cleanup();}
});
test('生产环境覆盖与页面 cascade 也不能绕过原资源发布保护',()=>{
 const f=fixture();try {
  const cascade=read(f.root,'config/_default/cascade.toml');
  put(f.root,'config/production/cascade.toml',cascade.replace('publishResources = false','publishResources = true'));
  assert.ok(checkConfig(f.root).some(error=>error.includes('原始资源')));
  rmSync(join(f.root,'config/production'),{recursive:true});
  for(const format of ['yaml','json']) {
   put(f.root,`config/production/cascade.${format}`,format==='json'?JSON.stringify({build:{publishResources:true},target:{path:'/**'}}):'build:\n  publishResources: true\ntarget:\n  path: "/**"\n');
   assert.ok(checkConfig(f.root).some(error=>error.includes('原始资源')));
   rmSync(join(f.root,'config/production'),{recursive:true});
  }
  const post=read(f.root,'content/posts/a/index.md');
  for(const field of ['build','_build','cascade']) {
   const value=field==='cascade'?{build:{publishResources:true}}:{publishResources:true};
   put(f.root,'content/posts/a/index.md',post.replace('---\n',`---\n${field}: ${JSON.stringify(value)}\n`));
   assert.ok(checkConfig(f.root).some(error=>error.includes('原始资源')),field);
  }
  put(f.root,'content/posts/a/index.md',post);
  assert.deepEqual(checkConfig(f.root),[]);
 }finally{f.cleanup();}
});
test('声明的个人挂件源码和私密服务输入不进入核心，升级报告标记受保护',()=>{
 const a=fixture(),b=fixture();try {
  const paths=['layouts/_partials/widgets/user-now.html','assets/css/widgets/user-now.css','assets/js/widgets/user-now.js'];
  for(const path of paths) {put(a.root,path,'personal extension');put(b.root,path,'new upstream code');}
  put(a.root,'data/widget_extensions.yaml',JSON.stringify({'user-now':{partial:'widgets/user-now.html',style:'css/widgets/user-now.css',script:'js/widgets/user-now.js',slots:['home-after-intro']}}));
  put(a.root,'integrations/waline/config.local.json','{"private":"SYNTHETIC_ONLY"}');
  put(a.root,'integrations/waline-server/.env.local','SYNTHETIC_ONLY=do-not-distribute');
  put(a.root,'config/production/hugo.toml','baseURL = "https://private.example.test/"');
  const before=coreManifest(a.root,'v-before');
  for(const path of [...paths,'config/production/hugo.toml','integrations/waline/config.local.json','integrations/waline-server/.env.local','layouts/_partials/extensions/head.html']) assert.ok(!(path in before.files),path);
  put(b.root,'core-manifest.json',JSON.stringify(coreManifest(b.root,'v-next')));
  const preview=previewUpgrade({current:a.root,upstream:b.root,previous:before});
  for(const path of paths) assert.equal(preview.files.find(entry=>entry.path===path)?.status,'protected',path);
  for (const path of paths) assert.equal(read(a.root,path),'personal extension');
  for(const partial of ['../head.html','widgets/../../head.html','/head.html','widgets\\\\user-now.html']) {
   put(a.root,'data/widget_extensions.yaml',JSON.stringify({'user-now':{partial}}));
   assert.throws(()=>coreManifest(a.root,'invalid'),/扩展|路径/);
  }
 }finally{a.cleanup();b.cleanup();}
});
test('随仓固定核心清单与实际源码一致，不把实例文件或私密环境纳入发行',()=>{
 const manifest=JSON.parse(read(repo,'core-manifest.json'));
 assert.deepEqual(manifest,coreManifest(repo,manifest.version));
 for(const path of ['config/_default/hugo.toml','config/_default/params.toml','data/editor.yaml','data/newsletter.yaml','assets/css/overrides.css','layouts/_partials/extensions/head.html','integrations/waline/config.local.json']) assert.ok(!(path in manifest.files),path);
});
test('核心清单明确归属；升级只读三方比较，私人文件不进入发行且本地改动冲突',()=>{
 const a=fixture(),b=fixture();try {
  for(const path of ['content/a.md','assets/media/a.png','data/editor.yaml','config/_default/hugo.toml','config/_default/params.toml','wrangler.jsonc'])assert.equal(ownership(path),'instance');
  const before=coreManifest(a.root,'v-before');assert.ok(!Object.keys(before.files).some(p=>p.startsWith('content/')));
  put(b.root,'assets/css/base.css',read(b.root,'assets/css/base.css')+'\n/* core update */');const next=coreManifest(b.root,'v-next');put(b.root,'core-manifest.json',JSON.stringify(next));
  let preview=previewUpgrade({current:a.root,upstream:b.root,previous:before});assert.equal(preview.files.find(f=>f.path==='assets/css/base.css').status,'update');
  put(a.root,'assets/css/base.css',read(a.root,'assets/css/base.css')+'\n/* private edit */');preview=previewUpgrade({current:a.root,upstream:b.root,previous:before});assert.equal(preview.files.find(f=>f.path==='assets/css/base.css').status,'conflict');assert.ok(read(a.root,'assets/css/base.css').includes('private edit'));
 }finally{a.cleanup();b.cleanup();}
});
