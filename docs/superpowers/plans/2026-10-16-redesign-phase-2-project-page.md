# Redesign Phase 2 (Project Page and Projects List) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mockups' project area:
- the Projects list as a sortable, paged table with a KPI strip and risk in words;
- one project header on every tab;
- the five rewritten tabs (Overview, Milestones, Team, Budget, Hours);
- a milestone side panel with Details, Approvals, Discussion, Work log, History and Notes;
- each with its employee variant.

**Architecture:**
- **Backend:** `GET /projects` gains `sort`, `dir` and `counts`. Two pure functions in the projects service do the work.
- **Shared parts:** four new components (`SidePanel`, `KpiStrip`, `FilterBar`, `DataTable`) and New York date helpers. Every later task builds on them.
- **One variant helper:** `projectView(user, project)` decides manager, executive or "your part". Every tab reads it, so the variants can't drift apart.
- **Milestone panel:** it's URL state (`?milestone=`, `?panel=`) on the Milestones tab. It reads the milestone from the list the tab already loaded.

**Tech Stack:**
- Frontend: React 19, MUI 9, TanStack Query 5, react-router 7.
- Tests: Vitest + Testing Library + MSW, and Playwright.
- Backend: Python 3.12 Lambda, pytest on PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-16-redesign-from-mockups-design.md`.
- **Binding sections:** §1–2 (scope, D1–D14, "Calls made"), **§4.0–4.9**, **§7.1**, §7.2, §8, §9's "Every phase" and "Phase 2" bullets, and §10.
- **Mockups** are in `.superpowers/redesign/`:
  - `Projects list (file was named People tab).png`
  - `Project - Overview.png`
  - `Projects - Milestones.png` (list), `Projects - Milestones2.png` (timeline), `Projects - Milestone3.png` (panel)
  - `Projects - Team.png`, `Projects - Budget.png`, `Projects - Hours.png`

## Global Constraints

- **Repo and branch:** repo `C:\Users\mizo7\OneDrive\Desktop\Projects\coding-workshop-participant`, branch `feat/frontend`. Work in place. Don't switch branches, push, deploy or touch remotes.
- **No permission or business-rule changes** (spec §1 "Not changing"):
  - `lib/permissions.js`, `app/access.js` and the server's checks stay as they are. Variants only hide things.
  - Approve week stays all or nothing, the stale-entry guard stays, and a rejection needs a reason.
- **The only API change** is §7.1, and it's additive: `sort`, `dir` and `counts` on `GET /projects`.
- **Privacy:**
  - Employees never see anyone else's hours or pending entries. An employee session never requests `/approvals` or `/allocations`. Budget hours columns are hidden when `hours_visible` is false.
  - Employees never see archived work.
  - Executives never request `/approvals`.
  - No rate is shown anywhere.
- **Variants:** every tab decides with Task 4's `projectView(user, project)`, never with role checks of its own:
  - `lead` (`project.manage`) sees team data;
  - `manage` (`lead` on a project that isn't archived) gets the edit actions;
  - `decides` (`approvals.view`) gets the pending-entry rows. They show only when the server lists entries, which covers delegates who are on the team;
  - `executive` is read-only;
  - `mine` (neither `lead` nor executive) gets "Your part" and "Your hours".
- **Exact copy, verbatim from spec §4.** `<…>` marks data.
  - **Risk** (§7.1):
    - "Past due", "Budget ahead of progress", "Overdue milestone";
    - no reason: "—", named "No risk";
    - health chip "On track";
    - tooltips "Ended <Oct 12, 2026>, <3 days> ago, and isn't completed." and "<81>% of the budget used against <62>% progress: <19> points ahead.".
  - **Projects list:**
    - title "Projects"; subtitle "Keep delivery, budget and risk in view.";
    - actions "New project" and "Request a project", beside today's "Export CSV";
    - KPIs "<N> projects", "<N> active", "<N> at risk";
    - filters "Search projects…", "All statuses" (Planned, Active, On hold, Completed), "All managers", "At risk only", "Archived", and the chip "Department: <name>";
    - columns "Project", "Status", "Manager", "Progress", "Budget used", "Due date", "Risk";
    - due lines "<N> days left", "Due today", "<N> days overdue";
    - footer "Progress is milestone completion weighted by difficulty. Budget used is approved spend against the budget. The due date is the project's planned end." with "Today is <October 15, 2026>" on the right;
    - no match: "No projects match" with "Clear filters".
  - **Header:** "Edit project", "More" (the description), "Archive project", "Restore project".
  - **Overview:**
    - KPI tiles:
      - "Progress" with "Weighted milestone completion";
      - "Approved spend" as "<$21,745> / <$250,000>" with "<8.7>% of budget used";
      - "Forecast at finish" with "Based on last 4 weeks" and "⚠ Over budget";
      - "Delivery" with "<73> days remaining", "<N> days overdue" or "Completed <date>".
    - "Milestone schedule", "<4> of <7> milestones complete", "View milestones →".
    - "Next milestones": columns Milestone, Dates, Owner, and "Unassigned".
    - "Needs attention": "<N> pending entries", "<N>h awaiting approval", "Review hours", "<N> overdue milestones", "<N> kicked back".
    - "Team this week": "Week of <Oct 12, 2026>", columns Name, Planned, Logged, and the chip "+<N>h".
    - "Project details": "Budget available" with "of <$250,000>" or "over budget", "Estimated effort", "Team" with "<5> people".
    - "Your part": "Your milestones: <2> of <7>", "Your hours: <38>h logged · <34>h approved", "This week: <6>h of <10>h planned", "Open my timesheet", "You aren't on this project's team.".
    - While planning: "This project is being planned. Open the Plan tab.".
  - **Milestones tab:**
    - summary "<4> of <7> milestones complete", "<8> pending entries · <62>h", "Your part: <2> of <7> milestones · <38>h logged";
    - toolbar "Search milestones…", Status (All, Not started, In progress, Ready for review, Completed, Waiting, Blocked), "List", "Timeline", "Add milestone";
    - columns "#", "Milestone", "Status", "Assignees", "Planned dates", "Effort (logged / estimate)", "Approvals" (managers) or "Your hours" (employees);
    - Effort ⓘ "Logged counts pending and approved hours of everyone on the milestone.";
    - cell text "Dependency: None", "Dependency: after <A>, <B>", "You", "Kicked back", "Unassigned", "Overdue", "<118>h / <264>h", "<114>h estimate", "<N>h logged", "+<0.5>h over estimate", "<N> pending";
    - footer "<7> milestones · Select a row to view details, discussion and history." with ⓘ "Effort shows logged / estimated hours. Status does not imply hours are approved.";
    - Timeline heading "Planned schedule", "<Jul 15 – Dec 27, 2026> · Bars show planned dates, colours show current status."; its footer ⓘ "Select a milestone to inspect dependencies, approvals and history.";
    - "⋯" items "Edit details", "Assign people", "Dependencies", today's `statusActions` labels, "Open discussion", "Archive milestone";
    - states "No milestones yet", "Your manager hasn't planned any milestones yet.", "No milestones match" with "Clear";
    - toast "That milestone is no longer available.".
  - **Panel:**
    - "Edit", "Close";
    - facts "<Aug 15, 2026 – Oct 23, 2026> · After <Discovery>" and "<118>h logged / <264>h estimated", plus "· You: <24>h" for an assignee;
    - tabs Details, Approvals, Discussion, Work log, History, Notes;
    - "Start a discussion", "No discussion yet. Your manager can start one.", "Post an update", "Add a note".
  - **Approvals tab:**
    - heading "<7> entries · <58>h awaiting approval", then "Milestone completion does not approve time entries."; at zero "Nothing waiting";
    - group "<Gia Rossi> · Week of <Oct 5, 2026> · <4> entries · <34>h", plus "Delegated from <manager>" when delegated;
    - columns Date, Hours, Source, Work note, Flags; a note from the day's progress update starts "Update: ";
    - footer "Select entries to review" or "<N> selected · <N>h", "View budget impact", "Request changes", "Approve <N>h";
    - toast "Approved <34>h for <Gia Rossi>";
    - flag labels: Repeated hours, Long day, After completion, Backdated, Over plan, No activity, No proof of work.
  - **Team:**
    - "<5> team members", "On this project · <115>h planned per week", "Add member", "Search team members…";
    - columns Person, Skills, "Planned / week", Actions; "Message"; tag "You";
    - "⋯" items "Edit planned hours" and "Remove from project"; the confirmation reads "Remove <name> from <project>? They're also taken off its milestones.";
    - footer "Planned hours are project allocations, not hours already worked." with "As of <date>";
    - empty "Nobody on this project yet".
  - **Budget:**
    - KPIs "Budget", "Approved spend", "Available budget" ("over budget" when negative), "Forecast at completion";
    - "Spend and forecast" with subtitle "<8.7>% approved spend · <24.5>% forecast" and legend "Approved spend" and "Forecast at completion";
    - banner "<62>h awaiting approval · Not yet included in spend." with "Review pending hours →";
    - caption "Forecast projects the last 4 weeks of approved spending to the project end date.";
    - "Cost by milestone": columns Milestone, Approved hours, Pending hours, Approved cost, Share of project budget, and a Total row;
    - caption "Bars compare the milestones; the percent is each one's share of the budget.";
    - footer "Displayed costs are rounded; totals use underlying values. Approved spend uses the rate saved at approval. Pending entries remain uncosted until approved." with "As of <date>".
  - **Hours:**
    - week bar "This week", "Project hours · This week" or "Project hours · Week of <Oct 5>", "As of <date>";
    - KPIs Planned, Logged (ⓘ "Logged means pending + approved. Rejected hours excluded."), Approved, Pending;
    - columns Person, "Planned / week", Logged, Approved, Pending, Review, plus "<N>h above project plan", "View entries" and "Total";
    - banner "<28>h awaiting approval this week · Pending hours do not contribute to approved project spend." with "Review this week's entries →";
    - footer "Planned hours are weekly allocations. This is not a measure of productivity.";
    - employees: "Your hours" with columns Milestone, Logged, Approved, Pending, Needs revision, and "Open my timesheet";
    - executives: "Team hours are private" with "Only the project's manager and admins see everyone's hours.";
    - empty "No hours this week" with "Hours appear as the team logs them.".
- **Phones, dark mode, accessibility** (§8, D14):
  - **375 px:** every new page has no horizontal page scroll.
  - **Below `md` (900 px):**
    - side panels are full-screen modal sheets;
    - tables are stacked cards (main field first, actions in a "⋯");
    - KPI strips use 2 columns, except the Projects list, which keeps 3.
  - **Colour:**
    - no hex colours in components; colours come from the palette, `STATUS` and `chartColors.js`;
    - tinted cards use palette colours with alpha;
    - status is never colour alone.
  - **Structure:**
    - one H1 per page and one H2 per card;
    - page and panel tabs use tab roles with `aria-controls`;
    - sortable headers carry `aria-sort`; progress bars carry `aria-valuetext`;
    - touch targets are at least 44 px; motion respects `useCalmMotion`.
- **Dates:** "Today is", "As of", days left or overdue, and overdue milestones all use the New York date (Task 2's `nyTodayIso`).
- **Tests:**
  - Role and label queries only.
  - Every request is answered by MSW.
  - Freeze dates with `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(…)`, then `vi.useRealTimers()` in `afterEach`.
  - Phones: `setViewport(375)`. Dark mode: `setPrefersDark(true)`. Both come from `src/test/setup.js`.
  - A retargeted test keeps its intent: each old assertion moves to where the thing now lives, or is replaced by the spec's behaviour.
- **Commands:** one suite at a time.
  - **Frontend:** `cd frontend && npx vitest run <paths> --testTimeout=20000`, then the full suite (`npx vitest run --testTimeout=20000`), then `npm run lint`.
  - **Backend:** `cd backend/v1 && OVERWATCH_TEST_DB=overwatch_test_p2 python -m pytest -o addopts="" -q <paths>`, then the same without paths.
  - **End to end:** `cd frontend && npx playwright test`, run alone, with ports 3000 and 3001 free (it starts its own servers).
- **Commits:**
  - Use the exact messages.
  - No attribution of any kind: no `Co-Authored-By`, no "Generated with".
  - Stage only your own files, by path. Never `git add -A` or `git add .`. `backend/health/` stays untracked.
- **Rulings that cross tasks:**
  - **Ruling: the fourth reason.** The code has four at-risk reasons; the spec names three. `BLOCKED_MILESTONE` reads "Kicked back". The risk order is `PAST_DUE`, `BUDGET_BURN`, `OVERDUE_MILESTONE`, `BLOCKED_MILESTONE`, then none. Why: §10.1 keeps the rule unchanged, so its fourth reason needs a word and a place.
  - **Ruling: "the first reason"** is the most severe by that order, not the array's first. Why: the Risk column, the health chip and `sort=risk` must agree.
  - **Ruling: short words live in a new `RISK_SHORT`** in `lib/labels.js`. `RISK_LABELS` stays for the Dashboard and the other pages. Why: phase 4 owns those pages.
  - **Ruling: budget bars keep today's `budgetTone`** (warning from 90%, error over 100%). The spec's "80%" yields to its own "(today's `budgetTone`)". Why: changing the function would change the Dashboard and Allocation.
  - **Ruling: one tab stop per row.** A row's keyboard target is its name link or button; Enter on it opens. A click anywhere on the row opens too. Why: a focusable row plus its link doubles the tab stops, and §8 says the row click "only widens the target".
  - **Ruling: no other backend change is needed.** These already exist:
    - `GET /approvals` takes `project`, `milestone` and `user`;
    - `POST /approvals/approve-week` takes `{entries: [{id, expected_hours}]}` (at most 100);
    - `POST /time-entries/{id}/reject` takes `{reason, expected_hours}`;
    - `GET /time-entries/{id}/breakdown` returns `request_cost`;
    - `/timesheets` reads `?project=&user=`, and `/timesheet` reads `?week=`;
    - the profile carries `projects[].logged_hours/approved_hours/planned_hours_per_week` and `milestones[].logged_hours`;
    - `GET /milestones/{id}/discussion` answers `404` until a discussion exists.

## Review Focus

1. **Changing a filter or the sort on page 2 or later of the Projects list.** The list goes back to page 1, so matches never hide behind an empty page reading "No projects match". Pinned in Task 3.
2. **Late evening in New York, after the UTC date has rolled over.** A project ending today (New York) reads "Due today", not "1 day overdue", and the footer reads the New York date. Pinned in Task 3.
3. **Closing the panel when its row isn't on screen** (filtered out, or the panel was opened from a link). Focus lands on the "Search milestones…" field, never on the page body. Pinned in Task 6.
4. **A `?panel=` value the viewer doesn't have,** such as an employee opening a manager's `?panel=approvals` link, or a typo. The panel shows Details and makes no `/approvals` request. Pinned in Task 7.
5. **The Approvals list refreshing after a partial result** (one person-week approved, another stale). Entries no longer listed leave the selection, so "N selected · Nh" and "Approve Nh" count only what's on screen. Pinned in Task 8.

---

### Task 1: `GET /projects`: sort, dir and counts

**Files:**
- Modify: `backend/v1/app/features/projects/service.py`:
  - `list_projects` (lines 473-493);
  - add the constants and the two pure functions below.
- Modify: `docs/project/API.md`:
  - the `GET /projects` row (line 233): `sort`, `dir`, `counts`;
  - the `at_risk_reasons` line (260): it also lists `BLOCKED_MILESTONE`.
- Test:
  - `backend/v1/tests/unit/test_project_sort.py` (new);
  - `backend/v1/tests/integration/test_projects_list_sort.py` (new).

**Interfaces:**
- **Produces** (in `service.py`):
  - `SORTS = ("name", "status", "manager", "progress", "budget_used", "due", "risk")`;
  - `DIRS = ("asc", "desc")`;
  - `STATUS_ORDER = ("planned", "active", "on_hold", "completed")`;
  - `RISK_ORDER = ("PAST_DUE", "BUDGET_BURN", "OVERDUE_MILESTONE", "BLOCKED_MILESTONE")`;
  - `sort_projects(items: list[dict], sort: str, direction: str) -> list[dict]`, which is pure;
  - `project_counts(items: list[dict]) -> dict`, returning `{"total", "active", "at_risk"}`.
- **Response:** `GET /projects` returns `{"items", "total", "counts"}`.

- [ ] **Step 1: Write the failing unit tests** in `test_project_sort.py`, on plain dicts shaped like `decorate()`'s output:
  - `test_each_key_sorts_both_ways` (parametrized over `SORTS`). Ascending and descending orders are exact lists.
    - `manager` sorts by `manager["name"]`, case-insensitive;
    - `progress` by `progress_pct`; `budget_used` by `budget_pct`; `due` by `predicted_end_date`.
  - `test_ties_break_by_name_in_both_directions`: three projects with equal `progress_pct` stay in name order under `asc` and under `desc`.
  - `test_status_order`: `planned`, `active`, `on_hold`, `completed`.
  - `test_risk_uses_the_most_severe_reason`:
    - `["OVERDUE_MILESTONE", "PAST_DUE"]` ranks with `PAST_DUE`;
    - ascending order is `PAST_DUE`, `BUDGET_BURN`, `OVERDUE_MILESTONE`, `BLOCKED_MILESTONE`, then none.
  - `test_counts`: `project_counts` returns `{"total": 4, "active": 2, "at_risk": 1}` for a fixture of 4.
- [ ] **Step 2: Write the failing integration tests** in `test_projects_list_sort.py`. Use `make_user`, `make_project`, `make_milestone`, `add_member`, `log_entry` and `token_for` from `tests/helpers.py`.
  - `test_sort_by_each_key_both_directions_across_pages`: an admin pages with `page_size=2` through 5 projects for each key and dir. The concatenated names match the expected order.
  - `test_bad_sort_or_dir_is_400`:
    - `?sort=owner` returns `(400, {"sort": "invalid_choice"})`;
    - `?dir=up` returns `(400, {"dir": "invalid_choice"})`;
    - assert on `body["error"]["details"]`;
    - an empty `?sort=&dir=` falls back to the defaults.
  - `test_counts_ignore_filters_and_paging`: `counts` is identical for `?q=zzz`, `?status=planned`, `?at_risk=true`, `?manager=<id>`, `?department=<id>`, `?archived=true` and `?page=2&page_size=1`. An archived project is never counted.
  - `test_counts_follow_the_callers_scope`: an employee on 1 of 3 projects gets `counts.total == 1`.
  - `test_at_risk_filter_unchanged_and_several_reasons_listed`: a project past due, burning budget and with an overdue milestone:
    - lists all three codes;
    - is the only one under `?at_risk=true`;
    - sorts first under `sort=risk`.
- [ ] **Step 3: Run both files.** Expect them to fail on the missing functions and keys.
- [ ] **Step 4: Implement.**
  - Validate a non-empty `sort` or `dir` with `as_enum` (which gives `{field: "invalid_choice"}`).
  - Decorate the caller's live projects once (`visible_projects(conn, ctx)`) and take `counts` from that set.
  - Unless `archived=true`, filter that same set in Python. Keep `as_uuid(department, "department")`, so a bad id is still `400`.
  - Sort before paging. Ties: pre-sort by `(name.lower(), str(id))`, then one `list.sort(key=…, reverse=desc)`. Python keeps equal keys in order under `reverse`, so ties stay name-ascending both ways.
  - **Ruling: what counts as live.** "Live" means not archived. `counts` ignores `q`, `status`, `manager`, `department`, `at_risk`, `archived` and paging. Why: spec §7.1 "whatever the filters".
- [ ] **Step 5: Update `API.md`.**
- [ ] **Step 6:** Run the two new files, then `tests/integration/test_projects.py`, then the whole backend suite. Expect all to pass.
- [ ] **Step 7: Commit:** "Projects API: sort and dir on GET /projects, sorted before paging, and counts of every live project the caller can see"

### Task 2: Shared parts: SidePanel, KpiStrip, FilterBar, DataTable, FootNote and New York dates

**Files:**
- Create:
  - `frontend/src/components/SidePanel.jsx`
  - `frontend/src/components/KpiStrip.jsx`
  - `frontend/src/components/FilterBar.jsx`
  - `frontend/src/components/DataTable.jsx`
  - `frontend/src/components/FootNote.jsx`
- Modify:
  - `frontend/src/components/ResponsiveTable.jsx`: extract its phone card list into a named export, `CardList`. `ResponsiveTable` keeps rendering exactly what it does today.
  - `frontend/src/lib/format.js`: the date helpers below.
- Test:
  - `frontend/src/components/sharedParts.test.jsx` (new);
  - `frontend/src/lib/format.test.js` (new);
  - `frontend/src/components/noHexColours.test.js` (new).

**Interfaces (produces):**
- `SidePanel({ open, title, titleAdornment, actions, onClose, returnFocus, list, children })`:
  - **Desktop (≥ 900 px):** `list` and the panel sit side by side at 1fr : 1fr. The panel is `<aside role="complementary">`, labelled by its title.
  - **Phones:** `list` is full width, and the panel is a full-screen MUI `Dialog` (`aria-modal`) whose top bar holds the title and Close.
  - **The title** is an H2 with `tabIndex={-1}`; it takes focus on open.
  - **Closing:** Esc calls `onClose`, and so does the "Close" button.
  - **After close,** focus goes to `returnFocus?.()`, else to the element focused before it opened.
- `KpiStrip({ ariaLabel, items, layout = 'label-first', phoneColumns = 2, loading, error, onRetry })`:
  - `items` are `[{ key, label, value, hint, tone: 'warning'|'error', icon, info, bar: { value, label, tone }, onClick }]`;
  - one outlined card with dividers; `layout: 'value-first'` puts the number above the label;
  - an item with `onClick` is a button named "<value> <label>";
  - `bar` renders a determinate bar with `aria-valuetext`;
  - `error` shows `ErrorAlert` with Retry inside the strip.
- `FilterBar({ search: { label, placeholder, value, onChange }, children, end })`:
  - the search field carries a magnifier and is named by `label`, with the placeholder shown;
  - `children` are selects and switches; `end` sits on the right;
  - it stacks on phones.
- `DataTable({ ariaLabel, columns, rows, getRowId, sort, defaultSort, onSortChange, serverSort, visibleKeys, onRowOpen, selectedId, rowTone, totalRow, renderCard, loading, skeletonRows = 5, empty, pagination })`:
  - `columns` are `[{ key, header, render(row), sortValue?(row), sortable, align, info, cardLabel }]`;
  - `sort` and `defaultSort` look like `{ key, dir: 'asc'|'desc' }`;
  - `pagination` looks like `{ page, pageSize, total, onPageChange }` (MUI `TablePagination`, one option of `pageSize`);
  - `totalRow` maps column keys to cell content: a last row whose first cell is a `th`, and a final "Total" card on phones;
  - `rowTone(row)` returns `'warning'` or null and tints the row.
- `CardList({ rows, renderCard, onRowClick, getRowId, ariaLabel, loading })`: today's phone markup, moved out of `ResponsiveTable`.
- `FootNote({ note, end })`: "ⓘ <note>" on the left (the icon is `aria-hidden`), `end` on the right. It stacks on phones.
- In `lib/format.js`:
  - `nyTodayIso(now = new Date()) → 'YYYY-MM-DD'`, using `Intl.DateTimeFormat` with `timeZone: 'America/New_York'`;
  - `formatLongDate(iso) → 'October 15, 2026'`;
  - `daysBetween(fromIso, toIso) → integer`;
  - `formatDateRange(startIso, endIso)`: "Jul 15 – Dec 27, 2026" within a year, "Dec 1, 2025 – Mar 3, 2026" across years.

**Ruling: `DataTable` is built on MUI `Table`** (with `TableSortLabel` and `TablePagination`), not on `DataGrid`. On phones it uses `CardList`. Why: phase 2's tables need total rows, a narrowed column set beside the panel, a selected-row tint and server sort. `ResponsiveTable` keeps `DataGrid` for the pages that still use it.

- [ ] **Step 1: Write the failing tests.**
  - **`sharedParts.test.jsx`:**
    - **SidePanel, desktop:** the panel is a `complementary` named by its title; the title has focus after opening; Esc calls `onClose`; focus returns to the button that opened it.
    - **SidePanel at 375 px:** the panel is a `dialog` with `aria-modal="true"` and a "Close" button.
    - **KpiStrip:** it renders three labelled values. A clickable item is a button named "2 at risk". `phoneColumns={3}` keeps 3 columns at 375 px (assert the grid style, not a colour). `error` shows a Retry button.
    - **FilterBar:** the search box is named "Search projects" and has the placeholder "Search projects…".
    - **DataTable:**
      - headers carry `aria-sort` (`ascending`, `descending`, `none`);
      - clicking a header calls `onSortChange` with the next `{ key, dir }`;
      - client sort is stable: equal values keep the input order;
      - clicking a row calls `onRowOpen`;
      - `visibleKeys` hides the other columns;
      - `totalRow` renders a last row headed "Total";
      - `empty` shows when there are no rows;
      - at 375 px there's no `table`, and each row is a card of "label: value" pairs.
  - **`format.test.js`:**
    - `nyTodayIso(new Date('2026-10-16T02:00:00Z'))` returns `'2026-10-15'`;
    - `formatLongDate('2026-10-15')` returns `'October 15, 2026'`;
    - `daysBetween('2026-10-12', '2026-10-15')` returns `3`;
    - both `formatDateRange` forms.
  - **`noHexColours.test.js`:** `import.meta.glob` (`query: '?raw'`, `eager: true`) over the five new components, `../features/projects/*.jsx` and `../features/milestones/**/*.jsx`. No file matches `/#[0-9a-f]{3,8}\b/i`.
