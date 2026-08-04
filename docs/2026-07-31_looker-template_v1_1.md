# Boomtown Platform — Looker Studio Revenue Template
**File:** docs/2026-07-31_looker-template_v1_1.md · **Version:** v1.1 · **Date:** 2026-07-31 · **Ships in:** v0.43.0
**Supersedes:** docs/2026-07-30_looker-template_v1_0.md (single-org content unchanged; v1.1 adds the cross-company feed).
**v1_0 was DELETED 2026-08-04** with the owner's OK — two versions of one document side by side is what
`CLAUDE.md` file hygiene forbids in as many words. Its history is in git; this file is the only live copy.

Owner requirements #12 and #18 ask for custom, graphically editable reporting "similar to
Power BI." The build/buy call of record (library §1) stands: **do not build a report
builder** — export to a free Looker Studio template. Two feeds now exist: the single-org
feed from v0.40.0, and (new in v0.43.0) a cross-company feed for owners who staff more
than one org (owner req #5, multi-company day-1).

## The single-org data contract (unchanged since v0.40.0)

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

Money is integer **cents** on purpose (no float drift). Divide by 100 once in Looker and
every chart is in dollars.

## NEW — the cross-company data contract (v0.43.0)

`Admin → Sales & Reports → Export for Looker · all companies` downloads
`boomtown-revenue-all-YYYY-MM-DD.csv`. The button appears only when you hold admin or
staff in **more than one** company; the file contains one row per event across **every
company you staff** — the server derives that list from your own roles, so there is
nothing to select and no way to request a company you don't staff. Deactivated companies
are excluded, the same rule the org switcher follows.

The 12 headers are a second, independent contract — the first two columns are new, the
remaining ten are identical to the single-org feed and guarded the same way:

| Column | Type in Looker | Meaning |
|---|---|---|
| `org_id` | Number | Stable company ID — use for drill-through |
| `org` | Text | Company name |
| *(then the 10 single-org columns above, same names, same meanings)* | | |

## One-time setup — cross-company page (~10 minutes, mirrors the single-org steps)

1. **Export** — Admin → Sales & Reports → **Export for Looker · all companies**.
2. **Second Sheet** — Google Sheets → File → Import → Upload → "Replace spreadsheet".
   Name it `Boomtown Revenue Feed — All Companies`. Keep it separate from the single-org
   Sheet so refreshing one never breaks the other.
3. **Add as a second data source** in the existing Looker report (Resource → Manage added
   data sources → Add) or make a fresh report from it.
4. **Field types** — set `org_id` to Number, `org` to Text; the other ten map exactly as
   the single-org table above (divide cents by 100 once).
5. **The chart the feed is for** — a stacked bar of `total_cents/100` by `month`, stacked
   by `org`, plus a scorecard per company. Group and filter on `org`; drill on `org_id`.

## Refresh (both feeds)

Export the CSV again → File → Import → "Replace spreadsheet" on the matching Sheet.
Looker picks the new data up on next view. Two clicks per feed.
