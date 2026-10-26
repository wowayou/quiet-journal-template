// Dependency-free, local-only search. No query leaves the browser.
export const normalize = (value) => String(value).normalize("NFKC").toLocaleLowerCase();

export function rankPages(pages, query) {
  const words = [...new Set(normalize(query).trim().split(/\s+/).filter(Boolean))];
  if (!words.length) return [];
  return pages.map((page) => {
    const title = normalize(page.title);
    const summary = normalize(page.summary);
    const text = normalize(page.text);
    const all = `${title}\n${summary}\n${text}`;
    if (!words.every((word) => all.includes(word))) return null;
    const score = words.reduce((n, word) => n + (title.includes(word) ? 20 : 0) + (summary.includes(word) ? 8 : 0) + (text.includes(word) ? 1 : 0), 0);
    return { page, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

const indexes = new Map();
function loadIndex(url) {
  if (!indexes.has(url)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const request = fetch(url, { signal: controller.signal, credentials: "omit" })
      .then((response) => {
        if (!response.ok) throw new Error(`Search index: HTTP ${response.status}`);
        return response.json();
      })
      .then((pages) => {
        if (!Array.isArray(pages)) throw new Error("Invalid search index");
        return pages;
      })
      .catch((error) => { indexes.delete(url); throw error; })
      .finally(() => clearTimeout(timeout));
    indexes.set(url, request);
  }
  return indexes.get(url);
}

export function initSearch(root) {
  const form = root.querySelector("[data-search-form]");
  const input = root.querySelector("[data-search-input]");
  const status = root.querySelector("[data-search-status]");
  const list = root.querySelector("[data-search-results]");
  const idle = status.textContent;
  let timer;
  let revision = 0;
  let composing = false;
  form.hidden = false;

  async function search() {
    const current = ++revision;
    const query = input.value.trim();
    list.replaceChildren();
    delete form.dataset.failed;
    if (!query) { status.textContent = idle; return; }
    status.textContent = "正在读取本站索引…";
    try {
      const pages = await loadIndex(form.dataset.index);
      if (current !== revision) return;
      const matches = rankPages(pages, query);
      status.textContent = matches.length ? `找到 ${matches.length} 项${matches.length > 20 ? "，先显示前 20 项，请增加关键词缩小范围" : ""}。` : "没有找到。试试更短的关键词，或到归档里看看。";
      const fragment = document.createDocumentFragment();
      for (const { page } of matches.slice(0, 20)) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = page.url;
        link.textContent = page.title;
        item.append(link);
        if (page.summary) {
          const excerpt = document.createElement("p");
          excerpt.textContent = page.summary;
          item.append(excerpt);
        }
        fragment.append(item);
      }
      list.append(fragment);
    } catch {
      if (current !== revision) return;
      form.dataset.failed = ""; // Show the archive fallback the message points to.
      status.textContent = "索引暂时无法读取。请再次点「查找」重试，或使用下方归档；你的关键词没有发送到外部服务。";
    }
  }
  function queue() {
    ++revision; // In-flight results must not overwrite a newer or cleared query.
    clearTimeout(timer);
    if (!composing) timer = setTimeout(search, 160);
  }
  input.addEventListener("input", queue);
  input.addEventListener("compositionstart", () => { composing = true; ++revision; clearTimeout(timer); });
  input.addEventListener("compositionend", () => { composing = false; queue(); });
  form.addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(timer); if (!composing) search(); });
}

if (typeof document !== "undefined") document.querySelectorAll('[data-widget="search"]').forEach(initSearch);