- [ ] **Step 2:** Run the three files. Expect them to fail.
- [ ] **Step 3:** Implement the signatures above.
- [ ] **Step 4:** Run `src/components src/lib`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Shared parts: SidePanel, KpiStrip, FilterBar, DataTable and FootNote, with New York dates for footers"

### Task 3: Projects list

**Files:**
- Modify: `frontend/src/features/projects/ProjectsPage.jsx` (rewrite).
- Modify: `frontend/src/lib/labels.js`: add `RISK_SHORT`.
- Create:
  - `frontend/src/lib/risk.js`;
  - `frontend/src/components/RiskText.jsx`.
- Test:
  - `frontend/src/features/projects/projects.test.jsx` (retarget its `ProjectsPage` describe);
  - `frontend/src/lib/risk.test.js` (new).

**Interfaces:**
- **Consumes:** Task 1's `counts` and `sort`/`dir`; Task 2's `KpiStrip`, `FilterBar`, `DataTable`, `FootNote`, `nyTodayIso`, `formatLongDate` and `daysBetween`.
- **Produces:**
  - `RISK_SHORT = { PAST_DUE: 'Past due', BUDGET_BURN: 'Budget ahead of progress', OVERDUE_MILESTONE: 'Overdue milestone', BLOCKED_MILESTONE: 'Kicked back' }`.
  - In `lib/risk.js`:
    - `RISK_ORDER`, the same four codes in the same order as the backend's;
    - `orderedRisks(reasons) → codes`;
    - `primaryRisk(reasons) → code | null`;
    - `riskSentence(code, project, today) → string`;
    - `dueLine(project, today) → { text, overdue } | null`.
  - `RiskText({ project, today, variant: 'cell' | 'chip' })`:
    - `cell`: a warning icon and the first word;
    - `chip`: a warning chip with the first word, or a success "On track" chip with a check icon when there's no reason;
    - both share one tooltip, with one `riskSentence` per reason in order, and the accessible name "Risk: <word>, <word>";
    - with no reason, `cell` shows "—" named "No risk".

