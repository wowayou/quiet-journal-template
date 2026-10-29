'use strict';

// Security regressions for the actual dependencies resolved from Waline's entry.
// Synthetic inputs only: no network, email, cloud account or database needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const fromWaline = createRequire(require.resolve('@waline/vercel/package.json'));
const { JSDOM } = fromWaline('jsdom');
const createDOMPurify = fromWaline('dompurify');

// Resolve through Waline, not a conveniently hoisted but unused test dependency.
test('Waline resolves exactly the reviewed security overrides and lock versions', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../package.json')));
  const lock = JSON.parse(readFileSync(join(__dirname, '../package-lock.json')));
  const window = new JSDOM('').window;
  try {
    assert.equal(createDOMPurify(window).version, '3.4.17');
    const expected = { dompurify: '3.4.17', 'markdown-it': '15.0.3', nodemailer: '10.1.4' };
    assert.deepEqual(manifest.overrides['@waline/vercel'], expected);
    for (const [name, version] of Object.entries(expected)) {
      assert.equal(lock.packages['node_modules/' + name].version, version);
      assert.match(fromWaline.resolve(name), /node_modules/);
    }
    assert.equal(fromWaline('markdown-it/package.json').version, expected['markdown-it']);
    assert.equal(fromWaline('nodemailer/package.json').version, expected.nodemailer);
  } finally { window.close(); }
});

// GHSA-cg2g-xh64-v4q7: not a production option here, but the replacement
// sanitizer must really fix the reported mode, not merely clear an audit label.
for (const [prefix, suffix] of [['$', '{alert(1)}'], ['{', '{alert(1)}}'], ['<', '%alert(1)%>']]) {
  test(`DOMPurify scrubs split shadow-root template expressions: ${prefix}${suffix}`, () => {
    const window = new JSDOM('').window;
    try {
      const purifier = createDOMPurify(window), host = window.document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const nested = window.document.createElement('div');
      shadow.append(nested);
      const inner = nested.attachShadow({ mode: 'open' });
      // Split every character: a fragment must contain neither an opening nor
      // a closing delimiter that the old per-text-node check already removes.
      for (const root of [shadow, inner]) {
        for (const character of prefix + suffix) root.append(window.document.createTextNode(character), window.document.createElement('object'));
      }
      purifier.sanitize(host, { IN_PLACE: true, SAFE_FOR_TEMPLATES: true });
      for (const root of [shadow, inner]) {
        root.normalize();
        assert.ok(!root.textContent.includes(prefix + suffix), 'Merged expression must not survive in either shadow root');
      }
    } finally { window.close(); }
  });
}

// GHSA-mrv2-3pqr-j5jr: parent/sibling removals must neutralize the discarded
// subtree too. jsdom never executes script or loads the synthetic image URLs.
for (const mode of ['parent', 'nextSibling']) {
  test(`DOMPurify neutralizes handlers on hook-detached ${mode} subtrees`, () => {
    const window = new JSDOM('<div id="root"><figure><img class="bad" src="a.png"><img id="evil" src="x" onerror="alert(1)"></figure><p>ok</p></div>').window;
    try {
      const purifier = createDOMPurify(window), root = window.document.getElementById('root');
      const evil = window.document.getElementById('evil');
      purifier.addHook('afterSanitizeAttributes', (node) => {
        if (node.getAttribute?.('class') === 'bad') {
          if (mode === 'parent') node.parentNode.remove(); else node.nextElementSibling.remove();
        }
      });
      purifier.sanitize(root, { IN_PLACE: true });
      assert.equal(evil.getAttribute('onerror'), null);
    } finally { window.close(); }
  });
}

test('DOMPurify blocks XHTML SMIL href rewrites (GHSA-c6gr-qvv4-5v3f)', () => {
  const window = new JSDOM('').window;
  try {
    const purifier = createDOMPurify(window);
    const output = purifier.sanitize('<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="x;javascript:alert(1)"/></a></svg>', {
      PARSER_MEDIA_TYPE: 'application/xhtml+xml', ALLOWED_TAGS: ['svg', 'a', 'animate'], ALLOWED_ATTR: ['attributeName', 'values'],
    });
    assert.doesNotMatch(output, /attributeName="href"/);
  } finally { window.close(); }
});

test('actual Waline Markdown pipeline preserves formatting and strips executable HTML', async () => {
  // Only the upstream configuration accessor is stubbed; parser, plugins,
  // sanitizer and Waline hooks are the actual installed production modules.
  global.think = { config: (name) => { assert.equal(name, 'domPurify'); return {}; } };
  let window;
  try {
    const { getMarkdownParser } = fromWaline('@waline/vercel/src/service/markdown/index.js');
    const render = await getMarkdownParser({ config: { highlight: false }, plugin: { tex: false } });
    const html = render('**hello** [link](https://example.invalid/)\n\n<script>alert(1)</script><img src="x" onerror="alert(1)"><form><input></form><svg onload="alert(1)"></svg><a href="javascript:alert(1)">bad</a>');
    window = new JSDOM(html).window;
    const doc = window.document;
    assert.equal(doc.querySelector('strong').textContent, 'hello');
    const link = doc.querySelector('a[href="https://example.invalid/"]');
    assert.equal(link.target, '_blank');
    for (const rel of ['ugc', 'nofollow', 'noreferrer', 'noopener']) assert.ok(link.relList.contains(rel));
    assert.equal(doc.querySelector('script,form,input,[onerror],[onload],[href^="javascript:"]'), null);
    assert.equal(typeof html, 'string', 'Production pipeline remains string-in/string-out, not IN_PLACE or DOM-returning');
  } finally { window?.close(); delete global.think; }
});

const addressparser = fromWaline('nodemailer/lib/addressparser');
const addresses = (nodes) => nodes.flatMap((node) => node.group ? addresses(node.group) : [node.address]);
for (const [label, input, expected] of [
  ['nested comments', 'Victim (x(y) <evil@evil.invalid>) <v@victim.invalid>', 'v@victim.invalid'],
  ['group semicolons', 'G: (a; <evil@evil.invalid>) <v@victim.invalid>;', 'v@victim.invalid'],
  ['quoted angle brackets', '<"a@evil.invalid>"@good.invalid>', '"a@evil.invalid>"@good.invalid'],
]) {
  test(`Nodemailer recipient parsing: ${label} cannot redirect the envelope`, () => {
    assert.deepEqual(addresses(addressparser(input)), [expected]);
  });
}

// The dependency fixes must work independently of our 2,000-character API
// limit. Test one synthetic oversized payload per bounded child process, so a
// future regression fails in <= 5 seconds rather than blocking the test runner.
for (const variant of ['comment', 'processing', 'declaration', 'cdata', 'label', 'title']) {
  test(`markdown-it pathological ${variant} parsing completes within the bounded worker`, () => {
    const code = `
      const assert = require('node:assert/strict');
      const MarkdownIt = require(process.argv[1]);
      const variant = process.argv[2];
      const openers = { comment: '<!--', processing: '<?x', declaration: '<!A', cdata: '<![CDATA[' };
      const text = variant === 'label' ? '[' + 'a\\n'.repeat(200000)
        : variant === 'title' ? '[a]: /u "' + 'x\\n'.repeat(200000)
        : 'x ' + openers[variant].repeat(128000);
      const output = new MarkdownIt({ html: true }).render(text);
      assert.equal(typeof output, 'string');
      assert.ok(output.length > 0);
    `;
    const result = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', code, fromWaline.resolve('markdown-it'), variant], {
      timeout: 5000, encoding: 'utf8', maxBuffer: 64 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}
