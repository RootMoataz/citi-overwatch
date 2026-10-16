# Redesign Phase 3 (Employee Screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mockups' three employee screens:
- **My week** (`/` for employees): a week picker in the header, "Your focus" (now and next), the grouped milestones with "Might come your way", "Available to claim", "This week's hours" for any past week, and "Your manager";
- **My timesheet** (`/timesheet`): a totals card, the redesigned Week grid with status words, an Entry details side panel, and unsaved typing kept in this tab; Day | Week | Month stay;
- **My history** (`/people/:me/profile`): a profile card, the week's and all-time figures, and Projects and Milestones tabs, with archived work only for those who may see it.

Two accessibility fixes from phase 1's review ride along.

**Architecture:**
- **Backend:** one additive parameter, `GET /users/{id}/profile?sections=this_week` (§7.5).
- **My week:** pure helpers (`features/home/myWork.js`) decide the groups, now and next, and the words. A controlled collapsible mode on the shared `Section` plus `useCollapsedSections()` remembers what's folded. The page composes small cards around them.
- **My timesheet:** `useTimesheetWeek` stays the one source of truth. It gains a one-cell save and a `sessionStorage` mirror. The Entry details panel is `SidePanel` driven by `?entry=`, with the history rules of phase 2's `useMilestonePanelUrl`.
- **My history:** the shared `KpiStrip`, `DataTable`, `FilterBar` and `FootNote`, with two small additive props.