**Rulings for this task:**
- **Ruling: the other two tooltip lines.** `OVERDUE_MILESTONE` and `BLOCKED_MILESTONE` use today's `RISK_LABELS` text ("Overdue milestone", "Kicked back – needs review"). Why: the spec gives sentences only for the other two.
- **Ruling: the numbers in the budget sentence** are whole percents, and the points are the difference of the two shown numbers. Why: the sentence must add up.
- **Ruling: the CSV.** Today's CSV already has an "At risk" column listing every reason, and it stays as it is. Why: the spec asks for a Risk column, and one exists.
- **Ruling: "Request a project"** is a link button to `/requests?new=1`, which opens today's request dialog. Why: "as today" is the Requests page's button; this page never had one.
- **Ruling: the Archived switch** shows for `archive.everything` (admins, executives) and sets `archived=true`. Why: the API supports it, and the spec lists it "as today" for those roles.
- **Ruling: sort, dir and page live in the URL** with the filters. `page` is dropped when it's 1. Any filter or sort change removes `page`. Why: links and Back keep the view, and Review Focus 1.

- [ ] **Step 1: Write the failing tests.**
  - **`risk.test.js`:**
    - `primaryRisk(['OVERDUE_MILESTONE','PAST_DUE'])` is `'PAST_DUE'`;
    - `riskSentence('PAST_DUE', { predicted_end_date: '2026-10-12' }, '2026-10-15')` is "Ended Oct 12, 2026, 3 days ago, and isn't completed.", and the singular reads "1 day ago";
    - `riskSentence('BUDGET_BURN', { budget_pct: 81.2, progress_pct: 61.9 })` is "81% of the budget used against 62% progress: 19 points ahead.";
    - `dueLine` returns "8 days left", "Due today", and "3 days overdue" with `overdue: true`; it returns null for a completed project;
    - **Review Focus 2:** `dueLine` with `today = nyTodayIso(new Date('2026-10-16T02:00:00Z'))` and an end of `2026-10-15` reads "Due today". On the page, frozen at that instant, the footer reads "Today is October 15, 2026".
  - **`projects.test.jsx` (ProjectsPage):**
    - **Header:** the H1 "Projects", the subtitle, "New project" for an admin only, and "Request a project" for a manager only, linking to `/requests?new=1`.
    - **KPI strip:** with `counts {total: 6, active: 3, at_risk: 2}`, it shows "6 projects", "3 active" and "2 at risk". Clicking "2 at risk" adds `at_risk=true` to the URL (read the location probe).
    - **Filters:** typing in "Search projects…" (300 ms debounce), the status select, "At risk only" and the Department chip all set and clear URL params. Each refetch sends them.
    - **Sorting:**
      - the Project header reads `aria-sort="ascending"` by default;
      - clicking "Budget used" requests `sort=budget_used&dir=asc`, and clicking again requests `dir=desc`;
      - assert the MSW request URL, and that rows render in the server's order.
    - **Paging:** with `total: 30`, the next-page button requests `page=2&page_size=25`.
    - **Review Focus 1:** on `?page=2`, changing the status removes `page` from the URL and from the next request.
    - **Rows:**
      - the name is a link to `/projects/p1`, with the department under it;
      - an "Archived" chip shows on an archived project;
      - the Risk cell reads "Past due", named "Risk: Past due, Budget ahead of progress", with both sentences in its tooltip;
      - a healthy row reads "—", named "No risk";
      - the Due date cell shows "3 days overdue";
      - clicking the row (not the link) navigates to the project.
    - **Footer:** frozen at 2026-10-15T16:00Z, it reads "Today is October 15, 2026" and shows the ⓘ note.
    - **Employee:** no "New project", no "Request a project", no "All managers", no "Archived".
    - **States:**
      - skeleton rows while loading;
      - an error shows `ErrorAlert` with Retry;
      - filtered with no rows: "No projects match" and "Clear filters";
      - no projects at all: today's empty state for the role.
    - **Phones (`setViewport(375)`):** no `table`; a project card shows its name, status chip, risk line, two bars with percents, and the due line; the KPI strip still shows all three values.
    - **Kept:** the four create-form tests (department, pull mode, templates, validation, server field errors) keep their assertions.
