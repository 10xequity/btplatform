/* Boomtown Platform — Desk Kiosk Check-in
   File: web/assets/kiosk.js · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.39.0
   Scan (keyboard-wedge) or type the 8-char member code. Owed balance denies to the desk
   (req #20); waiver never gates (D-MIN-8 — the server doesn't even send it here).
   Scan loop is high-frequency: results swap with NO animation (emil framework), auto-reset
   4s on success / 8s on a deny, and any keystroke during a result starts the next scan
   immediately so a line keeps moving. UX copy: human sentences, sentence case. */
(function () {
  var API = (window.BT_CONFIG || {}).apiBase || "";
  var card = document.getElementById("card");
  var token = new URLSearchParams(location.search).get("t");
  var eventName = "";
  var resetTimer = null;
  var state = "loading"; // loading | idle | busy | result

  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  document.documentElement.dataset.theme = localStorage.getItem("bt_theme") ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

  if (!token || !API || API.indexOf("PENDING") !== -1) {
    card.innerHTML = "<h1>Kiosk not set up</h1><p class='sub'>This kiosk link is missing its code. Open it again from the admin check-in page.</p>";
    return;
  }

  fetch(API + "/api/kiosk/" + token).then(function (r) { return r.json().then(function (d) {
    if (!r.ok) { card.innerHTML = "<h1>Kiosk not active</h1><p class='sub'>" + esc(d.error || "Ask staff to open a fresh kiosk link.") + "</p>"; return; }
    eventName = d.event.name || "Check in";
    renderIdle();
  }); }).catch(function () {
    card.innerHTML = "<h1>No connection</h1><p class='sub'>The kiosk can't reach the server. Check the Wi-Fi and reload.</p>";
  });

  function renderIdle(prefill) {
    clearTimeout(resetTimer); state = "idle";
    card.innerHTML = "<h1>" + esc(eventName) + "</h1>" +
      "<p class='sub'>Scan your pass — or type your code.</p>" +
      "<div class='field' style='text-align:left'><label for='code'>Your check-in code</label>" +
      "<input id='code' autocomplete='off' autocapitalize='characters' spellcheck='false' inputmode='text' /></div>" +
      "<button class='btn kk-btn' id='go'>Check in</button>" +
      "<div class='kk-msg' id='msg' role='status'></div>" +
      "<p class='kk-hint'>Your code is on your profile page under “Your check-in pass.” No code yet? See the desk.</p>";
    var input = document.getElementById("code");
    input.value = prefill || "";
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    input.addEventListener("blur", function () { // the kiosk input owns the scanner — take focus back
      setTimeout(function () { if (state === "idle" && document.getElementById("code")) document.getElementById("code").focus(); }, 150);
    });
    document.getElementById("go").addEventListener("click", submit);
  }

  function submit() {
    if (state !== "idle") return;
    var input = document.getElementById("code");
    var code = (input.value || "").trim();
    var msg = document.getElementById("msg");
    if (!code) { msg.className = "kk-msg warn"; msg.textContent = "Scan your pass or type your code first."; input.focus(); return; }
    state = "busy";
    var btn = document.getElementById("go");
    btn.disabled = true; btn.textContent = "Checking…";
    fetch(API + "/api/kiosk/" + token + "/scan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code })
    }).then(function (r) { return r.json().then(function (d) { renderResult(r, d); }); })
      .catch(function () {
        state = "idle"; btn.disabled = false; btn.textContent = "Check in";
        msg.className = "kk-msg err"; msg.textContent = "No connection — try again, or see the desk.";
      });
  }

  function avatarHtml(m) {
    if (m && m.avatar_url) return "<img class='kk-avatar' alt='' src='" + esc(API + m.avatar_url) + "' />";
    var initial = ((m && m.full_name) || "?").trim().charAt(0).toUpperCase();
    return "<div class='kk-avatar' aria-hidden='true'>" + esc(initial) + "</div>";
  }

  function renderResult(r, d) {
    state = "result";
    var m = d.member || null;
    var html;
    if (r.ok && d.status === "ok") {
      html = "<div class='kk-glyph'>✅</div>" + avatarHtml(m) +
        "<p class='kk-name'>" + esc(m ? m.full_name : "") + "</p>" +
        (m && m.team_name ? "<p class='kk-team'>" + esc(m.team_name) + "</p>" : "") +
        "<p class='kk-msg ok'>" + esc(d.message) + "</p>";
      scheduleReset(4000);
    } else if (d.status === "deny") {
      html = "<div class='kk-glyph'>🙋</div>" + avatarHtml(m) +
        "<p class='kk-name'>" + esc(m ? m.full_name : "") + "</p>" +
        "<p class='kk-msg warn'>" + esc(d.message) + "</p>";
      scheduleReset(8000);
    } else {
      html = "<div class='kk-glyph'>🤔</div>" +
        "<p class='kk-msg warn'>" + esc(d.message || d.error || "That didn't work — try again, or see the desk.") + "</p>";
      scheduleReset(6000);
    }
    card.innerHTML = html + "<button class='btn secondary kk-btn' id='next'>Next person</button>";
    document.getElementById("next").addEventListener("click", function () { renderIdle(); });
  }

  function scheduleReset(ms) {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(function () { if (state === "result") renderIdle(); }, ms);
  }

  // A scanner fired mid-result: start the next scan instantly so the line keeps moving.
  document.addEventListener("keydown", function (e) {
    if (state !== "result") return;
    if (e.key === "Enter" || e.key === "Escape") { renderIdle(); return; }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { renderIdle(e.key); e.preventDefault(); }
  });
})();
