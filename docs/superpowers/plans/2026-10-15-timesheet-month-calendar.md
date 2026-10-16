# Timesheet Month Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a view-only Month view (Day | Week | Month) to the employee timesheet. It shows the person's milestones as bars and each day's hours by milestone and status, and a click on a day opens it in the Day view.

**Architecture:**
- **Backend:** one read-only route, `GET /time-entries/calendar`, next to `get_week`. It reuses the week's permission filter, entry view, overtime and drafts.
- **Frontend:** a pure layout module (the weeks of the grid, the bar lanes and the per-day lines), a `MonthView` component, and `TimesheetPage` wiring (toggle, URL, open a day).

**Tech Stack:** Python 3.12 Lambda backend (pytest), React 19, MUI 9, TanStack Query, react-router, Vitest + Testing Library + MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-timesheet-month-calendar-design.md`

## Global Constraints

- **Repo and branch:** `C:\Users\mizo7\OneDrive\Desktop\Projects\coding-workshop-participant`, branch `feat/frontend`. Work in place. Don't switch branches, push, deploy, or touch remotes.
- **Rules and API:**
  - No business-rule or permission changes, and no change to the Day or Week views' behaviour.
  - The only API change is the new route `GET /time-entries/calendar`.
- **localStorage:** `overwatch.timesheet.view` is `'day' | 'week' | 'month'`, default `'day'`. Every read and write is wrapped in try/catch.
- **Month URL:** `?month=YYYY-MM`.
- **Status styles:** approved is solid; pending is outlined; rejected is red, with the hours struck through; timer draft is dashed ("from timer").
- **Status words** in accessible names: `approved`, `pending`, `rejected`, `from timer`.
- **Day totals:** count pending and approved hours only. Rejected and timer drafts are shown but not counted. The day cap is `DAY_CAP` (24) from `useTimesheetWeek.js`.
- **State colours and stripes:** come from `STATUS`/`statusColor` in `app/theme.js` and from `frontend/src/components/stateStripes.js`. Waiting and blocked are striped.
- **Date maths:** on ISO `YYYY-MM-DD` strings, with no local-time `Date` arithmetic that can shift across a daylight-saving change.
- **Tests:** use role and label queries, as the existing tests do.
- **Commits:**
  - No attribution of any kind: no Co-Authored-By, no "Generated with", no AI mention in commits or files.
  - Commit locally only, with the exact message each task gives.
  - Stage only the files you changed. Never `git add -A`: `backend/health/` is untracked and must stay out.
- **Test runs:** one suite at a time (machine load). Always pass `--testTimeout=20000` to Vitest, and don't change the Vitest config.
  - Frontend: `cd frontend && npx vitest run <paths> --testTimeout=20000`; full suite `npx vitest run --testTimeout=20000`; then `npm run lint`.
  - Backend: `cd backend/v1 && OVERWATCH_TEST_DB=overwatch_test_cal python -m pytest -o addopts="" -q <path>`.
  - Four date-dependent backend tests fail after 8 pm New York time. This is a known issue (see TESTING.md) and not yours.
  - A local review stack may be running on ports 3000/3001 (the owner is looking at it). Don't stop it, and don't start servers on those ports. Playwright (Task 5) needs them free, so the controller frees them before that task.
- **Style:** match the surrounding code: its comment density, naming and idioms.
- **Secrets:** never print or commit them (`ENVIRONMENT.config`, `.env*`, password files).

## Review Focus

1. **Daylight-saving weeks** (US clocks change on 8 Mar and 1 Nov 2026). A grid built with local `Date` maths can repeat or skip a day. Task 2 pins November 2026 and March 2026.
2. **A busy day with more than 3 milestones.** The box must stay its size, with "+N more", and the accessible name must still list every line. Pinned in Task 3.
3. **A milestone the person logged on but is no longer assigned to** (`role: null`). Its hours still need a name, and its bar still shows. Pinned in Tasks 1 and 3.
4. **Fast month switching.** While the next month loads, the grid must not show the previous month's hours under the new month's heading. Pinned in Task 3.
5. **Opening a day in another week with unsaved edits.** It must ask the existing discard question, never silently drop the edits. Pinned in Task 4.

---

### Task 1: The calendar route

**Files:**
- Modify: `backend/v1/app/features/time/service.py`:
  - add `calendar_range(month: str | None) -> tuple[str, date, date]`, next to `week_start`;
  - add `get_month(conn, ctx, params) -> dict`, after `get_week`.
- Modify: `backend/v1/app/features/time/routes.py`: add `@router.route("GET", "/time-entries/calendar")`, registered before any `/time-entries/{id}` route so `calendar` isn't read as an id.
- Test: `backend/v1/tests/unit/test_calendar_range.py` (new) and `backend/v1/tests/integration/test_time_calendar.py` (new). Reuse `world()`-style setup from `tests/integration/test_time.py` and helpers from `tests/helpers.py`.
- Docs: `docs/project/API.md`: one row under "Time entries and approvals", with the response shape from the spec.

**Interfaces:**
- **Produces:** the JSON shape in the spec's "API" section. Exact keys:
  - `month`, `range{start,end}`, `user{id,name}`;
  - `milestones[{id,name,start_date,end_date,status,display_status,progress_percent,project{id,name,status},role}]`;
  - `entries[...]`: the same view as the week's entries (`_entry_view`, with the live `over_40` from `_overtime` per week of the range);
  - `drafts[{milestone_id,work_date,hours}]`.
- **Consumes (reuse, don't copy):**
  - `_entry_view`, `_live`, `_overtime`, `drafts_by_cell(..., end=...)`;
  - the week's permission filter logic (extract it from `get_week` into a helper both use);
  - `display_status` and `_latest_percent` from `app/features/milestones/service.py`. "waiting" means a predecessor that isn't completed, the same rule as `_views`.

- [ ] **Step 1: Write failing unit tests** in `test_calendar_range.py`:
  - `calendar_range("2026-10") == ("2026-10", date(2026,9,28), date(2026,11,1))`
  - `calendar_range("2026-06")` starts `date(2026,6,1)` (a Monday) and ends `date(2026,7,5)`
  - `calendar_range("2026-08")` spans 6 weeks: `date(2026,7,27)`..`date(2026,9,6)`
  - `calendar_range("2026-02")` (Feb 2026 starts on a Sunday) gives `date(2026,1,26)`..`date(2026,3,1)`
  - `calendar_range(None)` is the month of `_today()`
  - `"2026-13"`, `"2026-1"`, `"abc"` and `""` raise `ApiError` 400 `VALIDATION_ERROR` with details `{"month": "invalid_month"}`
- [ ] **Step 2: Write failing integration tests** in `test_time_calendar.py`:
  - `test_own_month_lists_assigned_milestones_entries_and_drafts`:
    - set up an assigned milestone, an entry on two days and a stopped timer draft;
    - check the keys, `role == "primary"`, the entries' `label`, and the draft's hours.
  - `test_logged_but_unassigned_milestone_is_listed_with_role_none`
  - `test_waiting_milestone_has_display_status_waiting`: its predecessor isn't completed.
  - `test_milestone_overlapping_the_range_edge_is_included_and_one_outside_is_not`
  - `test_archived_milestone_and_project_are_left_out`
  - `test_rejected_entry_is_listed_with_its_status`
  - `test_employee_reading_someone_else_gets_403` and `test_unknown_user_gets_404`
  - `test_manager_sees_a_report_only_on_projects_they_manage`
  - `test_bad_month_is_400`
  - `test_no_hourly_rate_in_the_response`: no key containing `rate` anywhere in the body.
- [ ] **Step 3:** Run both files. Expect them to fail (no `calendar_range`; the route returns 404).
- [ ] **Step 4: Implement** `calendar_range`, `get_month` and the route:
  - **Milestone order:** by start date, then name, case-insensitive.
  - **Archived:** archived projects and milestones are excluded everywhere.
  - **Overtime:** run `_overtime` once per week of the range.
- [ ] **Step 5:** Run both files, then `tests/integration/test_time.py` and `tests/integration/test_time_rules.py` to check the week view is unchanged. Expect all to pass.
- [ ] **Step 6:** Add the API.md row.
- [ ] **Step 7: Commit:** "Calendar route: GET /time-entries/calendar returns a month's milestones, entries and timer drafts"

### Task 2: Month layout helpers (pure)

**Files:**
- Create: `frontend/src/features/timesheet/monthLayout.js`
- Test: `frontend/src/features/timesheet/monthLayout.test.js`

**Interfaces (produces; Task 3 consumes):**
- `gridWeeks(range: {start, end}) -> string[][]`: one array of 7 ISO dates per week, Monday first.
- `shiftMonth(month: 'YYYY-MM', n: number) -> 'YYYY-MM'` and `monthOf(iso: 'YYYY-MM-DD') -> 'YYYY-MM'`.
- `weekBars(week: string[], milestones, maxLanes = 3) -> { lanes: Bar[][], hidden: Milestone[] }`:
  - A `Bar` is `{ milestone, startCol, endCol, startsBefore, endsAfter, endsHere }`. Columns are 0–6.
  - `startsBefore` and `endsAfter` are true when the bar is cut at the week's edges.
  - `endsHere` is true when the milestone's `end_date` is in this week.
  - Milestones keep their input order (the API's order). Each goes in the first lane where it doesn't overlap.
  - A milestone that fits in no lane goes to `hidden`.
- `dayLines(entries, drafts) -> Map<iso, { total: number, lines: Line[] }>`:
  - A `Line` is `{ milestone_id, hours, kind: 'approved' | 'pending' | 'rejected' | 'draft' }`.
  - Lines are ordered by the milestone's first appearance in entries, then drafts.
  - `total` sums pending and approved only.

- [ ] **Step 1: Write failing tests:**
  - `gridWeeks` for October 2026 (5 weeks, first `2026-09-28`, last `2026-11-01`) and August 2026 (6 weeks).
  - **DST:** `gridWeeks({start:'2026-10-26', end:'2026-11-08'})` gives exactly 14 consecutive dates with no repeat or gap (US clocks change on 1 Nov). Do the same for `2026-03-02`..`2026-03-15`.
  - `shiftMonth('2026-12', 1) === '2027-01'`, `shiftMonth('2026-01', -1) === '2025-12'`, `monthOf('2026-10-14') === '2026-10'`.
  - `weekBars`:
    - two non-overlapping milestones share lane 0;
    - four overlapping ones fill 3 lanes, and the 4th goes to `hidden`;
    - a milestone from before the week to after it has `startCol 0`, `endCol 6`, `startsBefore`, `endsAfter` and not `endsHere`;
    - one ending on Wednesday has `endCol 2` and `endsHere`.
  - `dayLines`: a day with approved 6 + pending 2 + rejected 3 + draft 1.5 has `total 8` and four lines with the right `kind`s.
- [ ] **Step 2:** Run the file. Expect it to fail.
- [ ] **Step 3: Implement.** For date maths, parse ISO strings into UTC dates (`Date.UTC`) and format with `toISOString().slice(0, 10)`.
- [ ] **Step 4:** Run the file, then `npm run lint`. Expect both to pass.
- [ ] **Step 5: Commit:** "Month layout: grid weeks, bar lanes and day lines for the timesheet calendar"

### Task 3: MonthView

**Files:**
- Modify: `frontend/src/api/queries.js`: add `useCalendarMonth(month, enabled = true)`.
  - Query key `['time', 'month', month]`. It starts with `'time'`, so saves that invalidate `['time']` refresh it.
  - Use no `keepPreviousData`: a new month shows the skeleton, never the old month's hours (Review Focus 4).
- Create: `frontend/src/features/timesheet/MonthView.jsx`
- Test: `frontend/src/features/timesheet/monthView.test.jsx`, with MSW handlers for `GET ${API}/time-entries/calendar`. The fixtures are built like `dayView.test.jsx`'s, and "today" is frozen at Wed 14 Oct 2026 with `vi.useFakeTimers({ toFake: ['Date'] })`.

**Interfaces:**
- **Consumes:** Task 1's response, and Task 2's `gridWeeks`, `weekBars`, `dayLines` and `shiftMonth`.
- **Produces:** `MonthView({ month, onMonthChange(month), onOpenDay(iso) })`. Task 4 renders it.

**Exact strings:**
- **Header:**
  - month heading `"October 2026"`;
  - the total `"112h logged in October"`: `formatHours` of the month's pending and approved hours, counting days inside the month only;
  - buttons `"Previous month"`, `"Next month"` and `"This month"`.
- **Grid:** a `table` with `aria-label="October 2026"`, and column headers `Mon` … `Sun`.
- **Day button name:** `"<formatDayShort(date)>, <N hours>"`, where `<N hours>` is `1 hour` for 1, otherwise `<n> hours`. Then the optional parts, in order:
  - `", over 24 hours"`;
  - `", overtime"`;
  - for each line `", <milestone name> <N hours> <approved|pending|rejected|from timer>"`;
  - for each milestone due that day `", due: <name>"`.

  An empty past weekday in the month reads `"<formatDayShort(date)>, no hours"`.
- **Bar:** a link to `/projects/<project.id>?tab=milestones&milestone=<id>`, named `"<name>, <Mon D> to <Mon D>, <STATUS label>"`, plus `", overdue"` when it's unfinished and past its end date.
- **"+N more":** a button named `"<N> more milestones this week"`, which opens a popover listing the hidden milestones (name, dates, state).
- **Day box text:** the date number, the total (`formatHours`), up to 3 lines (`<name> <formatHours>`), then `+N more`. On a past weekday with no hours, the text is `No hours`.
- **Day box looks:**
  - Days outside the month are faded, today has a ring, and Saturdays and Sundays are lightly shaded.
  - Over 24h, the total is red.
  - An overtime day carries the same overtime mark the Week view uses.
- **Loading and errors:** a skeleton grid while loading; the app's `ErrorAlert` with a retry on failure.
- **Legend items:** `Approved`, `Pending`, `Rejected`, `From timer`, `Due`, `Overdue`.
- **Empty month:** `Nothing assigned to you this month`.
- **Phone (`xs`):**
  - boxes show the date, the total and up to 3 coloured dots;
  - tapping a box selects it, and a region under the grid, labelled by its heading `formatDayFull(date)`, lists that day's milestones (state, due/overdue) and lines;
  - an `Open this day` button calls `onOpenDay`;
  - the default selection is today if it's in the month, else the 1st.

- [ ] **Step 1: Write failing tests:**
  - **Day totals and names:**
    - `a day box names its date, total and each milestone's hours with status`: approved 6, pending 2, rejected 3 and draft 1.5 give `"Wed 14 Oct, 8 hours, Schema Mapping 6 hours approved, Build 2 hours pending, Build 3 hours rejected, Schema Mapping 1.5 hours from timer"`.
    - `rejected hours are shown struck through and not counted`: the rejected line has `text-decoration: line-through`, and the box total reads `8h`.
    - `a day over 24 hours says so` and `an overtime day says so`.
    - `a past weekday with no hours says No hours; weekends and future days say nothing`.
    - `a busy day shows 3 lines and +1 more but names all 4` (Review Focus 2).
  - **Bars:**
    - `milestone bars link to the milestone and carry their dates and state`.
    - `a bar ending this week marks its due day, and an unfinished one past its end is overdue`.
    - `a fourth overlapping milestone goes behind 3 more…`: here "1 more milestones this week" opens a popover with its name.
    - `a logged-but-unassigned milestone still gets a bar and named lines` (Review Focus 3).
  - **Header and navigation:**
    - `the header totals the month's pending and approved hours`.
    - `Previous month, Next month and This month call onMonthChange`.
    - `a new month shows a loading grid, never the previous month's hours` (Review Focus 4): MSW delays the second month's response, and while it waits no `"Wed 14 Oct"` button exists.
  - **Other:**
    - `clicking a day calls onOpenDay with its date`.
    - `an empty month still draws the grid and says Nothing assigned to you this month`.
    - `on a phone, tapping a day shows its details and Open this day opens it`: use `window.matchMedia` stubbed for `xs`, as the existing responsive tests do (find one with `grep -rn matchMedia src`).