- [ ] **Step 2:** Run the two files. Expect them to fail.
- [ ] **Step 3: Implement.**
  - `useProjects({ ...filters, sort, dir, page, page_size: 25 })`.
  - The Status column is `StatusChip`; Manager is `PersonWithAvatar`; Progress and Budget used are `DataBar` with `budgetTone` for budget.
  - The default sort is name ascending. Sort keys follow spec §4.1's table.
- [ ] **Step 4:** Run `src/features/projects src/lib`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Projects list: KPI strip, filters, sort and page in the URL, 25 per page, risk in words with its reasons"

### Task 4: Project header and frame

**Files:**
- Create:
  - `frontend/src/features/projects/ProjectHeader.jsx`;
  - `frontend/src/features/projects/viewer.js`.
- Modify:
  - `frontend/src/features/projects/ProjectDetailPage.jsx`: header, tabs and the tab panel;
  - `frontend/src/features/projects/OverviewTab.jsx`: move `DelegateLine` out to `ProjectHeader`.
- Test:
  - `frontend/src/features/projects/projects.test.jsx` (the `ProjectDetailPage` describe);
  - `frontend/src/features/projects/delegate.test.jsx` (the delegate line now sits in the header).

**Interfaces:**
- **Consumes:** Task 3's `RiskText` (`variant: 'chip'`); Task 2's `formatDateRange`.
- **Produces:**
  - `projectView(user, project) → { lead, manage, decides, executive, mine }`, as defined in Global Constraints;
  - `ProjectHeader({ project, user, view, onEdit, onArchive, onRestore, busy })`;
  - every tab now receives `{ project, manage, user, view }` (`manage` is kept for `PlanTab`).

