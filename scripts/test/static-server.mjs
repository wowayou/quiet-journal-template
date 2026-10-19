// Test-only static server that applies the actual _headers rules. Never deployed.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

export function staticHandler(root, intercept = () => false) {
  root = resolve(root);
  const blocks = [];
  for (const line of readFileSync(join(root, "_headers"), "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (line.startsWith("/")) blocks.push({ path: line.trim(), rules: [] });
    else blocks.at(-1)?.rules.push(line.trim());
  }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".xml": "application/xml", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".yml": "text/yaml" };
  return async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      for (const block of blocks) if (block.path.endsWith("*") ? pathname.startsWith(block.path.slice(0, -1)) : block.path === pathname) {
        for (const rule of block.rules) {
          if (rule.startsWith("! ")) response.removeHeader(rule.slice(2));
          else { const colon = rule.indexOf(":"); if (colon > 0) response.setHeader(rule.slice(0, colon), rule.slice(colon + 1).trim()); }
        }
      }
      if (await intercept(request, response, pathname)) return;
      let file = resolve(root, pathname.replace(/^\/+/, ""));
      if (file !== root && !file.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
      if (!existsSync(file)) { response.writeHead(404, { "Content-Type": "text/html" }).end(existsSync(join(root, "404.html")) ? readFileSync(join(root, "404.html")) : "Not found"); return; }
      response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
      response.end(request.method === "HEAD" ? undefined : readFileSync(file));
    } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
  };
}
export async function staticServer(root, intercept = () => false) {
  const server = createServer(staticHandler(root, intercept));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}
