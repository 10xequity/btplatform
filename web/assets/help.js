/* Boomtown Platform — Help & FAQ (public)
   File: web/assets/help.js · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.40.0
   Loads all published FAQs once, then ranks client-side per keystroke against the SAME
   scoring the server uses (question ×3 · tags ×2 · answer ×1) so the ?q= deep link and the
   live typing produce identical ordering. Server ranking still runs for ?q= first paint.
   Search-as-you-type = high-frequency → results swap with NO animation (standards §5).
   All content escaped at render — answers are stored as plain text, never HTML. */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let ALL = [];

  function tokenize(q) {
    return [...new Set(String(q || "").toLowerCase().split(/[^a-z0-9]+/i)
      .filter((t) => t.length >= 2))].slice(0, 8);
  }
  function score(tokens, r) {
    const q = (r.question || "").toLowerCase(), a = (r.answer || "").toLowerCase(),
      t = (r.tags || "").toLowerCase();
    let s = 0;
    for (const tok of tokens) { if (q.includes(tok)) s += 3; if (t.includes(tok)) s += 2; if (a.includes(tok)) s += 1; }
    return s;
  }
  function rank(q, rows) {
    const tokens = tokenize(q);
    if (!tokens.length) return rows;
    return rows.map((r) => ({ r, s: score(tokens, r) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).map((x) => x.r);
  }

  function render(rows, q) {
    const list = $("faqList"), count = $("faqCount");
    if (!ALL.length) {
      count.textContent = "";
      list.innerHTML = `<div class="faq-empty">No help articles yet — check back soon, or reach us from the schedule page.</div>`;
      return;
    }
    if (!rows.length) {
      count.textContent = "";
      list.innerHTML = `<div class="faq-empty">Nothing matched “${esc(q)}”. Try fewer or different words — “payment”, “schedule”, “sub”.</div>`;
      return;
    }
    count.textContent = q ? `${rows.length} match${rows.length === 1 ? "" : "es"}` : `${rows.length} articles`;
    // First result auto-opens only when searching — the best match should read immediately.
    list.innerHTML = rows.map((r, i) => `
      <details class="faq-item"${q && i === 0 ? " open" : ""}>
        <summary>${esc(r.question)}</summary>
        <div class="faq-a">${esc(r.answer)}</div>
      </details>`).join("");
  }

  async function load() {
    const q0 = new URLSearchParams(location.search).get("q") || "";
    try {
      const res = await fetch(`${API}/api/faq${q0 ? "?q=" + encodeURIComponent(q0) : ""}`);
      const data = await res.json();
      ALL = data.faqs || [];
      if (q0) {
        $("helpQ").value = q0;
        $("helpClear").classList.add("show");
        render(ALL, q0); // server already ranked for q0
        // Re-fetch the full set behind the scenes so live typing has the whole corpus.
        const full = await fetch(`${API}/api/faq`).then((r) => r.json()).catch(() => null);
        if (full) ALL = full.faqs || ALL;
      } else {
        render(ALL, "");
      }
    } catch {
      $("faqList").innerHTML = `<div class="faq-empty">The help center could not load. Check your connection and refresh the page.</div>`;
    }
  }

  $("helpQ").addEventListener("input", () => {
    const q = $("helpQ").value.trim();
    $("helpClear").classList.toggle("show", !!q);
    render(rank(q, ALL), q);
  });
  $("helpClear").addEventListener("click", () => {
    $("helpQ").value = "";
    $("helpClear").classList.remove("show");
    render(ALL, "");
    $("helpQ").focus();
  });

  load();
})();
