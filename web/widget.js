/* Boomtown Athletics — Embeddable Schedule Widget
   Version: v0.4.0 · Date: 2026-07-22
   Usage on any website (boomtownvb.com, coloradoboom.com, …):
     <script src="https://10xequity.github.io/btplatform/web/widget.js"
             data-view="public" data-theme="auto"></script>
   data-view  — schedule view slug ('public' by default, or a custom view's link slug)
   data-theme — 'dark' | 'light' | 'auto' (auto = follow the visitor's system setting)
   The widget renders where the script tag sits and sizes its own height. */
(function () {
  const me = document.currentScript;
  if (!me) return;
  const base = me.src.replace(/widget\.js.*$/, "");
  const view = me.dataset.view || "public";
  const themeAttr = me.dataset.theme || "auto";
  const theme = themeAttr === "auto"
    ? (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : themeAttr;

  const frame = document.createElement("iframe");
  frame.src = `${base}schedule.html?embed=1&view=${encodeURIComponent(view)}&theme=${theme}`;
  frame.title = "Boomtown Athletics schedule";
  frame.style.cssText = "width:100%;border:0;display:block;min-height:320px;";
  frame.setAttribute("loading", "lazy");
  me.parentNode.insertBefore(frame, me.nextSibling);

  window.addEventListener("message", function (e) {
    if (!e.data || typeof e.data.bt_widget_height !== "number") return;
    if (e.data.slug !== view) return;               // multiple widgets on one page
    frame.style.height = Math.max(320, e.data.bt_widget_height + 8) + "px";
  });
})();
