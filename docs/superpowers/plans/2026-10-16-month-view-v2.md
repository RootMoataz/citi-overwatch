# Month View v2 (hours-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the shipped Month view as the owner's hours-first calendar: no milestone ribbons, approval-only colours, deadline markers, and a selected-day panel with entry details and the locked-entry actions.

**Architecture:**
- **Backend:** one additive field on the existing calendar route, `locks`, built with the week view's `_locks`.
- **Frontend:** rework `MonthView`/`MonthDayBox`, drop `MonthBars`, and add a `MonthDayPanel`. `TimesheetPage` passes the existing request-change dialog in, and keeps `?day=` for the selection.

**Tech Stack:** Python 3.12 Lambda (pytest); React 19, MUI 9, TanStack Query, Vitest + Testing Library + MSW; Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-timesheet-month-calendar-design.md` — section **"Revision 2 (16 Oct 2026): hours-first Month view"** is binding; the earlier sections hold where Revision 2 doesn't replace them. Mockup: `.superpowers/redesign/My timesheet - Month (v2).png`.

## Global Constraints

- **Repo and branch:** repo `C:\Users\mizo7\OneDrive\Desktop\Projects\coding-workshop-participant`, branch `feat/frontend`. Work in place. Don't switch branches, push, deploy or touch remotes.
- **Rules and permissions:** no business-rule or permission changes.
  - Only timer hours are locked.
  - Typed hours stay editable in the Day view.
  - The Month view itself never saves hours.
- **API:** the only change is the additive `locks` on `GET /time-entries/calendar`, in the week view's exact shape `[{milestone_id, work_date, hours, draft_hours, tracked_hours, request}]`.
- **Exact copy** (from the spec):
  - status words "Approved", "Pending" / "Pending approval", "Needs revision", "Not submitted";
  - "⚠ Over 40h";
  - "📅 1 milestone deadline" / "📅 N milestone deadlines";
  - "<total>h logged in <Month>" and "Pending + approved · Rejected hours excluded.";
  - "Milestone dates appear separately from time-entry status.";
  - "Timer hours are locked; your manager approves any change";
  - **Request a change** / "Change requested";
  - **Edit in Day view**;
  - "Milestone dates";
  - **View milestones**;
  - "Today";
  - "No hours".
- **Source:** Manual when `tracked_hours` is 0; Tracked when `tracked_hours` ≥ `hours`; Mixed otherwise.
- **Day totals:** pending + approved only.
- **URL:** `?month=YYYY-MM&day=YYYY-MM-DD` while in Month.
- **Tests:** use role and label queries. Freeze "today" with `vi.useFakeTimers({ toFake: ['Date'] })`.
- **Commits:**
  - No attribution of any kind.
  - Exact commit messages.
  - Stage only your files; `backend/health/` stays out.
  - Leave `docs/superpowers/specs/2026-10-16-redesign-from-mockups-design.md` alone (another agent).
- **Test runs:** one suite at a time.
  - Frontend: `cd frontend && npx vitest run <paths> --testTimeout=20000`, then the full suite, then `npm run lint`.
  - Backend: `cd backend/v1 && OVERWATCH_TEST_DB=overwatch_test_m2 python -m pytest -o addopts="" -q <paths>`.
  - Four date-dependent backend tests fail after 8 pm New York time. This is known.

## Review Focus

1. **A day holding only a rejected line.** Its total is 0h, the line is struck through and says "Needs revision", and the panel shows the manager's reason and **Edit in Day view**. Pinned in Task 2.
2. **A timer-locked cell with a pending change request.** The panel shows "Change requested" disabled, never a second request. Pinned in Task 2.
3. **Selecting a day in another month via `?day=`.** The selection is clamped to the shown month (today, otherwise the 1st), with no crash. Pinned in Task 2.
4. **A deadline on a day with no hours.** The day still shows the 📅 marker, and the panel shows "No hours" plus the milestone date. Pinned in Task 2.
5. **Phones.** The panel sits under the grid, the dots are coloured by approval status, and there's no horizontal scroll at 375px. Checked in Task 3's browser pass.

---

### Task 1: Calendar `locks`

**Files:**
- Modify: `backend/v1/app/features/time/service.py`. `get_month` returns `locks` from `_locks(conn, user_id, entries, drafts)`, using the same entries and drafts it already loads.
- Test: `backend/v1/tests/integration/test_time_calendar.py`.
- Docs: the calendar row in `docs/project/API.md`.

- [ ] **Step 1: Write failing tests:**
  - `test_calendar_locks_list_timer_cells_with_their_pending_request`: a stopped-timer entry and a pending change request on it give one lock with `tracked_hours > 0` and `request` set; a manual entry gives no lock.
  - `test_calendar_locks_include_unsubmitted_drafts`.
  - `test_calendar_locks_respect_the_manager_project_filter`: a manager reading a report sees locks only on their own projects.
- [ ] **Step 2:** Run the file. Expect the new tests to fail (`KeyError: 'locks'`).
- [ ] **Step 3:** Implement. No new query beyond `_pending_requests`, which `_locks` already does.
- [ ] **Step 4:** Run `tests/integration/test_time_calendar.py tests/integration/test_time.py tests/unit/test_calendar_range.py`. Expect all to pass.
- [ ] **Step 5: Commit:** "Calendar: timer locks and pending change requests for the month"

### Task 2: Hours-first Month view and the selected-day panel

**Files:**
- Modify: `frontend/src/features/timesheet/MonthView.jsx`, `MonthDayBox.jsx`, `monthText.js` and `monthLayout.js`, only as needed.
- Delete: `MonthBars.jsx`, together with its tests and its now-unused helpers. `weekBars` goes only if nothing else uses it.
- Create: `frontend/src/features/timesheet/MonthDayPanel.jsx`.
- Modify: `TimesheetPage.jsx`, which passes `onRequest(cell)` (it already renders `RequestChangeDialog`) and owns `?day=` in Month.
- Tests: rewrite `monthView.test.jsx` for v2, and extend `monthPage.test.jsx`.

**Interfaces:**
- `MonthView({ month, day, onMonthChange(month), onSelectDay(iso), onOpenDay(iso), onRequest(cell) })`.
  - `cell` is the existing dialog's shape `{ milestoneId, date, hours, label }`. `label` is the milestone name.
- The page:
  - `onSelectDay` sets `?day=` (replace);
  - `onOpenDay` is the existing open-a-day path (discard question for another week);
  - `onRequest` sets the dialog's cell.

- [ ] **Step 1: Write failing tests:**
  - **Grid:**
    - `no milestone bars or "more milestones" buttons are drawn`;
    - `a day box shows its total and one chip per line with icon and status word` (approved, pending, rejected struck through and "Needs revision", timer draft "Not submitted");
    - `rejected and draft hours are not in the day total`;
    - `a day with an over-40 entry shows "⚠ Over 40h"`;
    - `deadline markers count the milestones ending that day` (1 / 2, singular / plural);
    - `a day with nothing shows an en dash`.
  - **Selection and panel:**
    - `clicking a day selects it, keeps ?day= in the URL and shows its panel`;
    - `the panel lists each line with status, project, hours, timer-linked and source` (Manual, Tracked, Mixed);
    - `a rejected line shows the manager's reason and Edit in Day view` (Review Focus 1);
    - `a timer-locked line shows the lock and Request a change, which opens the existing dialog with that cell`;
    - `a pending change request shows Change requested, disabled` (Review Focus 2);
    - `Edit in Day view opens the Day view on that date`;
    - `the panel lists that day's milestone dates with Overdue when past and unfinished, and View milestones links to the milestone`;
    - `a deadline on a day with no hours shows No hours and the milestone date` (Review Focus 4);
    - `?day= outside the shown month falls back to today or the 1st` (Review Focus 3).
  - **Header and legend:** `the header shows the month total and "Pending + approved · Rejected hours excluded."`; `the legend lists the four statuses and the milestone-dates note`.
  - **Phone (matchMedia stub):** `dots are coloured by approval status and the panel sits under the grid`.
