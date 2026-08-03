# Boomtown Platform — Spec: the roster entry sheet

**File:** `docs/2026-08-03_spec_roster-sheet_v1_0.md` · **Version:** v1.0 · **Date:** 2026-08-03
**Status:** SPEC — the sheet to create. The importer will be built against exactly this.
**Supersedes:** nothing. **Source:** owner 2026-08-03, *"I will have to use a new sheet for entry —
perhaps a google sheet that can be connected with proper fields."*

---

## 0. Why a new sheet rather than importing the old one

The existing club roster is one **tab per team**, and its real shape is:

```
15 National 1                          26-27
TEAM ROSTER
First name | Last name | pos |  Email  | Accept/Decline | Notes
Alexa      | Hill      | OH/DS |       | A              |
Syniah     | Tousley Johnson | OH/DS | | A              | Need Middle and Pin
           |           | R   |         |                |          ← an unfilled slot
TEAM MANAGEMENT
First name | Last name |     | Email   | Role           | Notes
Damon      | Sichler   |     | e@x.com | Asst. Coach    |
```

Three things make that hard to import reliably, and none of them are the owner's fault — they are
what a sheet built for *humans* looks like:

1. **Two blocks in one tab**, separated by a heading row, with different columns.
2. **Blank rows are meaningful.** A row with `R` and no name is an unfilled slot, not junk. Any
   importer that skips empty rows silently loses the fact that the team still needs a right side.
3. **The team name and season live in a floating header cell**, not in a column.

A parser can be written for that, and it will break the first time somebody inserts a row. The
sheet below removes the ambiguity instead of coding around it.

**The old sheets are not wasted:** this spec keeps the same vocabulary (positions, Accept/Decline,
the management block) so copy-paste from an existing tab is mechanical.

---

## 1. The sheet — one tab, one row per person

**One flat table. Every team in the same tab.** One tab per team is what makes the current file hard
to read programmatically; a `Team` column costs one cell per row and removes the whole problem.

| # | Column | Required | Accepts | Notes |
|---|---|---|---|---|
| A | `Team` | ✅ | text | e.g. `15 National 1`. Repeats on every row of that team. |
| B | `Season` | ✅ | text | e.g. `26-27`. Same on every row. |
| C | `Role` | ✅ | `Player`, `Coach`, `Asst. Coach`, `Manager`, `Director` | Replaces the two-block layout. |
| D | `First name` | ✅ for a filled slot | text | **Leave blank to declare an unfilled slot.** |
| E | `Last name` | ✅ for a filled slot | text | |
| F | `Position` | ✅ for players | `S OH RS MB L DS`, `/`-separated | `OH/DS` is fine. Blank for staff. |
| G | `Email` | recommended | email | The match key. Without it a returning player becomes a duplicate. |
| H | `Phone` | optional | text | |
| I | `Date of birth` | optional | `YYYY-MM-DD` | Drives the 18+ gate and age groups. |
| J | `Height (cm)` | optional | number 90–250 | **Centimetres.** Feet-and-inches is rendered, not stored. |
| K | `Jersey size` | optional | text | |
| L | `Status` | ✅ | `A`, `D`, `Pending` | Accept / Decline / undecided. `A`/`D` match the current sheet. |
| M | `Prev club` | optional | text | |
| N | `Notes` | optional | text | Free text. Carried through to the tryout card. |

**Rules that make it importable:**

- **Row 1 is the header, exactly as spelled above.** The importer reads column names, not positions,
  so columns may be reordered or extra ones added without breaking anything.
- **One person per row.** No merged cells, no blank spacer rows *between* teams — the `Team` column
  does that job.
- **An unfilled slot is a row with a `Team`, a `Role` of `Player`, a `Position`, and no name.** That
  is how "we still need a middle" survives the import instead of being thrown away as an empty row.
- **Height in centimetres.** `5'11"` typed into a number column becomes `511`, which the validator
  rejects — but only if it is a number column. Rendering in feet and inches is the app's job.

---

## 2. What the importer will do with it

1. **Read** the sheet (paste, CSV upload, or a connected Google Sheet).
2. **Preview before writing.** Every row shown with what will happen: *create contact*, *match
   existing by email*, *unfilled slot*, or *problem*. Nothing is written until it is confirmed.
3. **Match on email first**, then exact name within the same team. A returning player must not become
   a second record — that is the failure that makes an import worse than typing.
4. **Create** `contacts`, team rows, and `tryout_profiles` for positions/height/prev club (v0.60.0).
5. **Report** per team: filled slots, unfilled slots by position, staff assigned, and rows skipped
   with the reason. A silent import is an untrustworthy one.

**Re-running the same sheet is safe.** Matching on email means a second import updates rather than
duplicates. That matters because rosters change weekly and nobody will maintain two copies.

---

## 3. Deliberately not in v1

- **Two-way sync.** The sheet is an *entry* surface; the platform is the record. Sync in both
  directions needs conflict resolution ("who wins when both changed?") and is its own project.
- **Payment status.** It lives in registrations, not the roster; putting it here creates a second
  source of truth for money.
- **Parents/guardians.** Guardianship is created through the family flow, which has the 18+ logic.

---

## 4. To create the sheet

Make one Google Sheet, one tab named `Roster`, and paste this as row 1:

```
Team	Season	Role	First name	Last name	Position	Email	Phone	Date of birth	Height (cm)	Jersey size	Status	Prev club	Notes
```

Share it with the connected Google account (the current one is not reachable — `Requested entity
was not found`), or export CSV. Either unblocks the build.

---

*Changelog: v1.0 (2026-08-03) — first spec. Flattens the one-tab-per-team layout to one row per
person with a Team column, keeps the existing vocabulary so copy-paste is mechanical, and preserves
unfilled slots as first-class rows rather than discarding them as empty.*
