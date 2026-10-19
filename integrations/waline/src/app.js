import { readThread, validateConfig } from "./config.js";
import { anonymousTransport } from "./transport.js";

const PROTOCOL = "quiet-journal-comments", VERSION = 1;
const notice = document.querySelector("#notice");
const root = document.querySelector("#waline");
const show = (message) => { notice.textContent = String(message).slice(0, 400); };
const initialNotice = "免登录，不收邮箱、不发通知邮件；请回来查看审核结果和回复。发送结果以下方提示为准。";
let config, widget, readError = false;
const tellParent = (type) => {
  if (config && window.parent !== window) window.parent.postMessage({ protocol: PROTOCOL, version: VERSION, type }, config.blogOrigin);
};
try {
  const response = await fetch("./panel-config.json", { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error("评论面板配置未能加载。");
  config = validateConfig(await response.json());
  if (window.location.origin !== config.panelOrigin) throw new Error("评论面板部署源不匹配，已停止进入。不要放到博客或 Waline 管理端同源目录。");
  const thread = readThread(window.location);
  document.documentElement.dataset.theme = thread.theme;
  // This dedicated origin never hosts login. Use per-window storage so two articles/tabs
  // cannot share a live SDK draft; clear legacy persistent data before loading the SDK.
  for (const key of ["WALINE_USER", "WALINE_USER_META", "WALINE_COMMENT_BOX_EDITOR"]) window.localStorage.removeItem(key);
  const storage = window.sessionStorage;
  if (storage.getItem("QJ_WALINE_THREAD") !== thread.key) storage.removeItem("WALINE_COMMENT_BOX_EDITOR");
  storage.setItem("QJ_WALINE_THREAD", thread.key);
  const saved = JSON.parse(storage.getItem("WALINE_USER_META") || "{}");
  storage.removeItem("WALINE_USER");
  storage.setItem("WALINE_USER_META", JSON.stringify({ nick: typeof saved?.nick === "string" ? saved.nick.slice(0, 60) : "", mail: "", link: "" }));
  // The pinned SDK has no public storage option; this alias is confined to its own iframe.
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  const originalFetch = window.fetch.bind(window);
  window.fetch = anonymousTransport({
    apiOrigin: config.apiOrigin, key: thread.key, fetch: originalFetch,
    onError: (message, method) => { readError = method === "GET"; show(message); },
    onSuccess: (method, status) => {
      if (method === "GET" && readError) { readError = false; show(initialNotice); }
      if (method === "POST") {
        readError = false;
        show(status === "waiting" ? "留言已提交，等待作者审核；不会发邮件，请回来查看结果。" : status === "spam" ? "留言已被服务端暂存为垃圾评论，不会公开。" : "留言已提交；不会发邮件，请回来查看回复。");
      }
    },
  });
  window.alert = (message) => { show(message); notice.focus(); notice.scrollIntoView({ block: "nearest" }); };
  const { init } = await import("./vendor/waline-3.16.1.js");
  if (readThread(window.location).key !== thread.key) throw new Error("载入期间文章标识已变化，请重新打开面板。");
  widget = init({
    el: root, serverURL: config.apiOrigin, path: thread.key, lang: "zh-CN", login: "disable",
    meta: ["nick"], requiredMeta: ["nick"], pageSize: 10, wordLimit: 2000, dark: '[data-theme="dark"]',
    emoji: false, search: false, imageUploader: false, highlighter: false, texRenderer: false,
    reaction: false, comment: false, pageview: false, noRss: true,
    locale: { placeholder: "写下留言或回复。昵称不是身份认证，请勿填写敏感信息。", submit: "提交留言" },
  });
  // Waline reply links use fragment anchors. Scroll them without replacing our thread key.
  root.addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#']");
    if (!link || !root.contains(link)) return;
    event.preventDefault();
    try {
      const target = document.getElementById(decodeURIComponent(link.getAttribute("href").slice(1)));
      if (target && root.contains(target)) { target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: "center" }); }
    } catch { show("评论锚点无效。"); }
  });
  show(initialNotice);
  tellParent("ready");
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== config.blogOrigin) return;
    const data = event.data;
    if (data?.protocol === PROTOCOL && data.version === VERSION && data.type === "theme" && ["light", "dark"].includes(data.theme)) document.documentElement.dataset.theme = data.theme;
  });
  window.addEventListener("hashchange", () => {
    try { if (readThread(window.location).key === thread.key) return; } catch { /* Invalid new identity also stops the old form. */ }
    widget?.destroy(); root.hidden = true;
    show("文章标识已变化，已停止原评论表单。请从对应文章重新打开面板，避免把文字发到另一篇文章。");
  });
  window.addEventListener("pagehide", () => widget?.destroy(), { once: true });
} catch (error) {
  root.hidden = true;
  show(`评论面板未能启动：${error.message} 浏览器若限制跨站存储，可从文章的“独立窗口留言”入口尝试；不会自动重试。`);
  tellParent("error");
}
