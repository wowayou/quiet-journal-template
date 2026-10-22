#!/usr/bin/env node
// Optional newsletter rendering/POST test: local interception only; never contacts Buttondown or sends email.
import assert from 'node:assert/strict';
import { fixture, put, build } from './test/site-fixture.mjs';
import { staticServer } from './test/static-server.mjs';
import { launchBrowser, wait } from './test/browser-client.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const f=fixture();let server,browser,count=0;
const ok=(name,value)=>{assert.ok(value,name);count++;console.log(`✔ ${name}`);};
try {
 put(f.root,'data/newsletter.yaml',JSON.stringify({enabled:true,username:'synthetic-user',heading:'喜欢这些记录？',text:'测试样例，不发送邮件'}));assert.equal(build(f.root).status,0);
 server=await staticServer(join(f.root,'public'));browser=await launchBrowser();const ev=browser.evaluate,errors=[],external=[];let post;
 browser.on(m=>{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Log.entryAdded'&&/Content Security Policy|Refused to/.test(m.params.entry.text))errors.push(m.params.entry.text);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url)&&!m.params.request.url.startsWith(server.url))external.push(m.params.request.url);});
 await browser.send('Page.navigate',{url:server.url+'/posts/a/'});await wait(500);
 for(const width of [1280,390,320])for(const theme of ['light','dark']) {
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<600});await browser.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
  ok(`${width}/${theme} 订阅表单无溢出、邮箱和按钮 ≥44px`,await ev(`document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.newsletter input[type=email],.newsletter button')].every(e=>e.getBoundingClientRect().height>=44)`));
  if(process.env.QJ_SCREENSHOTS){mkdirSync(process.env.QJ_SCREENSHOTS,{recursive:true});await ev("document.querySelector('.newsletter').scrollIntoView({block:'center'})");const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(process.env.QJ_SCREENSHOTS,`newsletter-${width}-${theme}.png`),Buffer.from(shot.data,'base64'));}
 }
 ok('首次阅读不请求 Buttondown 或第三方脚本',external.length===0);
 ok('邮箱为空或格式错误时原生验证拦截提交',await ev(`(()=>{const form=document.querySelector('.newsletter form'),input=form.querySelector('[type=email]');input.value='';const empty=form.checkValidity();input.value='invalid-address';return !empty&&!form.checkValidity();})()`));
 await browser.send('Emulation.setScriptExecutionDisabled',{value:true});await browser.send('Page.reload');await wait(400);
 ok('无 JavaScript 仍保留原生表单、可见邮箱标签和独立订阅链接',await ev(`!!document.querySelector('.newsletter form[method=post]')&&document.querySelector('.newsletter label').textContent.includes('邮箱')&&document.querySelector('.newsletter a').href.startsWith('https://buttondown.com/')`));
 await browser.send('Emulation.setScriptExecutionDisabled',{value:false});
 const html=readFileSync(join(f.root,'public/posts/a/index.html'),'utf8');f.comments.enabled=true;f.comments.origin='https://comments.example.test';f.saveComments();assert.equal(build(f.root).status,0);
 const withComments=readFileSync(join(f.root,'public/posts/a/index.html'),'utf8');
 ok('文末顺序为继续阅读、邮件订阅、按需评论；首次不初始化 iframe',html.indexOf('entry__nav')<html.indexOf('class=newsletter')&&withComments.indexOf('class=newsletter')<withComments.indexOf('data-comments')&&!/<iframe/.test(withComments));
 await browser.send('Fetch.enable',{patterns:[{urlPattern:'https://buttondown.com/*'}]});
 browser.on(m=>{if(m.method==='Fetch.requestPaused'){if(m.params.request.method==='POST')post=m.params.request;browser.send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<meta charset="utf-8"><h1>合成确认页，请确认邮箱</h1>').toString('base64')}).catch(()=>{});}});
 await ev(`document.querySelector('#newsletter-email').value='synthetic@example.test';document.querySelector('.newsletter form').requestSubmit()`);
 for(let i=0;i<60&&!post;i++)await wait(100);
 ok('原生 POST 精确提交到预设账号，非 fetch 或 iframe',post?.method==='POST'&&post.url==='https://buttondown.com/api/emails/embed-subscribe/synthetic-user'&&post.postData?.includes('synthetic%40example.test'));
 for(let i=0;i<40;i++){if(await ev(`document.body?.innerText.includes('合成确认页')`))break;await wait(100);}
 ok('页面导航到服务确认流程，不伪造本地订阅成功',await ev(`document.body.innerText.includes('合成确认页')`));
 ok('无 CSP/脚本错误',errors.length===0);console.log(`Newsletter 浏览器回归：${count} 项通过；提交全部本机拦截，真实邮件 0。`);
}finally{await browser?.close();await server?.close();f.cleanup();}
