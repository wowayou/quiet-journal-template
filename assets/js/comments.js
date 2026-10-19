// The blog knows only the panel origin and a stable article key. No Waline code/API/auth here.
export const PROTOCOL = "quiet-journal-comments";
export const VERSION = 1;
export function panelURL(origin, key, theme = "light") {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("评论面板必须是 HTTPS 源。");
  if (!/^\/posts\/[\p{L}\p{N}][\p{L}\p{N}._-]{0,95}\/$/u.test(key)) throw new Error("评论文章 ID 无效。");
  url.hash = new URLSearchParams({ key, theme: theme === "dark" ? "dark" : "light" }).toString();
  return url;
}

export function initComments(root) {
  const open = root.querySelector("[data-comments-open]");
  const close = root.querySelector("[data-comments-close]");
  const status = root.querySelector("[data-comments-status]");
  const container = root.querySelector("[data-comments-frame]");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const theme = () => {
    const selected = document.documentElement.dataset.theme;
    return selected === "dark" || (selected !== "light" && systemTheme.matches) ? "dark" : "light";
  };
  let origin;
  try {
    origin = panelURL(root.dataset.origin, root.dataset.key).origin;
    if (origin === window.location.origin) throw new Error("Same-origin panel is not allowed");
  } catch {
    status.textContent = "评论配置无效，已停止连接。请联系站点作者。";
    root.querySelector("a").hidden = true;
    return;
  }
  let frame = null, timer = null;
  root.dataset.state = "idle";
  open.hidden = false;
  const sendTheme = () => frame?.contentWindow?.postMessage({ protocol: PROTOCOL, version: VERSION, type: "theme", theme: theme() }, origin);
  const observer = new MutationObserver(sendTheme);
  const removeFrame = () => {
    clearTimeout(timer); timer = null;
    observer.disconnect();
    systemTheme.removeEventListener("change", sendTheme);
    frame?.remove(); frame = null;
    close.hidden = true;
    open.hidden = false;
    open.disabled = false;
  };
  const fail = () => {
    removeFrame(); root.dataset.state = "error";
    status.textContent = "评论面板未能加载，未自动重试。可手动重试，或在独立窗口留言。";
    open.textContent = "重试加载评论";
  };
  open.addEventListener("click", () => {
    if (frame) return;
    root.dataset.state = "loading";
    status.textContent = "正在连接独立评论面板…";
    open.disabled = true; close.hidden = false;
    frame = document.createElement("iframe");
    frame.className = "comments__frame";
    frame.title = "独立评论面板：留言与回复";
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    frame.src = panelURL(origin, root.dataset.key, theme()).href;
    frame.addEventListener("error", fail, { once: true });
    timer = setTimeout(fail, 12000);
    container.append(frame);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    systemTheme.addEventListener("change", sendTheme);
  });
  window.addEventListener("message", (event) => {
    if (!frame || event.origin !== origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.protocol !== PROTOCOL || data.version !== VERSION) return;
    if (data.type === "error") { fail(); return; }
    if (data.type !== "ready" || root.dataset.state !== "loading") return;
    clearTimeout(timer); timer = null;
    root.dataset.state = "ready";
    open.hidden = true;
    status.textContent = "评论界面已加载。留言结果和审核状态以面板提示为准；不会发送邮件通知。";
    sendTheme();
  });
  close.addEventListener("click", () => {
    if (root.dataset.state === "ready" && !window.confirm("关闭会退出评论面板，未发送文字可能丢失；已发送留言不会撤回。确定关闭？")) return;
    removeFrame(); root.dataset.state = "idle";
    open.textContent = "加载评论";
    status.textContent = "评论已关闭。重新加载才会再次连接独立服务。";
    open.focus();
  });
  window.addEventListener("pagehide", removeFrame, { once: true });
}
if (typeof document !== "undefined") document.querySelectorAll("[data-comments]").forEach(initComments);
