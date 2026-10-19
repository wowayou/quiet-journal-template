/* Sveltia adapter only. The stored shortcode is documented in EDITING.md. */
(() => {
  // The host initializer reports a missing CMS program; avoid a second, misleading exception.
  if (typeof CMS === "undefined") return;
  const encode = (value = "") => String(value).replace(/[&"<>{}\r\n]/g, (c) => ({
    "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;", "{": "&#123;", "}": "&#125;", "\r": " ", "\n": " ",
  })[c]);
  const decode = (value = "") => value.replace(/&(quot|lt|gt|#123|#125|amp);/g, (_, entity) => ({
    quot: '"', lt: "<", gt: ">", "#123": "{", "#125": "}", amp: "&",
  })[entity]);
  CMS.registerEditorComponent({
    id: "qj-link",
    label: "链接（打开方式）",
    icon: "link",
    mode: "dialog",
    summary: "{{text}}",
    fields: [
      { name: "text", label: "显示文字" },
      { name: "url", label: "目标地址", hint: "站内用 /about/；外链用 https://；禁止脚本与嵌入代码。" },
      { name: "target", label: "打开方式", widget: "select", default: "auto", options: [
        { label: "跟随站点默认", value: "auto" }, { label: "当前标签页", value: "same" }, { label: "新标签页", value: "new" },
      ] },
      { name: "title", label: "链接说明（可选）", required: false },
    ],
    pattern: /{{< link text="(?<text>[^"]*)" url="(?<url>[^"]*)" target="(?<target>auto|same|new)" title="(?<title>[^"]*)" >}}/,
    fromBlock: (match) => Object.fromEntries(Object.entries(match.groups).map(([key, value]) => [key, decode(value)])),
    toBlock: ({ text = "", url = "", target = "auto", title = "" }) =>
      `{{< link text="${encode(text)}" url="${encode(url)}" target="${["auto", "same", "new"].includes(target) ? target : "auto"}" title="${encode(title)}" >}}`,
    toPreview: ({ text = "", target = "auto" }) => {
      const span = document.createElement("span");
      span.textContent = `${text || "链接"} · ${{ auto: "站点默认", same: "当前标签页", new: "新标签页" }[target] || "站点默认"}`;
      return span; // Field values are text, never innerHTML or executable URLs.
    },
  });
  globalThis.QJ_EDITOR_COMPONENTS_READY = true;
})();