- [ ] **Step 2:** Run the file. Expect it to fail.
- [ ] **Step 3: Implement** `useCalendarMonth` and `MonthView`.
  - Waiting and blocked bars use `stripes()` from `stateStripes.js`.
  - Long names are ellipsised in the box. Accessible names stay full.
- [ ] **Step 4:** Run `src/features/timesheet`, then the full suite, then lint. Expect all to pass with clean output.
- [ ] **Step 5: Commit:** "Month view: milestone bars and each day's hours by milestone and status, phone day panel"

### Task 4: Day | Week | Month on the timesheet page

**Files:**
- Modify: `frontend/src/features/timesheet/TimesheetPage.jsx`:
  - `readView` accepts `'month'`;
  - the toggle gains `Month`;
  - in the Month view, render `MonthView` in place of the week bar, strip, Day/Week panels and Submit.
- Test: `frontend/src/features/timesheet/timesheet.test.jsx`, or a new `monthPage.test.jsx` if that file is already long.

**Interfaces:**
- **Consumes:** `MonthView({ month, onMonthChange, onOpenDay })` from Task 3.
- **Changes the page's `goTo(target)` to `goTo(target, day?)`**, so opening a day in another week goes through the existing discard question, then lands on `?week=<target>&day=<day>`.

**Behaviour:**
- **Opening the Month view:** the month comes from `?month=`; without it, from the selected `day`, else from today for the current week, else from the shown week's Monday. The page writes `?month=` with `replace`.
- **Month navigation:** updates `?month=` with `replace`.
- **`onOpenDay(iso)`:** switches the view to `day`, stores it, and goes to `mondayOf(iso)` with `day=iso`. Within the current week it uses `setParams` directly. For another week, use `goTo(week, iso)`.
- **Unsaved changes:** while the Month view is shown and there are any, show an info line: `"You have N unsaved change(s) in the week of <formatDayShort(monday)>."` with a button `Back to that week`, which returns to the previous Day/Week view. The existing leave warning stays active. (Controller ruling: without this line, edits would be invisible but still pending.)

