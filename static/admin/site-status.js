// Shows when the live site was last generated and which settings the build skipped.
// Reads only the public same-origin /build.json; no tokens, GitHub or Cloudflare APIs.

// Pure: turn the fetched status (or a failure) into what the toolbar and dialog show.
export function describeStatus(status, now = Date.now()) {
  if (!status || status.format !== "quiet-journal-status" || typeof status.built !== "string" || !Array.isArray(status.warnings)) {
    return { ok: false, headline: "读不到网站状态。可能还没用新版本构建过，或网络有问题；文章已保存到仓库不受影响。", warnings: [], when: "" };
  }
  const built = Date.parse(status.built);
  if (Number.isNaN(built)) return { ok: false, headline: "网站状态的时间格式无效。", warnings: [], when: "" };
  const minutes = Math.max(0, Math.round((now - built) / 60000));
  const ago = minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`;
  const when = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(built);
  const warnings = status.warnings.filter((item) => typeof item === "string").slice(0, 20);
  return { ok: true, headline: `网站当前版本生成于 ${when}（${ago}）。`, warnings, when, ago };
}

export async function fetchStatus(url, fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(url, { cache: "no-store", credentials: "omit" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function startSiteStatus({ url = new URL("../build.json", document.baseURI).href, fetcher } = {}) {
  const open = document.querySelector("#qj-status-open");
  const marker = document.querySelector("#qj-status-warning");
  const dialog = document.querySelector("#qj-status-dialog");
  const headline = document.querySelector("#qj-status-headline");
  const list = document.querySelector("#qj-status-list");
  const empty = document.querySelector("#qj-status-empty");
  if (!open || !dialog) return;
  let busy = false;
  const refresh = async () => {
    if (busy) return; // One request at a time; never a polling loop.
    busy = true;
    const result = describeStatus(await fetchStatus(url, fetcher));
    busy = false;
    headline.textContent = result.headline;
    list.replaceChildren(...result.warnings.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    list.hidden = result.warnings.length === 0;
    empty.hidden = !result.ok || result.warnings.length > 0;
    const attention = !result.ok || result.warnings.length > 0;
    marker.hidden = !attention;
    const summary = result.ok ? `网站状态：${result.ago}生成${result.warnings.length ? `，${result.warnings.length} 项设置被跳过` : ""}` : "网站状态：读取失败";
    open.title = summary;
    open.setAttribute("aria-label", summary);
  };
  open.addEventListener("click", () => { dialog.showModal(); refresh(); });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => open.focus());
  // Re-check when the author comes back to this tab (e.g. after saving and waiting for the build).
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  open.disabled = false;
  refresh();
}
