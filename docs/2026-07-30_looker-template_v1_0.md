# Boomtown Platform — Looker Studio Revenue Template
**File:** docs/2026-07-30_looker-template_v1_0.md · **Version:** v1.0 · **Date:** 2026-07-30 · **Ships in:** v0.40.0

Owner requirements #12 and #18 ask for custom, graphically editable reporting "similar to
Power BI." The build/buy call of record (library §1) stands: **do not build a report
builder** — export to a free Looker Studio template. This doc is that template: a one-time
15-minute setup, then a two-click refresh whenever you want current numbers.

## The data contract

`Admin → Sales & Reports → Export for Looker` downloads `boomtown-revenue-YYYY-MM-DD.csv`
(one row per event, from the same source of truth as the Sales screen: Square COMPLETED
card payments, plus cash/comped registrations at event price). The 10 column headers are a
**contract** — the Looker report maps fields by name, and `reports_export.test.mjs` fails
the build if any header changes:

| Column | Type in Looker | Meaning |
|---|---|---|
| `event_id` | Number | Stable ID — use for drill-through, not display |
| `event` | Text | Event name |
| `type` | Text | tournament / league / event |
| `program` | Text | Program name, `(no program)` when unassigned |
| `starts_at` | Date & Time (`YYYY-MM-DDTHH:mm`) | Event start |
| `month` | Text `YYYY-MM` (or `undated`) | Pre-derived — group on this, no calculated field needed |
| `registrations` | Number | Paid + comped + cash-pending count |
| `card_cents` | Number | Square card revenue, in cents |
| `cash_cents` | Number | Cash revenue at event price, in cents |
| `total_cents` | Number | card + cash, in cents |

Money is integer **cents** on purpose (no float drift). Divide by 100 once in Looker
(step 4 below) and every chart is in dollars.

## One-time setup (~15 minutes)

1. **Export the CSV** — Admin → Sales & Reports → **Export for Looker**.
2. **Put it in a Google Sheet** — Google Sheets → File → Import → Upload → select the CSV →
   "Replace spreadsheet". Name the sheet `Boomtown Revenue Feed`. (Looker Studio reads
   Sheets natively and for free; it cannot fetch a password-protected API endpoint, which is
   why the CSV rides through a Sheet.)
3. **Create the report** — lookerstudio.google.com → Create → Report → Add data →
   **Google Sheets** → pick `Boomtown Revenue Feed` → Add.
4. **Add three calculated fields** — Resource → Manage added data sources → Edit →
   ADD A FIELD, one at a time:
   - `Total $` = `total_cents / 100`
   - `Card $` = `card_cents / 100`
   - `Cash $` = `cash_cents / 100`
   Set each field's Type to **Currency (USD)**.
5. **Build the four standard pages** (each is: Insert → chart type → drop the fields on):
   - **Revenue by month** — Column chart · Dimension `month` · Metric `Total $` · sort `month` ascending.
   - **Revenue by program** — Bar chart · Dimension `program` · Metrics `Total $`, `registrations`.
   - **Card vs cash mix** — Stacked column · Dimension `month` · Metrics `Card $`, `Cash $`.
   - **Event table** — Table · Dimensions `event`, `type`, `starts_at` · Metrics `registrations`, `Total $` · sort `starts_at` descending.
6. **Add a date-range control** (Insert → Date range control) bound to `starts_at`, and a
   drop-down filter on `program`. That covers the "modify and change reports graphically"
   part of req #18 — every chart on the page is drag-editable from here on.

## Refreshing the numbers (2 clicks, ~1 minute)

1. Admin → Sales & Reports → **Export for Looker**.
2. In the `Boomtown Revenue Feed` Sheet: File → Import → Upload → **Replace current sheet**.

Looker Studio picks the new rows up automatically (Refresh data in the report toolbar if it
looks stale). Because the headers never change, nothing in the report ever needs remapping.

## Verified against current reality

Looker Studio's Google Sheets connector, calculated-field editor, and date-range controls
were last verified against Google's live product 2026-07 by a prior session; the UI labels
above (ADD A FIELD, Manage added data sources) match that verification. If Google renames a
menu, the concepts hold: connect the Sheet, divide cents by 100, chart on `month`/`program`.

[INTERPRETATION] Multi-company note: the export is org-scoped to the company you're signed
into (standards §4). To report across Boomtown Volleyball / Match Point Social / Queens
Club, export once per company into three tabs of the same Sheet and add `Company` as a
manual column — or ask for a cross-org export line in a future release.
