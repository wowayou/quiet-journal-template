// 深浅色与手机菜单。在 <head> 中同步加载，首次绘制前应用深浅色，避免闪烁。
// 深浅色选择只保存在本机 localStorage（"light" | "dark"），不发送任何数据。
(function () {
  var root = document.documentElement;
  root.classList.add("js");   // 有 JS 时才把导航收进菜单
  // 窄屏在首次绘制前就收进菜单；宽屏等页头出现后按实际宽度判断（见下方 fit）。
  var narrow = window.matchMedia("(max-width: 40rem)");
  if (narrow.matches) root.classList.add("nav-compact");
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

    // 菜单：三条线按钮展开；Esc、点外面、点链接、不再需要菜单时收起
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
    // 窄屏，或站名 + 导航 + 按钮一行放不下（导航名很长、浏览器翻译成外语、放大）时收进菜单。
    // 只看实际尺寸，不识别翻译器。测量时临时去掉菜单样式并关闭过渡，同一帧内完成，不闪烁。
    var bar = header.querySelector(".site-header__bar");
    var nav = header.querySelector(".site-nav");
    var title = header.querySelector(".site-title");
    var fits = function () {
      var items = nav.querySelectorAll("li");
      var top = items.length ? items[0].getBoundingClientRect().top : 0;
      for (var i = 1; i < items.length; i++) if (Math.abs(items[i].getBoundingClientRect().top - top) > 2) return false;
      if (title && title.scrollWidth > title.clientWidth + 1) return false;   // 站名被挤窄
      var min = parseFloat(getComputedStyle(bar).minHeight) || 0;
      return bar.scrollWidth <= bar.clientWidth + 1 && bar.getBoundingClientRect().height <= min + 1;
    };
    var fit = function () {
      var compact = narrow.matches;
      if (!compact) {
        root.classList.add("nav-measuring");
        root.classList.remove("nav-compact");
        compact = !fits();
        root.classList.remove("nav-measuring");
      }
      root.classList.toggle("nav-compact", compact);
      if (!compact && header.classList.contains("is-open")) set(false);
    };
    var pending = 0;
    var schedule = function () { if (!pending) pending = requestAnimationFrame(function () { pending = 0; fit(); }); };
    fit();
    window.addEventListener("resize", schedule);
    if (narrow.addEventListener) narrow.addEventListener("change", schedule);
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(schedule);
      if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", schedule);
    }
    // 浏览器翻译会替换页头里的文字；只监听文字/子节点，不监听自己改的 class。
    if (window.MutationObserver) new MutationObserver(schedule).observe(bar, { childList: true, characterData: true, subtree: true });
  });
})();
