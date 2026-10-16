# Employee Now and Next Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show employees what to do now and next on My week:
- a Now & Next card;
- grouped, collapsible milestones;
- a skill-based "might come your way" prediction ordered by urgency and closeness;
- every My week section collapsible.

Archived milestones are hidden from employees everywhere.

**Architecture:**
- **Backend:**
  - adds fields to `GET /users/{id}/profile`;
  - adds a pure prediction rule next to auto-routing (`app/rules/routing.py`), with database glue in a new `app/features/users/coming_up.py`;
  - tightens archived visibility for employees on profile and milestone reads.
- **Frontend:**
  - pure grouping helpers;
  - a controlled `collapsible` mode on the shared `Section`;
  - a rebuilt right-hand column on My week.

**Tech Stack:** Python 3.12 Lambda backend (pytest), React 19, MUI 9, TanStack Query, Vitest + Testing Library + MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-employee-now-and-next-design.md`

## Global Constraints

- **Repo and branch:** `C:\Users\mizo7\OneDrive\Desktop\Projects\coding-workshop-participant`, branch `feat/frontend`. Work in place. Don't switch branches, push, deploy, or touch remotes.
- **Rules and permissions:**
  - No change to how auto-routing assigns work, to timesheet rules, or to managers', admins' or executives' screens and permissions.
  - The only exception is the employee archive rule in the spec.
- **API changes (additive):** profile `milestones[]` gains `display_status`, `waiting_on`, `progress_percent`, and the profile gains `coming_up`. That is the only additive change.
- **`coming_up` limit and order:** at most **5** items, ordered by:
  1. overdue first;
  2. then priority (critical, high, medium, low);
  3. then the share of required skills you have (higher first);
  4. then `have` (higher first);
  5. then `next_milestone_order_key`.
- **"New":** created in the last **7** days.
- **localStorage:** `overwatch.myweek.sections` holds JSON of the collapsed keys only (e.g. `{"done": true}`). Every read and write is in try/catch. Garbage or a blocked store means everything starts expanded.
- **Section keys:** `week`, `manager`, `nowNext`, `milestones`, `inProgress`, `upNext`, `review`, `coming`, `done`, `claim`.
- **Exact copy** (from the spec):
  - "Nothing in progress";
  - "Start <name> next";
  - "Nothing else assigned yet";
  - "See what might come your way";
  - "Heads-up: <name> (<Priority> priority) may come your way";
  - "Ready to start", "Starts <date>", "Waiting on <names>";
  - "Needs <skill>, which you have" and "Needs <a> and <b>, which you have";
  - "Ready now", "After <names>";
  - "Prediction", "New";
  - the group intro: "When the milestone before one of these is completed, auto-routing picks someone on the team with the right skills. It's a likely pick, not a promise."
- **Group names:** "In progress", "Up next", "With your manager", "Might come your way", "Completed". A group's button name is `"<Group>, <n> milestone(s)"`.
- **Tests:** use role and label queries, as the existing tests do. Frontend "today" is frozen with `vi.useFakeTimers({ toFake: ['Date'] })`.
- **Commits:**
  - No attribution of any kind: no Co-Authored-By, no "Generated with", no AI mention.
  - Commit locally only, with the exact message each task gives.
  - Stage only your files; never `git add -A` (`backend/health/` is untracked and stays out).
- **Test runs:** one suite at a time.
  - Frontend: always `--testTimeout=20000`. `cd frontend && npx vitest run <paths> --testTimeout=20000`, the full suite `npx vitest run --testTimeout=20000`, then `npm run lint`.
  - Backend: `cd backend/v1 && OVERWATCH_TEST_DB=overwatch_test_nn python -m pytest -o addopts="" -q <path>`.
  - Four date-dependent backend tests fail after 8 pm New York time. This is known and not yours.
  - Leave anything on ports 3000/3001 alone. The controller frees them before Task 6.
- **Style:** match the surrounding code: its comment density, naming and idioms.
- **Secrets:** never print or commit them.

## Review Focus

1. **An employee with no skills at all.** `coming_up` must be empty, with no group and no heads-up, never an error. Pinned in Task 2.
2. **An employee who left a project's team** (membership archived). That project must give no predictions. Pinned in Task 2.
3. **An archived predecessor.** It must neither block "ready" nor appear in `after` or `waiting_on`. Pinned in Tasks 1 and 2.
4. **Garbage JSON in `overwatch.myweek.sections`.** Everything must start expanded, with no crash. Pinned in Task 4.
5. **The Now milestone isn't loggable today** (project on hold). It still shows, with no Start timer button. Pinned in Task 5.

---

### Task 1: Profile milestone fields and the employee archive rule

**Files:**
- Modify: `backend/v1/app/features/users/profile.py`:
  - the `get_profile` milestone query and its output (around lines 108–160);
  - `whole_history`.
- Test: `backend/v1/tests/integration/test_profile.py`. Add tests, reusing that file's setup helpers.

**Interfaces:**
- **Produces:** each `milestones[]` item gains these fields, and Task 5 reads them:
  - `display_status`;
  - `waiting_on: [{id, name}]`, non-archived and not-completed predecessors, by name;
  - `progress_percent`.
- **Reuses:** `display_status` and `_latest_percent` from `app/features/milestones/service.py`. The "waiting" rule ignores archived predecessors, the same way `get_month` in `app/features/time/service.py` does.
- **Archive rule:** `whole_history = ctx.sees_all or (uid == ctx.user_id and ctx.role == "manager")`.

- [ ] **Step 1: Write failing tests:**
  - `test_profile_milestones_carry_display_status_waiting_on_and_progress`: a predecessor that isn't completed gives `display_status == "waiting"` and `waiting_on == [{"id": ..., "name": ...}]`. An update with 40% gives `progress_percent == 40`.
  - `test_archived_predecessor_does_not_make_a_milestone_wait` (Review Focus 3).
  - `test_employee_own_profile_hides_archived_projects_and_milestones`: an archived milestone, and a milestone of an archived project, are absent from `milestones` and `projects`.
  - `test_manager_own_profile_still_lists_archived` and `test_admin_sees_archived_on_an_employee_profile`.
- [ ] **Step 2:** Run the file. Expect the new tests to fail.
- [ ] **Step 3:** Implement. Batch the queries: one query for predecessors and one for percents per profile, with no per-milestone queries.
- [ ] **Step 4:** Run `tests/integration/test_profile.py`, then every file that reads the profile (`grep -rln "/profile" backend/v1/tests`). Expect all to pass.
- [ ] **Step 5: Commit:** "Profile: milestones carry display status, what they wait on and progress; employees no longer see archived work on their own profile"

### Task 2: "Might come your way" prediction

**Files:**
- Modify: `backend/v1/app/rules/routing.py`. Add the pure functions below, and don't touch the existing ones.
- Create: `backend/v1/app/features/users/coming_up.py`, with `coming_up_for(conn, user_id: str, today: date) -> list[dict]`.
- Modify: `backend/v1/app/features/users/profile.py`. Add `"coming_up": coming_up_for(conn, uid, _today()) if uid == ctx.user_id else []`.
- Test: `backend/v1/tests/unit/test_routing.py` (add, or create it if it's missing) and `backend/v1/tests/integration/test_coming_up.py` (new).

**Interfaces:**
- **Pure (`rules/routing.py`):**
  - `predictable(m: dict, person: dict) -> bool`: `ready_for_routing` without `dependencies_done`, plus `person_fits(person, m)`, plus `m["required_skills"]` not empty.
  - `coming_up_key(m: dict, person_skills, today: date) -> tuple`: the Global Constraints order. Overdue is `m["end_date"] < today`.
  - `predict_coming_up(person: dict, milestones: list[dict], *, today: date, limit: int = 5) -> list[dict]`. Returns `[{"milestone": m, "matched": set(skill ids)}]`, sorted and cut to `limit`.
  - **`person` shape:** the same as `plan_completion_routing`'s, i.e. `{skills, fits_projects, assigned_ids}`.
  - **Milestone shape:** the same as `_candidates` in `app/features/milestones/routing.py`, plus `created_at`.
- **Glue (`coming_up.py`):**
  - Projects where the user is an active, non-archived team member, the project is active, push mode and not archived.
  - Capacity per project: `fits_weekly_plan(other_planned_hours(conn, uid, project), planned_hours_per_week)`, the same as `_freed_people`.
  - Skills come from `skills_of`.
  - Predecessor names for `after`: non-archived, not completed, by name.
  - **Output items:** `{milestone: {id, name, start_date, end_date, priority}, project: {id, name}, ready, after, skills (matched names, sorted), match: {have, need}, is_new}`.
  - `is_new` means `created_at` is within 7 days of `today`.

- [ ] **Step 1: Write failing unit tests:**
  - `predictable` refuses each of these:
    - completed;
    - archived;
    - a pull project;
    - a project that isn't active;
    - has a primary;
    - you're already on it;
    - no required skills;
    - no matching skill;
    - not in `fits_projects`.
  - `predictable` accepts a not-ready milestone (predecessors open).
  - **Order:** an overdue low-priority milestone comes before a high-priority one that isn't overdue. High comes before medium. At equal priority, matching 2 of 2 skills comes before 1 of 2, and 1 of 1 comes before 1 of 2. Then the planned order applies.
  - `limit` cuts after sorting. Seven candidates give the 5 best.
- [ ] **Step 2: Write failing integration tests** in `test_coming_up.py`:
  - `test_ready_and_waiting_predictions_with_after_and_matched_skills`
  - `test_new_urgent_close_match_comes_first`: a milestone created today, high priority, needing 1 of 1 skills, comes before an older medium one needing 1 of 2. `is_new` is true only for the new one. Make the old one 8 days old, and one 6 days old for the boundary.
  - `test_no_skills_means_no_predictions` (Review Focus 1)
  - `test_left_team_project_gives_no_predictions` (Review Focus 2)
  - `test_archived_predecessor_is_not_in_after` (Review Focus 3)
  - `test_no_room_under_40h_gives_no_prediction_there`
  - `test_someone_elses_profile_has_empty_coming_up`, read by their manager.
- [ ] **Step 3:** Run both files. Expect them to fail.
- [ ] **Step 4:** Implement. Keep a constant number of queries per profile, plus at most one capacity check per project.
- [ ] **Step 5:** Run both files, the existing routing tests (`grep -rln "plan_completion_routing\|route_after_completion" backend/v1/tests`) and `test_profile.py`. Expect all to pass.
- [ ] **Step 6: Commit:** "Might come your way: skill-based prediction of unowned milestones, urgent and closest matches first"

### Task 3: Employees never read archived milestones

**Files:**
- Modify: whichever read paths in `backend/v1/app/features/milestones/` (and `projects` for the milestone list) still return archived milestones to employees.
- Test: `backend/v1/tests/integration/test_archived_for_employees.py` (new).

**Interfaces:**
- The rule applies to an employee only. An archived milestone, or any milestone of an archived project, is `404 NOT_FOUND` on these routes:
  - `GET /milestones/{id}`;
  - `GET /milestones/{id}/notes`;
  - `GET /milestones/{id}/updates`;
  - `GET /milestones/{id}/history`;
  - the write routes `POST /milestones/{id}/notes`, `POST /milestones/{id}/updates`, `POST /milestones/{id}/status` and `POST /milestones/{id}/kickback`.
- `GET /projects/{id}/milestones` leaves them out for an employee. This holds even with `include_archived` or a similar flag, if one exists.
- Managers, admins and executives behave as today.

- [ ] **Step 1: Write failing tests.** One test per route above, as the assigned employee. Archive the milestone with `DELETE /milestones/{id}` as its manager, then expect `404`. Repeat once with the project archived instead. Add `test_manager_still_reads_an_archived_milestone`.
- [ ] **Step 2:** Run the file. Note which tests fail. A test that passes already documents a route that was already safe; keep it.
- [ ] **Step 3:** Fix the failing routes with one shared guard: a helper used by every milestone read path, not a copy per route.
- [ ] **Step 4:** Run the new file and `tests/integration/test_milestones.py`, `test_milestone_workflow.py` and `test_archive.py`. Expect all to pass.
- [ ] **Step 5: Commit:** "Archived milestones are not found for employees on every milestone read and write"

### Task 4: Collapsible sections

**Files:**
- Modify: `frontend/src/features/dashboard/Section.jsx`: an optional controlled collapse.
- Create: `frontend/src/features/home/sectionState.js`, with `useCollapsedSections()`.
- Modify: `frontend/src/features/people/YourManagerCard.jsx`: it accepts the same optional `collapsible`, `open` and `onToggle` props, so My week can collapse it. PersonProfilePage keeps it as it is.
- Test: `frontend/src/features/home/sectionState.test.js` and `frontend/src/features/dashboard/section.test.jsx` (new, or extend an existing Section test).

**Interfaces:**
- `Section({ question, hint, children, collapsible = false, open = true, onToggle, count })`:
  - When `collapsible` is set, the heading holds a button. Its name is `question`, or `"<question>, <count> milestone(s)"` when `count` is given. It carries `aria-expanded` and `aria-controls`, and calls `onToggle()`.
  - When it is collapsed, the children aren't rendered, and the header and hint stay.
  - Without `collapsible`, it renders exactly as today.
- `useCollapsedSections() -> { isOpen(key): boolean, toggle(key): void }`. It is backed by `overwatch.myweek.sections` (collapsed keys only), defaults open, and is safe against a blocked or garbage store.

- [ ] **Step 1: Write failing tests:**
  - **The hook:** keys start open; `toggle` closes and reopens; the state survives a remount (it reads storage); garbage JSON gives all open (Review Focus 4); `setItem` throwing still toggles in memory.
  - **Section:**
    - the collapsible button has `aria-expanded="true"`, and clicking it calls `onToggle`;
    - with `open={false}` the children are gone, and the heading and count stay;
    - a non-collapsible Section has no button, as on the dashboard.
- [ ] **Step 2:** Run both files. Expect them to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/features/home src/features/dashboard src/features/people`, then lint. Expect both to pass.
- [ ] **Step 5: Commit:** "Sections can collapse: a controlled collapsible mode on Section, remembered per section on My week"

