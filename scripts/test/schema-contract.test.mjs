import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, put, read, build } from "./site-fixture.mjs";
import { clean } from "./fixtures.mjs";

// Contract: anything the CMS field pattern lets an author save must also build, and the known
// bad values the build rejects must already be rejected by the CMS before saving. Patterns are
// read from the generated /admin/config.yml (what the CMS actually loads), not copied here.
function cmsPatterns(root) {
  const config = JSON.parse(read(root, "public/admin/config.yml"));
  const found = {};
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((item) => walk(item, path));
    if (!node || typeof node !== "object") return;
    const here = node.name ? [...path, node.name] : path;
    if (Array.isArray(node.pattern) && typeof node.pattern[0] === "string") found[here.join(".")] = new RegExp(node.pattern[0]);
    for (const [key, value] of Object.entries(node)) if (key !== "pattern") walk(value, here);
  };
  walk(config.collections, []);
  const pick = (suffix) => {
    const keys = Object.keys(found).filter((key) => key.endsWith(suffix));
    assert.ok(keys.length, `后台缺少格式规则：${suffix}`);
    return keys.map((key) => found[key]);
  };
  return {
    link: [...pick("site.social.url"), ...pick("links.links.url")],
    external: pick("nav.external.url"),
    icon: pick("icon_image"),
    origin: pick("comments.origin"),
    username: pick("newsletter.username"),
  };
}

const samples = {
  link: {
    ok: ["https://github.com/someone", "http://a.example/c?d=1#e", "/about/", "mailto:me@example.org", "tel:+861234", "https://例子.中国/路径"],
    bad: ["javascript:alert(1)", "not a url", "//evil.example/x", "https://u:p@x.example/", "https:///x", "ftp://x.example", "https://x.example/a b", "data:text/html,x"],
  },
  external: { ok: ["https://x.example/", "http://x.example/a?b"], bad: ["/about/", "mailto:a@b.example", "javascript:alert(1)", "https://u@x.example/"] },
  icon: {
    // The bare filename is only seen by CMS validation mid-upload; it is saved as /media/<name>.
    ok: ["", "/media/probe.webp", "/media/probe.svg", "https://cdn.example/icons/a.WEBP?v=1"],
    cmsOnly: ["probe.webp"],
    bad: ["http://e.example/x.svg", "//e.example/x.svg", "https://user:pass@e.example/x.svg", "https://e.example/profile", "https://e.example/x.svg#part", "/media/../x.svg", "/media/a/../x.svg", "/media/x.gif", "data:image/svg+xml,x"],
  },
  origin: { ok: ["", "https://comments.example.com", "https://c.example.com:8443/"], bad: ["http://c.example.com", "https://c.example.com/path", "https://c.example.com:65536", "https://u@c.example.com", "https://c.example.com?x"] },
  username: { ok: ["", "synthetic-user", "A_b-9"], bad: ["user@host", "https://evil.example", "../x", "-x", "has space"] },
};

test("后台格式规则与构建规则一致：后台可保存的值都能构建，构建拒绝的典型值后台先拦下", () => {
  const f = fixture();
  try {
    put(f.root, "assets/media/probe.webp", clean.webp());
    put(f.root, "assets/media/probe.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10Z"/></svg>');
    const first = build(f.root); assert.equal(first.status, 0, first.stderr);
    const rules = cmsPatterns(f.root);

    for (const [kind, { ok, bad, cmsOnly = [] }] of Object.entries(samples)) {
      for (const re of rules[kind]) {
        for (const value of [...ok, ...cmsOnly]) assert.ok(re.test(value), `后台误拒 ${kind}: ${value}`);
        for (const value of bad) assert.ok(!re.test(value), `后台放行了构建会拒绝的 ${kind}: ${value}`);
      }
    }

    // Every CMS-accepted value, in one site, must build cleanly.
    f.site.social = [
      ...samples.link.ok.map((url, i) => ({ label: `L${i}`, url, icon: "link" })),
      ...samples.icon.ok.map((icon_image, i) => ({ label: `I${i}`, url: "https://x.example/", icon: "link", icon_image })),
    ];
    f.site.nav.push(...samples.external.ok.map((url, i) => ({ type: "external", label: `E${i}`, url })));
    f.saveSite();
    put(f.root, "data/links.yaml", JSON.stringify(samples.link.ok.map((url, i) => ({ name: `F${i}`, url }))));
    put(f.root, "data/comments.yaml", JSON.stringify({ enabled: true, origin: "https://c.example.com:8443/" }));
    put(f.root, "data/newsletter.yaml", JSON.stringify({ enabled: true, username: "A_b-9" }));
    const accepted = build(f.root); assert.equal(accepted.status, 0, accepted.stderr);

    // The counterexamples are real build failures, so the CMS rule is not stricter for no reason.
    for (const [kind, set] of [["link", "social"], ["icon", "icon"]]) {
      for (const value of samples[kind].bad) {
        f.site.social = [set === "social" ? { label: "x", url: value, icon: "link" } : { label: "x", url: "https://x.example/", icon_image: value }];
        f.saveSite();
        assert.notEqual(build(f.root).status, 0, `构建应拒绝 ${kind}: ${value}`);
      }
    }
    f.site.social = []; f.saveSite();
    for (const origin of samples.origin.bad) {
      put(f.root, "data/comments.yaml", JSON.stringify({ enabled: true, origin }));
      assert.notEqual(build(f.root).status, 0, `构建应拒绝 origin: ${origin}`);
    }
  } finally { f.cleanup(); }
});
