# Timesheet and Projects Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give employees a one-day timesheet (with an optional week grid) and a simplified projects area: cards on the list, and a one-page project with "Your part".

**Architecture:** Mostly frontend. The timesheet logic is lifted into a hook, and two views (Day, Week) render from it. The project page becomes a single Overview with milestone rows and a side panel, and managers get a reduced tab set. One backend field (`my_hours`) is added to the project summary.

**Tech Stack:** React 19, MUI 9, TanStack Query, react-router, Vitest + Testing Library + MSW, Playwright, and on the backend Python 3.12 with pytest against PostgreSQL 17.

**Spec:** `docs/superpowers/specs/2026-10-15-timesheet-and-projects-redesign-design.md`

## Global Constraints

- **No business-rule or permission changes.** The API stays the same, except `my_hours` on `GET /projects/{id}/summary`.
- **localStorage keys:**
  - `overwatch.timesheet.view` (`'day' | 'week'`, default `'day'`);
  - `overwatch.projects.view` (`'cards' | 'table'`, default `'cards'`).
  - Every read and write is wrapped in try/catch.
- **Queries:** role and label queries in tests, as the existing ones do. `data-testid="week-total"` is kept.
- **Commits:** no attribution lines in commits or files. Commit locally only; the controller pushes and deploys.
- **Test runs:** run suites one at a time, because machine load causes Vitest timeouts.
- **Commands:**
  - Frontend: `cd frontend && npx vitest run <paths>`; full suite `npx vitest run`; `npm run lint`.
  - Backend: `cd backend/v1 && python -m pytest -q <path>`.

## Review Focus

1. **Changing week with unsaved edits:** the user expects a confirm ("Discard N unsaved changes?") rather than silent loss. Covered by a test in Task A2.
2. **`?day=` missing, malformed, or outside the selected week:** the page falls back to today for the current week, otherwise to Monday, with no crash. Covered by a test in Task A2.
3. **A project with zero milestones, or a member with none assigned:** "Your part" shows `0 of 0 milestones · 0h logged · 0%` with no NaN. Covered by a test in Task B3.
4. **`?milestone=` naming an archived or unknown milestone:** the page renders and the panel stays closed. Covered by a test in Task B3.
5. **Old links `?tab=milestones|budget|hours`:** they land on Overview, Budget & hours, and Budget & hours respectively. Covered by a test in Task B3.

---

## Part A: Timesheet

### Task A1: Lift timesheet state into `useTimesheetWeek` and move the grid to `WeekGrid` (no behaviour change)

**Files:**
- Create: `frontend/src/features/timesheet/useTimesheetWeek.js`
- Create: `frontend/src/features/timesheet/WeekGrid.jsx`
- Modify: `frontend/src/features/timesheet/TimesheetPage.jsx`

**Interfaces:**
- Produces `useTimesheetWeek(week: string)`. It returns:
  - `{ sheet, rows, groups, allDays, entries, locks, valueOf(k), noteOf(k), hasDraft(k), isDraft(k), attention(k), timerNeedsNote(k), dayTotal(d), total, overDays, tooMany, tooFew, changed: string[], failure, setFailure, setHours(k, v), setNote(k, v), onSave(): Promise<void>, saving: boolean, discard(), nameOf(id), closedLabel(row) }`;
  - `key(milestoneId, date)` is exported from the same file.
- Produces `<WeekGrid state={…} days={…} thisWeek onRequest(cell) />`, which renders today's table exactly.

- [ ] **Step 1:** Run `npx vitest run src/features/timesheet src/features/timer`. Expect it to pass, which gives the baseline.
- [ ] **Step 2:** Move the state and derivations from `TimesheetPage.jsx` (lines 110–184) into the hook, and the table, `GroupRows`, `NoteButton` and `CellStatus` into `WeekGrid.jsx`. The page keeps the header, week navigation, alerts and `RequestChangeDialog`.
- [ ] **Step 3:** Run the same command and `npm run lint`. Expect both to pass, with the same counts as Step 1.
- [ ] **Step 4:** Commit with "Timesheet: lift week state into useTimesheetWeek and the grid into WeekGrid".

### Task A2: Day view, week strip and the Day/Week toggle

**Files:**
- Create: `frontend/src/features/timesheet/DayView.jsx`
- Create: `frontend/src/features/timesheet/WeekStrip.jsx`
- Modify: `frontend/src/features/timesheet/TimesheetPage.jsx`
- Test: `frontend/src/features/timesheet/dayView.test.jsx`

