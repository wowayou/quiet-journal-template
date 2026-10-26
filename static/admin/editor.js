// Official CMS.init()/nc-root integration. Preferences contain no credentials or article data.
export const QUALITY_KEY = "quiet-journal:upload-quality:v1";
export const QUALITIES = Object.freeze({
  site: { label: "站点设置", quality: null },
  compact: { label: "省空间 75", quality: 75 },
  balanced: { label: "均衡 85", quality: 85 },
  high: { label: "高质量 92", quality: 92 },
});
const valid = (key) => Object.hasOwn(QUALITIES, key);

export function cmsOptions(profile) {
  if (!valid(profile)) throw new Error("未知的上传质量选项。");
  if (profile === "site") return {};
  // Merge only quality. Keep file config, backend, dimensions and per-field overrides intact.
  return { config: { media_libraries: { default: { config: { transformations: { raster_image: { quality: QUALITIES[profile].quality } } } } } } };
}

export function loadQuality(storage) {
  try {
    const value = (storage ?? globalThis.localStorage).getItem(QUALITY_KEY);
    if (value === null) return { profile: "site", message: "" };
    if (valid(value)) return { profile: value, message: "" };
    return { profile: "site", message: "保存的质量选项无效，本次按站点设置；请重新选择。" };
  } catch {
    return { profile: "site", message: "无法读取本机偏好，本次按站点设置；不会改动仓库配置。" };
  }
}

export function saveQuality(profile, storage) {
  if (!valid(profile)) throw new Error("未知的上传质量选项。");
  try {
    (storage ?? globalThis.localStorage).setItem(QUALITY_KEY, profile);
    return { saved: true, message: `已记住「${QUALITIES[profile].label}」，下次载入编辑器生效。` };
  } catch {
    return { saved: false, message: "无法保存本机偏好。当前质量不变；请检查浏览器存储设置。" };
  }
}

export async function startEditor(cms = globalThis.CMS) {
  const launch = document.querySelector("#qj-startup-status");
  const open = document.querySelector("#qj-quality-open");
  const dialog = document.querySelector("#qj-quality-dialog");
  const select = document.querySelector("#qj-quality-select");
  const status = document.querySelector("#qj-quality-status");
  const warning = document.querySelector("#qj-quality-warning");
  const reload = document.querySelector("#qj-quality-reload");
  const root = document.querySelector("#nc-root");
  const stop = (message) => {
    root.hidden = true;
    open.disabled = true;
    open.textContent = "上传质量：未应用";
    launch.hidden = false;
    launch.textContent = message;
    return false;
  };
  const initial = loadQuality();
  let pending = initial.profile;
  root.hidden = true;
  open.textContent = "上传质量：未应用";
  select.value = initial.profile;
  status.textContent = initial.message || `本次：${QUALITIES[initial.profile].label}。不重压已有图片。`;
  warning.hidden = !initial.message;
  warning.title = initial.message;
  open.disabled = true;
  open.addEventListener("click", () => { select.value = pending; dialog.showModal(); });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => open.focus());
  dialog.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const result = saveQuality(select.value);
    status.textContent = `${result.message} 本次仍为「${QUALITIES[initial.profile].label}」。`;
    if (result.saved) {
      pending = select.value;
      reload.hidden = pending === initial.profile;
      warning.hidden = false;
      warning.title = pending === initial.profile ? "本机偏好已保存" : "质量偏好已变更，下次载入生效";
    }
  });
  reload.addEventListener("click", () => {
    if (window.confirm("重新载入会关闭当前编辑页。请先在编辑器保存文章，未保存内容可能丢失。确定继续？")) window.location.reload();
  });
  if (typeof cms?.init !== "function") {
    return stop("编辑器程序未能加载。请检查网络后刷新；不会自动升级或切换到其他 CDN。");
  }
  if (globalThis.CMS_MANUAL_INIT !== true || globalThis.QJ_EDITOR_COMPONENTS_READY !== true) {
    // If the prelude failed, Sveltia may already have auto-mounted with different settings.
    // Do not present a selected quality or an editor missing the required body component as usable.
    return stop("初始化配套脚本不完整，已停止进入编辑器。请完整更新后台文件并刷新，避免质量设置或正文组件缺失。");
  }
  try {
    await cms.init(cmsOptions(initial.profile));
    root.hidden = false;
    open.textContent = `上传质量：${QUALITIES[initial.profile].label}`;
    open.disabled = false;
    launch.hidden = true; // Mount success, not a claim that config/auth/deployment succeeded.
    return true;
  } catch {
    return stop("编辑器初始化失败。请刷新重试；若仍失败，请检查配置与浏览器控制台。");
  }
}

if (typeof document !== "undefined") {
  // Independent of the CMS: status stays readable even if the editor fails to start.
  import("./site-status.js").then(({ startSiteStatus }) => startSiteStatus()).catch(() => {});
  startEditor();
}
