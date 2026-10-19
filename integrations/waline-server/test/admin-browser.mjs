// Optional browser regression for the real local Waline/PostgreSQL fixture.
// The shared CDP helper is a development-only dependency of the full checkout.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, wait } from '../../../scripts/test/browser-client.mjs';

// Control a real popup, rather than claiming window.opener isolation from a
// header assertion or a page that never had an opener in the first place.
async function popupTarget(browser, targetId) {
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: false });
  const pending = new Map(), listeners = new Set();
  let sequence = 0;
  browser.on((event) => {
    if (event.method !== 'Target.receivedMessageFromTarget' || event.params.sessionId !== sessionId) return;
    const value = JSON.parse(event.params.message), operation = pending.get(value.id);
    if (operation) {
      clearTimeout(operation.timer); pending.delete(value.id);
      if (value.error) operation.fail(new Error(JSON.stringify(value.error))); else operation.done(value.result);
    } else for (const listener of listeners) listener(value);
  });
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`Popup CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { done, fail, timer });
    browser.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => { clearTimeout(timer); pending.delete(id); fail(error); });
  });
  const evaluate = async (expression) => {
    const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result?.value;
  };
  for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await send(method);
  return { send, evaluate, on: (listener) => listeners.add(listener) };
}

export async function checkAdmin({ tls, start, databaseURL, email, password, setupPassword }) {
  if (!process.env.QJ_CHROMIUM) throw new Error('test:admin requires QJ_CHROMIUM and a full checkout; no browser is downloaded.');
  const certificateSPKI = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ format: 'der', type: 'spki' })).digest('base64');
  let targetPort, browser, setup, service, count = 0, closing = false;
  const servers = [], unexpected = [], exceptions = [], policyErrors = [], protocolErrors = [];
  const local = async (handler) => {
    const server = createServer(tls, handler);
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    servers.push(server);
    return `https://localhost:${server.address().port}`;
  };
  const ok = (label, condition) => { assert.ok(condition, label); count++; console.log(`  ✔ admin browser: ${label}`); };
  const until = async (client, expression) => {
    for (let i = 0; i < 120; i++) { if (await client.evaluate(expression)) return; await wait(100); }
    throw new Error(`Admin browser wait failed: ${expression}\n${await client.evaluate('document.body.innerText')}`);
  };
  const go = async (client, url) => { await client.send('Page.navigate', { url }); await until(client, 'document.readyState === "complete"'); };
  const click = async (client, selector) => {
    await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    let point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }); await wait(80);
    assert.ok(await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`), `Actual hit target: ${selector}`);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const fill = async (client, selector, value) => { await click(client, selector); await client.send('Input.insertText', { text: value }); };
  const watch = async (client, origins) => {
    client.on((event) => {
      if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params.exceptionDetails.text);
      if (event.method === 'Log.entryAdded' && event.params.entry.source === 'security' && event.params.entry.level === 'error') policyErrors.push(event.params.entry.text);
      if (event.method === 'Fetch.requestPaused') {
        const { requestId, request: req } = event.params;
        const allowed = req.url.startsWith('data:') || origins.includes(new URL(req.url).origin);
        if (!allowed) unexpected.push(new URL(req.url).origin + new URL(req.url).pathname);
        void client.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }).catch((error) => { if (!closing) protocolErrors.push(error.message); });
      }
    });
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('i18nextLng','en');" });
    await client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  };
  try {
    const apiOrigin = await local((req, res) => {
      if (!targetPort) { res.writeHead(503).end(); return; }
      const upstream = request({ hostname: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https' }, timeout: 15000 }, (response) => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(503); res.end(); });
      req.pipe(upstream);
    });
    const openerOrigin = await local((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><button id="open">Open management</button><script>window.received=[];addEventListener("message",e=>received.push(e.data));document.querySelector("button").onclick=()=>{window.popup=window.open("about:blank","qj-admin");};</script></body></html>');
    });
    setup = await start({ WALINE_MODE: 'bootstrap', WALINE_DATABASE_URL: databaseURL, WALINE_API_ORIGIN: apiOrigin, WALINE_SETUP_PASSWORD: setupPassword });
    targetPort = setup.port;
    browser = await launchBrowser(undefined, { certificateSPKI }); await watch(browser, [apiOrigin]);
    const basic = 'Basic ' + Buffer.from(`setup:${setupPassword}`).toString('base64');
    await browser.send('Network.setExtraHTTPHeaders', { headers: { Authorization: basic } });
    await go(browser, apiOrigin + '/ui/register'); await until(browser, '!!document.querySelector("#password-again")');
    await fill(browser, '#nick', 'Browser Author'); await fill(browser, '#email', email);
    await fill(browser, '#password', password); await fill(browser, '#password-again', password);
    await click(browser, 'button[type=submit]'); await until(browser, 'location.pathname === "/ui/login"');
    ok('protected registration uses the real form and does not ask for email verification', await browser.evaluate('!!document.querySelector("#password") && !document.querySelector("#password-again")'));
    const duplicate = await setup.request('/api/user', { method: 'POST', data: { email: 'other@example.invalid', password, display_name: 'Other' }, headers: { Origin: apiOrigin, Authorization: basic } });
    ok('a second account is rejected after browser registration', duplicate.status === 409);
    closing = true; await browser.close(); browser = undefined; await setup.stop(); closing = false;

    service = await start({ WALINE_MODE: 'public', WALINE_DATABASE_URL: databaseURL, WALINE_API_ORIGIN: apiOrigin, WALINE_SETUP_PASSWORD: '' });
    targetPort = service.port;
    const text = 'Synthetic comment for browser moderation';
    const submitted = await service.request('/api/comment', { method: 'POST', data: { url: '/posts/browser-ui/', nick: 'Synthetic reader', comment: text } });
    assert.equal(submitted.body.errno, 0); const id = String(submitted.body.data.objectId);
    const listPath = '/api/comment?path=%2Fposts%2Fbrowser-ui%2F&page=1&pageSize=10&sortBy=insertedAt_desc';
    assert.equal((await service.request(listPath)).body.data.count, 0);

    browser = await launchBrowser(undefined, { certificateSPKI }); await watch(browser, [openerOrigin]);
    await go(browser, openerOrigin + '/'); await click(browser, '#open');
    let popup;
    for (let i = 0; i < 30 && !popup; i++) { popup = (await browser.send('Target.getTargets')).targetInfos.find((info) => info.type === 'page' && info.url === 'about:blank'); if (!popup) await wait(100); }
    assert.ok(popup, 'The cross-origin opener must actually create a popup');
    const admin = await popupTarget(browser, popup.targetId); await watch(admin, [apiOrigin]);
    assert.equal(await admin.evaluate('window.opener !== null'), true);
    await go(admin, apiOrigin + '/ui/login'); await until(admin, '!!document.querySelector("#email")');
    ok('COOP severs a real cross-origin opener before management runs', await admin.evaluate('window.opener === null') && await browser.evaluate('window.popup.closed'));
    await fill(admin, '#email', email); await fill(admin, '#password', password); await click(admin, 'button[type=submit]');
    await until(admin, 'location.pathname === "/ui" && !!document.querySelector(".typecho-option-tabs")');
    ok('normal browser login and authenticated same-origin reads work', await admin.evaluate('!!sessionStorage.getItem("TOKEN")'));
    ok('license and corresponding source links are visible in the real management shell', await admin.evaluate(`(()=>{const e=document.querySelector('.qj-admin-license');return e && e.getBoundingClientRect().height>0 && e.textContent.includes('GPL-2.0') && ['/SOURCE-waline-admin.tar.gz','/SOURCE-waline-server.tar.gz'].every(href=>e.querySelector('a[href="'+href+'"]'));})()`));
    await click(admin, '.typecho-option-tabs:not(.right) li:nth-child(2) button');
    await until(admin, `!!document.querySelector('#comment-${id}')`);
    await click(admin, `#comment-${id} .operate-approved`);
    await until(admin, `!document.querySelector('#comment-${id}')`);
    ok('browser approval makes a previously hidden comment public', (await service.request(listPath)).body.data.count === 1);
    await click(admin, '.typecho-option-tabs:not(.right) li:first-child button');
    await until(admin, `!!document.querySelector('#comment-${id}')`);
    await click(admin, `#comment-${id} .operate-reply`);
    await until(admin, '!!document.querySelector("textarea#text")');
    await fill(admin, 'textarea#text', 'Real browser author reply');
    await click(admin, '.comment-reply button.primary');
    await until(admin, '!document.querySelector(".comment-reply") && document.body.innerText.includes("Real browser author reply")');
    const comment = (await service.request(listPath)).body.data.data[0];
    ok('browser reply retains the real administrator and parent/root identity', comment.children.some((reply) => reply.type === 'administrator' && String(reply.pid) === id && String(reply.rid) === id));
    for (const width of [1280, 390, 320]) {
      await admin.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await go(admin, apiOrigin + '/ui'); await until(admin, '!!document.querySelector(".comment-author")');
      const layout = await admin.evaluate(`({viewport:innerWidth,width:document.documentElement.scrollWidth,font:parseFloat(getComputedStyle(document.querySelector('.comment-author')).fontSize)})`);
      ok(`${width}px management keeps readable text without shrinking the viewport`, layout.viewport === width && layout.width <= width && layout.font >= 14);
      if (process.env.QJ_SCREENSHOTS) {
        mkdirSync(process.env.QJ_SCREENSHOTS, { recursive: true });
        const shot = await admin.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(process.env.QJ_SCREENSHOTS, `waline-admin-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    ok('no token or profile message reaches the opener', await browser.evaluate('window.received.length === 0'));
    ok('fixed admin has no third-party requests, CSP violations or uncaught errors', !unexpected.length && !exceptions.length && !policyErrors.length && !protocolErrors.length);
    console.log(`  Admin browser checks: ${count} passed; local synthetic database only.`);
    return count;
  } catch (error) {
    console.error(JSON.stringify({ unexpected, exceptions, policyErrors, protocolErrors }));
    throw error;
  } finally {
    closing = true; await browser?.close();
    await setup?.stop(); await service?.stop();
    for (const server of servers) await new Promise((done) => { server.closeAllConnections(); server.close(done); });
  }
}