**Tech Stack:**
- Frontend: React 19, MUI 9, TanStack Query 5, react-router 7.
- Tests: Vitest + Testing Library + MSW, and Playwright.
- Backend: Python 3.12 Lambda, pytest on PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-16-redesign-from-mockups-design.md`.
- **Binding sections:** §1–2 (scope, D1–D14, "Calls made"), **§5.1–5.3**, **§7.5**, §7.2, §8, §9's "Every phase" and "Phase 3" bullets, and §10 (10.3 above all).
- **Folded in:**
  - `docs/superpowers/specs/2026-10-15-employee-now-and-next-design.md` and Tasks 4–6 of its plan (`docs/superpowers/plans/2026-10-15-employee-now-and-next.md`). Its backend (Tasks 1–3) is live and unchanged. Its rules all hold, under §5.1's headings "Your focus", "Upcoming" and "Available to claim".
  - The Month view of `docs/superpowers/specs/2026-10-15-timesheet-month-calendar-design.md`, including "Revision 2". It stays as shipped; the Week and Day views take its status words.
- **Mockups** are in `.superpowers/redesign/`:
  - `My Week (Employee).png`;
  - `My Timesheet.png` (Week view with Entry details open) and `My timesheet - Month (v2).png`;
  - `My History.png`.

## Global Constraints

- **Repo and branch:** repo `C:\Users\mizo7\OneDrive\Desktop\Projects\coding-workshop-participant`, branch `feat/frontend`. Work in place. Don't switch branches, push, deploy or touch remotes.
- **No permission or business-rule changes** (spec §1 "Not changing"):
  - `lib/permissions.js`, `app/access.js` and the server's checks stay as they are.
  - Hours are saved only by an explicit action (D9): **Submit** sends one `PUT /time-entries` with the week's changes; the panel's **Save & resubmit** sends one `PUT` with its cell alone. There's no autosave and no "Saved…" text.
  - Proof of work, the 24 h day, the 40 h warning, timer locks and change requests, closed and on-hold rows: all as today.
- **The only API change** is §7.5, and it's additive: `sections=this_week` on `GET /users/{id}/profile`.
- **Privacy:**
  - An employee session never requests another person's data. Every `/users/{id}/…` request carries the viewer's own id. `/time-entries` and `/time-entries/calendar` never carry `user=`. There's no request to `/approvals` or `/allocations`.
  - Employees never see archived work (D8): no "Include archived", no "Archived" or "Project archived" chips.
  - A salary is never on screen until **Employment details** is opened, and only when the profile carries `salary`.
- **Exact copy, verbatim from spec §5.** `<…>` marks data. Hours use `formatHours` ("19.75h"; see the first cross-task ruling).
  - **My week:**
    - title "My week"; subtitle "Hello, <Eli>. Your work and hours in one place.";
    - the week picker is a group named "Week shown in This week's hours": "Previous week", "<Oct 12 – 18, 2026>", "Next week", "This week";
    - "Your focus", with the subtitle "<1> overdue · <1> with your manager";
    - the Now card: "Due <Oct 5, 2026> · <10> days overdue" or "Due <Oct 20, 2026>", "Critical priority" or "High priority", "<Hard> difficulty", "<40>% done", "View milestone", "Discuss", and today's Start timer button;
    - the fallbacks: "Nothing in progress", "Start <name> next", "Nothing else assigned yet", "See what might come your way";
    - the Next words: "Ready to start", "Starts <Oct 21, 2026>", "Waiting on <Discovery, Schema Mapping>";
    - the heads-up: "Heads-up: <name> (<High> priority) may come your way", plus "New";
    - group headings: "In progress (<N>)", "Upcoming (<N>)", "With your manager (<N>)", "Might come your way (<N>)", "Completed · <N>", "Available to claim · <N>";
    - group buttons are named "<Group>, <N> milestone(s)", e.g. "Upcoming, 2 milestones", "Completed, 1 milestone";
    - rows:
      - "Due <Dec 27, 2026>";
      - "Submitted for review. Your manager completes the milestone.";
      - "Planned due <Aug 14, 2026>";
      - "Needs <skill>, which you have" ("Needs <a> and <b>, which you have"; three or more read "Needs <a>, <b> and <c>, which you have");
      - "Ready now", "After <names>", "Prediction", "New";
    - the coming group's intro: "When the milestone before one of these is completed, auto-routing picks someone on the team with the right skills. It's a likely pick, not a promise.";
    - claim empty: "No unassigned milestones available right now.";
    - nothing assigned and nothing coming: today's "Nothing assigned to you right now" with "Milestones your manager gives you, or that you claim, show up here.";
    - hours card:
      - "This week's hours", or "Hours · week of <Oct 5>" for an earlier week;
      - "Pending + approved", "<19.75h> logged", "/ 40h weekly reference";
      - the scale "0h", "<30h> planned", "40h";
      - the figures "Planned" and "Logged";
      - "Open my timesheet";
      - "Logged hours include pending and approved entries.";
      - "<5h> over 40h (sent to your manager as overtime)";
    - "Your manager", "Message <Morgan>".
  - **My timesheet:**
    - title "My timesheet"; subtitle "Review your week. Submit with confidence."; today's "Submit", "Submit <N> change(s)", "Saving…";
    - the totals card is a group named "Week totals":
      - "<19.75h> counted of 40h" (`data-testid="week-total"`) and "<49>%";
      - "<15.75h> Approved", "<4h> Pending", "<8h> Needs revision";
      - "ⓘ Rejected hours are excluded from counted totals.";
    - the week card: "<Oct 12 – 18, 2026>", "This week", the "Timesheet view" toggle "Day", "Week", "Month";
    - the Week grid:
      - column headers "Milestone", "<Mon>" over "<Oct 12>", "Today" under today's date, and "Counted";
      - status words "Approved", "Pending", "Needs revision", plus "Overtime";
      - the last row "Daily total (counted)";
      - the legend "Approved", "Pending", "Needs revision";
    - under the card: "ⓘ <27.75h> entered · <8h> excluded until resubmitted.";
    - Entry details:
      - title "Entry details" and the date "<Wed, Oct 14, 2026>";
      - "Hours", "Work note", "Manager feedback", "Source" ("Manual", "Tracked" or "Mixed") and "<4h> from a timer";
      - the buttons "Request a change", "Save & resubmit" and "Done";
      - the warning "Changing approved hours sends them back for approval.";
      - Day view rows get "Details", named "Details for <Schema Mapping, Wed Oct 14>";
    - the restore notice "Unsaved changes restored. Submit to send them.".
  - **My history:**
    - title "My history"; subtitle "Your work record, including completed milestones."; action "Open my timesheet";
    - the profile card:
      - "<Employee> · <Technology>", "Skills";
      - "Your manager" and "Message <Morgan>";
      - "Employment details" with "Annual salary and other employment details", and inside it "Annual salary";
    - "Week of <Oct 12, 2026>":
      - "Logged this week" with "Pending and approved";
      - "Planned this week";
      - "Overtime this week" with "Above 40h";
    - "All time summary": "Total hours logged" and "Total hours approved", each with "All time";
    - tabs "Projects <N>" and "Milestones <N>"; "Search milestones…"; "All projects";
    - Milestones columns "Milestone", "Project", "Status", "Planned dates", "Hours logged", "Hours approved";
    - Projects columns "Project", "Status", "Planned / week" ("Left the team"), "Hours logged", "Hours approved";
    - the footer "Read-only history. Edit eligible hours in My timesheet." with a lock icon;
    - "Include archived", and the chips "Archived", "Project archived", "Project completed".
- **Phones, dark mode, accessibility** (§8, D14):
  - **375 px:** every new page and state has no horizontal page scroll.
  - **Below `md` (900 px):**
    - side panels are full-screen modal sheets;
    - My history's tables are stacked cards;
    - KPI strips use 2 columns;
    - the Week grid scrolls inside its own card with the Milestone column fixed.
  - **Colour:**
    - no hex colours in components; colours come from the palette, `STATUS`, `chartColors.js` and `monthText.js`'s `kindColor`;
    - status is never colour alone: every dot, chip and line has a word.
  - **Structure:**
    - one H1 per page and one H2 per card;
    - tabs use tab roles with `aria-controls`;
    - collapsible headers carry `aria-expanded` and `aria-controls`;
    - progress bars carry `aria-valuetext`;
    - touch targets are at least 44 px; motion respects `useCalmMotion`.
- **Dates:** every "today" on these screens comes from `nyTodayIso()`, and every "this week" from Task 2's `nyMondayIso()`. That covers overdue, due lines, the week picker, the Today column, This week, the Day view's opening day, the Month view's today, and `useLoggable`.
- **Tests:**
  - **Tests first:** run each new test before the code. Keep the failing output (the RED evidence) for the task's review.
  - Role and label queries only. Every request is answered by MSW.
  - **Privacy** is asserted by recording requests: `server.events.on('request:start', …)`, then `server.events.removeAllListeners()` in `afterEach`.
  - Freeze dates with `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(…)`, then `vi.useRealTimers()` in `afterEach`. The default instant is `2026-10-15T16:00:00Z` (Thursday Oct 15 in New York; the week of Oct 12).
  - Phones: `setViewport(375)`. Dark mode: `setPrefersDark(true)`. Both come from `src/test/setup.js`.
  - A retargeted test keeps its intent: each old assertion moves to where the thing now lives, or is replaced by the spec's behaviour.
- **Commands:** one suite at a time.
  - **Frontend:** `cd frontend && npx vitest run <paths> --testTimeout=20000`, then the full suite (`npx vitest run --testTimeout=20000`), then `npm run lint`.
  - **Backend:** `cd backend/v1 && OVERWATCH_TEST_DB=overwatch_test_p3 python -m pytest -o addopts="" -q <paths>`, then the same without paths.
  - **End to end:** `cd frontend && npx playwright test`, run alone, with ports 3000 and 3001 free (it starts its own servers).
- **Commits:**
  - Use the exact messages.
  - No attribution of any kind: no `Co-Authored-By`, no "Generated with".
  - Stage only your own files, by path. Never `git add -A` or `git add .`. `backend/health/` stays untracked.
- **Rulings that cross tasks:**
  - **Ruling: one hours format.** Hours read "19.75h" (`formatHours`) everywhere, including where §5.2 writes "19.75 h". Why: the app, the Month view and §5.1's own copy ("19.75h logged") use one format.
  - **Ruling: New York's today on all three screens,** the timesheet, the Month view and `useLoggable` included. Why: timers and work dates are New York dates (`ny_date` in `app/features/time/timers.py`), and §3.6 calls it the server's date. A viewer elsewhere at 11 pm must see the day a timer logs to.
  - **Ruling: one set of status words.**
    - The employee's Week and Day views use the Month view's words (`KIND` in `features/timesheet/monthText.js`): "Approved", "Pending", "Needs revision", plus "Overtime" for an `over_40` entry.
    - A panel's status chip uses `KIND[kind].panel` ("Pending approval"), as the Month panel does.
    - The server's `entry.label` is no longer shown on the employee's cells. The manager's Timesheets page keeps it until phase 4.
    - Why: §5.2 and the Month spec must agree, and "API values and alert texts don't change".
  - **Ruling: the Week grid stays its own table,** not `DataTable`. Why: it's an input grid, and §5.2 and §8 fix its phone form as a grid scrolling in its card with a fixed first column, not as stacked cards.
  - **Ruling: label in name.** A control whose visible text is shorter than its name starts its name with that text:
    - a status line reads "Needs revision, details for Schema Mapping, Wed Oct 14" (§5.2's "e.g." name, with its visible words first);
    - a row's chevron link has no visible text and is named "View milestone <name>".
    - Why: WCAG 2.5.3, the rule Task 10 applies to the demo pill.
  - **Ruling: no other backend change is needed.** These already exist:
    - `GET /time-entries?week=`: `rows`; `entries` with `status`, `over_40`, `edited_after_decision`, `rejection_reason`, `note`, `source`, `tracked_hours`; `totals.logged`, `totals.approved` and `totals.draft`; `drafts` and `locks`.
    - `PUT /time-entries` with `{week, entries}`. An unchanged re-save of a rejected cell resubmits it.
    - `POST /time-edit-requests`.
    - The profile: `milestones[]` with `display_status`, `waiting_on`, `progress_percent`, `priority`, `role`, `can_open`, `is_archived` and `project.{status, is_archived}`; `coming_up`; `user.manager`; `salary` only for the person and admins; `projects[].on_team`; `skills` and `can_edit_skills`; `this_week`; `all_time`.
    - `GET /milestones/{id}/discussion` answers `404` until a discussion exists.

## Review Focus

1. **Sunday evening in New York, after the UTC date has rolled to Monday.**
   - My week still shows Oct 12 – 18, 2026 with Next disabled. The hours card asks `?week=2026-10-12&sections=this_week`, because the server's default week is the UTC one.
   - `/timesheet` opens the week of Oct 12 with Sun Oct 18 marked "Today".
   - Pinned in Tasks 4 and 5.
2. **A typed `?week=` on My week that is in the future or malformed.** The page shows this week with Next disabled, and no request names the future week. Pinned in Task 4.
3. **Restoring unsaved typing after the week changed underneath it:** a milestone unassigned, a project put on hold, garbage in storage, or the previous week's data still on screen while the new week loads.
   - Only cells of rows still listed and open come back.
   - Nothing restores from placeholder data.
   - Garbage restores nothing, without a crash.
   - No `PUT` ever carries a cell the sheet doesn't list.
   - Pinned in Task 8.
4. **An `?entry=` naming a cell that isn't a saved entry of the shown week** (a stale link, another week, a typo). The panel stays closed and the parameter is removed with replace, with no crash and no empty panel. Pinned in Task 7.
5. **Save & resubmit while other cells hold unsaved typing.** Only that cell is sent. The others stay unsaved, still counted, still in "Submit N changes" and still in storage. Pinned in Task 7.

---

### Task 1: `GET /users/{id}/profile?sections=this_week`

**Files:**
- Modify: `backend/v1/app/features/users/profile.py`: `get_profile` (lines 103-115); add `SECTIONS`.
- Modify: `docs/project/API.md`: the profile row (line 132) and the paragraph after it.
- Test: `backend/v1/tests/integration/test_profile.py` (add tests; reuse its `assign`, `MONDAY` and `tests/helpers.py`).

**Interfaces:**
- **Produces:**
  - `SECTIONS = ("this_week",)`;
  - with `sections=this_week`, `GET /users/{id}/profile` returns exactly `{"user": {"id": <uuid>}, "this_week": {"week_start", "logged", "overtime", "planned"}}`.
- **Order of checks:** a bad id or someone you can't see is `404` first; then `week` (`as_date`); then a non-empty `sections`, through `as_enum(…, "sections", SECTIONS)`. An empty `sections=` means the full profile.

- [ ] **Step 1: Write the failing tests:**
  - `test_sections_this_week_returns_only_the_week`: an employee reads their own profile with `?week=<a Wednesday last week>&sections=this_week`.
    - The body's keys are exactly `{"user", "this_week"}`, and `user == {"id": <their id>}`.
    - `this_week.week_start` is that week's Monday, and `logged`, `overtime` and `planned` match a fixture of pending, approved and rejected entries (rejected not counted).
  - `test_sections_bad_value_is_400`:
    - `?sections=milestones` returns `400`, with `body["error"]["details"] == {"sections": "invalid_choice"}`;
    - `?sections=` returns `200` with `milestones` present.
  - `test_sections_this_week_keeps_the_profile_permissions`:
    - an employee asking for another employee's week gets `404`;
    - a manager asking for a direct report's week gets `200` with only the two keys;
    - an executive gets `200`.
- [ ] **Step 2:** Run `tests/integration/test_profile.py`. Expect the three new tests to fail.
- [ ] **Step 3: Implement.** After `_can_view` and the week, return early with `_this_week(conn, uid, start)`. No history, `milestones` or `coming_up` queries run.
- [ ] **Step 4: Update `API.md`:** `?week=&sections=`, the trimmed shape, the `400`, and "same permissions as the profile".
- [ ] **Step 5:** Run `test_profile.py` and `test_coming_up.py`, then the whole backend suite. Expect all to pass.
- [ ] **Step 6: Commit:** "Profile API: sections=this_week returns only the week's hours, for My week's week picker"

### Task 2: My week groundwork: collapsible sections, the grouping helpers, New York weeks

**Files:**
- Modify:
  - `frontend/src/features/dashboard/Section.jsx`: an optional, controlled collapsible mode;
  - `frontend/src/lib/format.js`: `nyMondayIso`.
- Create:
  - `frontend/src/features/home/sectionState.js`;
  - `frontend/src/features/home/myWork.js`.
- Test:
  - `frontend/src/features/dashboard/section.test.jsx` (new);
  - `frontend/src/features/home/sectionState.test.js` (new);
  - `frontend/src/features/home/myWork.test.js` (new);
  - `frontend/src/lib/format.test.js`.

**Interfaces (produces):**
- `Section({ question, hint, action, children, collapsible = false, open = true, onToggle, buttonLabel, id })`:
  - Without `collapsible`, it renders exactly as today (the dashboard is unchanged). `id` goes on the `section` element.
  - With `collapsible`, the H2 holds a button: a chevron (`aria-hidden`) and `question`. The button carries `aria-expanded={open}` and `aria-controls` (the body's id), is named `buttonLabel ?? question`, and calls `onToggle()`. It's at least 44 px tall.
  - The body is always in the DOM with that id. It's `hidden` and empty while collapsed. The heading, the hint and `action` stay.
- `SECTION_KEYS = ['nowNext', 'inProgress', 'upNext', 'review', 'coming', 'done', 'claim', 'week', 'manager']`.
- `useCollapsedSections() → { isOpen(key) → boolean, toggle(key) → void, open(key) → void }`:
  - backed by `localStorage['overwatch.myweek.sections']`, as JSON of the collapsed keys only, e.g. `{"done": true}`;
  - every read and write is in try/catch;
  - garbage or a blocked store means everything starts open, and toggling still works in memory.
- `nyMondayIso(now = new Date()) → 'YYYY-MM-DD'`: the Monday of `nyTodayIso(now)`'s week.
- In `myWork.js` (pure; `today` is an ISO date):
  - `groupMilestones(milestones, today) → { inProgress, upNext, review, done }`:
    - only items with `role != null` that aren't archived (`is_archived`, `project.is_archived`);
    - **In progress:** `status` `in_progress` or `blocked`. Order: overdue first, then `priorityRank`, then `end_date`.
    - **Up next:** `status` `not_started`. Order: ready (no `waiting_on` and `start_date <= today`), then future starts by `start_date`, then waiting by `start_date`; ties by name.
    - **With your manager:** `status` `ready_for_review`, by `end_date`.
    - **Completed:** `status` `completed`, newest `end_date` first.
  - `isOverdue(m, today) → boolean`: not completed and `end_date < today`.
  - `upNextLabel(m, today) → string`: "Waiting on <names joined by ', '>", else "Starts <formatDate(start)>" when it starts after today, else "Ready to start".
  - `nowAndNext(groups, comingUp, today) → { now, next, startNext, headsUp }`:
    - `now = inProgress[0] ?? null`; `next = upNext[0] ?? null`;
    - `startNext` is the first ready Up next item, only when `now` is null;
    - `headsUp = comingUp[0]` when it's overdue (`milestone.end_date < today`) or `critical`/`high`, else null.
  - `focusSummary(groups, today) → string`: "<N> overdue" (open milestones in the three open groups) and "<N> with your manager", joined by " · ". Zero parts are left out; both zero gives `''`.
  - `dueLine(m, today) → { text, overdue }`: "Due Oct 5, 2026 · 10 days overdue" ("1 day overdue" in the singular), or "Due Oct 20, 2026".
  - `skillsSentence(names) → string`: the three forms in Global Constraints.

**Rulings for this task:**
- **Ruling: groups use the stored `status`, and chips show `display_status`.** Why: `display_status` turns an in-progress milestone with an open predecessor into "waiting". The now-and-next table would then drop it from every group.
- **Ruling: every My week section collapses, the right column's two cards included.** Why: §5.1 states the rule for the left column, and the now-and-next spec ("whose rules all hold") names This week and Your manager too. Doing both satisfies both.
- **Ruling: `buttonLabel`.** A group's heading reads "Completed · 3", and its button is named "Completed, 3 milestones". Why: the now-and-next spec fixes the name, §5.1 the visible text, and the name keeps the visible words.

- [ ] **Step 1: Write the failing tests:**
  - **`section.test.jsx`:**
    - a collapsible Section's button has `aria-expanded="true"` and `aria-controls` pointing at its body, and clicking it calls `onToggle`;
    - with `open={false}` the children are gone, and the heading, hint and `buttonLabel` name stay;
    - a non-collapsible Section has no button (as on the dashboard).
  - **`sectionState.test.js`:**
    - keys start open; `toggle` closes and reopens; `open('coming')` opens a closed key;
    - the state survives a remount;
    - **garbage JSON** gives all open;
    - a `setItem` that throws still toggles in memory.
  - **`myWork.test.js`** (today `2026-10-15`), for a mixed fixture:
    - In progress has overdue first, then priority, then end date;
    - an `in_progress` milestone whose `display_status` is `waiting` stays in In progress;
    - Up next is ready, then future, then waiting; Completed is newest first;
    - role-less and archived items are left out;
    - each `upNextLabel` branch: "Waiting on Discovery, Schema Mapping", "Starts Oct 21, 2026", "Ready to start";
    - `nowAndNext` with and without in-progress work, and `startNext`;
    - `headsUp` for high, critical and an overdue low one, and none for medium;
    - `focusSummary`: "1 overdue · 1 with your manager", "1 overdue", and `''`;
    - `dueLine`: "Due Oct 5, 2026 · 10 days overdue", "Due Oct 14, 2026 · 1 day overdue", "Due Oct 20, 2026";
    - `skillsSentence` for 1, 2 and 3 names.
  - **`format.test.js`:**
    - `nyMondayIso(new Date('2026-10-19T02:00:00Z'))` is `'2026-10-12'` (Sunday evening in New York);
    - `nyMondayIso(new Date('2026-10-15T16:00:00Z'))` is `'2026-10-12'`.
- [ ] **Step 2:** Run the four files. Expect them to fail.
- [ ] **Step 3:** Implement the signatures above.
- [ ] **Step 4:** Run `src/features/home src/features/dashboard src/lib`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "My week groundwork: collapsible sections remembered per section, grouping and now-and-next helpers, New York weeks"

### Task 3: My week: Your focus, the groups and Available to claim

**Files:**
- Create:
  - `frontend/src/features/home/YourFocusCard.jsx`;
  - `frontend/src/features/home/MilestoneGroups.jsx`;
  - `frontend/src/features/home/Claimable.jsx` (moved out of `MyWeekPage.jsx` with today's `MilestoneItem` and `ClaimButton`).
- Modify: `frontend/src/features/home/MyWeekPage.jsx`.
  - The left column (`md` 8 of 12) holds Your focus, the groups and Available to claim.
  - `MyMilestones` and `byUrgency` go.
  - The right column keeps today's `ThisWeek` and `YourManagerCard` until Task 4.
- Test:
  - `frontend/src/features/home/myWeek.test.jsx` (new);
  - `frontend/src/features/home/home.test.jsx` (retarget the employee tests; the manager and admin tests stay).

**Interfaces:**
- **Consumes:**
  - Task 2's `Section`, `useCollapsedSections` and the `myWork.js` helpers;
  - `useLoggable`, `TimerButton`, `useMilestoneDiscussion(id, enabled)`;
  - `StatusChip` (`icon`), `PriorityChip`, `DifficultyChip`, `SupportingChip`, `EmptyState`;
  - `milestoneHref` and `shortDate` from `features/timesheet/monthText.js`;
  - `nyTodayIso`, `DIFFICULTY` and `PRIORITY`.
- **Produces:**
  - `YourFocusCard({ groups, comingUp, today, sections, onShowComing, onShowPrediction })`: a collapsible `Section` with key `nowNext`, the question "Your focus" and the hint `focusSummary(…)`.
  - `MilestoneGroups({ groups, comingUp, today, sections })`: the five group Sections, keys `inProgress`, `upNext`, `review`, `coming` and `done`. Empty groups render nothing. The coming group's section id is `myweek-coming`, and each of its rows is `myweek-coming-<milestone id>` with `tabIndex={-1}`.
  - `Claimable({ sections })`: key `claim`.
  - In `MyWeekPage`:
    - `showComing()` opens `coming`, calls `scrollIntoView?.({ block: 'start' })` on `#myweek-coming`, and focuses its header button;
    - `showPrediction(id)` does the same for the row.