### Task 5: My week: Now & Next and grouped milestones

**Files:**
- Create: `frontend/src/features/home/myWork.js` (pure helpers):
  - `groupMilestones(milestones, today) -> { inProgress, upNext, review, done }`;
  - `upNextLabel(m, today) -> string`;
  - `nowAndNext(groups, comingUp) -> { now, next, headsUp }`;
  - `skillsSentence(names) -> string`.
- Create: `frontend/src/features/home/NowNextCard.jsx` and `frontend/src/features/home/MyMilestoneGroups.jsx`.
- Modify: `frontend/src/features/home/MyWeekPage.jsx`:
  - the right column gets NowNextCard, then MyMilestoneGroups, replacing `MyMilestones`;
  - every section is collapsible through `useCollapsedSections`, using the keys in Global Constraints;
  - `Claimable` and `ThisWeek` gain the collapse too.
- Test: `frontend/src/features/home/myWork.test.js` (new) and `frontend/src/features/home/home.test.jsx` (extend).

**Interfaces:**
- **Consumes:** profile fields from Tasks 1–2 and `Section` and `useCollapsedSections` from Task 4.
- **Group contents and order:** exactly the spec's table. Only milestones with a non-null `role` belong to groups (today's rule). Archived ones are already left out by the server.
- **`upNextLabel`:**
  - "Waiting on <names>" when `waiting_on` isn't empty (names joined with ", ");
  - otherwise "Starts <formatDate(start)>" when the start date is after today;
  - otherwise "Ready to start".
