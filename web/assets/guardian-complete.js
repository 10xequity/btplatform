/* Boomtown Platform — Guardian account completion
   File: web/assets/guardian-complete.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.32.0

   D-MIN-11. Reads the invite token from the URL fragment, shows WHO is waiting, then requires a
   real signed-in adult before anything is written. The token proves which pending participant
   this link is about; it does not prove who the holder is. Those are different claims and
   collapsing them is how a link forwarded to a group chat becomes a guardianship.

   Click budget (standards §3, requirement 19): signed-in adult with a DOB on file → tick, type,
   submit = 3. Not on file → 4. Budgeted against "add child ≤ 6".

   No organisation name appears anywhere in this file. Standards §8. */
(function () {
  "use strict";

  var API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  var card = document.getElementById("card");

  // Same conventions as app.js: bearer in sessionStorage, selected org in localStorage.
  var bearer = sessionStorage.getItem("bt_token") || null;
  var orgId = localStorage.getItem("bt_org");

  var savedTheme = localStorage.getItem("bt_theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    if (orgId) headers["X-Org-Id"] = orgId;
    try {
      var resp = await fetch(API + path, Object.assign({}, opts, { headers: headers, credentials: "include" }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(function () { return {}; }) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and try again." } };
    }
  }

  // Fragment, not query string — see the comment in guardian-complete.html.
  var token = (new URLSearchParams(location.hash.replace(/^#/, "")).get("t") || "").trim();

  function fail(text, extra) {
    card.innerHTML =
      '<div class="msg err">' + esc(text) + "</div>" +
      (extra || "") +
      '<p class="help-text" style="margin-top:14px"><a href="index.html">Back to the home page</a></p>';
  }

  if (!/^[a-f0-9]{32,64}$/.test(token)) {
    fail("This link is missing its invitation code. Ask for a fresh link — copy the whole thing, including everything after the #.");
    return;
  }

  var invite = null;

  async function load() {
    var r = await api("/api/guardian-invite/" + token);
    if (!r.ok) {
      fail(r.data.error || "This invitation isn't valid.");
      return;
    }
    invite = r.data;
    if (invite.already_active) {
      card.innerHTML =
        '<div class="msg ok">This account is already confirmed. ' +
        esc(invite.participant.full_name) + " can be registered.</div>";
      return;
    }
    render();
  }

  function render() {
    var p = invite.participant;
    var who =
      '<div class="g-who"><b>' + esc(p.full_name) + "</b>" +
      '<span>Age ' + esc(String(p.age)) + " — waiting on a parent or guardian</span></div>";

    if (!bearer) {
      card.innerHTML =
        who +
        '<p style="font-size:15px;line-height:1.6;margin:0 0 6px">' +
        "You need your own account before you can confirm this. Sign in or create one — it takes a minute — " +
        "then open this same link again." +
        "</p>" +
        '<p class="help-text">Keep this page open, or save the link somewhere you can find it.</p>' +
        '<a class="btn primary" style="display:block;text-align:center;line-height:52px" href="index.html">Sign in or create an account</a>';
      return;
    }

    card.innerHTML =
      who +
      '<label class="fld" for="gdob">Your date of birth</label>' +
      '<input id="gdob" type="date" autocomplete="bday" aria-describedby="gdobHelp" max="' +
      new Date().toISOString().slice(0, 10) + '" />' +
      '<p class="help-text" id="gdobHelp">Only needed if we don\'t already have it. A guardian has to be 18 or older.</p>' +
      '<div class="g-cert" id="certText">' + esc(invite.certification_text) + "</div>" +
      '<div class="g-check">' +
      '<input type="checkbox" id="cert" />' +
      '<label for="cert">I confirm the statement above is true.</label>' +
      "</div>" +
      '<label class="fld" for="certName">Type your full legal name</label>' +
      '<input id="certName" type="text" autocomplete="name" />' +
      '<button id="go" class="btn primary" type="button">Confirm and unlock registration</button>' +
      '<div id="msg" role="status" aria-live="polite"></div>';

    document.getElementById("go").onclick = submit;
  }

  async function submit() {
    var msg = document.getElementById("msg");
    var btn = document.getElementById("go");
    var name = document.getElementById("certName").value.trim();
    var dob = document.getElementById("gdob").value;

    function show(t, ok) { msg.className = "msg " + (ok ? "ok" : "err"); msg.textContent = t; }

    if (!document.getElementById("cert").checked) { show("Tick the confirmation box to continue.", false); return; }
    if (name.split(/\s+/).filter(Boolean).length < 2) { show("Type your full legal name.", false); return; }

    btn.disabled = true; btn.textContent = "Confirming…";
    var r = await api("/api/guardian-invite/" + token + "/claim", {
      method: "POST",
      body: JSON.stringify({ certified: true, certified_name: name, guardian_date_of_birth: dob || undefined }),
    });
    btn.disabled = false; btn.textContent = "Confirm and unlock registration";

    if (!r.ok) {
      if (r.data && r.data.need_guardian_dob) { document.getElementById("gdob").focus(); }
      show(r.data.error || "That didn't go through. Try again.", false);
      return;
    }
    card.innerHTML =
      '<div class="msg ok">' + esc(r.data.message) + "</div>" +
      '<p style="font-size:15px;line-height:1.6">' +
      esc(r.data.participant.full_name) + " is now linked to your account and can be registered." +
      "</p>" +
      '<a class="btn primary" style="display:block;text-align:center;line-height:52px" href="index.html">Done</a>';
  }

  load();
})();