**Interfaces:**
- Consumes `useTimesheetWeek` and `WeekGrid` from Task A1.
- `WeekStrip({ days, selected, dayTotal, overDays, onSelect })` renders a button group. Each button's accessible name is `"Wed 14 Oct, 6h"` and the selected one has `aria-pressed="true"`.
- `DayView({ state, day, thisWeek, onRequest })` renders:
  - one row per open milestone, with:
    - an hours input labelled `"<Milestone>, <Day label>"`, the same label as today's cells, so existing helpers keep working;
    - a note textbox labelled `"Work note, <Milestone>"`;
    - the status text and the Resubmit button;
  - `LockedCell` for locked cells;
  - `TimerButton` only when `thisWeek && day === today && milestone.status !== 'completed'`;
  - closed rows behind a button "Show N closed milestones".
- Page header button text: `Submit ${n} change${n === 1 ? '' : 's'}`, or `Submit` when n is 0 (disabled).
- The toggle is a `ToggleButtonGroup` with the label "Timesheet view" and buttons "Day" and "Week".
- URL: `?week=YYYY-MM-DD&day=YYYY-MM-DD`.

- [ ] **Step 1: Write failing tests** in `dayView.test.jsx`, using the same MSW fixtures and helpers as `timesheet.test.jsx`.
  - `opens on today for the current week and on Monday for other weeks`
  - `a bad or out-of-week ?day= falls back to the default day`
  - `the strip shows each day's total and marks a day over the cap`
  - `typing hours and a note for two days submits one PUT with both entries`: assert the body's `entries` holds the two `{milestone_id, work_date, hours, note}` items.
  - `hours without a note mark the row and the PROOF_REQUIRED error names the day with a link to it`
  - `timer hours show locked with Request a change`
  - `a completed milestone is hidden behind "Show 1 closed milestone" and has no Start button`
  - `a rejected entry shows its reason and Resubmit`
  - `hours past the day cap show the cap error and disable Submit`
  - `changing week with unsaved edits asks to discard them`
  - `the Day/Week choice is remembered`: toggle to Week, unmount, re-render, expect the grid. A `localStorage` that throws must still render the Day view.
- [ ] **Step 2:** Run `npx vitest run src/features/timesheet/dayView.test.jsx`. Expect it to fail.
- [ ] **Step 3:** Implement `WeekStrip`, `DayView` and the page wiring: view toggle, `day` param, discard confirm (reuse `ConfirmDialog`). The existing grid tests need the Week view: add a `localStorage.setItem('overwatch.timesheet.view','week')` setup in `timesheet.test.jsx`, `timesheetRules.test.jsx` and `timerWorkflow.test.jsx`, or retarget them to the Day view where the label-based queries still match.
- [ ] **Step 4:** Run `npx vitest run src/features/timesheet src/features/timer src/features/home`, then the full `npx vitest run`, then `npm run lint`. Expect all to pass.
- [ ] **Step 5:** Commit with "Timesheet: one day at a time, with a week strip and a Day/Week toggle".

### Task A3: End-to-end, docs and screenshots for Part A

**Files:**
- Modify: `frontend/e2e/overtime.spec.js`. It logs per day in the Day view: click the strip day, fill hours plus the "Work note, Schema Mapping" textbox, then Submit once.
- Modify these docs:
  - `README.md` (Employee tour, the timesheet screenshot and caption);
  - `docs/project/USER_STORIES.md` (the timesheet stories);
  - `docs/project/LOGIC_WALKTHROUGH.md` (where it describes the grid);
  - `docs/project/DEMO_SCRIPT.md` (timesheet steps);
  - `docs/project/TESTING.md` (counts).
- Modify: `docs/images/*timesheet*.png`, retaken from the local app at 1440×900.

- [ ] **Step 1:** Run `npx playwright test` on its own. Expect `6 passed`.
- [ ] **Step 2:** Update the docs. Each describes the Day view as the default and the Week grid as the alternative.
- [ ] **Step 3:** Commit with "Timesheet day view: end-to-end journey, docs and screenshots".

---

## Part C: Readable milestone charts (built after Part A, before Part B)

Spec section: "Part C: readable milestone charts". Frontend only. Colours come from `STATUS`/`statusColor` in `frontend/src/app/theme.js` and `chartPalette` in `frontend/src/app/chartColors.js`; add no new hues. Text beside a mark uses text colours, never the series colour.

### Task C1: Readable milestone timeline

**Files:**
- Modify: `frontend/src/components/Timeline.jsx`
- Modify: `frontend/src/features/milestones/MilestonesTab.jsx` (pass `onOpen`, which sets `?milestone=<id>` with `useSearchParams`)
- Test: `frontend/src/components/timeline.test.jsx`

