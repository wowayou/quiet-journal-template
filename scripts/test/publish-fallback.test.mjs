import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fallback, parseArgs, validateStaticConfig } from "../publish-fallback.mjs";

// All Git remotes are local temporary directories. Never use real credentials/deployments.
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "qj-publish-"));
  const root = join(base, "blog"), remote = join(base, "origin.git");
  mkdirSync(root);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git("init", "-b", "main");
  git("config", "user.name", "Synthetic test"); git("config", "user.email", "synthetic@example.test");
  writeFileSync(join(root, ".gitignore"), "public/\n");
  writeFileSync(join(root, "content.md"), "synthetic content");
  git("add", "."); git("commit", "-qm", "synthetic");
  git("clone", "--bare", ".", remote); git("remote", "add", "origin", remote);
  const commit = git("rev-parse", "HEAD"), calls = [], logs = [];
  const config = { name: "test-blog", preview_urls: false, assets: { directory: "./public" } };
  const options = { deploy: true, commit, worker: config.name, account: "a".repeat(32), buildsPaused: true };
  const run = (program, args, opts) => {
    calls.push({ program, args, env: opts.env });
    if (program === "git") return spawnSync(program, args, opts);
    return { status: 0, stdout: args[1] === "deployments" ? '[{"id":"synthetic-existing-deployment"}]' : "" };
  };
  const invoke = (extra = {}) => fallback({ root, run, loadConfig: () => config, log: (text) => logs.push(text), ...extra });
  const deployed = () => calls.filter(c => c.program === process.execPath && c.args[1] === "deploy");
  return { base, root, remote, git, commit, calls, config, options, run, invoke, deployed, logs, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("发布兜底：默认只检查，完整构建前后核对实时远端，无 fetch/push/云端请求", async () => {
  const f = fixture(); try {
    assert.deepEqual(await f.invoke(), { commit: f.commit, worker: "test-blog", deployed: false });
    assert.equal(f.calls.filter(c => c.args[0] === "ls-remote").length, 2);
    assert.ok(f.calls.some(c => c.args.join(" ") === "run build"));
    assert.ok(!f.calls.some(c => c.program === process.execPath || c.args.some(a => ["fetch", "pull", "push", "reset", "stash"].includes(a))));
    assert.equal(f.deployed().length, 0);
    assert.ok(f.logs.at(-1).includes("未部署"));
    assert.equal(existsSync(join(f.root, ".git/qj-publish-fallback.lock")), false);
  } finally { f.cleanup(); }
});

test("发布兜底：显式确认后只对现有目标发布一次，关闭遥测并指定账户/无额外环境", async () => {
  const f = fixture(); try {
    assert.equal((await f.invoke({ options: f.options })).deployed, true);
    assert.equal(f.deployed().length, 1);
    const list = f.calls.findIndex(c => c.args[1] === "deployments");
    assert.ok(list > f.calls.findIndex(c => c.args[0] === "run"));
    assert.ok(f.calls.slice(list + 1, -1).some(c => c.args[0] === "ls-remote"));
    const deploy = f.deployed()[0];
    assert.equal(deploy.env.CLOUDFLARE_ACCOUNT_ID, f.options.account);
    assert.equal(deploy.env.WRANGLER_SEND_METRICS, "false");
    assert.deepEqual(deploy.args.slice(-4), ["--env", "", "--message", `Manual fallback ${f.commit}`]);
  } finally { f.cleanup(); }
});

for (const condition of ["dirty", "untracked", "branch", "ahead", "behind"]) test(`发布兜底：${condition} 停止，绝不从开发区误发旧内容`, async () => {
  const f = fixture(); try {
    if (condition === "dirty") writeFileSync(join(f.root, "content.md"), "unsaved changes");
    if (condition === "untracked") writeFileSync(join(f.root, "private.md"), "uncommitted");
    if (condition === "branch") f.git("checkout", "-b", "cms/synthetic");
    if (["ahead", "behind"].includes(condition)) {
      f.git("commit", "--allow-empty", "-qm", "new synthetic content");
      if (condition === "behind") { f.git("push", "origin", "main"); f.git("reset", "--hard", "HEAD~1"); }
    }
    await assert.rejects(f.invoke({ options: f.options }), /未提交|生产分支|最新 main/);
    assert.ok(!f.calls.some(c => c.program !== "git"));
    assert.equal(f.deployed().length, 0);
  } finally { f.cleanup(); }
});

test("发布兜底：远端查询失败不假设本地已最新，也不重试", async () => {
  const f = fixture(); try {
    await assert.rejects(f.invoke({ run: (p, a, o) => a[0] === "ls-remote" ? (f.calls.push({ args: a }), { status: 1 }) : f.run(p, a, o) }), /Git 检查失败/);
    assert.equal(f.calls.filter(c => c.args[0] === "ls-remote").length, 1);
    assert.equal(f.deployed().length, 0);
  } finally { f.cleanup(); }
});

test("发布兜底：构建失败不能部署旧 public，失败后可再次检查", async () => {
  const f = fixture(); try {
    mkdirSync(join(f.root, "public")); writeFileSync(join(f.root, "public/index.html"), "OLD");
    await assert.rejects(f.invoke({ options: f.options, run: (p, a, o) => a[0] === "run" ? { status: 1 } : f.run(p, a, o) }), /构建\/目标检查失败/);
    assert.equal(f.deployed().length, 0);
    assert.equal(existsSync(join(f.root, ".git/qj-publish-fallback.lock")), false);
    assert.equal((await f.invoke()).deployed, false);
  } finally { f.cleanup(); }
});

for (const condition of ["local", "remote"]) test(`发布兜底：构建期间 ${condition} 内容变化必须停止`, async () => {
  const f = fixture(); try {
    const run = (p, a, o) => {
      if (a[0] === "run") {
        if (condition === "local") writeFileSync(join(f.root, "content.md"), "concurrent edit");
        else {
          f.git("commit", "--allow-empty", "-qm", "concurrent CMS save"); f.git("push", "origin", "main"); f.git("reset", "--hard", f.commit);
        }
      }
      return f.run(p, a, o);
    };
    await assert.rejects(f.invoke({ options: f.options, run }), /未提交|最新 main|提交变化/);
    assert.equal(f.deployed().length, 0);
  } finally { f.cleanup(); }
});

test("发布兜底：错误确认、脚本型 Worker、错误资产目录在发布前拒绝", async () => {
  const f = fixture(); try {
    for (const options of [{ ...f.options, commit: "b".repeat(40) }, { ...f.options, worker: "other" }]) {
      await assert.rejects(f.invoke({ options }), /提交.*不符|Worker\/账户/);
    }
    for (const config of [
      { ...f.config, main: "src/index.js" }, { ...f.config, preview_urls: true }, { ...f.config, build: { command: "external-build" } },
      { ...f.config, assets: { directory: "../private" } }, { ...f.config, assets: { directory: "public", run_worker_first: true } },
      { ...f.config, account_id: "b".repeat(32) },
    ]) assert.throws(() => validateStaticConfig(config, f.root, f.options), /纯静态|Worker\/账户/);
    assert.equal(f.deployed().length, 0);
  } finally { f.cleanup(); }
});

test("发布兜底：目标查询失败停止；部署失败结果不明，不重发", async () => {
  for (const stage of ["deployments", "deploy"]) {
    const f = fixture(); try {
      await assert.rejects(f.invoke({ options: f.options, run: (p, a, o) => {
        const result = f.run(p, a, o);
        return a[1] === stage ? { status: null, error: new Error("simulated timeout") } : result;
      } }), stage === "deploy" ? /先查看.*不要自动重试/ : /目标检查失败/);
      assert.equal(f.deployed().length, stage === "deploy" ? 1 : 0);
    } finally { f.cleanup(); }
  }
});

test("发布兜底：目标没有现有部署或响应不明时不能新建或覆盖 Worker", async () => {
  for (const stdout of ["[]", "not-json", "{}"]) {
    const f = fixture(); try {
      await assert.rejects(f.invoke({ options: f.options, run: (p, a, o) => {
        const result = f.run(p, a, o);
        return a[1] === "deployments" ? { status: 0, stdout } : result;
      } }), /无法确认|现有部署/);
      assert.equal(f.deployed().length, 0);
    } finally { f.cleanup(); }
  }
});

test("发布兜底：隐藏的环境/目标覆盖在任何命令之前拒绝", async () => {
  for (const key of ["CLOUDFLARE_ENV", "WRANGLER_ENV", "WRANGLER_CI_OVERRIDE_NAME"]) {
    const previous = process.env[key]; process.env[key] = "synthetic-other-target";
    const calls = [];
    try {
      await assert.rejects(fallback({ run: (...args) => calls.push(args) }), /隐藏的环境或目标覆盖/);
      assert.equal(calls.length, 0);
    } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
  }
});

test("发布兜底：单任务锁不自动清除；public 符号链接不清理外部目录", async () => {
  const f = fixture(); try {
    const lock = join(f.root, ".git/qj-publish-fallback.lock");
    writeFileSync(lock, "existing task");
    await assert.rejects(f.invoke(), /已有本地发布任务/);
    assert.equal(readFileSync(lock, "utf8"), "existing task"); rmSync(lock);
    const outside = join(f.base, "private"); mkdirSync(outside); writeFileSync(join(outside, "keep"), "safe");
    symlinkSync(outside, join(f.root, "public"));
    await assert.rejects(f.invoke(), /普通目录|符号链接/);
    assert.equal(readFileSync(join(outside, "keep"), "utf8"), "safe");
    assert.ok(!f.calls.some(c => c.args[0] === "run"));
  } finally { f.cleanup(); }
});

test("发布兜底：CLI 默认安全，缺少确认、拼写错误和重复参数不得放行", () => {
  assert.deepEqual(parseArgs([]), { deploy: false });
  assert.deepEqual(parseArgs(["--check"]), { deploy: false, check: true });
  for (const args of [["--deploy"], ["--worker", "x"], ["--check", "--deploy"], ["--check", "--check"], ["--unknown"], ["--commit"], ["--deploy", "--commit", "short"]]) assert.throws(() => parseArgs(args));
});