- [ ] **Step 2:** Run the two files. Expect them to fail.
- [ ] **Step 3:** Implement to the spec's Revision 2 and the mockup.
- [ ] **Step 4:** Run `src/features/timesheet`, then the full suite, then lint. Expect all to pass with pristine output.
- [ ] **Step 5: Commit:** "Month view: hours first — approval chips, deadline markers and a selected-day panel; no milestone ribbons"

### Task 3: End-to-end, docs, screenshot

**Files:**
- **E2E:** `frontend/e2e/overtime.spec.js`, the journey's Month step. Select Friday, check the panel shows its hours, then use **Edit in Day view** to land on that day. On mobile, the same steps through the panel under the grid.
- **Docs:**
  - README (the Month view caption and lines);
  - `docs/project/LOGIC_WALKTHROUGH.md` §5c;
  - `docs/project/USER_STORIES.md`;
  - the test counts in README, TESTING and DEMO_SCRIPT.
- **Screenshot:** retake `docs/images/timesheet-month.png` at 1440×900, as employee.demo, October 2026, with a day selected. Use the local stack (`devserver.py --db overwatch_shots --reset --seed` on 3001 and `npm run dev` on 3000), then stop both servers.

- [ ] **Step 1:** Update the e2e journey. Run `npx playwright test` alone, with the ports free. Expect 6 to pass.
- [ ] **Step 2:** Update the docs with counts from your own final full runs.
- [ ] **Step 3:** Take the screenshot. Also take a 390×844 phone shot into the job tmp folder (not the repo). View both, then stop the servers.
- [ ] **Step 4: Commit:** "Month view v2: end-to-end journey, docs and screenshot"
