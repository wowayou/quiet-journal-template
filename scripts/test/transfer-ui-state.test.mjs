import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real page script with controlled response ordering, not a second state implementation.
const source = readFileSync(new URL('../transfer-ui/app.js', import.meta.url), 'utf8');
const ids = [...readFileSync(new URL('../transfer-ui/index.html', import.meta.url), 'utf8').matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const operation = char => char.repeat(32);
const result = includeSettings => ({ includeSettings, counts: { posts: 1, drafts: 1, pages: 0, images: 0, settings: includeSettings ? 1 : 0, future: 0, notices: [] }, bytes: 100, files: includeSettings ? 2 : 1 });
const inventoryTask = (char, status, includeSettings) => ({ id: operation(char), action: 'inventory', status, includeSettings, ...(status === 'completed' ? { result: result(includeSettings) } : { error: status === 'failed' ? 'Synthetic inventory failure' : undefined }) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function page() {
  class Element {
    constructor(id = '') { this.id = id; this.checked = false; this.disabled = false; this.hidden = false; this.value = ''; this.children = []; this.text = ''; this.classList = { toggle() {} }; }
    get textContent() { return this.text + this.children.map(child => child.textContent || '').join(' '); }
    set textContent(value) { this.text = String(value); this.children = []; }
    replaceChildren(...children) { this.text = ''; this.children = children; }
    append(...children) { this.children.push(...children); }
    setAttribute() {}
    addEventListener() {}
    focus() {}
  }
  const elements = new Map(ids.map(id => [id, new Element(id)]));
  elements.get('settings').checked = true;
  elements.get('format').value = 'directory';
  elements.get('consent').checked = true;
  let state = { source: '/synthetic/site', folder: '/synthetic/private', snapshots: [], tasks: [] }, held;
  const details = new Map(), calls = [];
  const context = vm.createContext({
    document: { hidden: false, getElementById: id => elements.get(id), createElement: () => new Element(), addEventListener() {} },
    location: { hash: '' }, history: { replaceState() {} }, sessionStorage: { getItem: () => null },
    crypto: { getRandomValues: values => values.fill(1) }, AbortSignal, URL,
    window: { addEventListener() {} }, Option: class extends Element { constructor(text, value) { super(); this.textContent = text; this.value = value; } },
    setTimeout() {}, navigator: {},
    fetch: async (path, options = {}) => {
      calls.push({ path, ...(options.body ? { data: JSON.parse(options.body) } : {}) });
      let body;
      if (path === '/api/status') { if (held) { const pending = held; held = undefined; body = await pending.promise; } else body = state; }
      else if (path.startsWith('/api/task')) { body = details.get(new URL(path, 'http://127.0.0.1').searchParams.get('id')); }
      else throw new Error('Unexpected UI request: ' + path);
      return { ok: true, json: async () => body };
    },
  });
  vm.runInContext(source, context);
  vm.runInContext("token='a'.repeat(64)", context);
  return {
    elements, calls,
    set: value => { state = { ...state, ...value }; for (const task of state.tasks) details.set(task.id, task); },
    holdStatus: value => { held = value; },
    holdDetails: (id, value) => details.set(id, value.promise),
    evaluate: expression => vm.runInContext(expression, context),
  };
}

test('页面摘要：慢任务和刷新使用最新范围，不回填旧完成摘要；导出必须匹配范围', async () => {
  const p = page(), before = inventoryTask('a', 'completed', true), running = inventoryTask('b', 'running', false);
  p.set({ tasks: [before] }); await p.evaluate('refresh()');
  p.evaluate(`inventory=undefined;active=${JSON.stringify(running)};apply(active)`);
  p.set({ active: running.id, tasks: [before, running] }); await p.evaluate('refresh()');
  assert.equal(p.elements.get('settings').checked, false);
  assert.equal(p.evaluate('inventory'), undefined);
  assert.equal(p.elements.get('export').disabled, true);
  const done = inventoryTask('b', 'completed', false); p.set({ active: undefined, tasks: [before, done] }); await p.evaluate('refresh()');
  assert.equal(p.elements.get('settings').checked, false);
  assert.equal(p.evaluate('inventory.includeSettings'), false);
  assert.ok(p.elements.get('inventory').textContent.includes('内容设置 0 份'));
  assert.equal(p.elements.get('export').disabled, false);
  p.elements.get('settings').checked = true; p.evaluate('controls()');
  assert.equal(p.elements.get('export').disabled, true, 'mismatched scope must not enable export');
});

test('页面摘要：最新检查失败后不使用旧摘要放行，刷新也不自动重试', async () => {
  const p = page(), before = inventoryTask('a', 'completed', true), failed = inventoryTask('b', 'failed', false);
  p.set({ tasks: [before] }); await p.evaluate('refresh()');
  p.set({ tasks: [before, failed] }); await p.evaluate('refresh()');
  assert.equal(p.elements.get('settings').checked, false);
  assert.equal(p.evaluate('inventory'), undefined);
  assert.equal(p.elements.get('export').disabled, true);
  assert.ok(p.elements.get('inventory').textContent.includes('未完成'));
  const count = p.calls.length; await p.evaluate('refresh()');
  assert.equal(p.calls.length, count + 1);
  assert.ok(p.calls.every(call => !call.data));
});

test('页面状态：过期 status 响应不能覆盖新选择或释放尚在提交的任务', async () => {
  const p = page(), before = inventoryTask('a', 'completed', true), running = { ...inventoryTask('b', 'running', false), submitting: true };
  p.set({ tasks: [before] }); await p.evaluate('refresh()');
  const response = deferred(); p.holdStatus(response); const old = p.evaluate('refresh()');
  p.evaluate(`inventory=undefined;active=${JSON.stringify(running)};apply(active)`);
  response.resolve({ source: '/synthetic/site', folder: '/synthetic/private', snapshots: [], tasks: [before] }); await old;
  assert.equal(p.evaluate('active.id'), running.id);
  assert.equal(p.elements.get('settings').checked, false);
  await p.evaluate('refresh()');
  assert.equal(p.evaluate('active.id'), running.id, 'task absent before submission is not a rejected action');
  assert.equal(p.elements.get('export').disabled, true);
});

test('页面状态：读取任务详情期间有新操作时，旧完成结果不能覆盖当前任务', async () => {
  const p = page(), before = inventoryTask('a', 'completed', true), running = inventoryTask('b', 'running', false);
  const detail = deferred(); p.set({ tasks: [before] }); p.holdDetails(before.id, detail);
  const old = p.evaluate('refresh()'); await tick();
  p.evaluate(`inventory=undefined;active=${JSON.stringify(running)};apply(active)`);
  detail.resolve(before); await old;
  assert.equal(p.evaluate('active.id'), running.id);
  assert.equal(p.elements.get('settings').checked, false);
  assert.equal(p.evaluate('inventory'), undefined);
});

test('页面状态：已展示的任务摘要不能冒充完整比较，恢复必须读取完整任务', async () => {
  const p = page(), inv = inventoryTask('a', 'completed', true);
  const checked = { id: operation('b'), action: 'inspect', status: 'completed', snapshot: '/synthetic/A', result: { ...result(true), snapshot: '/synthetic/A', comparison: [], targetOnly: 0 } };
  p.set({ tasks: [inv, checked] }); await p.evaluate('refresh()');
  p.evaluate("review=undefined;document.getElementById('review').hidden=true");
  p.set({ tasks: [inv, { ...checked, result: result(true) }] });
  const detail = deferred(); detail.resolve(checked); p.holdDetails(checked.id, detail);
  await p.evaluate('refresh()');
  assert.equal(p.elements.get('review').hidden, false);
  assert.equal(p.evaluate('review.result.snapshot'), '/synthetic/A');
  assert.equal(p.elements.get('import').disabled, true, 'restored review requires fresh consent');
});

test('页面状态：失败目录身份刷新可见，旧检查与确认不复活', async () => {
  const p = page(), inv = inventoryTask('a', 'completed', true);
  const checked = { id: operation('b'), action: 'inspect', status: 'completed', snapshot: '/synthetic/A', result: { ...result(true), snapshot: '/synthetic/A', comparison: [], targetOnly: 0 } };
  const failed = { id: operation('c'), action: 'inspect', status: 'failed', snapshot: '/synthetic/missing-B', error: '目录不存在：/synthetic/missing-B' };
  p.set({ tasks: [inv, checked, failed] }); await p.evaluate('refresh()');
  assert.equal(p.elements.get('review').hidden, true);
  assert.equal(p.elements.get('import').disabled, true);
  assert.ok(p.elements.get('result').textContent.includes('目录不存在'));
  assert.ok(p.elements.get('output').textContent.includes('/synthetic/missing-B'));
  await p.evaluate('refresh()');
  assert.equal(p.elements.get('review').hidden, true);
  assert.equal(p.evaluate('review'), undefined);
});
