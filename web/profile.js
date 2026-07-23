/* Boomtown Platform — Member Profile page
   File: web/profile.js · Version: v1.0 · Date: 2026-07-22 · Ships in: v0.5.0
   Self-service profile (avatar crop, bio, Instagram, visibility), family accounts
   (add child, guardian waiver signing, 18th-birthday handover), upcoming events with
   Add-to-calendar + email reminders, results résumé, passkey enrollment.
   UX copy from docs/2026-07-22_ux-copy_v1.0.md. Vanilla JS, no framework. */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modalRoot");
  const logoutBtn = document.getElementById("logoutBtn");
  const themeToggle = document.getElementById("themeToggle");
  const avatarFile = document.getElementById("avatarFile");

  /* Theme (same behavior as app.js) */
  const savedTheme = localStorage.getItem("bt_theme");
  const systemLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = savedTheme || (systemLight ? "light" : "dark");
  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bt_theme", next);
  });

  if (!API || API.includes("PENDING")) {
    app.innerHTML = "<div class='card'><p>The app is still loading its settings. Hold <strong>Ctrl</strong> and press <strong>F5</strong> to refresh.</p></div>";
    return;
  }

  let bearer = sessionStorage.getItem("bt_token") || null;
  let me = null;            // /api/profile/me payload
  let avatarTarget = null;  // contact_id the next avatar upload applies to

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    const orgId = localStorage.getItem("bt_org");
    if (orgId) headers["X-Org-Id"] = orgId;
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Couldn't reach Boomtown. Check your connection and try again." } };
    }
  }

  /* ---------- boot ---------- */
  const params = new URLSearchParams(location.search);
  if (params.get("token")) {
    verify(params.get("token"));
  } else {
    load();
  }

  async function verify(token) {
    history.replaceState({}, "", location.pathname);
    app.innerHTML = "<div class='card'><p>Signing you in…</p></div>";
    const r = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
    if (r.ok) {
      bearer = r.data.token;
      sessionStorage.setItem("bt_token", bearer);
    }
    load(r.ok ? null : (r.data.error || "Sign-in failed. Request a new link."));
  }

  async function load(errorMsg) {
    const r = await api("/api/profile/me");
    if (!r.ok) return renderSignIn(errorMsg);
    me = r.data;
    renderAll();
  }

  /* ---------- sign in ---------- */
  function renderSignIn(errorMsg) {
    logoutBtn.hidden = true;
    app.innerHTML = `
      <div class="card">
        <h1 style="margin-top:0">Your profile</h1>
        <p>Sign in with your email — we'll send a one-time link. No password needed.</p>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" />
        </div>
        <button id="sendLink" class="btn" style="width:100%">Send sign-in link</button>
        <div id="loginNotice">${errorMsg ? `<div class="notice error">${esc(errorMsg)}</div>` : ""}</div>
      </div>`;
    const emailInput = document.getElementById("email");
    const submit = async () => {
      const email = emailInput.value.trim();
      const n = document.getElementById("loginNotice");
      if (!email) { n.innerHTML = "<div class='notice error'>Enter your email address.</div>"; return; }
      const btn = document.getElementById("sendLink");
      btn.disabled = true; btn.textContent = "Sending…";
      const r = await api("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email }) });
      btn.disabled = false; btn.textContent = "Send sign-in link";
      if (!r.ok) { n.innerHTML = `<div class='notice error'>${esc(r.data.error || "Something went wrong. Try again.")}</div>`; return; }
      n.innerHTML = r.data.mode === "sandbox"
        ? `<div class='notice'>Sandbox mode (no email provider yet). <a href="${r.data.dev_link.replace(/\/\?token=/, "/profile.html?token=")}">Open your sign-in link</a>.</div>`
        : "<div class='notice'>Link sent. Check your email — it expires in 15 minutes.</div>";
    };
    document.getElementById("sendLink").addEventListener("click", submit);
    emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  logoutBtn.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    bearer = null; sessionStorage.removeItem("bt_token");
    renderSignIn();
  });

  /* ---------- main render ---------- */
  function renderAll() {
    logoutBtn.hidden = false;
    const p = me.profile, c = me.contact;
    app.innerHTML = `
      <section class="section card">
        <div class="profile-head">
          ${avatarHtml(p && p.avatar_url, c.full_name, "")}
          <div class="grow">
            <h1 style="margin:0;font-size:24px">${esc(c.full_name || "Your profile")}</h1>
            <p class="meta" style="margin:4px 0 0">${me.waiver_ok ? '<span class="chip ok">Waiver signed ✓</span>' : '<span class="chip need">Waiver needed at next registration</span>'}</p>
          </div>
        </div>
        <div class="actions" style="margin-top:14px">
          <button class="btn secondary avatar-btn" id="changePhoto">${p && p.avatar_url ? "Change photo" : "Add a photo"}</button>
          <button class="btn secondary" id="editProfile">Edit profile</button>
          <button class="btn ghost" id="shareProfile">Share</button>
        </div>
        <div id="profileNotice"></div>
      </section>

      <section class="section card" id="upcomingSection">
        <h2>Upcoming events</h2>
        <div id="upcomingList"><p class="meta">Loading…</p></div>
        <div class="row" style="border:0;padding-top:14px">
          <div class="grow">
            <strong>Email me reminders</strong>
            <div class="meta">We'll email you 24 hours before events you're registered for. Unsubscribe anytime.</div>
          </div>
          ${switchHtml("remindSelf", p && p.reminder_opt_in)}
        </div>
      </section>

      <section class="section card">
        <h2>Your family</h2>
        <div id="familyList"></div>
        <button class="btn secondary" id="addChild" style="margin-top:10px">Add a child</button>
      </section>

      <section class="section card">
        <h2>Your results</h2>
        <div id="resumeList"><p class="meta">Loading…</p></div>
      </section>

      <section class="section card" id="passkeyCard" hidden>
        <h2>Sign in faster with Face ID or fingerprint</h2>
        <p class="meta">Add this device once. After that, signing in is one tap — no email link needed.</p>
        <button class="btn" id="enrollPasskey">Add this device</button>
        <div id="passkeyNotice"></div>
      </section>`;

    document.getElementById("changePhoto").addEventListener("click", () => pickAvatar(c.id));
    document.getElementById("editProfile").addEventListener("click", editProfileModal);
    document.getElementById("shareProfile").addEventListener("click", shareProfile);
    document.getElementById("addChild").addEventListener("click", addChildModal);
    wireSwitch("remindSelf", (on) => setReminders(c.id, on));

    renderFamily();
    loadUpcoming();
    loadResume(c.id);
    setupPasskeyCard();
  }

  function avatarHtml(url, name, extraClass) {
    const initials = (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    return url
      ? `<img class="avatar ${extraClass}" src="${API + url}" alt="${esc(name || "Profile photo")}" loading="lazy" />`
      : `<div class="avatar ${extraClass}" aria-hidden="true">${esc(initials)}</div>`;
  }

  function switchHtml(id, on) {
    return `<label class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""} /><span class="track"></span><span class="dot"></span></label>`;
  }
  function wireSwitch(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => fn(el.checked));
  }

  /* ---------- profile edit ---------- */
  function editProfileModal() {
    const p = me.profile, c = me.contact;
    openModal(`
      <h2 style="margin-top:0">Edit profile</h2>
      <div class="field"><label for="fName">Your name</label>
        <input id="fName" type="text" value="${esc(c.full_name || "")}" autocomplete="name" /></div>
      <div class="field"><label for="fInsta">Instagram (optional)</label>
        <input id="fInsta" type="text" value="${esc(p.instagram_handle || "")}" placeholder="yourhandle" />
        <div class="meta">Just your handle — with or without the @</div></div>
      <div class="field"><label for="fBio">About you (optional)</label>
        <textarea id="fBio" maxlength="280" rows="3">${esc(p.bio || "")}</textarea>
        <div class="meta">A sentence or two. 280 characters max.</div></div>
      <div class="field"><label for="fDob">Date of birth (optional)</label>
        <input id="fDob" type="date" value="${esc(p.date_of_birth || "")}" /></div>
      <div class="field"><label for="fVis">Who can see your profile?</label>
        <select id="fVis">
          <option value="public" ${p.visibility === "public" ? "selected" : ""}>Anyone with the link</option>
          <option value="members" ${p.visibility === "members" ? "selected" : ""}>Members only</option>
          <option value="private" ${p.visibility === "private" ? "selected" : ""}>Just me</option>
        </select></div>
      <div class="row" style="border:0"><div class="grow">Show my results on my profile</div>${switchHtml("fHist", p.show_history)}</div>
      <div class="row" style="border:0"><div class="grow">Show my Instagram</div>${switchHtml("fShowIg", p.show_instagram)}</div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" id="saveProfile">Save profile</button>
        <button class="btn ghost" data-close>Cancel</button>
      </div>
      <div id="editNotice"></div>`);
    document.getElementById("saveProfile").addEventListener("click", async () => {
      const body = {
        full_name: document.getElementById("fName").value,
        instagram_handle: document.getElementById("fInsta").value,
        bio: document.getElementById("fBio").value,
        visibility: document.getElementById("fVis").value,
        show_history: document.getElementById("fHist").checked ? 1 : 0,
        show_instagram: document.getElementById("fShowIg").checked ? 1 : 0,
      };
      const dob = document.getElementById("fDob").value;
      if (dob) body.date_of_birth = dob;
      const r = await api("/api/profile/update", { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) { document.getElementById("editNotice").innerHTML = `<div class="notice error">${esc(r.data.error || "That didn't save. Try again.")}</div>`; return; }
      closeModal();
      load();
    });
  }

  function shareProfile() {
    const url = location.origin + location.pathname.replace(/profile\.html$/, "member.html") + "?contact_id=" + me.contact.id;
    if (navigator.share) { navigator.share({ title: "My Boomtown profile", url }).catch(() => {}); return; }
    navigator.clipboard.writeText(url).then(() => flash("profileNotice", "Link copied"));
  }

  /* ---------- avatar (crop + upload) ---------- */
  function pickAvatar(contactId) {
    avatarTarget = contactId;
    avatarFile.value = "";
    avatarFile.click();
  }
  avatarFile.addEventListener("change", () => {
    const file = avatarFile.files && avatarFile.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return flash("profileNotice", "We can't read that file type. JPG or PNG works best — iPhone users: choose \u201CMost Compatible\u201D in Camera settings, or screenshot the photo.", true);
    }
    if (file.size > 5 * 1024 * 1024) {
      return flash("profileNotice", "That photo is too large (5 MB max). Try a smaller one or a screenshot of it.", true);
    }
    const url = URL.createObjectURL(file);
    openModal(`
      <h2 style="margin-top:0">Position your photo</h2>
      <div class="crop-box"><img id="cropImg" src="${url}" alt="Photo to crop" /></div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" id="useCrop">Use photo</button>
        <button class="btn ghost" data-close>Cancel</button>
      </div>`);
    const img = document.getElementById("cropImg");
    if (!window.Cropper) { // CDN blocked — upload uncropped rather than blocking the user
      document.getElementById("useCrop").addEventListener("click", () => uploadBlob(file, file.type));
      return;
    }
    const cropper = new Cropper(img, { aspectRatio: 1, viewMode: 1, autoCropArea: 1, movable: true, zoomable: true });
    document.getElementById("useCrop").addEventListener("click", () => {
      const canvas = cropper.getCroppedCanvas({ width: 512, height: 512, imageSmoothingQuality: "high" });
      canvas.toBlob((blob) => uploadBlob(blob, "image/jpeg"), "image/jpeg", 0.85);
    });
  });

  async function uploadBlob(blob, type) {
    const btn = document.getElementById("useCrop");
    if (btn) { btn.disabled = true; btn.textContent = "Uploading…"; }
    const headers = { "Content-Type": type };
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    const orgId = localStorage.getItem("bt_org");
    if (orgId) headers["X-Org-Id"] = orgId;
    try {
      const resp = await fetch(API + "/api/profile/avatar?contact_id=" + avatarTarget, {
        method: "POST", headers, credentials: "include", body: blob,
      });
      const data = await resp.json().catch(() => ({}));
      closeModal();
      if (!resp.ok) return flash("profileNotice", data.error || "That didn't save. Try again.", true);
      load();
    } catch {
      closeModal();
      flash("profileNotice", "Couldn't reach Boomtown. Check your connection and try again.", true);
    }
  }

  /* ---------- upcoming events ---------- */
  async function loadUpcoming() {
    const r = await api("/api/profile/upcoming");
    const el = document.getElementById("upcomingList");
    if (!el) return;
    if (!r.ok) { el.innerHTML = `<p class="meta">${esc(r.data.error || "Couldn't load events.")}</p>`; return; }
    const rows = r.data.upcoming || [];
    if (!rows.length) {
      el.innerHTML = `<p class="meta">Nothing on the calendar for you yet. Browse events and grab a spot.</p>
        <a class="btn secondary" href="schedule.html">See the schedule</a>`;
      return;
    }
    el.innerHTML = rows.map((e) => `
      <div class="row">
        <div class="grow">
          <strong>${esc(e.name)}</strong>
          <div class="meta">${fmtDate(e.starts_at)}${e.location ? " · " + esc(e.location) : ""}${e.contact_id !== me.contact.id ? " · for " + esc((e.full_name || "").split(" ")[0]) : ""}</div>
        </div>
        <a class="btn ghost" href="${API}/api/events/ics?event_id=${e.event_id}" aria-label="Add ${esc(e.name)} to calendar">Add to calendar</a>
      </div>`).join("");
  }

  async function setReminders(contactId, on) {
    const r = await api("/api/profile/reminders", { method: "POST", body: JSON.stringify({ contact_id: contactId, opt_in: on }) });
    flash("profileNotice", r.ok ? (on ? "Reminders on" : "Reminders off — you won't get event emails") : (r.data.error || "That didn't save."), !r.ok);
  }

  /* ---------- résumé ---------- */
  async function loadResume(contactId) {
    const r = await api("/api/profile/resume?contact_id=" + contactId);
    const el = document.getElementById("resumeList");
    if (!el) return;
    if (!r.ok) { el.innerHTML = `<p class="meta">${esc(r.data.error || "Couldn't load results.")}</p>`; return; }
    const rows = r.data.results || [];
    if (!rows.length) {
      el.innerHTML = "<p class='meta'>No results yet. Play in a Boomtown event and your finishes will show up here automatically.</p>";
      return;
    }
    const t = r.data.totals;
    el.innerHTML = `
      <p class="meta">${t.events} event${t.events === 1 ? "" : "s"} · ${t.wins}–${t.losses}${t.best_finish ? " · best finish " + ordinal(t.best_finish) : ""} · ${t.points} pts</p>
      ${rows.map((x) => `
        <div class="results-row">
          <div><strong>${esc(x.name)}</strong><div class="meta">${fmtDate(x.starts_at)} · ${esc(x.team_name || "")}</div></div>
          <div class="meta">${x.rank ? ordinal(x.rank) + " of " + x.teams_in_event : ""}</div>
          <div>${x.wins}–${x.losses}</div>
        </div>`).join("")}`;
  }

  /* ---------- family ---------- */
  function renderFamily() {
    const el = document.getElementById("familyList");
    const fam = me.family || [];
    if (!fam.length) {
      el.innerHTML = "<p class='meta'>Add your kids here to register them for events and sign their forms — all from your account.</p>";
      return;
    }
    el.innerHTML = fam.map((k) => `
      <div class="row">
        ${avatarHtml(k.avatar_url, k.full_name, "small")}
        <div class="grow">
          <strong>${esc(k.full_name)}</strong>
          <div class="meta">Age ${k.age ?? "—"}
            ${k.waiver_ok ? '<span class="chip ok">Signed ✓</span>' : '<span class="chip need">Needs signature</span>'}
            ${k.turns_18_soon ? '<span class="chip need">Turns 18 soon</span>' : ""}
          </div>
        </div>
        <div class="actions">
          ${k.is_adult
            ? `<button class="btn secondary" data-ageout="${k.contact_id}" data-name="${esc(k.full_name)}">Hand over account</button>`
            : `${k.waiver_ok ? "" : `<button class="btn secondary" data-sign="${k.contact_id}" data-name="${esc(k.full_name)}">Sign</button>`}
               <button class="btn ghost" data-photo="${k.contact_id}" aria-label="Change photo for ${esc(k.full_name)}">Photo</button>`}
        </div>
      </div>`).join("");
    el.querySelectorAll("[data-sign]").forEach((b) => b.addEventListener("click", () => signWaiverModal(Number(b.dataset.sign), b.dataset.name)));
    el.querySelectorAll("[data-photo]").forEach((b) => b.addEventListener("click", () => pickAvatar(Number(b.dataset.photo))));
    el.querySelectorAll("[data-ageout]").forEach((b) => b.addEventListener("click", () => ageOutModal(Number(b.dataset.ageout), b.dataset.name)));
  }

  function addChildModal() {
    openModal(`
      <h2 style="margin-top:0">Add a child to your family</h2>
      <div class="field"><label for="cName">Their full name</label>
        <input id="cName" type="text" autocomplete="off" /></div>
      <div class="field"><label for="cDob">Their date of birth</label>
        <input id="cDob" type="date" />
        <div class="meta">We use this to know when forms need a parent's signature.</div></div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" id="saveChild">Add a child</button>
        <button class="btn ghost" data-close>Cancel</button>
      </div>
      <div id="childNotice"></div>`);
    document.getElementById("saveChild").addEventListener("click", async () => {
      const r = await api("/api/family/add-child", {
        method: "POST",
        body: JSON.stringify({ full_name: document.getElementById("cName").value, date_of_birth: document.getElementById("cDob").value }),
      });
      if (!r.ok) { document.getElementById("childNotice").innerHTML = `<div class="notice error">${esc(r.data.error || "That didn't save. Try again.")}</div>`; return; }
      closeModal();
      load();
    });
  }

  const WAIVER_TEXT = "[PLACEHOLDER WAIVER \u2014 official liability waiver text goes here before real use. It will cover assumption of risk, release of liability, medical authorization, and photo consent for Boomtown Athletics events. The owner supplies the final wording, reviewed for signing on behalf of a minor.]";

  function signWaiverModal(minorId, name) {
    const first = (name || "").split(" ")[0];
    openModal(`
      <h2 style="margin-top:0">Sign for ${esc(first)}</h2>
      <p>This form covers <strong>${esc(first)}</strong>. As their parent or legal guardian, you sign on their behalf.</p>
      <div class="waiver-scroll" id="waiverScroll" tabindex="0">${esc(WAIVER_TEXT)}${"<br><br>".repeat(2)}— End of document —</div>
      <p class="meta" id="scrollHint">Scroll to the end to sign</p>
      <div class="field"><label for="wName">Type your full legal name</label>
        <input id="wName" type="text" autocomplete="name" /></div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" id="doSign" disabled>Sign for ${esc(first)}</button>
        <button class="btn ghost" data-close>Cancel</button>
      </div>
      <div id="signNotice"></div>`);
    const scroll = document.getElementById("waiverScroll");
    const signBtn = document.getElementById("doSign");
    const unlock = () => {
      if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 8) {
        signBtn.disabled = false;
        document.getElementById("scrollHint").textContent = "";
      }
    };
    scroll.addEventListener("scroll", unlock);
    unlock(); // short text may not need scrolling
    signBtn.addEventListener("click", async () => {
      const r = await api("/api/family/sign-waiver", {
        method: "POST",
        body: JSON.stringify({ minor_contact_id: minorId, signed_name: document.getElementById("wName").value }),
      });
      if (!r.ok) { document.getElementById("signNotice").innerHTML = `<div class="notice error">${esc(r.data.error || "That didn't save. Try again.")}</div>`; return; }
      closeModal();
      load();
    });
  }

  function ageOutModal(minorId, name) {
    const first = (name || "").split(" ")[0];
    openModal(`
      <h2 style="margin-top:0">${esc(first)} is 18 — hand over their account</h2>
      <p>Enter <strong>their</strong> email address. We'll send them an invitation to claim their own account. All their playing history moves with them — your account stays untouched.</p>
      <div class="field"><label for="aEmail">Their email</label>
        <input id="aEmail" type="email" inputmode="email" /></div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" id="doAgeout">Send invitation</button>
        <button class="btn ghost" data-close>Cancel</button>
      </div>
      <div id="ageoutNotice"></div>`);
    document.getElementById("doAgeout").addEventListener("click", async () => {
      const r = await api("/api/family/ageout", {
        method: "POST",
        body: JSON.stringify({ minor_contact_id: minorId, email: document.getElementById("aEmail").value }),
      });
      if (!r.ok) { document.getElementById("ageoutNotice").innerHTML = `<div class="notice error">${esc(r.data.error || "That didn't send. Try again.")}</div>`; return; }
      closeModal();
      load();
    });
  }

  /* ---------- passkeys ---------- */
  function setupPasskeyCard() {
    const card = document.getElementById("passkeyCard");
    if (!window.btPasskey || !window.btPasskey.supported) return;
    card.hidden = false;
    document.getElementById("enrollPasskey").addEventListener("click", async () => {
      const btn = document.getElementById("enrollPasskey");
      btn.disabled = true; btn.textContent = "Waiting for your device…";
      try {
        const label = await window.btPasskey.enroll();
        btn.textContent = "Add this device";
        btn.disabled = false;
        flash("passkeyNotice", (label || "This device") + " added. Next time, just use your face or fingerprint.");
      } catch (e) {
        btn.textContent = "Add this device";
        btn.disabled = false;
        flash("passkeyNotice", (e && e.message) || "That didn't go through. Try again, or use the email link.", true);
      }
    });
  }

  /* ---------- modal + utils ---------- */
  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true"><div class="modal">${html}</div></div>`;
    const backdrop = modalRoot.firstElementChild;
    requestAnimationFrame(() => backdrop.classList.add("open"));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
    modalRoot.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    document.addEventListener("keydown", escClose);
    const focusable = backdrop.querySelector("input, button, select, textarea, [tabindex]");
    if (focusable) focusable.focus();
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }
  function closeModal() {
    const backdrop = modalRoot.firstElementChild;
    if (!backdrop) return;
    backdrop.classList.remove("open");
    document.removeEventListener("keydown", escClose);
    setTimeout(() => { modalRoot.innerHTML = ""; }, 160);
  }
  function flash(id, msg, isError) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="notice${isError ? " error" : ""}">${esc(msg)}</div>`;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(s) {
    if (!s) return "Date TBA";
    const d = new Date(s.replace(" ", "T"));
    if (isNaN(d)) return s;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
})();
