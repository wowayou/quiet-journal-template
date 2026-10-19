import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { clean } from "./fixtures.mjs";

export const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
export function put(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
export const document = (fields, content = "") => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n${content}\n`;
export const read = (root, path) => readFileSync(join(root, path), "utf8");
export const allFiles = (root) => readdirSync(root, { withFileTypes: true }).flatMap((file) => file.isDirectory() ? allFiles(join(root, file.name)).map((child) => `${file.name}/${child}`) : [file.name]);
export const build = (root, extra = []) => spawnSync(process.env.HUGO || "hugo", ["--source", root, "--baseURL", "https://example.test/", "--gc", "--minify", "--cleanDestinationDir", ...extra], { encoding: "utf8", timeout: 60000 });

export function fixture() {
  const root = mkdtempSync(join(tmpdir(), "qj-features-"));
  // Never copy the author's articles/photos into fixtures. Tests use synthetic content.
  const skip = new Set(["public", "resources", "node_modules", ".git", ".hugo_build.lock", "content", "integrations"]);
  cpSync(repo, root, { recursive: true, filter: (source) => {
    const path = relative(repo, source).replaceAll("\\", "/");
    return !skip.has(path.split("/")[0]) && path !== "assets/media";
  } });
  put(root, "assets/media/rainy-street.webp", clean.webp());
  const site = {
    title: "小小的生活手记", description: "一个纯静态测试站点", author: "Test Author", theme: "auto", accent: "orange", favicon: "",
    hero: { title: "你好呀", text: "[关于](/about/)" }, links: { external_target: "new" }, sharing: { generate: true }, fediverse: { creator: "" },
    nav: [{ type: "home", label: "首页", icon: "home", icon_only: true }, { type: "page", label: "关于", page: "about" }],
    social: [], footer: { show_rss: true, show_template_credit: true, show_built_with: false },
  };
  const widgets = [{ id: "find", type: "search", title: "站内搜索", slot: "home-after-intro", enabled: true }, { id: "book", type: "answers", title: "答案之书", slot: "content-after", enabled: false }];
  const comments = { enabled: false, origin: "" };
  put(root, "data/comments.yaml", JSON.stringify(comments));
  put(root, "data/site.yaml", JSON.stringify(site));
  put(root, "data/widgets.yaml", JSON.stringify(widgets));
  put(root, "data/links.yaml", "[]");
  for (const [id, layout, title] of [["about", "page", "关于"], ["archive", "archive", "归档"], ["links", "links", "友链"], ["credits", "credits", "致谢"]]) {
    put(root, `content/${id}.md`, document({ title, layout, draft: false }, "测试正文。"));
  }
  put(root, "content/posts/a/index.md", document({ title: "中文回忆", date: "2020-01-02T08:00:00+08:00", lastmod: "2024-02-03T09:10:11+08:00", draft: false }, "散步经过雨后的书店。"));
  put(root, "content/posts/b/index.md", document({ title: "Another day", date: "2022-01-02T08:00:00Z", draft: false }, "Reading a small book."));
  return { root, site, widgets, comments, saveComments: () => put(root, "data/comments.yaml", JSON.stringify(comments)), saveSite: () => put(root, "data/site.yaml", JSON.stringify(site)), saveWidgets: () => put(root, "data/widgets.yaml", JSON.stringify(widgets)), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