**What each part shows:**
- **Now** is an inner card, overline "Now", with an error-coloured left edge when overdue. It holds:
  - the name (H3) and its project link;
  - `dueLine`, in the error colour when overdue;
  - a flag icon with "Critical priority" or "High priority" (nothing for medium or low);
  - "<Hard> difficulty", "<P>% done" when known, and `StatusChip icon` of `display_status`;
  - the buttons:
    - **View milestone** (outlined) to `milestoneHref(m)`;
    - **Discuss** (text, chat icon) to `milestoneHref(m) + '&panel=discussion'`, only once `useMilestoneDiscussion(now.id)` succeeds;
    - `TimerButton` when `useLoggable()` has the id.
- **Next** has the overline "Next": the name, project link, `upNextLabel` and the chevron link.
- **Fallbacks:**
  - "Nothing in progress", plus a "Start <name> next" link to `startNext`'s panel;
  - "Nothing else assigned yet", plus a "See what might come your way" button (calls `onShowComing`) when `coming_up` isn't empty.
- **Heads-up:** a third row, "Heads-up: <name> (<Priority> priority) may come your way", with a "New" chip. It's a link-styled button that calls `onShowPrediction`.
- **Group rows** (`ul`, with the name as H3, the project link, and a chevron link named "View milestone <name>" to `milestoneHref`, at least 44 px):
  - **In progress:** `dueLine`, "<P>% done", the state chip, `PriorityChip hideDefault`, `DifficultyChip`, `SupportingChip`, and `TimerButton` when loggable;
  - **Upcoming:** a calendar icon with "Due <date>", the state chip, and `upNextLabel`;
  - **With your manager:** "Submitted for review. Your manager completes the milestone.";
  - **Might come your way:** the intro line first; each row has `skillsSentence(skills)`, "Ready now" or "After <names>", `PriorityChip`, "New" when `is_new`, and a "Prediction" chip;
  - **Completed:** a green check icon (`aria-hidden`), the name, the project link, and a calendar icon with "Planned due <date>".
- **Available to claim:**
  - it shows "Available to claim · <N>" once loaded, with today's rows and Claim buttons;
  - empty: "No unassigned milestones available right now.";
  - a skeleton while loading.
- **Nothing at all:** with every group empty and `coming_up` empty, Your focus holds today's `EmptyState` instead of Now and Next.

