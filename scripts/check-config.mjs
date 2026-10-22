#!/usr/bin/env node
// Build-time guards for instance-owned Hugo inputs. Direct Hugo also guards actual private pages.
import { parseDocument } from "yaml";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function checkConfig(root) {
  const run = spawnSync(process.env.HUGO || "hugo", ["config", "--source", root, "--environment", "production", "--format", "json"], { encoding: "utf8", timeout: 15000 });
  if (run.status !== 0) return [run.stderr || "Hugo 配置解析失败。"];
  const config = JSON.parse(run.stdout), errors = [];
  const source = readFileSync(join(root, "config/_default/hugo.toml"), "utf8");
  if (/^\s*build(?:Drafts|Future|Expired)\s*=\s*true/im.test(source)) errors.push("实例不能打开草稿、未来或过期内容发布。");
  if (config.builddrafts || config.buildfuture || config.buildexpired) errors.push("有效配置不能开启私人/未来/过期内容。");
  if (config.markup?.goldmark?.renderer?.unsafe) errors.push("Markdown unsafe 不得开启。");
  if (JSON.stringify(config.frontmatter?.date) !== JSON.stringify(["date"])) errors.push("date 必须只用显式内容字段，不从 Git 或文件时间生成。");
  if (JSON.stringify(config.frontmatter?.lastmod) !== JSON.stringify(["lastmod", "modified", "date"])) errors.push("lastmod 必须只用内容字段；Hugo 内建 modified 别名由页面校验拒绝。");
  const cascadeFile = join(root, "config/_default/cascade.toml");
  if (!existsSync(cascadeFile) || !/publishResources\s*=\s*false/.test(readFileSync(cascadeFile, "utf8"))) errors.push("核心 cascade 必须禁止原 bundle 资源直接发布。");
  if (existsSync(cascadeFile)) {
    const cascade = readFileSync(cascadeFile, 'utf8');
    if (/publishResources\s*=\s*true/.test(cascade) || !/path\s*=\s*"\/\*\*"/.test(cascade)) errors.push('核心 cascade 必须覆盖全部页面且不得发布原资源。');
  }
  if (existsSync(join(root, "static/admin/config.yml"))) errors.push("后台配置应由核心 schema 和 data/editor.yaml 生成，不保留静态副本。");
  if (config.params?.timezone !== config.timezone) errors.push("实例显示时区必须与 Hugo timeZone 相同。");
  function resourceOverrides(value, path) {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (key.toLowerCase() === 'publishresources' && entry !== false) errors.push(`${path}：不能覆盖原始资源发布保护。`);
      else resourceOverrides(entry, path);
    }
  }
  function configFiles(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) configFiles(path);
      else if (entry.isFile() && /\.(?:toml|ya?ml|json)$/i.test(path)) {
        const text = readFileSync(path, 'utf8');
        // Hugo's effective config omits processed cascade maps; inspect these inputs as well.
        if (path.endsWith('.toml')) {
          const settings = text.replace(/^\s*#.*$/gm, '').matchAll(/\b["']?publishResources["']?\s*=\s*([^\s#},]+)/gi);
          if ([...settings].some((match) => match[1] !== 'false')) errors.push(`${path}：配置不能覆盖原始资源发布保护。`);
        } else {
          const doc = parseDocument(text, { uniqueKeys: true });
          if (doc.errors.length) errors.push(`${path}：配置无效。`);
          else resourceOverrides(doc.toJS({ maxAliasCount: 50 }), path);
        }
      }
    }
  }
  configFiles(join(root, 'config'));
  function bundles(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, {withFileTypes:true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) bundles(path);
      else if (entry.isFile() && path.endsWith('.md')) {
        const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
        if (!match) continue;
        const doc = parseDocument(match[1], { uniqueKeys:true });
        if (doc.errors.length) { errors.push(`${path}：文首信息无效。`); continue; }
        const data = doc.toJS({maxAliasCount:50});
        resourceOverrides(data?.build, path);
        resourceOverrides(data?._build, path);
        resourceOverrides(data?.cascade, path);
      }
    }
  }
  bundles(join(root,'content'));
  return errors;
}
if (globalThis.process.argv[1] && resolve(globalThis.process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkConfig(globalThis.process.argv[2] || ".");
  for (const error of errors) console.error(`FAIL ${error}`);
  console.log(`check-config：${errors.length} 个失败`); globalThis.process.exitCode = errors.length ? 1 : 0;
}