- [ ] **Step 1: Write failing tests:**
  - `the Month toggle shows the month and is remembered` (localStorage `overwatch.timesheet.view` becomes `'month'`, and a re-render opens Month).
  - `Month opens on the selected day's month and keeps it in the URL`.
  - `clicking a day in the month opens it in the Day view`.
  - `opening a day in another week with unsaved edits asks first, and Cancel keeps the edits` (Review Focus 5).
  - `unsaved edits show a line in the Month view and Back to that week returns`.
  - `a blocked localStorage still opens the page in the Day view`.
- [ ] **Step 2:** Run the file. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/timesheet src/features/timer src/features/home`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Timesheet: Day | Week | Month, with a month calendar that opens any day in the Day view"

### Task 5: End-to-end, docs and screenshot

**Files:**
- Modify: `frontend/e2e/overtime.spec.js`, the employee timesheet journey. After the hours are submitted, switch to `Month`, find the day's button by its accessible name (with hours), click it, and expect the Day view on that day.
- **Docs:**
  - `README.md`: the Timesheets section, plus the test counts;
  - `docs/project/LOGIC_WALKTHROUGH.md`: a short "Month view" section;
  - `docs/project/USER_STORIES.md`: the employee story;
  - `docs/project/TESTING.md` and `docs/project/DEMO_SCRIPT.md`: the test counts.
- **Screenshot:** `docs/images/timesheet-month.png`, at 1440×900. Take it as employee.demo on the local stack:
  - start `python backend/v1/scripts/devserver.py --db overwatch_shots --reset --seed` on port 3001 and `npm run dev` on 3000;
  - use a Playwright script in `C:\Users\mizo7\.claude\jobs\5a07e959\tmp`;
  - stop both servers afterwards, and confirm the ports are free.

- [ ] **Step 1:** Extend the e2e journey. Run `cd frontend && npx playwright test` alone, with ports 3000 and 3001 free. Expect 6 passed.
- [ ] **Step 2:** Update the docs with the counts from your own final full runs:
  - frontend: `npx vitest run --testTimeout=20000`;
  - backend: `--collect-only` per folder.
- [ ] **Step 3:** Take the screenshot, and view it to check it before committing.
- [ ] **Step 4: Commit:** "Month view: end-to-end journey, docs and screenshot"
