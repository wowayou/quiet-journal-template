// Optional browser checks use the browser already installed by the maintainer; no auto-downloads.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
export const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export async function launchBrowser(binary = process.env.QJ_CHROMIUM, { certificateSPKI } = {}) {
  if (!binary || typeof WebSocket === "undefined") throw new Error("浏览器检查需要 Node 22+，并设置 QJ_CHROMIUM 指向本机 Chromium；不会自动下载浏览器。");
  if (certificateSPKI && !/^[A-Za-z0-9+/]{43}=$/.test(certificateSPKI)) throw new Error("本地测试证书的 SPKI 指纹格式无效。");
  const profile = mkdtempSync(join(tmpdir(), "qj-browser-"));
  // Only the caller's ephemeral test certificate may bypass validation, never all certificates.
  const certificate = certificateSPKI ? [`--ignore-certificate-errors-spki-list=${certificateSPKI}`] : [];
  // Headless Linux may report no pointing device. Model a desktop mouse explicitly;
  // the viewport test switches to touch emulation for mobile cases.
  const noSandbox = process.env.QJ_CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
  const proc = spawn(binary, ["--headless", ...noSandbox, ...certificate, "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let logs = "";
  proc.stderr.on("data", (data) => { logs += data; });
  const exit = once(proc, "exit").catch(() => {});
  let ws;
  const close = async () => { ws?.close(); proc.kill(); await Promise.race([exit, wait(2000)]); rmSync(profile, { recursive: true, force: true }); };
  try {
    let failure;
    proc.on("error", (error) => { failure = error; });
    for (let i = 0; i < 100 && !/DevTools listening on ws:/.test(logs); i++) { if (failure) throw failure; await wait(100); }
    const browserURL = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (!browserURL) throw new Error(`Chromium 未启动：${logs.slice(-500)}`);
    const endpoint = `http://${new URL(browserURL).host}`;
    const target = (await (await fetch(`${endpoint}/json/list`)).json()).find((entry) => entry.type === "page");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, reject) => { ws.onopen = done; ws.onerror = reject; });
    let next = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.done(message.result);
      } else for (const listener of listeners) listener(message);
    };
    const send = (method, params = {}) => new Promise((done, reject) => {
      const id = ++next;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { done, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const value = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
      return value.result?.value;
    };
    await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Log.enable");
    return { send, evaluate, on: (listener) => listeners.add(listener), close };
  } catch (error) { await close(); throw error; }
}