**Rulings for this task:**
- **Ruling: no health chip on archived projects either.** Why: `at_risk_reasons` is always empty for them, so "On track" would be a claim the rule never checked.
- **Ruling: when "More" shows.** It appears when the description has more than 3 lines or 240 characters. Why: jsdom can't measure overflow, and the clamp needs a testable trigger.

- [ ] **Step 1: Write the failing tests:**
  - **The header is the same on every tab.** For each `?tab=` (overview, milestones, team, budget, hours), it shows:
    - the H1 name and the status chip;
    - the health chip ("On track", or "Past due" in a chip named "Risk: Past due");
    - the meta line: the manager's name, "Technology", and "Jul 15 – Dec 27, 2026".
  - **Health chip:** a completed project has none; an archived project shows "Archived" and no health chip.
  - **Description:** a 300-character one is clamped and shows "More"; clicking "More" reveals all of it. A short one shows no "More".
  - **Actions:**
    - "Edit project" only for `project.manage` on a live project: not for an employee, an executive, or an admin on an archived project;
    - it opens `ProjectForm`.
  - **The "⋯" menu** (named "More project actions") is for admins only:
    - "Archive project" asks for confirmation and archives;
    - on an archived project it holds "Restore project";
    - for `users.demoAdmin`, the items are disabled with the `DEMO_DISABLED` tooltip.
  - **Delegate line** (`delegate.test.jsx`): the header shows "Approvals delegated to …" and the ended form.
  - **Tabs:** Plan only while planning or after a finalized plan; the default is Plan while planning, otherwise Overview; `?tab=` is kept. An old `?tab=milestones&milestone=m1` link lands on Milestones with the param intact.
  - **`projectView`:** a table-driven test over admin, manager (own), manager (other's project, member), employee and executive, on a live and an archived project.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
  - The meta line's manager is a `PersonLink` with `context={{ project }}`.
  - A missing department drops its "·" segment.
  - The page's own "← Projects" link (`PageHeader`'s `breadcrumb`) goes. Phase 1's top-bar crumb (desktop) and back link (phones) replace it. `useBreadcrumb(project.data?.name, …)` stays.
  - Archive and Restore stay inside `DemoLock action="project.archive"`.
- [ ] **Step 4:** Run `src/features/projects`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Project page: one header on every tab with health, meta line, Edit project and the admin menu"

### Task 5: Overview

**Files:**
- Modify:
  - `frontend/src/features/projects/OverviewTab.jsx` (rewrite);
  - `frontend/src/components/Timeline.jsx`: a `layout` prop, `'default'` (today) or `'compact'`.
- Test:
  - `frontend/src/features/projects/overview.test.jsx` (new; the four overview tests move here from `projects.test.jsx`);
  - `frontend/src/components/timeline.test.jsx`.

**Interfaces:**
- **Consumes:** `projectView`; `KpiStrip`; `riskSentence` and `RISK_SHORT`; `nyTodayIso` and `daysBetween`; `useProjectSummary`, `useMilestones`, `useMembers`, `useApprovals`, `useAllocations`, `useProfile`, `useWeek` and `projectEffort` (all existing).
- **Produces:** `Timeline` gains `layout: 'compact'`. Each name shows its state word with an icon under it; the month axis and the Today line stay; there's no legend and no "after …" line.

- [ ] **Step 1: Write the failing tests**, frozen at 2026-10-15T16:00Z:
  - **KPI strip:**
    - "53.8%" with "Weighted milestone completion";
    - "$21,745 / $250,000" with "8.7% of budget used";
    - "$61,293" with "Based on last 4 weeks", plus "⚠ Over budget" when the forecast is above the budget;
    - "Dec 27, 2026" with "73 days remaining"; a past end date gives "N days overdue"; a completed project gives "Completed <date>".
    - A summary error shows `ErrorAlert` with Retry in the strip. Progress still shows from `project.progress_pct`, and the rest of the page renders.
  - **Milestone schedule:**
    - "4 of 7 milestones complete";
    - "View milestones →" navigates to `?tab=milestones&view=timeline`;
    - clicking a timeline row navigates to `?tab=milestones&milestone=<id>`;
    - while planning, "This project is being planned. Open the Plan tab." replaces it.
  - **Next milestones:** the 3 next uncompleted milestones by start date, with a state, "Oct 24 – Dec 12, 2026", and the first primary assignee or "Unassigned". A row opens its panel. The card is hidden when none is left.
  - **Manager (`lead`, `decides`):**
    - "Needs attention" shows "8 pending entries", "62h awaiting approval" and "Review hours" (to `/timesheets?project=p1`) from `GET /approvals?project=p1`;
    - the risk sentences;
    - "2 overdue milestones" and "1 kicked back";
    - the card is hidden when all of these are empty.
    - "Team this week" shows "Week of Oct 12, 2026" and a "+14h" chip when logged is above planned.
    - "Project details" shows "Budget available" (and "over budget" when negative), "Estimated effort", "5 people" and the work-mode line.
  - **Employee (`mine`):**
    - no request to `/approvals` or `/allocations`;
    - "Needs attention" holds only risk and milestone rows;
    - "Your part" shows "Your milestones: 2 of 7" and the next one's name and due date, linking to its panel;
    - "Your hours: 38h logged · 34h approved" from the profile;
    - "This week: 6h of 10h planned" from `GET /time-entries?week=2026-10-12` and the member list;
    - "Open my timesheet";
    - not on the team: "You aren't on this project's team.".
  - **Executive:** the manager layout with no pending rows, no "Team this week", no `/approvals` request and no Edit.
  - **Timeline:** `layout="compact"` shows "Completed" under a name and has no "Status colours" list.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
  - The left column is 2/3 wide and the right 1/3. They stack on phones: KPI strip, then schedule, next milestones, needs attention, team this week or your part, project details.
  - **Ruling: "Open my timesheet"** shows only with `timesheet.use`. Why: the route is closed otherwise (`ROUTE_CHECKS`).
- [ ] **Step 4:** Run `src/features/projects src/components`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Overview: KPI strip, milestone schedule, next milestones, needs attention, team this week or your part, and project details"

### Task 6: Milestones tab: summary, toolbar, list, timeline, "⋯" menu and the panel's frame

**Files:**
- Modify: `frontend/src/features/milestones/MilestonesTab.jsx` (rewrite: the summary card, toolbar, List and Timeline, states and the URL state).
- Create:
  - `frontend/src/features/milestones/MilestoneList.jsx`
  - `frontend/src/features/milestones/MilestoneMenu.jsx`
  - `frontend/src/features/milestones/MilestonePanel.jsx` (header and facts)
- Modify:
  - `frontend/src/features/milestones/MilestoneDialog.jsx`: an optional `focusField`;
  - `frontend/src/components/StatusChip.jsx`: an `icon` prop;
  - `frontend/src/components/Timeline.jsx`: `layout: 'detailed'`;
  - `frontend/src/lib/estimates.js`: `effortText`;
  - `frontend/src/features/projects/tabs.js`: Milestones points to `MilestonesTab`.
- Delete: `frontend/src/features/milestones/MilestonesWithHours.jsx`.
- Test:
  - `frontend/src/features/milestones/milestones.test.jsx` (retarget);
  - `frontend/src/components/timeline.test.jsx`;
  - `frontend/src/components/components.test.jsx` (StatusChip).

**Interfaces:**
- **Consumes:** `SidePanel`, `DataTable`, `FilterBar`, `FootNote`, `projectView`, `MilestoneStatusBar`, `statusActions`, `useApprovals`, `useProfile` and `useMembers`.
- **Produces:**
  - `MilestonesTab({ project, manage, user, view })`. It reads `?milestone=` and `?view=timeline`, and remembers List or Timeline in `overwatch.milestones.view` (`localStorage`, wrapped in try/catch). The URL wins.
  - `MilestoneList({ items, view, pendingByMilestone, myHoursByMilestone, selectedId, narrow, onOpen, menuFor })`. When `narrow`, it shows only #, Milestone and Status (the status cell then carries the "N pending" chip).
  - `MilestoneMenu({ milestone, project, items, members, user, onOpenPanel })`: the "⋯" button, named "More actions for <name>", its items and today's dialogs.
  - `MilestonePanel({ project, milestone, items, members, user, view, myHours, onClose, returnFocus })`: `SidePanel` with:
    - the name (H2) and its `StatusChip icon`;
    - "Edit" (`manage`), the `MilestoneMenu` and Close;
    - the description;
    - the three facts (calendar, people, clock).
    - Task 7 adds its tabs below.
  - `StatusChip({ status, label, size, icon = false })`: with `icon`, milestone states get an icon, and `waiting` gets `stateStripes`.
  - `effortText(m) → { text, over }`: "118h / 264h", "114h estimate", "<N>h logged" or "—"; `over` is "+0.5h over estimate" or null.
  - `Timeline` `layout: 'detailed'`: the name column adds # and the status chip, plus a Dependency column ("None" / "After Discovery"). It's used from `lg` (`WIDE_QUERY`); below that, the default layout.
  - `MilestoneDialog({ …today's props, focusField })`, where `focusField` is `'name' | 'assignee_ids' | 'predecessor_ids'`.

