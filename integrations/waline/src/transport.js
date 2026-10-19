import { validKey } from "./config.js";

export const LIMITS = Object.freeze({ requestBytes: 12288, responseBytes: 1048576, textCharacters: 2000, timeout: 15000 });
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
function publicComment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.objectId !== "string" || typeof value.comment !== "string" || !Number.isFinite(value.time) || Number.isNaN(new Date(value.time).getTime()) || (value.children !== undefined && !Array.isArray(value.children))) throw new Error("评论条目的标识、正文、时间或回复格式不兼容。");
  const { avatar, mail, ip, ua, addr, browser, os, link, ...comment } = value;
  if (Array.isArray(comment.children)) comment.children = comment.children.map(publicComment);
  return { ...comment, avatar: "" };
}
export function anonymousBody(body, key) {
  if (typeof body !== "string" || encoder.encode(body).length > LIMITS.requestBytes) throw new Error("留言请求过大。");
  const data = JSON.parse(body);
  if (!data || typeof data !== "object" || Array.isArray(data) || data.url !== key || !validKey(key)) throw new Error("留言与当前文章不匹配。");
  if (typeof data.nick !== "string" || !data.nick.trim() || [...data.nick].length > 60) throw new Error("请填写 1–60 字符的昵称；昵称不是身份认证。");
  if (typeof data.comment !== "string" || !data.comment.trim() || [...data.comment].length > LIMITS.textCharacters) throw new Error("留言正文须为 1–2000 字符。");
  // Select fields rather than forwarding the SDK's cached email/link/high-entropy UA.
  const result = { nick: data.nick.trim(), comment: data.comment, url: key, mail: "", link: "", ua: "" };
  if (data.pid || data.rid) {
    if (![data.pid, data.rid].every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error("回复目标无效。");
    result.pid = data.pid; result.rid = data.rid;
  }
  return JSON.stringify(result);
}

// Used only inside the dedicated anonymous panel. This is not installed on the blog or CMS.
// The pinned Waline SDK uses global fetch, so this explicit transport is its API boundary.
export function anonymousTransport({ apiOrigin, key, fetch: request, onError = () => {}, onSuccess = () => {}, timeout = LIMITS.timeout }) {
  return async (input, init = {}) => {
    let timer, controller, onAbort, method, dispatched = false, rejected = false;
    try {
      const url = new URL(input);
      method = (init.method || "GET").toUpperCase();
      if (url.origin !== apiOrigin || url.pathname !== "/api/comment" || url.username || url.password || url.hash || url.href.length > 2048 || !["GET", "POST"].includes(method)) throw new Error("免登录面板只允许当前文章的评论读取与提交，不允许登录、计数或其他接口。");
      if (new Headers(init.headers).has("authorization")) throw new Error("检测到旧登录状态，已阻止发送；请清除此评论面板的站点数据后重试。");
      const queryKeys = [...url.searchParams.keys()];
      const allowed = method === "GET" ? ["path", "pageSize", "page", "lang", "sortBy"] : ["lang"];
      if (new Set(queryKeys).size !== queryKeys.length || queryKeys.some((name) => !allowed.includes(name))) throw new Error("评论请求参数不受支持。");
      if (method === "GET" && (url.searchParams.get("path") !== key || !/^[1-9]\d{0,3}$/.test(url.searchParams.get("page") || "") || !/^([1-9]|10)$/.test(url.searchParams.get("pageSize") || ""))) throw new Error("评论页码、单页数量或文章标识无效。");
      const body = method === "POST" ? anonymousBody(init.body, key) : undefined;
      controller = new AbortController();
      onAbort = () => controller.abort();
      if (init.signal?.aborted) controller.abort();
      else init.signal?.addEventListener("abort", onAbort, { once: true });
      let expired = false;
      timer = setTimeout(() => { expired = true; controller.abort(); }, timeout);
      let response, bytes;
      try {
        dispatched = true;
        response = await request(url.href, { method, body, headers: method === "POST" ? { "Content-Type": "application/json" } : {}, signal: controller.signal, credentials: "omit", mode: "cors", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
        if (!response.ok) throw new Error(`评论服务返回 HTTP ${response.status}。${method === "POST" ? "留言可能已收到，请先检查列表，不要立即重复提交。" : "请稍后手动刷新列表。"}`);
        if (Number(response.headers.get("content-length")) > LIMITS.responseBytes) throw new Error("评论响应超过 1 MiB，请联系作者处理。");
        const reader = response.body?.getReader();
        const chunks = []; let size = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > LIMITS.responseBytes) { await reader.cancel(); throw new Error("评论响应超过 1 MiB，请联系作者处理。"); }
            chunks.push(value);
          }
        }
        bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      } catch (error) {
        if (expired) throw new Error(method === "POST" ? "评论请求超时；留言可能已收到。请先检查列表，不要立即重复提交。不会自动重发。" : "评论列表读取超时，请稍后手动刷新。不会自动重试。");
        throw error;
      }
      const payload = JSON.parse(decoder.decode(bytes));
      if (!payload || typeof payload !== "object" || typeof payload.errno !== "number") throw new Error("评论服务响应格式不兼容。");
      if (payload.errno) {
        rejected = true;
        throw new Error(`评论服务拒绝了请求：${typeof payload.errmsg === "string" ? payload.errmsg.slice(0, 240) : "请稍后手动重试"}`);
      }
      if (method === "GET") {
        if (!payload.data || !Array.isArray(payload.data.data) || !Number.isSafeInteger(payload.data.count) || payload.data.count < 0 || !Number.isSafeInteger(payload.data.totalPages) || payload.data.totalPages < 0) throw new Error("评论列表响应格式不兼容。");
        payload.data.data = payload.data.data.map(publicComment);
      } else {
        if (!payload.data || typeof payload.data !== "object" || typeof payload.data.objectId !== "string") throw new Error("提交结果格式不兼容；留言可能已收到，请先检查列表，不要立即重复提交。");
        payload.data = publicComment(payload.data);
      }
      onSuccess(method, method === "POST" ? payload.data.status : undefined);
      return new Response(JSON.stringify(payload), { status: response.status, headers: { "Content-Type": "application/json" } });
    } catch (error) {
      controller?.abort();
      if (error.name === "AbortError") throw error;
      const failure = method === "POST" && dispatched && !rejected && !error.message.includes("可能已收到")
        ? new Error(`${error.message} 留言可能已收到，请先检查列表，不要立即重复提交。`, { cause: error })
        : error;
      onError(failure.message, method);
      throw failure;
    } finally {
      clearTimeout(timer);
      if (onAbort) init.signal?.removeEventListener("abort", onAbort);
    }
  };
}
