// 深浅色与手机菜单。在 <head> 中同步加载，首次绘制前应用深浅色，避免闪烁。
// 深浅色选择只保存在本机 localStorage（"light" | "dark"），不发送任何数据。
(function () {
  var root = document.documentElement;
  root.classList.add("js");   // 有 JS 时才把手机导航收进菜单
  var KEY = "qj-theme";
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) {}

  function current() {
    var t = root.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  document.addEventListener("DOMContentLoaded", function () {
    // 深浅色按钮
    var btn = document.querySelector("[data-theme-toggle]");
    if (btn) {
      var sync = function () {
        var dark = current() === "dark";
        btn.setAttribute("aria-pressed", String(dark));
        btn.setAttribute("aria-label", dark ? "切换到浅色模式" : "切换到深色模式");
      };
      sync();
      btn.addEventListener("click", function () {
        var next = current() === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        try { localStorage.setItem(KEY, next); } catch (e) {}
        sync();
      });
    }

    // 手机菜单：三条线按钮展开；Esc、点外面、点链接、屏幕变宽时收起
    var header = document.querySelector("[data-header]");
    var toggle = document.querySelector("[data-menu-toggle]");
    if (!header || !toggle) return;
    var set = function (open, focusBack) {
      header.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
      if (!open && focusBack) toggle.focus();
    };
    toggle.addEventListener("click", function () { set(!header.classList.contains("is-open")); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("is-open")) set(false, true);
    });
    document.addEventListener("click", function (e) {
      if (header.classList.contains("is-open") && !header.contains(e.target)) set(false);
    });
    header.querySelectorAll(".site-nav a").forEach(function (a) {
      a.addEventListener("click", function () { set(false); });
    });
    var wide = window.matchMedia("(min-width: 40.01rem)");
    if (wide.addEventListener) wide.addEventListener("change", function () { if (wide.matches) set(false); });
  });
})();