**Rulings for this task:**
- **Ruling: Now follows the now-and-next rule** (in progress or kicked back). A ready-for-review milestone sits in "With your manager", never in Now. Why: §5.1 says the spec's rules all hold. The mockup's sample shows the card's look, not a new rule.
- **Ruling: "Now" and "Next" overlines name the card's two parts.** Why: the now-and-next spec names them, and the second part needs a label. The mockup's sample only fills the first.
- **Ruling: Discuss opens the project panel's Discussion tab.** Why: phase 2 put the thread in the panel ("Open discussion" does the same).
- **Ruling: Start timer is today's `TimerButton`** (visible "Start", named "Start timer on <name>"). Why: one timer control app-wide.
- **Ruling: the subtitle counts only overdue and with-your-manager,** as §5.1's example does, and is empty when both are zero. Why: those two need attention; every group shows its own count.

- [ ] **Step 1: Write the failing tests** in `myWeek.test.jsx`. Freeze at 2026-10-15T16:00Z. MSW answers `/users/u-emp/profile`, `/projects`, `/projects/p2/milestones`, `/time-entries` and `/milestones/:id/discussion`. The base fixture:
  - In progress: `m1` "Build" (Atlas Customer Portal, `p3`): critical, hard, ends 2026-10-05, 40% done;
  - Up next: "Hypercare" (ready, ends 2026-12-27), "Review" (starts 2026-10-21) and "Data load" (waiting on "Load testing");
  - With your manager: one; Completed: three;
  - `coming_up`: two predictions.

  The tests:
  - **Your focus:**
    - the Now card shows "Build" with an "Atlas Customer Portal" link;
    - it reads "Due Oct 5, 2026 · 10 days overdue", "Critical priority", "Hard difficulty", "40% done" and its state chip;
    - "View milestone" links to `/projects/p3?tab=milestones&milestone=m1`;
    - the subtitle reads "1 overdue · 1 with your manager".
  - **Discuss:** with a discussion answering `200`, "Discuss" links to `…&milestone=m1&panel=discussion`; with `404`, there's no "Discuss".
  - **Next:** "Hypercare" with "Ready to start".
  - **Fallbacks:**
    - with nothing in progress: "Nothing in progress" and a "Start Hypercare next" link;
    - with nothing up next and no predictions: "Nothing else assigned yet", and no "See what might come your way";
    - with nothing up next and two predictions: collapse "Might come your way", then click "See what might come your way". Its button reads `aria-expanded="true"` and has focus (stub `Element.prototype.scrollIntoView` and assert it was called).
  - **Heads-up:**
    - a high-priority prediction gives "Heads-up: Data cutover (High priority) may come your way" and "New";
    - a medium one gives none;
    - an overdue low one gives one.
  - **Groups:**
    - headings "In progress (1)", "Upcoming (3)", "With your manager (1)", "Might come your way (2)", "Completed · 3";
    - an empty group has no heading;
    - Upcoming rows, in order: "Hypercare" with "Due Dec 27, 2026" and "Ready to start"; "Review" with "Starts Oct 21, 2026"; "Data load" with "Waiting on Load testing";
    - Completed rows are newest first, with "Planned due Aug 14, 2026";
    - every chevron is a link named "View milestone <name>" to its panel URL.
  - **Might come your way:**
    - the intro line;
    - "Needs Data Engineering, which you have" and "Needs Backend Development and Data Engineering, which you have";
    - "Ready now", "After Discovery", "Prediction" and "New".
  - **Collapsing:**
    - every section starts with `aria-expanded="true"`;
    - clicking "Completed, 3 milestones" hides its rows and keeps "Completed · 3";
    - after unmounting and rendering again, it's still collapsed;
    - garbage in `overwatch.myweek.sections` starts everything expanded.
  - **Timer** (kept from `home.test.jsx`):
    - "Start timer on Design" shows where `/time-entries` lists the row open;
    - none on a row of an on-hold project, including the Now milestone (the now-and-next plan's Review Focus 5);
    - none on a completed milestone.
  - **Available to claim:**
    - "Available to claim · 1"; Claim posts `/milestones/m7/claim`;
    - a taken milestone isn't listed;
    - with none: "Available to claim · 0" and "No unassigned milestones available right now.".
  - **Empty:** with no milestones and no `coming_up`, the "Your focus" region holds "Nothing assigned to you right now".
  - **Retarget `home.test.jsx`:** its first employee test checks the H1, the Your focus region and the claim flow. The "My milestones" order test is replaced by the In progress order above. The two timer tests and the "nothing to claim" test move to `myWeek.test.jsx`.
- [ ] **Step 2:** Run both files. Expect them to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/home src/features/dashboard`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "My week: Your focus with now and next, grouped milestones with what might come your way, and Available to claim"

### Task 4: My week: the week picker, This week's hours, Your manager and the phone order

**Files:**
- Create:
  - `frontend/src/features/home/WeekPicker.jsx`;
  - `frontend/src/features/home/WeekHoursCard.jsx` (`WeekMeter` moves here from `MyWeekPage.jsx`).
- Modify:
  - `frontend/src/features/home/MyWeekPage.jsx`: header, `?week=`, both columns and the phone order;
  - `frontend/src/features/people/YourManagerCard.jsx`: `collapsible`, `open` and `onToggle`; an H2 title in the `Section` style; an outlined **Message <first name>**;
  - `frontend/src/api/queries.js`: `useProfileWeek`.
- Test:
  - `frontend/src/features/home/myWeekHours.test.jsx` (new);
  - `frontend/src/features/people/yourManager.test.jsx` (the My week case);
  - `frontend/src/features/home/home.test.jsx` ("32h of 40h" becomes "32h logged").

**Interfaces:**
- **Consumes:** Task 1's `sections=this_week`; Task 2's `nyMondayIso`, `Section` and `useCollapsedSections`; `formatWeekRange`, `mondayOfIso`, `addDays`, `shortDate`.
- **Produces:**
  - `useProfileWeek(userId, week, enabled = true)`: `GET /users/{userId}/profile?week=<week>&sections=this_week`, with the key `['profile', userId, 'week', week]` and `placeholderData: keepPreviousData`. Saves already invalidate `['profile']`, which covers it.
  - `WeekPicker({ week, current, onChange })`:
    - a `role="group"` named "Week shown in This week's hours";
    - "Previous week" (icon button);
    - a calendar icon with `formatWeekRange(week)`;
    - "Next week" (icon button), and the "This week" button; both are disabled when `week === current`.
  - `WeekHoursCard({ week, current, data, loading, error, onRetry, open, onToggle })`:
    - a collapsible `Section` with key `week`;
    - titled "This week's hours", or "Hours · week of <shortDate(week)>" (`formatDate` when the year differs from `current`'s);
    - holds `WeekMeter`, the two figures, **Open my timesheet** (contained, full width) to `/timesheet?week=<week>`, the caption, and the over-40 line.
  - `WeekMeter({ logged, planned, over, label })`:
    - the progressbar is named `label` ("Hours logged this week", or "Hours logged in the week of <Oct 5>") with today's `aria-valuetext`, and carries `data-over`;
    - the legend row becomes the scale: "0h" at the start, "<N>h planned" under the marker, and "40h" at the dashed line (`aria-hidden`);
    - the width transition is off under `useCalmMotion`.
  - `YourManagerCard({ manager, sx, collapsible = false, open = true, onToggle })`.

**Rulings for this task:**
- **Ruling: the shown week is `?week=`**, normalised to its Monday and dropped for the current week. A future or malformed value shows the current week. Changes replace the history entry, as the timesheet's week steps do. Why: reload and links keep the week; §5.1 offers no future week.
- **Ruling: where the hours come from.** The card uses the full profile's `this_week` only when its `week_start` equals the shown week. Otherwise it reads `useProfileWeek`. Why: the server's default week follows the UTC date and the page's follows New York's (Review Focus 1).
- **Ruling: the scale replaces the legend.** Why: §5.1 calls for "the bar, a '30h planned' marker and the 0h–40h scale", and the shipped meter drew a legend instead. The marker, the dashed 40h line and the progressbar stay.
- **Ruling: the phone order is a second arrangement, not CSS reordering.**
  - Below `md`, one column: Your focus, This week's hours, the groups, Available to claim, Your manager.
  - From `md`, two columns (8 and 4): Your focus, the groups and Available to claim on the left; the hours card and Your manager on the right.
  - Today's `TimerLimitBanner showUnsubmitted` stays above both arrangements.
  - Why: a CSS grid would tie the right cards' heights to the left rows. Reading order must follow the visual order (§5.1).

- [ ] **Step 1: Write the failing tests** (freeze at 2026-10-15T16:00Z unless a test says otherwise):
  - **Header:** the H1 "My week" and "Hello, Eli. Your work and hours in one place.".
  - **Picker:**
    - the group "Week shown in This week's hours" reads "Oct 12 – 18, 2026", and "Next week" and "This week" are disabled;
    - "Previous week":
      - sets `?week=2026-10-05` (location probe);
      - requests `/users/u-emp/profile` with `week=2026-10-05&sections=this_week`;
      - titles the card "Hours · week of Oct 5" and shows that response's figures;
      - points "Open my timesheet" to `/timesheet?week=2026-10-05`;
    - "This week" drops `week` and titles the card "This week's hours", with no `sections` request.
  - **Review Focus 1:** frozen at 2026-10-19T02:00Z, with the profile's `this_week.week_start` `'2026-10-19'`:
    - the picker reads "Oct 12 – 18, 2026" with Next disabled;
    - the card requests `week=2026-10-12&sections=this_week`.
  - **Review Focus 2:** `/?week=2026-11-02` and `/?week=garbage` both read "Oct 12 – 18, 2026" with Next disabled. No request names `2026-11-02`.
  - **Hours card:**
    - "19.75h logged", "/ 40h weekly reference" and "Pending + approved";
    - the progressbar "Hours logged this week" has `aria-valuetext` "19.75h of 40h, 30h planned";
    - "0h", "30h planned" and "40h"; "30h" Planned and "19.75h" Logged;
    - the caption;
    - at 45h logged: "5h over 40h (sent to your manager as overtime)" and `data-over="true"`;
    - a `sections` error shows `ErrorAlert` with Retry inside the card.
  - **Your manager:** a region "Your manager" with "Morgan Manager", "Delivery Manager · Technology", and "Message Morgan" linking to `/messages?to=u-mgr`. It collapses with key `manager`.
  - **Phones** (`setViewport(375)`): the H2s in order are "Your focus", "This week's hours", the group headings, "Available to claim · 0", then "Your manager".
  - **Privacy:** recording every request through load and "Previous week":
    - every `/users/<id>` path has `id === 'u-emp'`;
    - no path starts with `/approvals` or `/allocations`;
    - no `/time-entries` request has `user`.
  - **States:** one skeleton per card while the profile loads; a profile error shows `ErrorAlert` with Retry.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/home src/features/people src/api`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "My week: the week picker in the header, This week's hours for any past week, Your manager, and the phone order"

### Task 5: My timesheet: header, totals card, week bar and New York's today

**Files:**
- Modify:
  - `frontend/src/features/timesheet/TimesheetPage.jsx`: the subtitle, the totals card, the week card's bar (range, This week, the toggle, Weekend), the rejected footnote, and New York's today and week;
  - `frontend/src/features/timesheet/DayView.jsx`: New York's today; the day heading becomes an H3, and its paper is a `section` labelled by it;
  - `frontend/src/features/timesheet/MonthView.jsx`: `today` from `nyTodayIso()`;
  - `frontend/src/features/timer/useLoggable.js`: `nyMondayIso()`.
- Create:
  - `frontend/src/features/timesheet/weekFigures.js`;
  - `frontend/src/features/timesheet/WeekTotals.jsx`.
- Test:
  - `frontend/src/features/timesheet/weekFigures.test.js` (new);
  - `frontend/src/features/timesheet/timesheet.test.jsx`, `dayView.test.jsx`, `timesheetRules.test.jsx` and `frontend/src/features/timer/timerWorkflow.test.jsx` ("8h / 40h" becomes "8h counted of 40h");
  - `frontend/src/features/timesheet/monthPage.test.jsx` (New York's today in Month).

**Interfaces:**
- **Consumes:** `useTimesheetWeek` (`entries`, `changed`, `isDraft`, `total`), `KIND` and `kindColor`, `formatWeekRange`, `nyTodayIso`, `nyMondayIso`, `FootNote`.
- **Produces:**
  - `weekFigures({ entries, changed, isDraft, total }) → { counted, approved, pending, needsRevision, entered }`:
    - `counted = total`, today's live total;
    - `approved` is the hours of saved approved entries whose cell isn't in `changed`;
    - `needsRevision` is the hours of saved rejected entries whose cell holds no typed hours (`!isDraft(k)`);
    - `pending = counted − approved`;
    - `entered = counted + needsRevision`.
  - `WeekTotals({ figures, cap = 40 })`: one outlined card, `role="group"`, named "Week totals":
    - the `data-testid="week-total"` element reads "<counted> counted of 40h" and keeps `data-over`;
    - a bar named "Counted hours against 40h", with `aria-valuetext` "<counted> of 40h", capped at 100%;
    - "<round(counted ÷ 40 × 100)>%";
    - three figures, each a dot (`aria-hidden`, `kindColor`), the hours and the word;
    - the ⓘ note.
    - It stacks on phones.

**Rulings for this task:**
- **Ruling: the totals follow the screen.** With nothing typed, the figures equal the server's `totals.logged`, `totals.approved` and the rejected entries' hours. Typed hours count as Pending until submitted. Why: the big number has always been the live total, today's over-40 warning reads it, and a card that ignored typing would disagree with that warning.
- **Ruling: Month keeps its own header.** In Month, the page header keeps the shipped subtitle and the toggle, with "<N>h logged in <Month>"; there's no totals card or week bar. Why: the calendar spec's totals are monthly, and a week's figures above a month would disagree.
- **Ruling: the week card's frame.** One outlined card holds the bar and the view: the H2 is the week range, then the strip and Day view, or the grid. `DayView` keeps its own paper inside it. Why: one H2 per card; the Day view has no mockup ("as shipped").

- [ ] **Step 1: Write the failing tests:**
  - **`weekFigures.test.js`:**
    - the mockup's week (Mon 0.25, Tue 7.75 and Fri 7.75 approved; Thu 4 pending; Wed 8 rejected) gives 19.75, 15.75, 4, 8 and 27.75;
    - typing 2h on an empty cell gives counted 21.75 and pending 6;
    - re-typing the rejected 8 moves it from needs revision to pending;
    - editing Tue (approved) moves 7.75 from approved to pending.
  - **Page** (`?week=2026-10-12`, frozen at 2026-10-15T16:00Z):
    - **Header:**
      - "My timesheet" and "Review your week. Submit with confidence.";
      - "Submit" is disabled with nothing changed;
      - no text matches `/saved/i` before any save.
    - **Totals:** within "Week totals":
      - "19.75h counted of 40h", "49%", "15.75h" Approved, "4h" Pending, "8h" Needs revision, and the ⓘ note;
      - typing 2 in an empty cell gives "21.75h counted of 40h" and "6h" Pending;
      - past 40h, `data-over="true"` and today's warning alert.
    - **Footnote:** "27.75h entered · 8h excluded until resubmitted." shows only when the week holds rejected hours.
    - **Week bar:**
      - the H2 "Oct 12 – 18, 2026";
      - "Previous week" and "Next week" set `?week=`; "This week" opens the current week;
      - the "Timesheet view" toggle holds Day, Week and Month.
    - **New York:** frozen at 2026-10-19T02:00Z with no `week`:
      - the request is `week=2026-10-12`, and the Day view opens on the region "Sunday 18 October 2026";
      - `useLoggable`'s request is the same week;
      - in Month, today's box is Oct 18.
    - **Privacy:** loading the week and switching to Month makes no request with `user`, and none to `/approvals`.
  - **Retarget** the week-total texts in the four files. The `data-over` assertions are unchanged.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/timesheet src/features/timer src/lib`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "My timesheet: header, week totals with approved, pending and needs revision, the week bar, and New York's today"

### Task 6: The Week grid: columns, status words, legend and phones

**Files:**
- Create: `frontend/src/features/timesheet/EntryStatus.jsx`, with:
  - `entryKind`;
  - `StatusWords`;
  - `EntryStatusChip` (moved from `MonthDayPanel.jsx`'s local `StatusChip`);
  - `CellStatus` (moved from `WeekGrid.jsx`).
- Modify:
  - `frontend/src/features/timesheet/WeekGrid.jsx`: the header cells, the project row, the Counted column, "Daily total (counted)", the legend, the sticky first column, and no outline of its own (the week card frames it);
  - `frontend/src/features/timesheet/useTimesheetWeek.js`: `rowTotal(milestoneId)`;
  - `frontend/src/features/timesheet/DayView.jsx` and `MonthDayPanel.jsx`: the imports.
- Test: `frontend/src/features/timesheet/timesheet.test.jsx` and `dayView.test.jsx`.

**Interfaces:**
- **Consumes:** `KIND` and `kindColor` (`monthText.js`); Task 5's week card.
- **Produces:**
  - `entryKind(entry) → 'approved' | 'pending' | 'rejected'`;
  - `StatusWords({ entry })`: a dot (`aria-hidden`) and `KIND[kind].legend`, plus a separate "Overtime" element when `over_40`;
  - `EntryStatusChip({ kind })`: the Month panel's chip, unchanged;
  - `CellStatus({ entry, cellLabel, onResubmit, resubmitting, closed, inlineReason })`: today's props, with `StatusWords` in place of `entry.label`. The "Edited" chip, `SourceChip`, the reason and Resubmit stay until Task 7;
  - `rowTotal(milestoneId) → number`: the row's counted hours, by the same rule as `dayTotal` (rejected left out unless re-typed).
- **The grid:**
  - each day's header reads the weekday over the date, with `data-weekend` and `data-today`;
  - today's column (this week only) has a tinted background and a "Today" caption;
  - weekend columns are dimmed;
  - a project row has a folder icon (`aria-hidden`) and the name;
  - the "Counted" column uses `rowTotal`; the last row is "Daily total (counted)";
  - cells with timer hours keep `LockedCell`, and closed rows stay greyed out, as today;
  - the first column is `position: sticky; left: 0` with the paper background;
  - under the card, a list named "Legend": Approved, Pending, Needs revision;
  - today's Weekend switch stays on phones.

**Ruling: Counted excludes rejected hours per row.** Why: §5.2 names the column "Counted", while today's row total also summed rejected hours.

- [ ] **Step 1: Write the failing tests** (frozen at 2026-10-15T16:00Z, Week view):
  - **Headers:**
    - the column headers read "Milestone", then Monday to Sunday, then "Counted". Match the day headers by pattern, e.g. `/Mon\s*Oct 12/` and `/Thu\s*Oct 15\s*Today/`;
    - Thursday has `data-today="true"`; Saturday and Sunday have `data-weekend="true"`;
    - a past week has no `data-today`.
  - **Project row:** a row reads "Apollo".
  - **Status words:**
    - an approved cell reads "Approved", an `over_40` pending cell reads "Pending" and "Overtime", and a rejected cell reads "Needs revision";
    - the grid holds no "Pending approval", "Rejected" or "Overtime requested from" text.
  - **Counted:** a row with 8h approved and 8h rejected reads "8h"; "Daily total (counted)" is a row header.
  - **Legend:** a list "Legend" with the three words.
  - **Phones** (`setViewport(375)`): the grid is still a `table`, and the Weekend switch shows.
  - **Day view (`dayView.test.jsx`):**
    - a rejected entry reads "Needs revision" and keeps "Reason: Wrong milestone" and "Resubmit Schema Mapping, Wed Oct 14";
    - an `over_40` entry reads "Pending" and "Overtime";
    - "Edited" and the source chip stay.
  - **Kept:** the week grid's "Edited", source, rejection tooltip and Resubmit tests keep passing on `CellStatus`.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/timesheet`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Week grid: weekday and date columns with Today, Counted, status words with Overtime, the legend, and a fixed first column on phones"

### Task 7: Entry details panel

**Files:**
- Create:
  - `frontend/src/features/timesheet/EntryPanel.jsx`;
  - `frontend/src/features/timesheet/useEntryPanelUrl.js`.
- Modify:
  - `frontend/src/features/timesheet/TimesheetPage.jsx`: `SidePanel` around the week card (Day and Week views), `?entry=`, and `chooseView` dropping `entry`;
  - `frontend/src/features/timesheet/EntryStatus.jsx`: `StatusLine`;
  - `frontend/src/features/timesheet/WeekGrid.jsx`: a saved cell shows its `StatusLine`. The "Edited" chip, the source chip, the reason tooltip and Resubmit leave the grid (they're in the panel). The note button stays;
  - `frontend/src/features/timesheet/DayView.jsx`: a **Details** button on each row with a saved entry that day;
  - `frontend/src/features/timesheet/useTimesheetWeek.js`: `saveCell`;
  - `frontend/src/lib/format.js`: `formatDayLong`.
- Test:
  - `frontend/src/features/timesheet/entryPanel.test.jsx` (new);
  - `frontend/src/features/timesheet/timesheet.test.jsx`: "cells show backend labels, Edited tag and rejection reason", "a rejected cell can be resubmitted with the same hours" and "cells say where their hours came from" move to the panel;
  - `frontend/src/lib/format.test.js`.

**Interfaces:**
- **Consumes:** `SidePanel`, `HoursField`, `LockedCell`'s `LOCK_HINT`, `RequestChangeDialog` (TimesheetPage's `asking`), `EntryStatusChip`, `sourceOf`, `NOTE_MIN`, `NOTE_MAX`, `isProofNote`, `closedLabel`, `ErrorAlert`.
- **Produces:**
  - `formatDayLong(iso) → 'Wed, Oct 14, 2026'`.
  - `StatusLine({ entry, cellLabel, entryParam, onOpen })`:
    - a text button holding `StatusWords`, named "<words>, details for <cellLabel>", e.g. "Pending, Overtime, details for Schema Mapping, Thu Oct 15";
    - it carries `data-entry={entryParam}`, is at least 44 px in its tap area, and calls `onOpen()`.
  - `useEntryPanelUrl({ ready, has }) → { entryKey, open(milestoneId, date), close(), returnFocus() }`:
    - **The param:** `?entry=<milestoneId>:<date>`, and `entryKey` is the hook's `<milestoneId>|<date>`.
    - **History rules,** as `useMilestonePanelUrl`'s:
      - opening from a closed panel pushes an entry marked `state.panelPushed`;
      - opening while one is open replaces;
      - `close()` goes back when marked, and otherwise removes `entry` with replace.
    - **Bad values:** once `ready` (the week's own data is in, not placeholder data), a key that `has` refuses is removed with replace, silently.
    - `returnFocus()` finds `[data-entry="<param>"]` or the Day view's Details button for it, else the week range heading (`tabIndex={-1}`).
  - `saveCell(k) → Promise<void>`:
    - it sends `PUT /time-entries` with `{ week, entries: [{ milestone_id, work_date, hours: num(valueOf(k)), note? }] }`, where `note` follows `onSave`'s rule;
    - on success, it clears only `k` from the typed hours and notes;
    - it rejects with the API error and leaves `failure` alone;
    - `savingCell` is exposed.
  - `EntryPanel({ state, cellKey, onRequest, onClose })`, rendered inside `SidePanel title="Entry details"`. In order, it holds:
    - the date (`formatDayLong`);
    - the milestone name (H3) with `EntryStatusChip`, plus "Edited" when `edited_after_decision` and "Overtime" when `over_40`;
    - the closed reason, when closed;
    - **Hours:** `HoursField` with the caption "Hours". A locked cell shows its hours with a lock and **Request a change**, which calls `onRequest(cell)`, or "Change requested: <N>h" while one waits;
    - **Work note:** multiline, with the helper "<10-500 characters> · <n>/500" and the error "At least 10 characters";
    - **Manager feedback,** error-tinted with the reason, only when rejected;
    - **Source:** `sourceOf`'s word, with "<N>h from a timer" when `tracked_hours > 0`;
    - the warning "Changing approved hours sends them back for approval." while an approved cell is in `changed`;
    - `ErrorAlert` for a failed save;
    - the button: **Save & resubmit** (contained, full width; disabled while saving or invalid) for a rejected entry on an open row, otherwise **Done**.

**Rulings for this task:**
- **Ruling: the panel edits the week directly.** Its fields write the same typed hours and notes as the grid, so the cell updates as you type. Done, Close and Esc keep the edits as unsaved changes. Why: one source of truth, and nothing typed is lost; Submit sends it.
- **Ruling: the panel opens only on saved entries** of listed rows in the shown week. A typed, unsaved cell has no status line and keeps the note button. Why: §5.2 opens it "from a saved cell's status line".
- **Ruling: closed rows are read-only.** On an on-hold or completed project, the fields are disabled, the closed reason shows, and only Done is offered. Why: the server refuses changes there (`409 PROJECT_NOT_OPEN`).
- **Ruling: a locked rejected cell resubmits its lock's hours.** Why: the server accepts timer hours unchanged and refuses anything else.
- **Ruling: Save & resubmit closes the panel on success.** The save's toast is today's "Hours saved and sent for approval". Why: one toast for one save, as Submit gives.

- [ ] **Step 1: Write the failing tests** in `entryPanel.test.jsx`. Freeze at 2026-10-15T16:00Z and use `?week=2026-10-12` with the Week view stored. The fixture is the mockup's week:
  - Mon 0.25, Tue 7.75 and Fri 7.75 approved;
  - Wed 8, rejected, with the reason "Please add a clearer breakdown of the work completed.";
  - Thu 4 pending, locked by a timer (`tracked_hours` 4).

  The tests:
  - **Open:**
    - clicking "Needs revision, details for Schema Mapping, Wed Oct 14" sets `entry=m1:2026-10-14`;
    - the region "Entry details" shows "Wed, Oct 14, 2026", the H3 "Schema Mapping", the chip "Needs revision", Hours "8", the Work note, "Manager feedback" with the reason, and Source "Manual".
  - **Feedback** shows only on the rejected entry (Tue's panel has none).
  - **Save & resubmit:**
    - type 9 on Tue first, then open Wed and click "Save & resubmit";
    - exactly one `PUT` goes out, with the body `{week: '2026-10-12', entries: [{milestone_id: 'm1', work_date: '2026-10-14', hours: 8}]}`;
    - the panel closes; "Submit 1 change" stays, and Tue still reads 9 (**Review Focus 5**).
  - **Done:**
    - on Tue (approved), changing Hours to 9 shows "Changing approved hours sends them back for approval.";
    - Done closes the panel with no `PUT`; the grid's Tue reads 9, and "Submit 1 change" shows.
  - **Locked:** Thu's panel shows the hours read-only with "Request a change", which opens the dialog "Request a change". Its Source reads "Tracked" with "4h from a timer".
  - **Day view:** "Details for Schema Mapping, Wed Oct 14" opens the same panel.
  - **URL and focus:**
    - the deep link `&entry=m1:2026-10-14` opens on load;
    - Esc closes it, and focus returns to its status line;
    - after an open from the grid, Back closes it.
  - **Review Focus 4:**
    - `&entry=m1:2026-10-21`, `&entry=zzz` and an empty cell's key each open no panel;
    - `entry` leaves the URL (location probe), with no console error.
  - **Closed:** a rejected entry on an on-hold row has disabled fields and Done, and no "Save & resubmit".
  - **Phones** (`setViewport(375)`): the panel is a `dialog` with `aria-modal="true"`.
  - **Retargeted:** "Edited" and "Overtime" chips in the panel; Source "Mixed" for a mixed entry; the reason in "Manager feedback".
  - **`format.test.js`:** `formatDayLong('2026-10-14')` is `'Wed, Oct 14, 2026'`.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement. From `md` up, the week card is `SidePanel`'s `list`; the totals card stays full width above it.
- [ ] **Step 4:** Run `src/features/timesheet src/lib`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Entry details: a side panel from the status line or Details, Save & resubmit for one cell, Done keeps the edits"

### Task 8: Unsaved typing kept in this tab

**Files:**
- Create: `frontend/src/features/timesheet/unsavedStore.js`.
- Modify:
  - `frontend/src/features/timesheet/useTimesheetWeek.js`: `useTimesheetWeek(week, { userId })`, restore, mirror, `restored`, `dismissRestored`, and `discard` clearing the store;
  - `frontend/src/features/timesheet/TimesheetPage.jsx`: pass `user.id`, and show the notice;
  - `frontend/src/auth/SessionProvider.jsx`: `logout` calls `clearAllUnsaved()`;
  - `frontend/src/test/setup.js`: clear `sessionStorage` after each test, as it clears `localStorage`.
- Test:
  - `frontend/src/features/timesheet/unsavedStore.test.js` (new);
  - `frontend/src/features/timesheet/unsaved.test.jsx` (new);
  - `frontend/src/auth/sessionProvider.test.jsx` (new).

**Interfaces:**
- **Produces** (in `unsavedStore.js`; every access is in try/catch):
  - `UNSAVED_PREFIX = 'overwatch.timesheet.unsaved.'`;
  - `unsavedKey(userId, week) → 'overwatch.timesheet.unsaved.<userId>.<week>'`;
  - `readUnsaved(userId, week) → { drafts, notes } | null`. It keeps only keys shaped `<id>|YYYY-MM-DD` with a date in that week, hours matching `/^\d{0,2}(\.\d{0,2})?$/`, and notes of at most `NOTE_MAX` characters. Anything unreadable gives `null`;
  - `writeUnsaved(userId, week, { drafts, notes })`, which removes the key when both are empty;
  - `clearAllUnsaved()`, which removes every key under the prefix and nothing else.
- **The hook:**
  - **Restore** runs once per week: when the sheet holds that week's own data (`!sheet.isPlaceholderData`) and nothing is typed in it yet. It keeps cells whose row is listed and open (`closedLabel` null).
  - **The mirror:** it writes this week's typed hours and notes after every change, but only once that week's restore check has run.
  - `restored` is true when a restore brought back at least one cell that `changed` lists. `dismissRestored()` hides the notice.
  - `discard()` also calls `writeUnsaved(userId, week, {})`.
- **The page:** an info alert, "Unsaved changes restored. Submit to send them.", with a Close button. It shows while `restored` and `changed.length > 0`.

**Rulings for this task:**
- **Ruling: only a sign-out clears the store,** a demo's end included. A lapsed session doesn't, so the same person signing back in this tab gets their typing back. Why: §5.2 names Submit and sign-out. The key carries the user id, so nobody else can read it.
- **Ruling: restored values are taken as they are.** `changed` already ignores a value equal to the saved one, and a re-typed rejected cell must survive as a resubmission. Why: no second rule for what counts as a change.

- [ ] **Step 1: Write the failing tests:**
  - **`unsavedStore.test.js`:**
    - a round trip;
    - garbage JSON gives `null`;
    - a key for another week, a malformed key, "1e1" hours and a 501-character note are dropped;
    - `setItem` throwing doesn't throw;
    - `clearAllUnsaved` leaves an unrelated `acme-scout:demo-welcomed:x` key alone.
  - **`unsaved.test.jsx`:**
    - typing 9 on Tue with a note stores `{"drafts": {"m1|2026-10-13": "9"}, "notes": {…}}` under `overwatch.timesheet.unsaved.u-emp.2026-10-12`;
    - after unmounting and rendering again, Tue reads 9, the notice shows, and "Submit 1 change" is enabled;
    - no `PUT` is recorded until Submit;
    - Submit removes the key and the notice;
    - discarding on a week change removes that week's key.
  - **Review Focus 3:**
    - stored cells for `m9` (not a row) and for an on-hold row aren't restored, and Submit sends only the valid cell;
    - garbage in the key restores nothing and the page renders;
    - stepping from the week of Oct 5 back to Oct 12 restores Oct 12's cells only once Oct 12's own data is in;
    - with `sessionStorage.setItem` throwing, typing and Submit still work.
  - **`sessionProvider.test.jsx`:** `/auth/refresh` answers `401` and `/auth/logout` answers `204`. With two `overwatch.timesheet.unsaved.*` keys set, calling `logout()` from a consumer removes both.
- [ ] **Step 2:** Run the three files. Expect them to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/timesheet src/auth src/features/timer`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "My timesheet: unsaved typing kept in this tab and restored after a reload, cleared on Submit and sign-out"

### Task 9: My history

**Files:**
- Modify:
  - `frontend/src/features/people/PersonProfilePage.jsx` (rewrite);
  - `frontend/src/features/people/SkillsCard.jsx`: `embedded`;
  - `frontend/src/features/people/YourManagerCard.jsx`: `embedded` and `title`;
  - `frontend/src/components/KpiStrip.jsx`: `title`;
  - `frontend/src/components/FootNote.jsx`: `icon`.
- Create:
  - `frontend/src/features/people/ProfileCard.jsx`;
  - `frontend/src/features/people/HistoryTabs.jsx`.
- Test:
  - `frontend/src/features/people/profile.test.jsx` (retarget);
  - `frontend/src/features/people/yourManager.test.jsx` (the own-profile case);
  - `frontend/src/components/sharedParts.test.jsx` (`KpiStrip` `title`, `FootNote` `icon`).

**Interfaces:**
- **Consumes:** `useProfile`, `useBreadcrumb`, `useRedirectOnDenied`, `KpiStrip`, `DataTable` (`rowHeader`), `FilterBar`, `FootNote`, `StatusChip`, `SupportingChip`, `UserAvatar`, `MessageButton`, `ROLE_LABEL`, `formatDateRange`, `formatMoney`, `can`.
- **Produces:**
  - `KpiStrip({ …today's props, title })`: with `title`, an H2 sits inside the card above the figures, and the group is labelled by it (`aria-labelledby`) instead of `ariaLabel`.
  - `FootNote({ note, end, icon })`: `icon` (`aria-hidden`) replaces "ⓘ".
  - `SkillsCard({ person, skills, canEdit, embedded = false })`: `embedded` drops the outline, and its title is an H3 in a `section` named "Skills".
  - `YourManagerCard({ …, embedded = false, title = 'Your manager' })`: `embedded` drops the outline, the title is an H3, and Message is outlined and full width.
  - `ProfileCard({ person, skills, canEditSkills, own })`:
    - a 64 px avatar, the name (H2), the job title, and "<Role> · <Department>";
    - `SkillsCard embedded`;
    - `YourManagerCard embedded`, titled "Your manager" when `own`, else "Reports to";
    - **Employment details,** only when `'salary' in person`: a button with a lock icon, `aria-expanded` and `aria-controls`, collapsed on every visit, and the line "Annual salary and other employment details". Opened, it shows "Annual salary" and `formatMoney(salary)`.
  - `HistoryTabs({ projects, milestones, canSeeArchived, own })`:
    - MUI tabs "Projects <N>" and "Milestones <N>", with tab roles and `aria-controls`;
    - `?tab=projects` selects Projects; otherwise Milestones (written with replace);
    - **Milestones:**
      - a `FilterBar` with the search "Search milestones" (placeholder "Search milestones…"), a select named "Project" whose first option is "All projects", and "Include archived" when `canSeeArchived`;
      - a `DataTable` with columns Milestone (`rowHeader`: the name, plus `SupportingChip`, or "No longer assigned" when `role` is null, plus "Archived"), Project (a link to `?tab=milestones` when `can_open`, plus "Project archived" or "Project completed"), Status (`StatusChip icon` of `display_status`), Planned dates (`formatDateRange`), Hours logged and Hours approved;
      - the default sort is Planned dates, newest first;
    - **Projects:** a `DataTable` with columns Project (`rowHeader`: the link when `can_open`, plus "Archived"), Status, Planned / week ("Left the team" when `on_team` is false), Hours logged and Hours approved. It keeps the server's order until a header is clicked.
    - With "Include archived" off, the archived rows (a milestone or its project archived, or an archived project) are hidden. The tab counts count the rows shown.
- **The page:**
  - **Header:**
    - "My history" with its subtitle when `own && can(viewer, 'history.own')`;
    - otherwise today's header (the name, the job title or role, "· Archived", and Message for someone else);
    - **Open my timesheet** (outlined, calendar icon, to `/timesheet`) when `own && can(viewer, 'timesheet.use')`.
  - **Left (`md` 4):** `ProfileCard`.
  - **Right (`md` 8):**
    - `KpiStrip title="Week of <Oct 12, 2026>"` with Logged, Planned and Overtime this week (the warning tone above 0);
    - `KpiStrip title="All time summary"`;
    - `HistoryTabs`;
    - on `own` only, `FootNote` with a lock icon and "Read-only history. Edit eligible hours in My timesheet.".
  - **Phones:** the profile card first; the tables are cards.

**Rulings for this task:**
- **Ruling: "My history" titles only an employee's own page.** It matches the crumb (`history.own`). Anyone else's page, a manager's own included, keeps today's header above the new body. Why: §5.3's copy is first person, and the crumb already draws that line.
- **Ruling: "Reports to" on someone else's page.** Why: "Your manager" is wrong there, and "Reports to" is today's word.
- **Ruling: Employment details shows only when the profile carries `salary`.** Why: the salary is all it holds today, and an empty expander would claim details that aren't there. The server already sends `salary` only to the person and admins.
- **Ruling: the Role column folds into the name cell** ("Supporting", "No longer assigned"). Why: §5.3 lists six columns, and no information is lost.
- **Ruling: "Include archived" shows when the data holds archived rows and the viewer isn't an employee.** Why: the server already leaves archived work out for employees; the role check keeps D8 even against a stale payload. It stays off by default (§5.3).
- **Ruling: "Project completed" stays for every viewer.** Why: it isn't archived work, so D8 doesn't touch it.
- **Ruling: the footer shows on your own page only.** Why: it points to your own timesheet.

- [ ] **Step 1: Write the failing tests:**
  - **Employee, own page:**
    - the H1 "My history", the subtitle, and "Open my timesheet" to `/timesheet`;
    - the card shows the H2 "Eli Employee", "Software Engineer" and "Employee · Technology", Skills, "Your manager" and "Message Morgan";
    - "Employment details" has `aria-expanded="false"` and shows "Annual salary and other employment details", with no "$95,000" in the document;
    - after a click, "Annual salary" and "$95,000" show.
  - **Figures:**
    - the group "Week of Oct 12, 2026" holds "Logged this week" "19.75h" "Pending and approved", "Planned this week" "30h", and "Overtime this week" "0h" "Above 40h";
    - "All time summary" holds "174.25h" and "169.25h", each "All time".
  - **Tabs:**
    - "Milestones 7" is selected, with `aria-controls`;
    - clicking "Projects 2" sets `?tab=projects`; a `?tab=projects` deep link selects it.
  - **Milestones:**
    - the six column headers;
    - "Schema" in the search leaves one row;
    - Project "Atlas Customer Portal" leaves its rows;
    - a `can_open` project is a link, and another is plain text;
    - "Supporting" and "No longer assigned" show.
  - **Projects:** "Left the team" in Planned / week, and the five column headers.
  - **Footer:** the lock and "Read-only history. Edit eligible hours in My timesheet.".
  - **D8 and privacy:**
    - there's no "Include archived" and no "Archived" chip for the employee;
    - recording requests, every `/users/<id>` request is for `u-emp`.
  - **Admin viewing Eli** (archived rows in the payload):
    - "Include archived" is unchecked and the archived rows are hidden; checking it shows them with "Archived" and "Project archived";
    - the tab counts change;
    - the H1 is "Eli Employee", the block reads "Reports to", there's no footer, and Employment details is present.
  - **Manager viewing Eli** (no `salary`): no Employment details at all.
  - **Manager's own page** with archived rows: "Include archived" is present, and the H1 is the name.
  - **Phones** (`setViewport(375)`): the H2 "Eli Employee" comes before "Week of Oct 12, 2026", and the history has no `table`.
  - **Kept:** the photo now sits in the profile card's avatar; the department reads "Employee · Technology"; "Edit skills" shows for `can_edit_skills`.
  - **`sharedParts.test.jsx`:** a titled `KpiStrip` is a group named by its H2; `FootNote icon` replaces "ⓘ".
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/people src/components`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "My history: profile card, week and all-time figures, Projects and Milestones tabs, archived only for those who see it"

### Task 10: Two accessibility fixes from phase 1's review

**Files:**
- Modify:
  - `frontend/src/features/puppy/Puppy.jsx`: the dock call also passes `expanded: Boolean(anchor)`;
  - `frontend/src/app/Layout.jsx`: the header avatar's `aria-expanded`;
  - `frontend/src/app/DemoSession.jsx`: the full pill's name (line 56);
  - `docs/project/LOGIC_WALKTHROUGH.md` (around line 883): the name.
- Test: `frontend/src/app/Layout.test.jsx` and `frontend/src/app/publicDemo.test.jsx`.

**Interfaces:**
- **Consumes:** `PuppyDock`'s setter, which now receives `{ icon, open(anchorEl), expanded }`.
- **The avatar:** `aria-expanded={openedFrom === 'header' || Boolean(narrow && dockedPuppy?.expanded)}`. `aria-haspopup` stays "menu".
- **The full pill's name:** "Demo session · <m:ss>, signed out in <spoken>". The name still holds still while the pill has focus.

**Rulings for this task:**
- **Ruling: below 375 px the avatar reports Puppy's panel as expanded while it's docked there.** Why: the panel is anchored to the avatar, and the menu item that opened it has closed. The avatar is what a screen reader returns to.
- **Ruling: the full pill's name starts with its visible text,** "Demo session · 4:29, signed out in 4 minutes 29 seconds". The aria-label stays. Why: WCAG 2.5.3 needs the visible label inside the name. This keeps the spoken duration that the spec's name adds, and matches the compact pill, which already starts with "4:29". It changes §3.5's exact copy by prefixing the visible text, and nothing else.

- [ ] **Step 1: Write the failing tests:**
  - **`Layout.test.jsx`** (`setViewport(320)`, with `<Puppy />`):
    - open "Account menu", then the menu item "Puppy assistant";
    - with the dialog "Puppy assistant" open, the "Account menu" button has `aria-expanded="true"`;
    - Escape closes it and sets `"false"`.
  - **`Layout.test.jsx`:** the top-bar order test expects `/^Demo session · 4:\d{2}, signed out in 4 minutes \d+ seconds$/`.
  - **`publicDemo.test.jsx`:** at `lg`, the pill button's name contains its visible text "Demo session · 4:29"; focusing it holds the name while the clock moves.
- [ ] **Step 2:** Run both files. Expect them to fail.
- [ ] **Step 3:** Implement, and update the walkthrough's quoted name.
- [ ] **Step 4:** Run `src/app src/features/puppy`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Accessibility: the avatar says when Puppy's docked panel is open, and the demo pill's name starts with what it shows"

### Task 11: Journeys, dark mode, docs and screenshots

**Files:**
- **E2E:**
  - `frontend/e2e/onboarding.spec.js`: after the password change, the H1 "My week", the region "Your manager" containing "Morgan Manager", and the region "Your focus" containing "Nothing assigned to you right now".
  - `frontend/e2e/overtime.spec.js`:
    - **before Submit,** the group "Week totals" reads "45h counted of 40h", with "45h" for Pending (every day was typed, so nothing counts as approved yet);
    - **after Submit,** `week-total` reads "45h counted of 40h";
    - the Day view's checks become `getByText('Overtime', { exact: true })`: 1 on Friday and 0 on Monday to Thursday;
    - the manager's part is unchanged (phase 4 owns Timesheets).
  - `frontend/e2e/milestones.spec.js`: when `employee.demo` signs in, My week shows the region "Your focus". Then:
    - "Completed, <N> milestone(s)" collapses, and its rows go;
    - after a reload it's still collapsed;
    - it expands again.
  - `frontend/e2e/shell.spec.js`: the 375 px test also measures:
    - for a role whose nav has `/timesheet`: the Week view, the Month view, and an open Entry details (click the first `[data-entry]`);
    - for `employee.demo`: My week's previous week (`/?week=<last Monday>`);
    - wherever the nav has My history: `?tab=projects`.
- **Frontend:**
  - `frontend/src/features/home/employeeDarkMode.test.jsx` (new): under `setPrefersDark(true)`, My week, My timesheet (Week and Month) and My history each render their H1 and first H2 with no console error;
  - `frontend/src/components/noHexColours.test.js`: the glob adds `../features/home/*.jsx`, `../features/timesheet/*.jsx` and `../features/people/*.jsx`, excluding tests.
- **Docs:**
  - README tour:
    - the My week, My timesheet and My history paragraphs;
    - the images `my-week.png`, `my-timesheet.png`, `timesheet-month.png` and `my-history.png`, each with alt text;
    - check the alt text of `your-manager.png` and `timesheet-mobile.png` against the new screens, and correct it where it no longer holds.
  - `docs/project/USER_STORIES.md`: My week (focus, groups, week picker), My timesheet (totals, Entry details, Save & resubmit, restored typing), My history (tabs, Employment details, archived per role).
  - `docs/project/LOGIC_WALKTHROUGH.md`:
    - §9a-i: the screen under its new headings;
    - §5a: unsaved typing in `sessionStorage` and the one-cell Save & resubmit;
    - the New York "today" of the timesheet.
  - `docs/project/DEMO_SCRIPT.md`: the employee walk-through.
  - `docs/project/TESTING.md`: counts from your own final runs.
  - `docs/project/API.md`: check Task 1's row against the final code.
- **Screenshots:**
  - Into `docs/images/`, at 1440×900, light, as `employee.demo`:
    - `my-week.png` (`/`);
    - `my-timesheet.png` (Week view, with Entry details open on a "Needs revision" entry if the seed holds one, else a pending one);
    - `timesheet-month.png` (Month);
    - `my-history.png` (`/people/<Eli's id>/profile`).
  - One dark shot (My week) and one at 375 px (My timesheet, Week view) go into `C:\Users\mizo7\.claude\jobs\5a07e959\tmp`, not the repo.
  - Use the local stack: `python backend/v1/scripts/devserver.py --db overwatch_shots --reset --seed` on 3001 and `npm run dev` on 3000. Drive it with a throwaway Playwright script kept in that tmp folder.
  - Stop both servers afterwards.

- [ ] **Step 1:** Write `employeeDarkMode.test.jsx` and extend `noHexColours.test.js`, then run both. Expect them to pass.
- [ ] **Step 2:** Update the four e2e specs. Run `npx playwright test` alone with 3000 and 3001 free. Expect all to pass, on desktop Chrome and the iPhone 13 profile.
- [ ] **Step 3:** Run the full frontend suite twice and lint, then the full backend suite. Use these counts in TESTING.
- [ ] **Step 4:** Update the docs.
- [ ] **Step 5:** Take the screenshots and view each one. Then stop both servers and check that ports 3000 and 3001 are free.
- [ ] **Step 6:** Scan every changed file for `TODO`, `test.skip`, `.only` and stub tests. There must be none.
- [ ] **Step 7: Commit:** "Employee screens: journeys, dark mode, docs and screenshots for phase 3"
