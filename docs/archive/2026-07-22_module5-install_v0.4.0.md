# Install v0.4.0 — Admin Panel + Public Schedule
**Version: v0.4.0 · Date: 2026-07-22 · Time needed: ~4 minutes, one upload**

## What you're installing
A full admin panel (sidebar menu on every admin page) with: event calendar you can
**drag and drop** onto, recurring events, templates, duplicating, bulk CSV import,
per-event management screens with registrations + CSV download, member management,
admins & roles, and a **public schedule page** you can embed on boomtownvb.com.

The database part is **already done** — I applied it directly. You only upload files.

## Step 1 — Upload the files (the only step)
1. Unzip `2026-07-22_boomtown_v0.4.0.zip` on your computer.
2. Go to **github.com/10xequity/btplatform** and sign in.
3. Click **Add file → Upload files**.
4. Drag the **`web`**, **`worker`**, **`db`**, and **`docs`** folders AND the
   **`CHANGELOG.md`** file from the unzipped folder into the upload box.
   (Same as last time — GitHub merges folders; existing files get replaced.)
5. In the commit message box type: `v0.4.0 — admin panel + schedule`
6. Click **Commit changes**.

That's it. The worker redeploys itself (~1 min) and the site refreshes (~2 min).

## Step 2 — Try it (2 clicks)
1. Open **https://10xequity.github.io/btplatform/web/admin.html**
   (sign in with your normal email link if asked).
2. You should see a **sidebar** on the left and a dashboard. Click
   **Events & Programs** → drag the **“Blank event”** chip onto any day → fill the
   little form → **Create event**. Done.

## Where things live now
| I want to… | Go to |
|---|---|
| See everything at a glance | **Dashboard** |
| Create / move / bulk-import events | **Events & Programs** (drag chips onto days) |
| Manage one event, get its sign-up link, download its CSV | click any event → its page |
| Repeat something weekly | Events → **↻ Recurring** button |
| Edit or cancel a whole series going forward | any event in the series → the ↻ banner |
| See or edit members | **Members** |
| Add staff or another admin | **Admins & Roles** → “+ Add admin / staff” |
| Put the schedule on boomtownvb.com | **Views & Embed** tab → copy the snippet |

## The embed snippet (for your websites)
Paste this into any page on your Wix/website editor where HTML is allowed:
```html
<script src="https://10xequity.github.io/btplatform/web/widget.js"
        data-view="public" data-theme="auto"></script>
```
The public view hides names and counts. Make a **custom view** in Views & Embed if a
partner needs to see counts — its link is unguessable.

## Still parked from before (nothing new needed from you today)
1. Square sandbox keys → Cloudflare secrets (see the v0.3.0 install doc, Step 3).
2. Your official waiver wording (the current one is a placeholder).
