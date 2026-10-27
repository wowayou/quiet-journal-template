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

    // 菜单：三条线按钮展开；Esc、点外面、点链接、焦点离开页头、不再需要菜单时收起。
    // 普通导航展开区，不是 role=menu，也不困住焦点。
    var header = document.querySelector("[data-header]");
    var toggle = document.querySelector("[data-menu-toggle]");
    if (!header || !toggle) return;
    var bar = header.querySelector(".site-header__bar");
    var nav = header.querySelector(".site-nav");
    var title = header.querySelector(".site-title");
    var links = function () { return nav.querySelectorAll("a"); };
    // 菜单最多占到屏幕底部：按页头实际底边计算（站名换行时页头会变高）。
    var space = function () {
      if (!root.classList.contains("nav-compact")) { header.style.removeProperty("--nav-space"); return; }
      var bottom = Math.max(0, bar.getBoundingClientRect().bottom);
      header.style.setProperty("--nav-space", Math.max(88, Math.floor(window.innerHeight - bottom)) + "px");
    };
    var set = function (open, focusBack, focusFirst) {
      header.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
      if (open) { space(); nav.scrollTop = 0; }
      if (open && focusFirst && links()[0]) links()[0].focus();
      if (!open && focusBack) toggle.focus();
    };
    // detail === 0：由键盘 Enter/空格触发。键盘打开时把焦点送到第一项，鼠标/触控保持不动。
    toggle.addEventListener("click", function (e) { set(!header.classList.contains("is-open"), false, e.detail === 0); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("is-open")) set(false, true);
    });
    document.addEventListener("click", function (e) {
      if (header.classList.contains("is-open") && !header.contains(e.target)) set(false);
    });
    // Tab 走出页头后收起，展开的菜单不盖在已获得焦点的正文上。
    header.addEventListener("focusout", function (e) {
      if (header.classList.contains("is-open") && e.relatedTarget && !header.contains(e.relatedTarget)) set(false);
    });
    links().forEach(function (a) {
      a.addEventListener("click", function () { set(false); });
    });
    // 窄屏，或站名 + 导航 + 按钮一行放不下（导航名很长、浏览器翻译成外语、放大）时收进菜单。
    // 只看实际尺寸，不识别翻译器。测量时临时去掉菜单样式并关闭过渡，同一帧内完成，不闪烁。
    var fits = function () {
      var items = nav.querySelectorAll("li");
      var top = items.length ? items[0].getBoundingClientRect().top : 0;
      for (var i = 1; i < items.length; i++) if (Math.abs(items[i].getBoundingClientRect().top - top) > 2) return false;
      if (title && title.scrollWidth > title.clientWidth + 1) return false;   // 站名被挤窄
      var min = parseFloat(getComputedStyle(bar).minHeight) || 0;
      return bar.scrollWidth <= bar.clientWidth + 1 && bar.getBoundingClientRect().height <= min + 1;
    };
    var fit = function () {
      var was = root.classList.contains("nav-compact");
      var active = document.activeElement;
      var compact = narrow.matches;
      if (!compact) {
        root.classList.add("nav-measuring");
        root.classList.remove("nav-compact");
        compact = !fits();
        root.classList.remove("nav-measuring");
      }
      root.classList.toggle("nav-compact", compact);
      if (!compact && header.classList.contains("is-open")) set(false);
      // 布局切换会藏起当前焦点时，把焦点交给可见的入口；焦点不在页头里就不动。
      if (compact && !was && nav.contains(active) && !header.classList.contains("is-open")) {
        toggle.focus();
      } else if (!compact && was && active === toggle) {
        var target = nav.querySelector('[aria-current="page"]') || links()[0];
        if (target) target.focus();
      } else if (active && document.activeElement !== active && header.contains(active)) {
        active.focus();   // 测量时短暂隐藏导致的失焦，放回原处
      }
      space();
    };
    var pending = 0;
    var schedule = function () { if (!pending) pending = requestAnimationFrame(function () { pending = 0; fit(); }); };
    fit();
    window.addEventListener("resize", schedule);
    // 页头吸顶前后底边位置不同；菜单展开时滚动也更新可用高度。
    window.addEventListener("scroll", function () { if (header.classList.contains("is-open")) space(); }, { passive: true });
    if (narrow.addEventListener) narrow.addEventListener("change", schedule);
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(schedule);
      if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", schedule);
    }
    // 浏览器翻译会替换页头里的文字；只监听文字/子节点，不监听自己改的 class。
    if (window.MutationObserver) new MutationObserver(schedule).observe(bar, { childList: true, characterData: true, subtree: true });
  });
})();