- **`nowAndNext`:**
  - `now` is `inProgress[0]`, or null;
  - `next` is `upNext[0]`, or null;
  - `headsUp` is `comingUp[0]` when it's overdue or `critical`/`high` priority, else null.
- **`skillsSentence`:** `['A']` gives "Needs A, which you have"; `['A','B']` gives "Needs A and B, which you have"; three names give "Needs A, B and C, which you have".

- [ ] **Step 1: Write failing tests:**
  - **`myWork.test.js`:**
    - each group's contents and order for a mixed fixture: overdue first in In progress; ready, then future, then waiting in Up next; newest first in Completed;
    - each `upNextLabel` branch;
    - `nowAndNext` with and without in-progress items;
    - `headsUp` for high, critical and overdue, and none for medium;
    - `skillsSentence` for 1, 2 and 3 names.
  - **`home.test.jsx`:**
    - `the Now & Next card shows the current milestone and the next one`;
    - `with nothing in progress it says so and suggests the next ready milestone`;
    - `with nothing up next it says Nothing else assigned yet`;
    - `See what might come your way scrolls to the predictions`;
    - `a heads-up names an urgent prediction and marks it New`;
    - `groups show counts and their milestones; empty groups are hidden`;
    - `Might come your way rows say which skills you have, Ready now or After …, and Prediction`;
    - `every section starts expanded, collapses on click and stays collapsed after a reload`;
    - `the Now milestone on an on-hold project shows without Start timer` (Review Focus 5).
