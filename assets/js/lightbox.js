// 点图放大：点击文章图片在页面内查看大图。方向键 / 左右滑动切换，Esc 或点空白处关闭。
// 没有 JS 时，图片链接直接打开大图。无第三方依赖。
(function () {
  function button(cls, label, text) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.setAttribute("aria-label", label);
    b.textContent = text;
    return b;
  }

  function init() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".entry__body a.media__zoom"));
    if (!links.length || typeof HTMLDialogElement !== "function") return;
    var root = document.documentElement;
    var dlg, img, cap, idx = 0, opener = null, x0 = null;

    function build() {
      dlg = document.createElement("dialog");
      dlg.className = "lightbox";
      dlg.setAttribute("aria-label", "查看大图");
      var fig = document.createElement("figure");
      fig.className = "lightbox__figure";
      img = document.createElement("img");
      img.className = "lightbox__img";
      img.alt = "";
      cap = document.createElement("figcaption");
      cap.className = "lightbox__caption";
      fig.appendChild(img);
      fig.appendChild(cap);
      var close = button("lightbox__btn lightbox__close", "关闭", "×");
      var prev = button("lightbox__btn lightbox__prev", "上一张", "‹");
      var next = button("lightbox__btn lightbox__next", "下一张", "›");
      if (links.length < 2) prev.hidden = next.hidden = true;
      dlg.appendChild(fig);
      dlg.appendChild(close);
      dlg.appendChild(prev);
      dlg.appendChild(next);
      document.body.appendChild(dlg);

      close.addEventListener("click", function () { dlg.close(); });
      prev.addEventListener("click", function () { show(idx - 1); });
      next.addEventListener("click", function () { show(idx + 1); });
      dlg.addEventListener("click", function (e) { if (e.target === dlg || e.target === fig) dlg.close(); });
      dlg.addEventListener("keydown", function (e) {
        if (e.key === "ArrowLeft") show(idx - 1);
        else if (e.key === "ArrowRight") show(idx + 1);
      });
      dlg.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      dlg.addEventListener("touchend", function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 50 && links.length > 1) show(idx + (dx < 0 ? 1 : -1));
      }, { passive: true });
      dlg.addEventListener("close", function () {
        root.classList.remove("lightbox-open");
        if (opener) opener.focus();
      });
    }

    function show(i) {
      idx = (i + links.length) % links.length;
      var a = links[idx];
      var thumb = a.querySelector("img");
      var media = a.closest(".media");
      var c = media && media.querySelector(".media__caption");
      img.src = a.getAttribute("href");
      img.alt = thumb ? thumb.alt : "";
      cap.textContent = c ? c.textContent : "";
      cap.hidden = !cap.textContent;
      img.classList.remove("is-in");
      void img.offsetWidth;
      img.classList.add("is-in");
    }

    document.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest("a.media__zoom") : null;
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var i = links.indexOf(a);
      if (i < 0) return;
      e.preventDefault();
      if (!dlg) build();
      opener = a;
      show(i);
      dlg.showModal();
      root.classList.add("lightbox-open");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
