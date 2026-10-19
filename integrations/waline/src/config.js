export function httpsOrigin(value) {
  if (typeof value !== "string" || value.length > 256 || !/^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[1-9][0-9]{0,4})?\/?$/.test(value)) throw new Error("必须填写 HTTPS 源，不带路径、查询、片段或凭据。");
  return new URL(value).origin;
}
export function validateConfig(value) {
  const fields = ["apiOrigin", "blogOrigin", "panelOrigin"];
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== fields.join(",")) throw new Error("面板配置只能包含 blogOrigin、panelOrigin、apiOrigin 三项。");
  const config = Object.fromEntries(fields.map((key) => [key, httpsOrigin(value[key])]));
  if (new Set(Object.values(config)).size !== 3) throw new Error("博客、评论面板、Waline API/管理端必须使用三个不同的源。");
  return config;
}
export function validKey(key) {
  return typeof key === "string" && /^\/posts\/[\p{L}\p{N}][\p{L}\p{N}._-]{0,95}\/$/u.test(key);
}
export function readThread(location) {
  if (location.search) throw new Error("免登录面板不接受查询参数或登录令牌；请从文章评论入口打开。");
  const params = new URLSearchParams(location.hash.slice(1));
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !["key", "theme"].includes(key)) || !validKey(params.get("key"))) throw new Error("评论文章标识无效，请从文章评论入口重新打开。");
  const theme = params.get("theme") || "light";
  if (!["light", "dark"].includes(theme)) throw new Error("未知评论主题。");
  return { key: params.get("key"), theme };
}
