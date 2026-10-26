#!/usr/bin/env node
// Manual fallback for Workers Builds. No fetching/merging, cloud builds or automatic retries.
import { spawnSync } from "node:child_process";
import { openSync, closeSync, unlinkSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
export const HELP = `本地发布兜底（请在最新 main 的独立、干净克隆中运行）
  npm run publish:fallback -- --check
  npm run publish:fallback -- --deploy --commit <完整提交 SHA> --worker <现有 Worker> --account <账户 ID> --builds-paused
默认只检查：两次只读查询 origin/main，并运行完整 npm run build；不 fetch/pull，不发布。
发布前先核对账户套餐/额度，暂停该 Worker 的自动构建并等在途构建结束。发布仅运行一次 Wrangler，无自动重试。
失败/超时不代表未上线；先检查 Cloudflare Deployments，不能直接重试。`;

export function parseArgs(args) {
  const options = { deploy: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw new Error(`重复参数：${key}`);
    seen.add(key);
    if (key === "--help") options.help = true;
    else if (key === "--check") options.check = true;
    else if (key === "--deploy") options.deploy = true;
    else if (key === "--builds-paused") options.buildsPaused = true;
    else if (["--commit", "--worker", "--account"].includes(key) && args[i + 1] && !args[i + 1].startsWith("--")) options[key.slice(2)] = args[++i];
    else throw new Error(`未知参数或缺少值：${key}`);
  }
  if (options.check && options.deploy) throw new Error("--check 和 --deploy 不能同时使用。");
  if (!options.deploy && [options.commit, options.worker, options.account, options.buildsPaused].some(Boolean)) throw new Error("发布确认参数必须与 --deploy 一起使用。");
  if (options.deploy && (!SHA.test(options.commit ?? "") || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.worker ?? "") || !/^[a-f0-9]{32}$/.test(options.account ?? "") || !options.buildsPaused)) throw new Error("发布需要完整 --commit、--worker、--account 和 --builds-paused；先核对套餐/额度并暂停自动构建。");
  return options;
}

export function validateStaticConfig(config, root, options) {
  if (!config.name || config.main || config.build?.command || config.assets?.run_worker_first || resolve(root, config.assets?.directory ?? "") !== join(root, "public") || config.preview_urls !== false) throw new Error("兜底只支持 public/ 纯静态资源、无自定义构建/Worker 脚本且关闭版本预览的配置。");
  if (options.deploy && (config.name !== options.worker || config.account_id && config.account_id !== options.account)) throw new Error("确认的 Worker/账户与 wrangler.jsonc 不符，已停止。");
}

export async function fallback({ root = process.cwd(), options = {}, run = spawnSync, loadConfig, log = console.log } = {}) {
  // Validate programmatic callers too, before any command or network request.
  if (options.deploy) parseArgs(["--deploy", "--commit", options.commit ?? "", "--worker", options.worker ?? "", "--account", options.account ?? "", ...(options.buildsPaused ? ["--builds-paused"] : [])]);
  root = resolve(root);
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true", GIT_TERMINAL_PROMPT: "0" };
  if (env.CLOUDFLARE_ENV || env.WRANGLER_ENV || Object.keys(env).some(key => key.startsWith("WRANGLER_CI_") && env[key])) throw new Error("请移除 CLOUDFLARE_ENV / WRANGLER_ENV / WRANGLER_CI_*；兜底不接受隐藏的环境或目标覆盖。");
  if (options.deploy) env.CLOUDFLARE_ACCOUNT_ID = options.account;
  const command = (program, args, { visible = false, timeout = 20000, uncertain = false } = {}) => {
    const result = run(program, args, { cwd: root, env, encoding: "utf8", stdio: visible ? "inherit" : "pipe", timeout, maxBuffer: 4 * 1024 ** 2 });
    if (result.error || result.status !== 0) throw new Error(uncertain ? "部署未确认成功（失败、断线或超时）。先查看 Cloudflare Deployments；不要自动重试。" : `${program === "git" ? "Git 检查" : "本地构建/目标检查"}失败，已停止；未执行部署。`);
    return (result.stdout ?? "").trim();
  };
  const git = (...args) => command("git", args);
  if (resolve(git("rev-parse", "--show-toplevel")) !== root) throw new Error("请在博客仓库根目录运行。");
  const lock = resolve(root, git("rev-parse", "--git-path", "qj-publish-fallback.lock"));
  let fd;
  try { fd = openSync(lock, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") throw new Error("已有本地发布任务或中断留下的锁；先核实任务与线上状态，不自动解锁/重试。"); throw error; }
  try {
    const output = lstatSync(join(root, "public"), { throwIfNoEntry: false });
    if (output && !output.isDirectory()) throw new Error("public 必须是普通目录，不能经由符号链接清理其他位置。");
    const clean = () => {
      if (git("status", "--porcelain", "--untracked-files=normal")) throw new Error("工作区有未提交文件。请使用远端最新 main 的独立干净克隆，勿 stash/reset 在用工作区。");
      if (git("symbolic-ref", "--short", "HEAD") !== "main") throw new Error("兜底只允许生产分支 main。");
      const head = git("rev-parse", "HEAD");
      if (!SHA.test(head)) throw new Error("无法确认完整提交身份。");
      return head;
    };
    const current = () => {
      const head = clean();
      const remote = git("ls-remote", "--exit-code", "origin", "refs/heads/main");
      if (remote !== `${head}\trefs/heads/main`) throw new Error("本地提交不是远端最新 main，或远端身份不明。重新同步独立克隆后再检查；不自动合并或覆盖文章。");
      return head;
    };
    const commit = current();
    if (options.deploy && options.commit !== commit) throw new Error("确认的提交与远端最新提交不符，已停止。");
    const config = loadConfig ? await loadConfig() : (await import("wrangler")).unstable_readConfig({ config: join(root, "wrangler.jsonc"), env: "" });
    validateStaticConfig(config, root, options);
    log(`目标：${config.name}；提交：${commit}；${options.deploy ? "完整构建通过后发布" : "只检查，不发布"}`);
    // Use the existing production pipeline, retaining config/media/privacy/link checks and clean output.
    command(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { visible: true, timeout: 120000 });
    const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
    if (options.deploy) {
      // Fail rather than silently create a Worker in a wrong/new account.
      const output = command(process.execPath, [wrangler, "deployments", "list", "--config", join(root, "wrangler.jsonc"), "--env", "", "--json"], { timeout: 30000 });
      let deployments;
      try { deployments = JSON.parse(output); } catch { throw new Error("目标部署列表无法确认，未执行部署。"); }
      if (!Array.isArray(deployments) || deployments.length === 0) throw new Error("目标没有可确认的现有部署；兜底不新建 Worker。");
    }
    if (current() !== commit) throw new Error("构建期间提交变化，必须重新检查和确认。");
    if (options.deploy) {
      command(process.execPath, [wrangler, "deploy", "--config", join(root, "wrangler.jsonc"), "--env", "", "--message", `Manual fallback ${commit}`], { visible: true, timeout: 120000, uncertain: true });
      log("Wrangler 已报告部署成功。仍需检查实际文章、首页与后台；不要仅凭保存提示判断上线。");
    } else log("完整生产构建与最新提交核对通过；未部署。发布时需再次完整检查并显式确认提交、Worker 和账户。");
    return { commit, worker: config.name, deployed: !!options.deploy };
  } finally { closeSync(fd); unlinkSync(lock); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else await fallback({ options });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