**Rulings for this task:**
- **Ruling: one dialog for three menu items.** "Edit details", "Assign people" and "Dependencies" all open today's `MilestoneDialog`, focused on Name, "Assigned to" or "Depends on". Why: one dialog holds all three, and the spec says "each opens today's dialog".
- **Ruling: the menu's status moves keep `statusActions`' labels** ("Complete", "Send back", …). Why: the spec's "Mark completed" is an "e.g.", and one action keeps one name.
- **Ruling: "Open discussion"** opens the panel on its Discussion tab (`?panel=discussion`). Why: the thread now lives in the panel.
- **Ruling: no extra fetch for the panel.** It reads its milestone from `GET /projects/{id}/milestones`, which `_views` builds exactly like `GET /milestones/{id}`. Once the list has loaded, an id that's missing means the milestone vanished. Why: the panel needs nothing the list lacks.
- **Ruling: Back closes the panel.** Opening pushes a history entry; closing removes `?milestone` and `?panel` with `replace`. Why: "links and Back work" without Back reopening a closed panel.
- **Ruling: the pull-mode note and the dependency-warning alert** stay, under the summary card. Why: no role loses information.

- [ ] **Step 1: Write the failing tests** (rewrite `milestones.test.jsx` around the new screen, keeping each old intent):
  - **Summary:**
    - "4 of 7 milestones complete" and the status bar;
    - a manager sees "8 pending entries · 62h" linking to `/timesheets?project=p1`, hidden at 0;
    - an employee sees "Your part: 2 of 7 milestones · 38h logged" and requests no `/approvals`.
  - **Columns:**
    - "#" in dependency order;
    - "Dependency: after Discovery", "Dependency: None" and a "You" tag;
    - the state chip and "Kicked back";
    - avatars with "+1" and first names, and "Unassigned";
    - "Aug 15, 2026 – Oct 23, 2026", with "Overdue" when past and unfinished;
    - every `effortText` form, including "+0.5h over estimate";
    - "2 pending" for a manager and "—" at 0; an employee gets "Your hours" instead;
    - the More column: an `aria-hidden` chevron (the name button is the keyboard target), plus the "⋯" for `manage`.
  - **Toolbar:**
    - the search matches name and description;
    - the Status filter by `display_status`;
    - "Timeline" sets `?view=timeline` and is remembered after a remount without the param;
    - "Add milestone" opens `MilestoneDialog` only for `manage`;
    - search and the filter also apply to the Timeline.
  - **Sorting:** Milestone by name; Status in Part C's order; Planned dates by start.
  - **Opening:**
    - a row click and Enter on the name button set `?milestone=m2`;
    - the panel shows the H2 "Build: frontend" and the list narrows to #, Milestone and Status;
    - the deep link `?milestone=m2` opens it on load;
    - Esc closes it and focus returns to that row's name button.
  - **Review Focus 3:** with `?milestone=m3` loaded directly and a search hiding m3, closing puts focus on the "Search milestones" field.
  - **Vanished:** `?milestone=gone` once the list has loaded closes the panel with the toast "That milestone is no longer available.".
  - **Panel header:**
    - "Aug 15, 2026 – Oct 23, 2026 · After Discovery", the assignees, "118h logged / 264h estimated", and "· You: 24h" for an assignee;
    - "Edit" and "⋯" only for `manage`.
  - **"⋯" per permission:** the items for a manager; the status items follow `statusActions` (a ready-for-review milestone shows "Complete" and "Send back"); none for an employee or an executive. "Archive milestone" confirms and calls `DELETE /milestones/m1`.
  - **States:** skeleton rows; "No milestones yet" with "Add milestone" for a manager, or "Your manager hasn't planned any milestones yet."; "No milestones match" with "Clear".
  - **Kept:** cycle error, out-of-range dates, difficulty, priority, estimate, claim and pull-mode tests. Assertions about cards move to the row, the panel or the dialog.
  - **Timeline:** `layout="detailed"` shows the Dependency column header and "After Discovery".
  - **StatusChip:** `icon` renders an icon with the same label.
  - **Phones:** at 375 px rows are cards, and the panel is a `dialog`.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3: Implement.**
  - **Data sources:**
    - pending per milestone and the summary total come from `useApprovals({ project: id }, view.decides)`;
    - "Your hours" and "38h logged" come from `useProfile(user.id)`'s `milestones[]` and `projects[]`, only when `view.mine`.
  - **Footers:** "<N> milestones · Select a row to view details, discussion and history." with the ⓘ note; under Timeline, "Planned schedule" and its own footer.
- [ ] **Step 4:** Run `src/features/milestones src/features/projects src/components`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Milestones tab: summary, toolbar, list and timeline, the ⋯ menu, and a side panel that opens from the row or a link"

### Task 7: Milestone panel tabs: Details, Discussion, Work log, History, Notes

**Files:**
- Modify: `frontend/src/features/milestones/MilestonePanel.jsx`: the tabs, with `?panel=`.
- Create:
  - `frontend/src/features/milestones/panel/DetailsTab.jsx`;
  - `frontend/src/features/milestones/panel/DiscussionTab.jsx`;
  - `frontend/src/features/timer/useLoggable.js` (moved from `features/home/MyWeekPage.jsx`, which then imports it).
- Modify:
  - `frontend/src/api/messages.js`: `messageKeys.discussion` and `useMilestoneDiscussion`;
  - `frontend/src/features/messages/ThreadView.jsx`: a `crumb` prop;
  - `frontend/src/app/breadcrumbs.js`: `useBreadcrumb`'s `enabled` option;
  - `frontend/src/features/milestones/WorkLog.jsx` and `MilestoneNotes.jsx`: button labels only.
- Test:
  - `frontend/src/features/milestones/workflow.test.jsx` (retarget to the panel);
  - `frontend/src/features/milestones/panel.test.jsx` (new);
  - `frontend/src/app/breadcrumbs.test.jsx` (one test).

**Interfaces:**
- **Consumes:** Task 6's `MilestonePanel` and `MilestoneMenu`; `KickbackPanel`, `KickbackDialog`, `MilestoneDetails`, `WorkLog`, `MilestoneHistory`, `MilestoneNotes`, `TimerButton`, `PriorityChip`, `DifficultyChip` and `SupportingChip`.
- **Produces:**
  - `PANEL_TABS = ['details', 'approvals', 'discussion', 'worklog', 'history', 'notes']`;
  - `panelTabsFor(view) → [{ value, label }]`, with Approvals only for `view.decides`; Task 8 fills Approvals in;
  - `DetailsTab({ milestone, items, project, manage })`;
  - `DiscussionTab({ milestone, manage, user })`;
  - `useMilestoneDiscussion(milestoneId)`: `GET /milestones/{id}/discussion` under the key `['messages', 'discussion', id]`. `useOpenDiscussion` already invalidates `['messages']`;
  - `useBreadcrumb(label, { failed, enabled = true })`;
  - `ThreadView({ id, me, title, onBack, crumb = true })`;
  - `useLoggable() → Set<string>`.

**Rulings for this task:**
- **Ruling: the embedded thread doesn't name the crumb.** `ThreadView` inside the panel passes `crumb={false}`, which disables `useBreadcrumb`. Why: otherwise the thread's title would replace "Projects / <name>".
- **Ruling: spec labels for two buttons.** Work log's "Post update" becomes "Post an update", and Notes' "Post note" becomes "Add a note". The field labels stay. Why: §4.4 names those two actions.
- **Ruling: "Start a discussion" needs an assignee.** It's disabled with the tooltip "Assign someone first" while nobody is assigned. Why: the server answers `409 NOBODY_TO_DISCUSS`, and today's `DiscussButton` does the same.