- [ ] **Step 2:** Run both files. Expect them to fail.
- [ ] **Step 3:** Implement. Reuse `MilestoneItem`, the chips, `TimerButton` and the `useLoggable` logic from `MyWeekPage.jsx`, moving them as needed rather than copying them.
- [ ] **Step 4:** Run `src/features/home src/features/people src/features/dashboard`, then the full suite, then lint. Expect all to pass with clean output.
- [ ] **Step 5: Commit:** "My week: Now & Next card and grouped milestones with what might come your way; every section collapses"

### Task 6: End-to-end, docs and screenshot

**Files:**
- Modify: `frontend/e2e/milestones.spec.js`, the journey that signs in as `employee.demo`. On My week:
  - expect the Now & Next card's "Now" row;
  - collapse "Completed" (or the first group present) and expect its rows gone;
  - reload, and expect it still collapsed;
  - expand it again.
- **Docs:**
  - `README.md` (My week);
  - `docs/project/API.md` (the profile fields, `coming_up`, the employee archive rule and the 404s);
  - `docs/project/LOGIC_WALKTHROUGH.md` (a "Now and next" section with the prediction rule and its order);
  - `docs/project/USER_STORIES.md`;
  - the test counts in README, `docs/project/TESTING.md` and `docs/project/DEMO_SCRIPT.md`.
- **Screenshot:** retake My week as employee.demo at 1440×900 into `docs/images/` (reuse the existing My week image's name if there is one, else `my-week.png`). Use the local stack `python backend/v1/scripts/devserver.py --db overwatch_shots --reset --seed` (port 3001) and `npm run dev` (port 3000), with a Playwright script in `C:\Users\mizo7\.claude\jobs\5a07e959\tmp`. Stop both servers afterwards and confirm the ports are free.

- [ ] **Step 1:** Extend the journey. Run `cd frontend && npx playwright test` alone, with ports 3000/3001 free. Expect every test to pass.
- [ ] **Step 2:** Update the docs, with counts from your own final full runs.
- [ ] **Step 3:** Take the screenshot, and view it before committing.
- [ ] **Step 4: Commit:** "Now and next: end-to-end journey, docs and screenshot"