**Interfaces:**
- `Timeline({ items, range, onOpen? })`:
  - `items` are milestone objects as today (`id, name, start_date, end_date, status, display_status, priority, predecessors, progress_percent, assignees, is_assignee, logged_hours, estimated_hours, working_days`);
  - the export name and the `aria-label="Milestone timeline"` list stay.
- **Row:**
  - an `li` with `tabIndex=0`;
  - its `aria-label` is `"<name>, <start> to <end>, <state label>[, <P>% done][, overdue][, <priority> priority]"`;
  - Enter or click calls `onOpen(item)`.
- **Direct label text:** `"<Mon D> – <Mon D> · <state>"`. The state is:
  - `Done` (completed);
  - `<P>% done` (in progress with a percent), or `In progress` without one;
  - `Ready for review`;
  - `Not started`;
  - `Waiting on <names>`;
  - `Blocked`.
  - Overdue adds `· ⚠ Overdue`.
- **Month axis:** an `aria-hidden` row of month labels. Tests find them with `getByText('Aug', { exact: true })` within the chart.
- **You tag:** the text `You` next to the name when `is_assignee`.

- [ ] **Step 1: Write failing tests** in `timeline.test.jsx`, rendering `Timeline` directly with `renderAsUser` or a theme wrapper, as `components.test.jsx` does:
  - `shows a month label for every month start in the range` (Jul 15 → Oct 20 gives Aug, Sep and Oct; a range crossing the year shows "Jan 2027")
  - `labels each bar with its dates and state` ("Aug 15 – Oct 23 · 60% done" for an in-progress milestone with `progress_percent: 60`; "· Done" for a completed one)
  - `marks an unfinished milestone past its end date as overdue`: freeze the clock with `vi.setSystemTime`, then expect "⚠ Overdue" and "overdue" in the row's aria-label
  - `tags my milestones with You and adds Your milestone to the legend`
  - `waiting milestones name what they wait on`
  - `focus shows the tooltip with people and hours against the estimate`
  - `click and Enter call onOpen with the milestone`
  - `a one-day range and a milestone outside the range render without NaN` (no `NaN` in `container.innerHTML`)
- [ ] **Step 2:** Run `npx vitest run src/components/timeline.test.jsx`. Expect it to fail.
- [ ] **Step 3:** Implement. In `MilestonesTab.jsx`, pass `onOpen={(m) => setParams((p) => { p.set('milestone', m.id); return p })}`. Use the existing `focused` scroll; don't add a new one.
- [ ] **Step 4:** Run `npx vitest run src/components src/features/milestones src/features/projects`, then the full `npx vitest run`, then `npm run lint`. Expect all to pass.
- [ ] **Step 5:** Commit with "Milestone timeline: month axis, dates and state on every bar, progress fill, overdue and You, click to open".

### Task C2: Milestones-by-state bar

**Files:**
- Create: `frontend/src/components/MilestoneStatusBar.jsx`
- Modify: `frontend/src/features/milestones/MilestonesTab.jsx` (render it above the timeline)
- Test: `frontend/src/components/milestoneStatusBar.test.jsx`

**Interfaces:**
- `MilestoneStatusBar({ items })`:
  - counts non-archived items by `display_status`, in the order `completed, ready_for_review, in_progress, not_started, waiting, blocked`;
  - renders a `section` labelled by its heading `"<done> of <total> milestones done"`;
  - each segment has the accessible name `"<State label>: <n> milestone(s)"`;
  - the legend items read `"<State label> <n>"`;
  - returns `null` with no non-archived items.