- [ ] **Step 1: Write the failing tests:**
  - **Tabs per role:**
    - a manager sees Details, Approvals, Discussion, Work log, History and Notes, each a `tab` with `aria-controls`;
    - an employee and an executive see no Approvals;
    - `?panel=history` opens History; clicking a tab sets `?panel=`.
  - **Review Focus 4:** an employee opening `?milestone=m1&panel=approvals`, and anyone opening `?panel=nonsense`, sees Details selected, and no `/approvals` request is made.
  - **Details:**
    - objective, the criteria checklist and the skills (the existing `workflow.test.jsx` assertions);
    - priority and difficulty chips;
    - "Discovery" listed as a dependency with its state;
    - assignees with "Supporting" marked;
    - the open kickback and its review actions for the reviewer only;
    - an assignee's "Start" then "Ready for review" (`POST /milestones/m1/status`);
    - the blocked tooltip "Waiting on: Discovery";
    - "Claim" in a pull project;
    - "Kick back" opens the dialog;
    - "Start timer on …" only when `useLoggable` includes the milestone.
  - **Discussion:**
    - a `200` renders the thread (a `log` named "Messages") and leaves the crumb as the project's name;
    - a `404` shows "Start a discussion" to a manager, which posts to `/milestones/m1/discussion` and then shows the thread;
    - an employee gets "No discussion yet. Your manager can start one.".
  - **Work log:** "Post an update" with a percent posts and appears; an employee who may not post only reads.
  - **History:** kickbacks and events.
  - **Notes:** an assignee posts with "Add a note".
  - **Employee variant:** no "Edit" and no "⋯" in the panel header.
  - **Breadcrumbs:** `useBreadcrumb('Thread', { enabled: false })` leaves the page's crumb unchanged.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement. The Discussion thread sits in a 420 px-high box inside the panel (full height on the phone sheet).
- [ ] **Step 4:** Run `src/features/milestones src/features/messages src/features/home src/app`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Milestone panel: Details, Discussion, Work log, History and Notes tabs, kept in the URL"

### Task 8: Milestone panel: Approvals tab

**Files:**
- Create:
  - `frontend/src/features/milestones/panel/ApprovalsTab.jsx`;
  - `frontend/src/lib/personWeeks.js` (`groupByPersonWeek` moves here from `features/timesheets/ReviewTab.jsx`, which then imports it).
- Modify:
  - `frontend/src/features/milestones/MilestonePanel.jsx`: render Approvals with its count;
  - `frontend/src/api/queries.js`: an optional success override on `useApproveWeek` and `useRejectEntry`;
  - `frontend/src/features/timer/timerClock.js`: the `FLAG_LABEL` words and `weekSource`;
  - `frontend/src/features/timer/FlagChips.jsx`: `info` flags become neutral.
- Delete: `frontend/src/features/approvals/MilestonePendingHours.jsx`.
- Test:
  - `frontend/src/features/milestones/approvals.test.jsx` (new; takes over the intent of the `MilestonePendingHours` describe in `hours.test.jsx`, which is removed);
  - `frontend/src/features/timesheets/timesheets.test.jsx` (the flag words).

**Interfaces:**
- **Consumes:** `useApprovals({ milestone: id })`, `useApproveWeek`, `useRejectEntry`, `useBreakdown`, `BreakdownPanel`, `SourceChip`, `FlagChips` and `shareText`.
- **Produces:**
  - `groupByPersonWeek(items) → [{ key, user, week, items }]`, oldest week first;
  - `weekSource(entries) → 'tracked' | 'manual' | 'mixed' | null` (§7.2);
  - `useApproveWeek({ success } = {})` and `useRejectEntry({ success } = {})`: `success` replaces the toast, and `null` silences it. Timesheets keeps today's toasts;
  - `FLAG_LABEL`, using spec §4.4's words.

**Rulings for this task:**
- **Ruling: one flag, one name.** `FLAG_LABEL` changes app-wide to the spec's words ("Repeated hours", "After completion"). Why: a flag must not have two names on two pages.
- **Ruling: flag colours.** `FlagChips` shows `warn` flags in warning, `info` flags neutral, and `NO_PROOF` keeps its error colour. Why: the spec's rule names the two severities, and `NO_PROOF`'s colour is today's.
- **Ruling: toasts.**
  - The panel toasts "Approved <34>h for <Gia Rossi>" per approved person-week.
  - Request changes gives one toast, "Requested changes on <N> entries" (not in the spec).
  - The Request changes dialog is titled "Request changes", with a required field "Reason" (error "Tell the employee why", up to 1,000 characters) and the buttons "Cancel" and "Request changes".
  - Why: the spec fixes only the approval toast and "one reason".
- **Ruling: budget impact for several entries.** "View budget impact" opens a dialog titled "Budget impact":
  - one entry shows today's `BreakdownPanel`;
  - several show a table (Entry, Hours, Cost, and a Total row) from each `request_cost`;
  - above 20 selected, the button is disabled with the tooltip "Select 20 entries or fewer to see the budget impact".
  - Why: "up to 20 at a time" caps the request fan-out, and a partial total must never read as the whole.
- **Ruling: the person-week share.** Each group header ends with a Tracked, Manual or Mixed chip from `weekSource`, whose tooltip is `shareText`. Why: §7.2 uses the share on these groups.

- [ ] **Step 1: Write the failing tests:**
  - **Heading:** "7 entries · 58h awaiting approval" and "Milestone completion does not approve time entries."; at zero, "Nothing waiting".
  - **Groups:**
    - "Gia Rossi · Week of Oct 5, 2026 · 4 entries · 34h" comes before her Oct 12 week;
    - a group collapses and expands;
    - its select-all checkbox selects only its own entries;
    - a delegated group shows "Delegated from Morgan Manager".
  - **Rows:** the date, "8.5h", a "Manual" source chip, the note, or "Update: …" from the day's progress update, and the "⚠ Repeated hours" and "⚠ Over plan" flags with the server's message as their tooltips.
  - **Footer:** "Select entries to review" with all three buttons disabled; after selecting two, "2 selected · 17h".
  - **Approve:** selecting entries in two person-weeks and clicking "Approve 41h" sends two `POST /approvals/approve-week` requests. Each body holds only that week's selected `{id, expected_hours}`. The toast reads "Approved 17h for Gia Rossi".
  - **Stale:** the second request gets `409 STALE_ENTRY`. Its message shows in the panel, the first week's result stands, and the list refetches.
  - **Review Focus 5:** after the refetch drops the approved entries, the footer counts only the still-listed selected entries.
  - **Request changes:**
    - submitting with an empty reason shows "Tell the employee why" and sends nothing;
    - with "Missing notes", it sends one `POST /time-entries/{id}/reject` per selected entry, each with `{reason: 'Missing notes', expected_hours}`;
    - one toast follows.
  - **Budget impact:** one entry shows "Budget impact of approving"; two show their costs and the total; with 21 selected the button is disabled with its tooltip.
  - **Demo admin:** as `users.demoAdmin`, "Approve" and "Request changes" are enabled; approving is on the server's allowed list.
  - **Flags in Timesheets:** `timesheets.test.jsx` reads "Repeated hours" where it read "Same hours daily".
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3: Implement.**
  - Approve person-weeks one after another and collect failures.
  - After every refetch, prune the selection to ids still listed.
  - The footer is sticky inside the panel; on phones it's sticky at the bottom of the sheet.
- [ ] **Step 4:** Run `src/features/milestones src/features/timesheets src/features/timer src/features/projects src/lib`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Milestone panel: Approvals tab by person and week, one approve per person-week, request changes with one reason, budget impact"

### Task 9: Team

