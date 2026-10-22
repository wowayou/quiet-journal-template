#!/usr/bin/env node
// Local content workspace: exact loopback Host, independent session, one bounded task, no Git writes.
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, createWriteStream, createReadStream, rmSync } from "node:fs";
import { dirname, join, resolve, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { once } from "node:events";
import { contentBytes, checkedFile, fingerprint, LIMITS, newOutput } from "./content-transfer.mjs";
import { ZIP_LIMITS } from "./content-zip.mjs";

const ui = new URL("./transfer-ui/", import.meta.url);
const assets = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]]]);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const token = () => randomBytes(16).toString("hex");
const directory = (path) => {
  const value = resolve(path);
  try { const stat = lstatSync(value); if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("请选择普通本地目录，不能使用符号链接。"); return realpathSync(value); }
  catch (error) { if (error.code === 'ENOENT') throw failure(`目录不存在：${value}。请检查完整路径，或重新选择内容包。`); if (error.code === 'EACCES') throw failure(`无法读取目录：${value}。请检查本机文件权限。`); throw error; }
};
export async function startContentUI({ source = process.cwd(), folder = dirname(resolve(source)), taskTimeoutMs = 120000 } = {}) {
  if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs < 1 || taskTimeoutMs > 120000) throw failure("任务超时必须在两分钟以内。");
  source = directory(source); folder = directory(folder);
  const secret = randomBytes(32).toString("hex"), tasks = new Map(), downloads = new Map();
  let origin, active;
  const view = (task, details = false) => ({ id: task.id, action: task.action, status: task.status, stage: task.stage, current: task.current, total: task.total, path: task.path, result: details ? task.result : task.result && { files: task.result.files, bytes: task.result.bytes, counts: task.result.counts, output: task.result.output, format: task.result.format, includeSettings: task.result.includeSettings }, error: task.error });
  function snapshot(name) {
    if (typeof name !== "string" || !name) throw failure("请选择目录快照。");
    if (isAbsolute(name)) return directory(name);
    if (name.startsWith(".") || /[\/\\\u0000-\u001f]/.test(name) || basename(name) !== name) throw failure("请选择列表中的快照，或填写绝对目录路径。");
    return directory(join(folder, name));
  }
  function list() {
    const entries = readdirSync(folder, { withFileTypes: true });
    if (entries.length > 2000) throw failure("存放目录超过 2,000 项，请用 --folder 指定专用目录。");
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try { if (lstatSync(join(folder, entry.name, "manifest.json")).isFile()) snapshots.push(entry.name); }
      catch (e) { if (!["ENOENT", "EACCES"].includes(e.code)) throw e; }
    }
    return { source, folder, snapshots: snapshots.sort().reverse(), active: active?.id, tasks: [...tasks.values()].map(task => view(task)), limits: { fileBytes: LIMITS.fileBytes, totalBytes: LIMITS.totalBytes, zipBytes: ZIP_LIMITS.bytes } };
  }
  function reserve(data) {
    if (!/^[a-f0-9]{32}$/.test(data.id || "")) throw failure("缺少有效操作 ID。");
    const signature = fingerprint(data), previous = tasks.get(data.id);
    if (previous) { if (previous.signature !== signature) throw failure("同一个操作 ID 不能用于另一项操作。", 409); return previous; }
    if (active) throw failure("已有内容操作进行中，请等待或取消。", 409);
    if (tasks.size >= 40) throw failure("本次会话已完成 40 次操作，请结束后重新启动工具。");
    const root = newOutput(join(folder, `journal-${data.action}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${data.id.slice(0, 8)}`), source);
    mkdirSync(root, { mode: 0o700 });
    const task = { id: data.id, startedAt: Date.now(), action: data.action, status: "running", stage: "checking", root, signature, cancel: new SharedArrayBuffer(4) };
    tasks.set(task.id, task); active = task; return task;
  }
  function launch(task, options) {
    if(taskTimeoutMs - (Date.now() - task.startedAt) <= 0) Atomics.store(new Int32Array(task.cancel),0,1);
    const worker = new Worker(new URL("./content-worker.mjs", import.meta.url), { workerData: { ...options, action: task.action, source, root: task.root, cancel: task.cancel }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
    task.worker = worker;
    const stop = (status, error) => { if (task.status !== "running") return; task.status = status; task.error = error; if (active === task) active = undefined; clearTimeout(task.timer); };
    worker.on("message", (message) => {
      if (message.type === "progress") Object.assign(task, { stage: message.stage, current: message.current, total: message.total, path: message.path });
      else if (message.type === "complete") { task.result = message.result; stop("completed"); }
      else if (message.type === "failed") stop(message.cancelled ? "cancelled" : "failed", message.error);
    });
    worker.on("error", (error) => stop("failed", `${error.message} 请检查临时目录 ${task.root}；未触碰当前博客。`));
    worker.on("exit", (code) => { if (task.status === "running") stop("failed", `任务意外结束（${code}），请检查 ${task.root} 的清单/报告；不要盲目重试。`); });
    task.timer = setTimeout(() => { Atomics.store(new Int32Array(task.cancel), 0, 1); task.stage = "cancelling"; task.error = "任务超过时间上限，正在取消。"; setTimeout(() => { if (task.status === "running") worker.terminate(); }, 5000).unref(); }, Math.max(1, taskTimeoutMs - (Date.now() - task.startedAt)));
  }
  const server = createServer(async (req, res) => {
    const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "X-Frame-Options": "DENY", "Cross-Origin-Opener-Policy": "same-origin" };
    const send = (status, value, type = "application/json; charset=utf-8") => {
      // An early rejection must not leave an unread upload on a reusable connection.
      res.writeHead(status, { ...headers, ...(!req.complete ? { Connection: 'close' } : {}), "Content-Type": type });
      res.end(type.startsWith("application/json") ? JSON.stringify(value) : value);
    };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") throw failure("仅允许从本机工具访问。", 403);
      if (req.method === "GET" && assets.has(req.url)) { const [name, type] = assets.get(req.url); return send(200, readFileSync(new URL(name, ui)), type); }
      if (req.method === "GET" && req.url.startsWith("/download/")) {
        const key = req.url.slice(10), grant = downloads.get(key);
        if (!grant || grant.until < Date.now() || req.headers.cookie?.split('; ').find(pair => pair.startsWith('qj-download=')) !== `qj-download=${grant.cookie}`) throw failure("下载许可已失效，请重新点击下载。", 403);
        downloads.delete(key);
        const file = grant.task.result.output, stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== grant.task.result.archiveBytes) throw failure("输出文件已变化，请核对结果。", 409);
        res.writeHead(200, { ...headers, "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="journal-content.zip"', "Content-Length": stat.size, "Set-Cookie": `qj-download=; Path=/download/${key}; Max-Age=0; HttpOnly; SameSite=Strict` });
        await pipeline(createReadStream(file), res); return;
      }
      const given = Buffer.from(req.headers.authorization || ""), expected = Buffer.from(`Bearer ${secret}`);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw failure("会话失效，请用终端完整地址重新连接。", 403);
      if (req.method === "GET" && req.url === "/api/status") return send(200, list());
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/api/task') {
        const task = tasks.get(url.searchParams.get('id'));
        if (!task) throw failure('操作不存在。', 404);
        return send(200, view(task, true));
      }
      if (req.method === 'POST' && url.pathname === '/api/download-ticket') {
        if (Number(req.headers['content-length'] || 0) > 4096) throw failure('操作参数过长。', 413);
        req.resume();
        const task = tasks.get(url.searchParams.get('id'));
        if (!task || task.status !== 'completed' || task.action !== 'export' || task.result.format !== 'zip') throw failure('没有可下载的内容包。', 404);
        for (const [key, item] of downloads) if (item.until < Date.now()) downloads.delete(key);
        if (downloads.size >= 4) throw failure('已有下载许可，请先完成或等待一分钟。', 409);
        const key = token(), cookie = token();
        downloads.set(key, { cookie, task, until: Date.now() + 60000 });
        res.setHeader('Set-Cookie', `qj-download=${cookie}; Path=/download/${key}; Max-Age=60; HttpOnly; SameSite=Strict`);
        return send(200, { url: `/download/${key}` });
      }
      if (req.method === "GET" && ["/api/report", "/api/download", "/api/file"].includes(url.pathname)) {
        const task = tasks.get(url.searchParams.get("id"));
        if (!task || task.status !== "completed") throw failure("找不到已完成的操作。", 404);
        if (url.pathname === "/api/report") { res.setHeader("Content-Disposition", 'attachment; filename="journal-report.json"'); return send(200, task.result); }
        if (url.pathname === "/api/file") {
          const path = url.searchParams.get("path"), wanted = task.result.comparison?.find((entry) => entry.path === path);
          if (!wanted || !/\.(md|yaml)$/i.test(path)) throw failure("只提供已检查条目的纯文本差异。", 400);
          const expected = task.result.entries.find((entry) => entry.path === path);
          if (expected.bytes > 256 * 1024) throw failure("文件超过差异预览上限 256 KiB，请下载报告后本地查看。");
          const incoming = contentBytes(join(task.result.snapshot, "files"), path, 256 * 1024);
          if (incoming.length !== expected.bytes || createHash("sha256").update(incoming).digest("hex") !== expected.sha256) throw failure("内容包已改变，请重新检查。", 409);
          let existing = "";
          try { const file = checkedFile(source, path); if (lstatSync(file).size <= 256 * 1024) existing = contentBytes(source, path, 256 * 1024).toString("utf8"); else existing = "（本站文件过大，请本地比较）"; } catch (e) { if (e.code !== "ENOENT") existing = "（本站路径不是同类型普通文件，或已改变）"; }
          return send(200, { path, incoming: incoming.toString("utf8"), current: existing });
        }
        if (task.action !== "export" || task.result.format !== "zip") throw failure("此操作没有 ZIP 下载。");
        const path = task.result.output;
        const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== task.result.archiveBytes) throw failure("输出文件已改变，请重新核对。");
        res.writeHead(200, { ...headers, "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="journal-content.zip"', "Content-Length": stat.size });
        return await pipeline(createReadStream(path), res);
      }
      if (req.method === "POST" && url.pathname === "/api/upload") {
        if (req.headers["content-type"] !== "application/zip") throw failure("请选择 ZIP 内容包。", 415);
        if (Number(req.headers['content-length'] || 0) > ZIP_LIMITS.bytes) throw failure("ZIP 上传超过体积上限。", 413);
        const data = { id: url.searchParams.get("id"), action: "upload" }, task = reserve(data);
        if (task.worker || task.receiving || task.status !== "running") return send(200, view(task));
        task.receiving = true;
        task.stage = "receiving";
        task.uploadAbort = new AbortController();
        task.timer = setTimeout(() => task.uploadAbort.abort(new Error('本机文件接收超时。')), Math.max(1, taskTimeoutMs - (Date.now() - task.startedAt)));
        const incoming = join(task.root, "incoming.zip"); let size = 0;
        try {
          await pipeline(req, new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > ZIP_LIMITS.bytes ? new Error("ZIP 上传超过体积上限。") : null, chunk); } }), createWriteStream(incoming, { flags: "wx", mode: 0o600 }), { signal: task.uploadAbort.signal });
          clearTimeout(task.timer);
          launch(task, { incoming }); return send(202, view(task));
        } catch (e) {
          clearTimeout(task.timer);
          task.status = Atomics.load(new Int32Array(task.cancel)) ? 'cancelled' : 'failed'; task.error = e.message;
          if (active === task) active = undefined;
          try { rmSync(task.root, { recursive: true, force: true }); }
          catch (cleanup) { task.error += ` 清理未完成：${cleanup.message}，请检查 ${task.root}`; }
          if (!res.destroyed) return send(400, view(task));
          return;
        }
      }
      if (req.method !== "POST" || req.url !== "/api/action") throw failure("不支持的操作。", 404);
      if (req.headers["content-type"] !== "application/json") throw failure("只接受 JSON 参数。", 415);
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 4096) throw failure("操作参数过长。", 413); chunks.push(chunk); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || Array.isArray(data) || Object.keys(data).some((key) => !["id", "action", "snapshot", "reviewId", "includePrivate", "includeSettings", "format"].includes(key))) throw failure("无效操作参数。");
      if (data.action === "cancel") {
        const task = tasks.get(data.id); if (!task) throw failure("操作不存在。", 404);
        if (task.status === "running") { Atomics.store(new Int32Array(task.cancel), 0, 1); task.stage = "cancelling"; task.uploadAbort?.abort(); }
        return send(200, view(task));
      }
      if (!["inventory", "export", "inspect", "import"].includes(data.action)) throw failure("不支持的操作。");
      if (tasks.has(data.id)) { const task = reserve(data); return send(200, view(task)); }
      let incoming, review;
      if (data.action === "inspect") incoming = snapshot(data.snapshot);
      if (data.action === "import") {
        const reviewed = tasks.get(data.reviewId);
        if (!reviewed || reviewed.status !== "completed" || !["inspect", "upload"].includes(reviewed.action)) throw failure("请先选择并检查内容包，再确认恢复。", 409);
        incoming = reviewed.result.snapshot; review = reviewed.result;
      }
      if (["export", "import"].includes(data.action) && data.includePrivate !== true) throw failure("请明确确认其中包含私人内容。");
      if (data.format && !["zip", "directory"].includes(data.format)) throw failure("输出格式必须是 ZIP 或目录。");
      const task = reserve(data);
      if (!task.worker && task.status === "running") launch(task, { incoming, review, includePrivate: data.includePrivate, includeSettings: data.includeSettings !== false, format: data.format || "zip" });
      return send(202, view(task));
    } catch (error) { if (!res.headersSent && !res.destroyed) send(error.status || 400, { error: error instanceof SyntaxError ? "操作参数不是有效 JSON。" : error.message }); }
  });
  server.requestTimeout = 120000; server.headersTimeout = 10000; server.timeout = 120000;
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, url: `${origin}/#${secret}`, close: async () => {
    active?.uploadAbort?.abort();
    if (active?.worker) {
      const task = active, worker = task.worker;
      Atomics.store(new Int32Array(task.cancel), 0, 1);
      await Promise.race([once(worker, "exit").catch(() => {}), new Promise(done => setTimeout(done, 3000))]);
      if (task.status === "running") await worker.terminate();
    }
    for (const task of tasks.values()) clearTimeout(task.timer);
    await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  } };
}
export async function main(args) {
  if (args.includes("--help")) { console.log("npm run content:ui [-- --folder /已有私人目录]\n仅本机任务界面，ZIP/目录快照，不操作 Git 或自动发布；Ctrl+C 关闭。"); return; }
  if (args.length && (args.length !== 2 || args[0] !== "--folder" || !args[1])) throw failure("只支持 --folder <已有私人目录>。");
  const app = await startContentUI({ folder: args[1] });
  console.log(`\n内容工具（仅本机）：\n${app.url}\n\n请在浏览器打开完整地址。含私人内容，输出不加密。Ctrl+C 关闭。\n`);
  const stop = async () => { await app.close(); process.exit(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(`content-ui：${e.message}`); process.exitCode = 1; });