- [ ] **Step 1: Write failing tests:**
  - `heading counts the completed milestones`
  - `one segment per state present, in the fixed order, sized by count` (check the segment widths' `style` or a `data-count`)
  - `archived milestones are left out`
  - `nothing renders without milestones`
  - `the Milestones tab shows the bar above the timeline` (in `milestones.test.jsx`)
- [ ] **Step 2:** Run the new file. Expect it to fail.
- [ ] **Step 3:** Implement: 2px gaps between segments, each count printed inside its segment when the segment is at least 24px wide, and the tooltip on hover.
- [ ] **Step 4:** Run `npx vitest run src/components src/features/milestones`, then the full suite and lint. Expect all to pass.
- [ ] **Step 5:** Commit with "Milestones by state: one bar with counts above the timeline".

### Task C3: Cost-by-milestone bars, then docs and screenshots for Part C

**Files:**
- Modify: `frontend/src/components/DataBar.jsx` (an optional `max` prop, default 100; `aria-valuemax` follows it; the printed text stays `formatPct(value)`)
- Modify: `frontend/src/features/projects/MilestoneCostTable.jsx` (`max` = the largest `budget_pct` among the rows, at least 0.1; plus the caption)
- Test: the cost table tests in `frontend/src/features/projects/projects.test.jsx`, or wherever `MilestoneCostTable` is tested today
- Docs:
  - `README.md` (the milestones and budget captions);
  - `docs/project/LOGIC_WALKTHROUGH.md` or `docs/project/ARCHITECTURE.md`, where they describe the timeline;
  - `docs/project/TESTING.md` (counts);
  - `docs/images/milestones.png` and `docs/images/budget.png`, retaken from the local app at 1440×900.

- [ ] **Step 1: Write failing tests:**
  - `the most expensive milestone's bar is full and the others are relative`
  - `the percent text is the share of the budget`
  - `the caption explains the bars`
- [ ] **Step 2:** Run the file. Expect it to fail.
- [ ] **Step 3:** Implement, then run `npx vitest run src/features/projects src/components`, the full suite and lint. Expect all to pass.
- [ ] **Step 4:** Update the docs and retake the two screenshots.
- [ ] **Step 5:** Commit with "Cost by milestone: bars compare milestones; docs and screenshots for the readable charts".

---

## Part B: Projects

### Task B1: `my_hours` on the project summary

**Files:**
- Modify: `backend/v1/app/features/projects/service.py:412` (`summary`)
- Modify: `docs/project/API.md`, the `GET /projects/{id}/summary` row
- Test: `backend/v1/tests/integration/test_project_summary_my_hours.py`, following the fixtures in the existing project-summary tests

**Interfaces:**
- `summary()` adds `"my_hours": Decimal`: the sum of the caller's `time_entries.hours` with `status IN ('pending','approved')` on non-archived milestones of this project. It is `0` when there are none.

- [ ] **Step 1:** Write failing tests:
  - `test_summary_my_hours_counts_own_pending_and_approved_only`: an employee with 3h approved, 2h pending and 4h rejected, plus another member's 5h, gets `my_hours == 5`.
  - `test_summary_my_hours_zero_for_manager_without_entries`.
- [ ] **Step 2:** Run `python -m pytest -q tests/integration/test_project_summary_my_hours.py`. Expect it to fail.
- [ ] **Step 3:** Add the query to `summary()` and the field to API.md.
- [ ] **Step 4:** Run the file, then the full `python -m pytest -q`. Expect all to pass.
- [ ] **Step 5:** Commit with "Project summary: my_hours for the caller".

### Task B2: Projects list as grouped cards with a table toggle

**Files:**
- Create: `frontend/src/features/projects/ProjectCard.jsx`
- Modify: `frontend/src/features/projects/ProjectsPage.jsx`
- Test: `frontend/src/features/projects/projectCards.test.jsx`

**Interfaces:**
- `ProjectCard({ project, me })` is a `CardActionArea` link to `/projects/:id`, with the accessible name being the project name. It shows the status chip or `RiskBadges`, a `LinearProgress` with the label `"<name>: <pct>% complete"`, "Due <predicted end>", `AvatarStack` of `project.team`, and the manager.
- "Mine" means `project.manager.id === me.id`, or `project.delegate?.id === me.id`, or `project.team` includes `me.id`.
- Status chips filter through the existing `status` and `at_risk` query params. "More filters" opens the existing department, manager and archived controls.
- The view toggle is labelled "Projects view", with buttons "Cards" and "Table". It's shown to admins, managers and executives; employees always get cards.

- [ ] **Step 1:** Write failing tests:
  - `employee sees My projects cards only`
  - `manager sees My projects then Other projects`
  - `the At risk chip sends at_risk=true`
  - `the Table toggle shows today's table with CSV export and is remembered`
  - `a card links to its project`
- [ ] **Step 2:** Run the new file. Expect it to fail.
- [ ] **Step 3:** Implement. The existing `projects.test.jsx` list tests switch to the Table view where they assert table cells.
- [ ] **Step 4:** Run `npx vitest run src/features/projects`, then the full suite and lint. Expect all to pass.
- [ ] **Step 5:** Commit with "Projects list: grouped cards, status chips and a table toggle".

### Task B3: One-page project with milestone rows, side panel and new tabs

**Files:**
- Create: `frontend/src/features/projects/ProjectOverview.jsx`
- Create: `frontend/src/features/projects/YourPart.jsx`
- Create: `frontend/src/features/milestones/MilestoneRow.jsx`
- Create: `frontend/src/features/milestones/MilestonePanel.jsx`
- Create: `frontend/src/features/projects/BudgetHoursTab.jsx`
- Modify: `frontend/src/features/projects/tabs.js`
- Modify: `frontend/src/features/projects/ProjectDetailPage.jsx`
- Retire `OverviewTab.jsx` and `MilestonesTab.jsx` once nothing imports them, moving `MilestoneCard`'s body into `MilestonePanel`.
- Test: `frontend/src/features/projects/projectOverview.test.jsx`

**Interfaces:**
- `yourPart(milestones, meId, myHours)` lives in `frontend/src/lib/yourPart.js` and returns `{ mine: number, total: number, hours: number, sharePct: number }`.
  - Weights: easy 1, medium 2, hard 3, the same as backend `DIFFICULTY_WEIGHTS`; check `backend/v1/app/rules/` and copy the exact values.
  - A completed milestone's weight is split equally among its assignees.
  - `sharePct` is my completed weight ÷ the total weight of non-archived milestones × 100, and 0 when the total is 0.
- `MilestoneRow({ m, names, manage, onOpen })` is a list item button named `"<name>, <state text>"`. The state text is one of `Completed`, `In progress`, `Ready for review`, `Up next`, or `Waiting on <names>`. My milestones also get their main `statusActions` button inline.
- `MilestonePanel({ m, project, manage, onClose })` is an MUI `Drawer` (anchor right on desktop, bottom on phones) labelled with the milestone name.
- `ProjectOverview` reuses Part C's components:
  - `MilestoneStatusBar` sits under the health strip;
  - `Timeline` goes in the collapsible timeline section, with `onOpen` opening the panel.
  - C1's and C2's component tests keep passing. The C2 placement test in `milestones.test.jsx` is retargeted to the Overview.
- `PROJECT_TABS` for managers, delegates and admins: `plan` (as today), `overview`, `budget-hours`, `team`. Executives get `overview` and `budget-hours`. Everyone else gets no tab bar.
  - Old `?tab=` values map as `milestones` → `overview`, `budget` → `budget-hours`, `hours` → `budget-hours`.

- [ ] **Step 1:** Write failing tests:
  - `yourPart` unit tests in `src/lib/yourPart.test.js`:
    - the shared split, where two assignees on a completed hard milestone give each 1.5 of the weight;
    - zero milestones gives 0%;
    - archived milestones are excluded.
  - `projectOverview.test.jsx`:
    - `employee sees no tabs, the health strip, Your part and the milestone rows`
    - `Your part reads "Your part: 2 of 5 milestones · 38h logged · 24% of the project's progress"` with fixture values that produce exactly that
    - `clicking a row opens the panel with the milestone's actions; Escape closes it`
    - `?milestone=<id> opens the panel; an unknown id leaves it closed`
    - `manager sees Overview, Budget & hours and Team tabs and can add a milestone`
    - `old ?tab=budget lands on Budget & hours`
    - `the timeline section is collapsed by default`
- [ ] **Step 2:** Run the new files. Expect them to fail.
- [ ] **Step 3:** Implement. Retarget `milestones.test.jsx`, `workflow.test.jsx`, `delegate.test.jsx`, `hours.test.jsx` and `projects.test.jsx` to the rows and panel; the behaviours they assert stay the same.
- [ ] **Step 4:** Run `npx vitest run src/features/projects src/features/milestones src/lib`, then the full suite and lint. Expect all to pass.
- [ ] **Step 5:** Commit with "Project page: one-page overview, Your part, milestone rows with a side panel, fewer tabs".

### Task B4: End-to-end, docs and screenshots for Part B

**Files:**
- Modify: `frontend/e2e/milestones.spec.js`, to open milestones through rows and the panel.
- Modify: `frontend/e2e/helpers.js`, if `openProject(page, name, tab)` needs the new tab values.
- Modify these docs:
  - `README.md` (project screenshots and captions);
  - `USER_STORIES.md`;
  - `LOGIC_WALKTHROUGH.md`;
  - `DEMO_SCRIPT.md`;
  - `TESTING.md`;
  - `ARCHITECTURE.md`, if it lists the project tabs.
- Modify: `docs/images/` project screenshots, retaken locally.

- [ ] **Step 1:** Run `npx playwright test` on its own. Expect `6 passed`.
- [ ] **Step 2:** Update the docs.
- [ ] **Step 3:** Commit with "Projects redesign: end-to-end journey, docs and screenshots".
