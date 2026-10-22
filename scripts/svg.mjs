// A deliberately small, passive SVG icon profile, not a general SVG sanitizer.
// Reject unsupported markup instead of rewriting it. Never inline uploaded SVG.
const ELEMENTS = new Set(["svg", "g", "defs", "title", "desc", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "style"]);
const ATTRIBUTES = new Set(["xmlns", "version", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "class", "id", "preserveAspectRatio", "vector-effect", "role", "aria-hidden", "focusable", "type"]);
const COLOR = /^(?:#[a-f\d]{3,8}|[a-z]+|(?:rgb|rgba)\([\d.,%\s]+\))$/i;
function passiveCSS(css) {
  // Only simple class rules with static paint declarations, e.g. dashboard-icons.
  let end = 0;
  for (const rule of css.matchAll(/\.([a-zA-Z_][\w-]*)\s*\{([^{}]*)\}/g)) {
    if (css.slice(end, rule.index).trim()) return false;
    const declarations = rule[2].split(";").map((part) => part.trim()).filter(Boolean);
    if (!declarations.length || declarations.some((part) => {
      const match = /^(fill|stroke|stop-color|opacity|fill-opacity|stroke-opacity|stroke-width)\s*:\s*(.+)$/.exec(part);
      return !match || !(COLOR.test(match[2]) || /^\d*(?:\.\d+)?$/.test(match[2]));
    })) return false;
    end = rule.index + rule[0].length;
  }
  return !css.slice(end).trim();
}

export function inspectIconSvg(text) {
  const fail = (reason) => [`SVG 图标：${reason}`];
  if (Buffer.byteLength(text) > 256 * 1024) return fail("超过 256 KiB；请简化图标。");
  if (/\uFFFD|<!DOCTYPE|<!ENTITY|<metadata|xmlns:(?:inkscape|sodipodi|rdf|dc)/i.test(text)) return fail("无效 UTF-8、DTD、实体或编辑器元数据。");
  const source = text.replace(/^\uFEFF?\s*<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/i, "").replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  let end = 0, roots = 0;
  function validText(value) {
    if (stack.at(-1) === "style") return passiveCSS(value);
    return ["title", "desc"].includes(stack.at(-1)) ? !/[<>]/.test(value) : !value.trim();
  }
  for (const token of source.matchAll(/<\/?[a-zA-Z][^<>]*>/g)) {
    if (!validText(source.slice(end, token.index))) return fail("不支持的文本、样式或标记。");
    const match = /^<(\/)?([a-zA-Z][\w:-]*)([\s\S]*?)(\/?)>$/.exec(token[0]);
    const [, closing, name, attributes, selfClosing] = match;
    if (!ELEMENTS.has(name)) return fail(`不支持元素 ${name}（不允许脚本、引用、嵌入或动画）。`);
    if (closing) {
      if (attributes.trim() || selfClosing || stack.pop() !== name) return fail("元素未正确闭合。");
    } else {
      if (!stack.length && (name !== "svg" || ++roots !== 1)) return fail("必须只有一个 svg 根元素。");
      if (["style", "title", "desc"].includes(stack.at(-1))) return fail("文本元素不能嵌套标记。");
      const seen = new Set();
      let position = 0;
      for (const attr of attributes.matchAll(/\s+([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
        if (attributes.slice(position, attr.index).trim()) return fail("属性格式无效。");
        const [, key, , value] = attr;
        if (!ATTRIBUTES.has(key) || seen.has(key) || /[<&\\@]|url\s*\(/i.test(value) || (key !== "xmlns" && /(?:https?|data|javascript):/i.test(value))) return fail(`不允许的属性或资源引用：${key}。`);
        if (key === "xmlns" && value !== "http://www.w3.org/2000/svg") return fail("不支持的命名空间。");
        seen.add(key);
        position = attr.index + attr[0].length;
      }
      if (attributes.slice(position).trim()) return fail("属性格式无效。");
      if (!selfClosing) stack.push(name);
    }
    end = token.index + token[0].length;
  }
  if (stack.length || roots !== 1 || source.slice(end).trim()) return fail("缺少完整的 svg 根元素。");
  return [];
}
