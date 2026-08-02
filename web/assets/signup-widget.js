/* Boomtown Platform — Email signup widget (embeddable)
   File: web/assets/signup-widget.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.16.0
   Drop-in for boomtownvb.com / coloradoboom.com (spec §3.3 "website signup widgets"):
     <script src="https://10xequity.github.io/btplatform/web/assets/signup-widget.js?v=0.50.0"
             data-org="boomtown" defer></script>
   Renders where the tag sits. data-org: boomtown | match-point | queens-club.
   Optional data-api overrides the API origin. Honors the host page's colors via inherited
   font; keeps its own minimal styles. Honeypot field included — bots fill it, humans never
   see it. Consent lands as consent_source='signup-widget' on the contact. */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var org = s.getAttribute("data-org") || "boomtown";
  var api = (s.getAttribute("data-api") || "https://boomtown-api.vvisuth.workers.dev") + "/api/signup";

  var wrap = document.createElement("div");
  wrap.setAttribute("style", "max-width:420px;font-family:inherit");
  wrap.innerHTML =
    '<form novalidate style="display:flex;flex-wrap:wrap;gap:8px">' +
    '<label style="flex:100%;font-weight:700;font-size:15px">Get event announcements' +
    '<span style="display:block;font-weight:400;font-size:13px;opacity:.75">Tournaments, leagues, and open play — no spam, unsubscribe anytime.</span></label>' +
    '<input type="email" name="email" required placeholder="you@email.com" aria-label="Email address"' +
    ' style="flex:1;min-width:180px;padding:11px 12px;font:inherit;border:1px solid #999;border-radius:8px;min-height:44px;box-sizing:border-box">' +
    '<input type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true"' +
    ' style="position:absolute;left:-5000px;width:1px;height:1px;opacity:0">' +
    '<button type="submit" style="padding:11px 18px;font:inherit;font-weight:700;border:0;border-radius:8px;' +
    'background:var(--accent, #D4AF37);color:var(--gold-ink, #101418);cursor:pointer;min-height:44px">Sign up</button>' +
    '<p role="status" aria-live="polite" style="flex:100%;margin:2px 0 0;font-size:13px"></p></form>';
  s.parentNode.insertBefore(wrap, s);

  var form = wrap.querySelector("form");
  var msg = wrap.querySelector("p");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = form.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "Enter a valid email address."; return; }
    var btn = form.querySelector("button");
    btn.disabled = true; btn.style.opacity = ".6";
    fetch(api, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: org, email: email, hp: form.company.value }),
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (d.ok) { form.email.value = ""; msg.textContent = d.message || "You're on the list!"; }
        else { msg.textContent = d.error || "Something went wrong — try again."; }
      })
      .catch(function () { msg.textContent = "Can't reach the signup service — try again in a minute."; })
      .finally(function () { btn.disabled = false; btn.style.opacity = "1"; });
  });
})();
/* Changelog: v1.0 (2026-07-24) — initial embeddable signup widget. */
