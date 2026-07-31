/* Boomtown Platform — Text Messages (admin)
   File: web/assets/admin-sms.js · Version: v1.0 · Date: 2026-07-31 · Ships in: v0.42.0
   Target picker loads once · reach preview refreshes on pick (no extra click, req #19) ·
   send is two-step (Send → Yes, destructive-adjacent) · segment counter is honest about
   cost. Uses BT_ADMIN helpers; errors render through fail() (Back + Dashboard, rule 2). */
(async function () {
  const { api, guard, esc } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);

  let configured = true;

  async function loadTargets() {
    const r = await api("/api/admin/sms/targets");
    if (!r.ok) return fail("Couldn't load the event list. Try again in a minute.");
    const j = await r.json();
    configured = !!j.configured;
    $("smsBanner").hidden = configured;
    const sel = $("sTarget");
    for (const t of j.targets || []) {
      const o = document.createElement("option");
      o.value = "event:" + t.id;
      const when = t.starts_at ? " — " + String(t.starts_at).slice(0, 10) : "";
      o.textContent = t.name + " (" + t.type + when + ")";
      sel.appendChild(o);
    }
  }

  async function loadReach() {
    const t = $("sTarget").value;
    const box = $("sReach");
    box.textContent = "";
    if (!t) return;
    const r = await api("/api/admin/sms/recipients?target=" + encodeURIComponent(t));
    if (!r.ok) { box.textContent = "Couldn't count recipients."; return; }
    const j = await r.json();
    box.innerHTML =
      "<span><strong>" + j.eligible + "</strong> will get this text</span>" +
      "<span>" + j.noConsent + " haven't opted in</span>" +
      "<span>" + j.noPhone + " have no textable number</span>";
  }

  async function loadLog() {
    const r = await api("/api/admin/sms/log?limit=50");
    if (!r.ok) return;
    const j = await r.json();
    const tb = $("smsLog");
    tb.innerHTML = "";
    for (const row of j.log || []) {
      const tr = document.createElement("tr");
      const who = row.full_name ? esc(row.full_name) : esc(row.to_number || row.from_number || "");
      const status = row.error ? esc(row.status) + " — " + esc(row.error) : esc(row.status);
      tr.innerHTML =
        '<td><span class="sms-dir ' + (row.direction === "out" ? "out" : "in") + '">' +
        (row.direction === "out" ? "Sent" : "Received") + "</span></td>" +
        "<td>" + who + "</td>" +
        '<td class="sms-body">' + esc(row.body || "") + "</td>" +
        "<td>" + status + "</td>" +
        "<td>" + esc(String(row.created_at || "").slice(0, 16)) + "</td>";
      tb.appendChild(tr);
    }
    if (!(j.log || []).length) {
      tb.innerHTML = '<tr><td colspan="5" class="muted">No texts yet.</td></tr>';
    }
  }

  function updateCount() {
    const n = $("sBody").value.length;
    const seg = n === 0 ? 1 : Math.ceil(n / 160);
    const el = $("sCount");
    el.textContent = n + " / 480 · " + seg + " text segment" + (seg > 1 ? "s" : "") + " ≈ 160 characters each";
    el.classList.toggle("over", n > 480);
  }

  let armed = false;
  function disarm() {
    armed = false;
    $("sConfirm").hidden = true;
    $("sSend").textContent = "Send text";
  }

  async function doSend() {
    const t = $("sTarget").value;
    const [type, id] = t.split(":");
    const body = $("sBody").value.trim();
    const out = $("sResult");
    out.className = "sms-result";
    out.textContent = "Sending…";
    const r = await api("/api/admin/sms/send", {
      method: "POST",
      body: JSON.stringify({ target: { type, id: Number(id) }, body }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      out.className = "sms-result err";
      out.textContent = j.error || "That didn't send. Try again.";
      return;
    }
    out.className = "sms-result ok";
    out.textContent = "Sent to " + j.sent + (j.failed ? " — " + j.failed + " failed (see the log)" : "") +
      (j.skipped && j.skipped.noConsent ? " · " + j.skipped.noConsent + " skipped without consent" : "");
    $("sBody").value = "";
    updateCount();
    loadLog();
  }

  $("sTarget").addEventListener("change", () => { disarm(); loadReach(); });
  $("sBody").addEventListener("input", () => { disarm(); updateCount(); });
  $("smsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!$("sTarget").value) { $("sResult").className = "sms-result err"; $("sResult").textContent = "Pick an event first."; return; }
    if (!$("sBody").value.trim()) { $("sResult").className = "sms-result err"; $("sResult").textContent = "Write the message first."; return; }
    if (!configured) { $("sResult").className = "sms-result err"; $("sResult").textContent = "Texting isn't switched on yet."; return; }
    armed = true;
    $("sConfirm").hidden = false;
    $("sSend").textContent = "Wait —";
    $("sResult").className = "sms-result";
    $("sResult").textContent = "Send to everyone in the reach line?";
  });
  $("sConfirm").addEventListener("click", async () => {
    if (!armed) return;
    disarm();
    await doSend();
  });

  updateCount();
  await loadTargets();
  await loadLog();
})();