**Files:**
- Modify: `frontend/src/features/projects/TeamTab.jsx` (rewrite around today's `MemberDialog`, which is kept).
- Test: `frontend/src/features/projects/team.test.jsx` (new; the three team tests move here from `projects.test.jsx`).

**Interfaces:**
- **Consumes:** `DataTable`, `FilterBar`, `FootNote`, `projectView`, `MessageButton`, `PersonLink`, `SkillChips`, `useMembers`, `useRemoveMember`, `nyTodayIso`.

**Ruling: the remove confirmation is split in two.** Its title is "Remove <name> from <project>?" and its body "They're also taken off its milestones.". Why: `ConfirmDialog` has a title and a body.

- [ ] **Step 1: Write the failing tests:**
  - **Summary:** "5 team members" and "On this project · 115h planned per week" (the sum of the planned hours); "Add member" only for `manage`, opening today's dialog. The cap error still shows its message.
  - **Search:** "Search team members…" matches name, job title and skill.
  - **Table:**
    - ordered by last name;
    - each row shows the avatar, the name (a profile link for the project's manager), the job title, skill chips and "30h";
    - Message follows `/messages/contacts`: none for yourself, none for someone outside your contacts.
  - **"⋯":** only for `manage`, with "Edit planned hours" and "Remove from project". Remove confirms with the exact title and body, then calls `DELETE /projects/p1/members/u1`.
  - **Employee:** read-only, a "You" tag on their own row, no "Add member" and no "⋯".
  - **Executive:** read-only with Message.
  - **Footer:** "Planned hours are project allocations, not hours already worked." and "As of Oct 15, 2026".
  - **Empty:** "Nobody on this project yet", with "Add member" for a manager.
  - **Phones:** at 375 px rows are cards.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/projects`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Team tab: summary, search, and a table with Message and the manager's ⋯ menu"

### Task 10: Budget

**Files:**
- Modify:
  - `frontend/src/features/projects/BudgetTab.jsx` (rewrite);
  - `frontend/src/features/projects/MilestoneCostTable.jsx`: the bars move into the Approved cost cell, the Share column shows the percent, and the captions and footer are the spec's.
- Test: `frontend/src/features/projects/budget.test.jsx` (new; the five budget tests move here from `projects.test.jsx`).

**Interfaces:**
- **Consumes:** `KpiStrip`, `FootNote`, `projectView`, `BulletChart`, `PrintButton`, `budgetRows`, `useProjectSummary`, `useMilestoneCosts`, and `useApprovals({ project }, view.decides)`.

- [ ] **Step 1: Write the failing tests:**
  - **KPI strip:** "Budget", "Approved spend", "Available budget" (and "$12,000 over budget" when negative) and "Forecast at completion" (in the warning tone above the budget; assert a `data-tone` or class, not a colour).
  - **"Spend and forecast":**
    - the subtitle "8.7% approved spend · 24.5% forecast";
    - the legend "Approved spend" and "Forecast at completion";
    - the bullet chart's text alternative;
    - "Print / PDF";
    - the caption.
  - **Banner:** for a manager, "62h awaiting approval · Not yet included in spend." with "Review pending hours →" to `/timesheets?project=p1`.
  - **Cost by milestone:**
    - the columns, the Total row and "Export CSV";
    - the most expensive milestone's bar is full and the others are relative (kept from today's tests);
    - the bar sits in the Approved cost cell, and the Share cell reads the percent;
    - the caption and the footer, with "As of <date>".
  - **Employee:** no Approved hours or Pending hours columns (the API sends `hours_visible: false`), no banner and no `/approvals` request; the dollar figures are the same.
  - **Executive:** the hours columns and no banner.
  - **Never** any text matching `/rate/i` in the tab.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/projects`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Budget tab: KPI strip, spend and forecast, the pending banner, and cost by milestone with relative bars"

### Task 11: Hours

**Files:**
- Modify:
  - `frontend/src/features/projects/HoursTab.jsx` (rewrite);
  - `frontend/src/lib/format.js`: `formatWeekRange`.
- Test:
  - `frontend/src/features/projects/hours.test.jsx` (retarget);
  - `frontend/src/lib/format.test.js`.

**Interfaces:**
- **Consumes:** `KpiStrip`, `DataTable` (`totalRow`, `rowTone`), `FootNote`, `projectView`, `useAllocations`, `useMembers`, `useWeek`, `mondayOf`, `addDays`, `nyTodayIso`.
- **Produces:** `formatWeekRange(mondayIso)`: "Oct 12 – 18, 2026", "Sep 28 – Oct 4, 2026", or "Dec 28, 2026 – Jan 3, 2027".

**Rulings for this task:**
- **Ruling: who sees which variant.** `view.lead` gets the team table; otherwise `timesheet.use` gets "Your hours"; otherwise (executives, managers who don't track hours) the private message. Why: "Your hours" reads the viewer's own timesheet.
- **Ruling: the week picker.** The calendar button, named "Pick a week", opens a popover holding a native date field, "Any day in the week". Picking a date sets `?week=` to its Monday. Why: one plain control, no new date-picker setup.

- [ ] **Step 1: Write the failing tests**, frozen at 2026-10-15T16:00Z:
  - **Week bar:**
    - "Oct 12 – 18, 2026";
    - "Previous week" and "Next week" step `?week=`;
    - "This week" clears it;
    - picking 2026-10-07 sets `?week=2026-10-05`;
    - the right side reads "Project hours · This week" or "Project hours · Week of Oct 5", with "As of Oct 15, 2026".
  - **Manager:**
    - the KPI strip (Planned, Logged with its ⓘ, Approved, Pending);
    - a row for Ada:
      - "20h", "18h", "10h" and "8h";
      - "View entries" linking to `/timesheets?project=p1&user=u1`;
      - "—" for someone with nothing pending;
      - "4h above project plan" and a tinted row when logged is above planned;
    - the Total row;
    - the banner "8h awaiting approval this week · Pending hours do not contribute to approved project spend." with "Review this week's entries →";
    - the footer;
    - someone not on this project isn't listed (kept from today).
  - **Employee:**
    - "Your hours", fed by `GET /time-entries?week=2026-10-12` filtered to `project_id` p1;
    - a row per milestone with Logged, Approved, Pending and Needs revision (rejected hours);
    - "Open my timesheet" linking to `/timesheet?week=2026-10-12`;
    - no `/allocations` request.
  - **Executive:** "Team hours are private" and "Only the project's manager and admins see everyone's hours.".
  - **Empty:** "No hours this week" and "Hours appear as the team logs them.".
  - **`format.test.js`:** the three `formatWeekRange` forms.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/projects src/lib`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Hours tab: the week in the URL, the team table with totals and review links, and Your hours for employees"

### Task 12: Journeys, dark mode, docs and screenshots

**Files:**
- **E2E:**
  - `frontend/e2e/milestones.spec.js`, rewritten to the row and the panel:
    1. The manager uses "Add milestone".
    2. The row shows "Dependency: after Discovery" and Eli.
    3. Eli opens the row, and in the panel's Details clicks "Start" then "Ready for review". "Complete" isn't offered to him.
    4. The manager clicks "Complete" in the row's "⋯", and the row shows Completed.
  - `frontend/e2e/overtime.spec.js`: `consumed()` reads the Budget tab's "Approved spend" KPI.
  - `frontend/e2e/shell.spec.js`: the 375 px check adds every project tab (`?tab=overview|milestones|team|budget|hours`) and an open panel (`?tab=milestones&milestone=<first row>`) to the pages it measures.
- **Frontend:** `frontend/src/features/projects/darkMode.test.jsx` (new). Under `setPrefersDark(true)`, the Projects list and each project tab render their H1 and main heading with no console error.
- **Docs:**
  - README tour: the projects paragraph, and the images `projects.png`, `project-overview.png`, `milestones.png`, `milestone-panel.png` and `budget.png` with alt text;
  - `docs/project/USER_STORIES.md`: the Projects list, project header, panel and employee-variant stories;
  - `docs/project/LOGIC_WALKTHROUGH.md` §6: the risk words, "first reason" and the sort order;
  - `docs/project/DEMO_SCRIPT.md`: the project walk-through, approving from the panel, and the renamed flags;
  - `docs/project/TESTING.md`: counts from your own final runs;
  - `docs/project/API.md`: check Task 1's rows against the final code.
- **Screenshots:**
  - Into `docs/images/`, at 1440×900, light, as manager.demo:
    - `projects.png` (`/projects`);
    - `project-overview.png` (Apollo Data Migration, Overview);
    - `milestones.png` (Milestones, List);
    - `milestone-panel.png` (a milestone with pending entries, `&panel=approvals`);
    - `budget.png` (Budget).
  - One dark shot (Overview) and one at 375 px (the panel sheet) go into `C:\Users\mizo7\.claude\jobs\5a07e959\tmp`, not the repo.
  - Use the local stack: `python backend/v1/scripts/devserver.py --db overwatch_shots --reset --seed` on 3001 and `npm run dev` on 3000. Drive it with a throwaway Playwright script kept in that tmp folder.
  - Stop both servers afterwards.

- [ ] **Step 1:** Write `darkMode.test.jsx` and run it. Expect it to pass.
- [ ] **Step 2:** Update the three e2e specs, then run `npx playwright test` alone with 3000 and 3001 free. Expect all to pass, on desktop Chrome and the iPhone 13 profile.
- [ ] **Step 3:** Run the full frontend suite twice and lint, and the full backend suite. Use these counts in TESTING.
- [ ] **Step 4:** Update the docs.
- [ ] **Step 5:** Take the screenshots, view each one, then stop both servers and check that ports 3000 and 3001 are free.
- [ ] **Step 6: Commit:** "Project page: journeys, dark mode, docs and screenshots for phase 2"
