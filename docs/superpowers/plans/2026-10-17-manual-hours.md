# Manual Hours ("Log hours manually") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Log hours manually** button beside every Start timer opens a pop-up (day, hours, why not the timer, work note) that sends hours as a pending manual request. Managers decide each request one by one in a new **Manual hours** tab on Timesheets, apart from To review and week approval.

**Architecture:**
- **Data:** a manual request is an ordinary `time_entries` row with two new columns, `manual_reason` and `manual_details` (migration 016). The 24 h day, the 40 h week, budgets, flags and HR then count it with no new code.
- **Backend:** pure rules in `app/rules/manual_hours.py`. The service `app/features/time/manual.py` reuses the grid's cell checks, `lock_person`, `write_entry` and the approval code (`_load_entry`, `_decidable`, `_apply_decision`). The server enforces the separate queue (`GET /approvals` leaves these out; week approval, single approve/reject, the grid and Start timer refuse them).
- **Frontend:** one `LogTimeActions` beside each `TimerButton`, one `ManualHoursDialog` for submit, edit and resubmit, a read-only `ManualCell` in the timesheet, and a `ManualTab` on Timesheets. Hooks live in `api/queries.js`.

**Tech Stack:**
- Frontend: React 19, MUI 9, TanStack Query 5, react-router 7.
- Tests: Vitest + Testing Library + MSW, and Playwright.
- Backend: Python 3.12 Lambda, pytest on PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-17-manual-hours-design.md` (approved; all of it binding: O1–O5, decisions 1–20, §4–§13).

## Global Constraints

- **Repo and branch:** repo `C:\Users\mizo7\OneDrive\Desktop\Projects\coding-workshop-participant`, branch `feat/frontend`. Work in place. Don't switch branches, push, deploy or touch remotes.
- **The owner's servers:** the owner previews from this tree on ports 5173 and 3060. Never start, stop or call those. Any browser check uses your own stack: `python backend/v1/scripts/devserver.py --db overwatch_shots --reset --seed` on 3001 and `npm run dev` on 3000. Stop both when done.
- **No permission changes beyond the spec (O5, decision 12):**
  - `app/authz.py`, `app/access.js` and every existing check stay as they are.
  - Reviewers are the project's manager, its active delegate and admins, decided through `_load_entry` / `APPROVER_SQL`. Nobody decides their own hours. Executives get no list.
  - The only new frontend rule is `can(user, 'hours.manual')`, the same rule as `timesheet.use`, listed in `DEMO_BLOCKED`.
- **Every existing rule holds:** the 24 h day, overtime past 40 h, closed work, assignment, timer locks, proof of work, the stale-entry guard, and a reason on every rejection. Typing hours into the grid works exactly as today, with no reason asked (O3).
- **Privacy:** an employee session never requests another person's data. Employees never call `/manual-hours` with `GET`, `/approvals` or `/allocations`. `PUT` and `DELETE /manual-hours/{id}` answer `404` for anyone but the owner.
- **Dates:** the window, the dialog's days and "today" are New York dates: `ny_date(now)` on the server, `nyTodayIso()` and `mondayOfIso()` on the screen. Days in the copy read "Fri 16 Oct" (`service.short_day`, `formatDayShort`). Hours read "2.5h" (`formatHours`, `hours_text`).
- **Exact copy, verbatim from the spec.** `<…>` marks data.
  - **Button:** "Log hours manually", named "Log hours manually on <Schema Mapping>".
  - **Pop-up:**
    - titles "Log hours manually", "Edit manual hours", "Fix and resubmit"; under the title "<Schema Mapping> · <Apollo Data Migration>";
    - Day: "Today, <Thu 15 Oct>", "Yesterday, <Wed 14 Oct>", then "<Tue 13 Oct>"… (8 days); the server's "Pick today or one of the 7 days before";
    - Hours: "Between 0.25 and 24 hours" · "Use quarter hours: .25, .5 or .75";
    - the legend "Why not the timer?", the reasons "Forgot to start the timer", "Worked away from the computer", "Meeting or call", "Timer problem", "Other", and "Pick a reason";
    - "Details (required for Other)" · "Say what happened (at least 10 characters)";
    - "Work note" with "What you worked on · <0>/500" · "At least 10 characters";
    - hints "Already logged that day: <6h> · that week: <38h>" and "This takes your week over 40h, so it goes to your manager as overtime.";
    - the footer "Your manager reviews manual hours one by one. They count toward the budget once approved.";
    - buttons "Cancel", "Send for review", "Sending…", "Save changes", "Resubmit";
    - the toast "Sent <2h> on <Schema Mapping> (<Fri 16 Oct>) for review".
  - **Timesheet:**
    - the chip "Manual request"; status words "Pending", "Approved", "Needs revision", plus "Overtime";
    - actions "Edit", "Fix and resubmit", "Withdraw";
    - the confirm "Withdraw these hours?" with "<2h> on <Schema Mapping>, <Fri 16 Oct>, are removed and your manager won't see them.";
    - refusals "<Fri 16 Oct> already has <3h> on <Schema Mapping>. Change them on your timesheet.", "<Fri 16 Oct> has timer hours on <Schema Mapping>. Use Request a change to add time.", "Your timer on <Schema Mapping> is running. Stop it first.";
    - Start timer's tooltip "You logged today's hours here manually. Edit that request instead."
  - **Manual hours list:**
    - the tab "Manual hours <N>" (`?tab=manual`), "Show everyone";
    - the intro "Hours logged without the timer. Each needs its own decision; Approve week never includes them.";
    - columns "Person", "Date", "Milestone", "Hours", "Why not the timer", "Work note", "Flags"; flag words "Overtime", "Edited after a decision", "Delegated from <Morgan Manager>";
    - actions "Budget impact", "Request changes", "Approve <2h>";
    - toasts "Approved <2h> for <Ben Okafor>" and "Sent back to <Ben Okafor>";
    - the dialog "Request changes" with "Reason" (up to 1000 characters), "<Ben> sees your reason on their timesheet and can fix and resubmit." and "Tell the employee why";
    - empty: "No manual hours waiting" with "Hours your team logs without the timer show up here.";
    - To review's caption "· <2h> more in Manual hours";
    - the milestone Approvals tab's "<2> manual-hours requests on this milestone are reviewed separately." with the link "Review manual hours".
  - **Server:**
    - `MANUAL_REVIEW_ONLY`: "Manual hours are reviewed one at a time in Timesheets → Manual hours.";
    - bells: "<Ben> logged <2h> on <Schema Mapping> (<Fri 16 Oct>) without the timer: <Forgot to start the timer>", "<Ben> resubmitted <2.5h> of manual hours on <Schema Mapping> (<Fri 16 Oct>)" (hint "Review it in Manual hours"), "Your <2h> of manual hours on <Schema Mapping> (<Fri 16 Oct>) need changes: <reason>", "<Kim> approved your <2h> of manual hours on <Schema Mapping> (<Fri 16 Oct>)".
- **Phones, dark mode, accessibility** (spec §11, redesign §8):
  - no horizontal page scroll at 375 px in the dialog or the tab; below `md` the list is stacked cards with the actions in a 44 px row;
  - theme colours only (no hex in components); status is never colour alone;
  - the dialog is labelled by its title, focus starts on Hours, the reasons are a radio group under the legend, errors use helper text and `aria-invalid`, Esc closes unless sending;
  - a control's name starts with its visible text (WCAG 2.5.3, phase 3's rule): "Approve 2h, Ben Okafor, Wed 14 Oct", "Edit manual hours, Schema Mapping, Wed Oct 14", "Manual request: Forgot to start the timer";
  - `ManualHoursButton` uses `TimerButton`'s target rule: 44 px with `touch`, otherwise 44 px below `md`.
- **Testing scope (the owner asked for it to be tested too; nothing here is optional):**
  - **Backend**, unit and integration: every rule, guard, permission and notification in the spec (Tasks 1-2).
  - **Frontend:**
    - the pop-up's validation (Task 3);
    - every button placement (Task 4);
    - the read-only manual cell, and edit, withdraw and resubmit (Task 5);
    - the Manual hours tab's actions and stale errors, and the badge count (Task 6);
    - privacy, by recorded requests (Tasks 4-6).
  - **End to end** on desktop Chrome and the iPhone 13 profile (Task 7). The whole loop runs: from My week to Approved, the request-changes path, and week approval refused.
  - **A hands-on walkthrough** on your own stack, reported as a pass/fail list (Task 8).
- **Tests:**
  - **Tests first:** run each new test before the code. Keep the failing output (the RED evidence) for the task's review.
  - Role and label queries only. Every request is answered by MSW (`onUnhandledRequest: 'error'`).
  - Freeze dates with `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(…)`, then `vi.useRealTimers()` in `afterEach`. The default instant is `2026-10-15T16:00:00Z` (Thursday Oct 15 in New York; the week of Oct 12).
  - Backend tests use the real New York today (`TODAY = ny_date(now)`, as `test_timer_workflow.py` does) with projects around it, and a `clock` fixture that monkeypatches `manual._now` (and `timers._now` where timers run).
  - Phones: `setViewport(375)`. Dark mode: `setPrefersDark(true)`. Both come from `src/test/setup.js`.
  - A retargeted test keeps its intent.
- **Commands:** one suite at a time.
  - **Frontend:** `cd frontend && npx vitest run <paths> --testTimeout=20000`, then the full suite (`npx vitest run --testTimeout=20000`), then `npm run lint`.
  - **Backend:** `cd backend/v1 && OVERWATCH_TEST_DB=overwatch_test_mh python -m pytest -o addopts="" -q <paths>`, then the same without paths.
  - **End to end:** `cd frontend && npx playwright test`, run alone, with ports 3000 and 3001 free (it starts its own servers).
- **Commits:**
  - Use the exact messages.
  - No attribution of any kind: no `Co-Authored-By`, no "Generated with".
  - Stage only your own files, by path. Never `git add -A` or `git add .`. `backend/health/` stays untracked.

## Review Focus

1. **New York's date at the window's edges.** At 22:30 on a Thursday in New York the UTC date is already Friday.
   - The server takes Thursday as today: Thursday and the 7 days before are accepted; the Wednesday before that and Friday are `400 OUTSIDE_WINDOW`.
   - The dialog's first day reads "Today, Thu 15 Oct", and that's what it sends.
   - Pinned in Tasks 1 and 3.
2. **Hours typed the way people type them:** " 2.5 ", "2.50", "2,5", "1e1", "0.2", "2.1", "24.25", `true`.
   - The server accepts " 2.5 " and "2.50" as 2.5h. "2,5", "1e1" and `true` are `invalid_number`; "0.2" is `min:0.25`; "24.25" is `max:24`; "2.1" is `quarter`.
   - The dialog shows the matching message and keeps Send disabled.
   - Pinned in Tasks 1 and 3.
3. **Whitespace-only text.**
   - A note of ten spaces is `note: min_length:10`.
   - "Other" with details of spaces is `details: min_length:10`.
   - Details of spaces on a fixed reason are stored as `NULL` (never `''`), so the chip's tooltip shows the reason alone.
   - Pinned in Tasks 1, 3 and 5.
4. **A reviewer's old tab:**
   - **the employee changed only the note since:** `409 STALE_ENTRY`, still pending;
   - **the entry was withdrawn or decided elsewhere since:** `404` or `400 NOT_PENDING`;
   - **an old To review tab's Approve week includes a manual id:** `409 MANUAL_REVIEW_ONLY`, and nothing is approved.
   - On screen the error stays on its row. When the refetch drops the row, the error moves to the top of the list, titled "<Person> · <day>".
   - Pinned in Tasks 2 and 6.
5. **The grid as a back door:**
   - typing kept in `sessionStorage` from before the cell became a manual request, or an old tab's `PUT` with that cell changed;
   - the cell is never restored, never in "Submit N changes" and never in the `PUT`;
   - the server answers `409 MANUAL_HOURS_LOCKED`, and an unchanged re-send of a rejected manual cell stays rejected;
   - Pinned in Tasks 2 and 5.

---

### Task 1: Migration, rules and the employee's API (submit, edit, withdraw)

**Files:**
- Create:
  - `backend/v1/migrations/016_manual_hours.sql`: spec §4's SQL, verbatim;
  - `backend/v1/app/rules/manual_hours.py`;
  - `backend/v1/app/features/time/manual.py` (`submit`, `edit`, `withdraw`).
- Modify:
  - `backend/v1/app/features/time/service.py`: `_entry_view` (lines 87-95), `write_entry` (510-555), `_check_daily_cap` (422-436);
  - `backend/v1/app/features/time/routes.py`: three routes;
  - `backend/v1/app/public_demo.py`: three `DENIED` rows;
  - `docs/project/API.md`: a "Manual hours" subsection after "Change requests on timer hours" (line 437);
  - `docs/project/DATA_MODEL.md`: the two columns under "Time and money".
- Test:
  - `backend/v1/tests/unit/test_rules_manual_hours.py` (new);
  - `backend/v1/tests/integration/test_manual_hours.py` (new; model its `world`, `call`, `cell`, `save` and `bell` helpers on `test_timer_workflow.py`).

**Interfaces:**
- **Consumes:**
  - `service._validate_cell`, `cell_state`, `existing_entry`, `lock_person`, `write_entry`, `_require_timesheet`, `_sync_stored_flags`, `_closed_reason`, `week_start`, `short_day`, `hours_text`, `_live`, `_overtime`, `_name`, `NUMBER_TEXT`;
  - `changes._text`;
  - `timers._running`;
  - `ny_date`, `NOTE_MIN`, `NOTE_MAX`.
- **Produces (rules, pure):**
  - `REASONS: dict[str, str]`, in this order: `forgot_timer` "Forgot to start the timer", `away_from_computer` "Worked away from the computer", `meeting_or_call` "Meeting or call", `timer_problem` "Timer problem", `other` "Other";
  - `WINDOW_DAYS = 7`, `DETAILS_MIN, DETAILS_MAX = 10, 500`;
  - `in_window(day: date, today: date) -> bool` (`today − 7 ≤ day ≤ today`);
  - `is_quarter(hours: Decimal) -> bool`;
  - `clean_details(value: str | None) -> str | None` (trimmed; empty gives `None`);
  - `details_error(reason: str, details: str | None) -> str | None`, returning `"min_length:10"`, `"max_length:500"` or `None`.
- **Produces (service):**
  - `_entry_view(e, …)` adds `"updated_at": e["updated_at"]` and `"manual": None | {"reason": e["manual_reason"], "details": e["manual_details"]}`. This reaches the week, month and approval views.
  - `write_entry(…, manual: tuple[str, str | None] | None = None) -> str`. With `manual`, the `INSERT` writes both columns and the `UPDATE` sets both. With `None`, neither statement touches them.
  - `_check_daily_cap(conn, ctx, cells, *, with_drafts: bool = False) -> None`. With `with_drafts`, each day's total also adds `drafts_by_cell(conn, ctx.user_id, d, end=d)` hours of cells not in the save.
  - `manual._now() -> datetime` (UTC; tests monkeypatch it).
  - `manual.submit(conn, ctx, body) -> {"entry": <entry view>, "week_start": date}`.
  - `manual.edit(conn, ctx, entry_id, body) -> {"entry": <entry view>}`.
  - `manual.withdraw(conn, ctx, entry_id) -> {"withdrawn": entry_id}`.
  - Routes: `POST /manual-hours` → `201`; `PUT /manual-hours/{id}` → `200`; `DELETE /manual-hours/{id}` → `200`.
  - `public_demo.DENIED` gains `("POST", "/manual-hours")`, `("PUT", "/manual-hours/{id}")` and `("DELETE", "/manual-hours/{id}")`: "logging, editing or withdrawing the demo account's own manual hours (it keeps no timesheet)".
- **Validation (`_fields(body) -> (hours, reason, details, note)`; spec §9 codes):**
  - `hours`: `NUMBER_TEXT` after `strip()`, and not a bool, else `invalid_number` ("Enter the hours as a number, like 2.5"). Then `min:0.25` / `max:24` ("Between 0.25 and 24 hours"). Then `quarter` ("Use quarter hours: .25, .5 or .75").
  - `reason`: `invalid` ("Pick a reason") when not a `REASONS` key.
  - `details`: `changes._text(…, "details", None, 500)`, then `clean_details`, then `details_error` ("Say what happened (at least 10 characters)").
  - `note`: `changes._text(…, "note", NOTE_MIN, NOTE_MAX)`. Missing or blank gives `min_length:10`.
  - `require()` covers only `milestone_id`, `work_date`, `hours` and `reason` (submit) or `hours` and `reason` (edit), so a blank note reaches its own check.
- **Submit, in order:**
  1. `_require_timesheet`, then the fields.
  2. `OUTSIDE_WINDOW` unless `in_window(day, ny_date(_now()))`, with "Pick today or one of the 7 days before".
  3. `_validate_cell` with `week_start(day)`: `NOT_ASSIGNED`, `PROJECT_NOT_OPEN`, `OUT_OF_PROJECT_RANGE`.
  4. A completed milestone: `409 PROJECT_NOT_OPEN`, "<Schema Mapping> is completed, so its hours can't be logged manually".
  5. In one transaction under `lock_person`:
     - `TIMER_RUNNING`: `timers._running` is on this milestone with this `work_date`;
     - `TIMER_HOURS_LOCKED`: `cell_state(...)["locked"]`;
     - `CELL_HAS_HOURS` with `{"entry_id"}`: any existing entry;
     - `_check_daily_cap(…, with_drafts=True)`;
     - `write_entry(…, existing=None, tracked=Decimal(0), needs_note=False, manual=(reason, details))`;
     - `_sync_stored_flags`.
  6. A `DatabaseError` with code 23505 becomes `CELL_HAS_HOURS`, as in `changes.create`.
- **Edit:**
  - **Load:** `404` unless the entry's `user_id` is the caller and `manual_reason` is set. Inside the transaction, re-read it with `SELECT … FOR UPDATE` after `lock_person`.
  - **Checks:** `_validate_cell` on the entry's milestone and day, then `409 PROJECT_NOT_OPEN` when `cell["closed"]` or the milestone is completed. No window check.
  - **NO_CHANGE:** `400 NO_CHANGE` ("Nothing changed") when hours, reason, details and note all equal the stored ones and the status is `pending` or `approved`.
  - **Write:** `_check_daily_cap(…, with_drafts=True)`, then `write_entry(…, existing, tracked=Decimal(0), manual=…)`; it sets `edited_after_decision` itself. Then `_sync_stored_flags`.
- **Withdraw:**
  - **Load and checks:** the same `404`, then `409 PROJECT_NOT_OPEN` for closed work or a completed milestone.
  - **Delete:** `DELETE … WHERE id = :i AND status = 'pending' AND NOT edited_after_decision RETURNING id`. No row gives `400 CANNOT_CLEAR_DECIDED`: "These hours were already reviewed, so they can't be withdrawn. Edit them instead."
  - **After:** audit `withdraw_manual`, then `_sync_stored_flags`.

**Rulings for this task:**
- **Ruling: `_check_daily_cap` gains `with_drafts=False`, and only manual submit and edit pass `True`.** Why: decision 20 sits in the manual-hours rules table (§8). The grid already pre-fills drafts into their own cells, and §13 leaves timers unchanged.
- **Ruling: the refusals run `TIMER_RUNNING`, then `TIMER_HOURS_LOCKED`, then `CELL_HAS_HOURS`. "Running" means a timer on that milestone and day.** Why: the most specific fix wins, and a timer elsewhere must not block (decision 10).
- **Ruling: edit and withdraw re-read the entry `FOR UPDATE` inside the lock.** Why: decisions don't take `lock_person`. A decision landing mid-edit must not be overwritten without its "edited after a decision" mark.
- **Ruling: `NO_CHANGE` also covers an approved entry sent back unchanged. An unchanged rejected one is a resubmission.** Why: re-sending approved hours unchanged would only undo the approval (the grid's own rule, `save_week` line 594), while the grid resubmits a rejected cell unchanged.
- **Ruling: `PUT` and `DELETE` answer `404` for any id that isn't the caller's own manual entry,** their own typed entries included. Why: one answer leaks nothing, and typed hours change in the grid.

- [ ] **Step 1: Write the failing tests.**
  - **`test_rules_manual_hours.py`:**
    - `test_reason_codes_and_labels`: `list(REASONS.items())` equals the five pairs above, in order.
    - `test_the_window_is_today_and_the_seven_days_before`, with today 2026-10-15: `in_window` is true for 10-15 and 10-08, and false for 10-07 and 10-16.
    - `test_quarter_hours`: true for 0.25, 2.5, 2.50 and 24; false for 0.3, 2.1 and 0.2.
    - `test_details`:
      - `clean_details("   ") is None`; `clean_details(" Lost wifi ") == "Lost wifi"`;
      - `details_error("other", None) == details_error("other", "Short") == "min_length:10"`;
      - `details_error("other", "x" * 10) is None`; `details_error("forgot_timer", None) is None`;
      - `details_error("forgot_timer", "x" * 501) == "max_length:500"`.
  - **`test_manual_hours.py`.** The world: Morgan Reyes manages Apollo (MONDAY ± 60 days). Eli Park is assigned to Schema Mapping and Cutover. `NOTE = "Mapped the legacy address fields"`.
    - `test_submit_saves_pending_manual_hours`:
      - `POST` for `TODAY − 1`, `"2.5"`, `forgot_timer`, `details: None` gives `201`;
      - the entry has `status "pending"`, `hours 2.5`, `source "manual"`, `tracked_hours 0`, `needs_note False`, `manual == {"reason": "forgot_timer", "details": None}` and an `updated_at`;
      - `week_start == week_start(TODAY − 1)`.
    - `test_views_carry_manual_and_updated_at`: in `GET /time-entries` and `/time-entries/calendar`, the manual entry has `manual` and `updated_at`, and a typed entry has `manual None`.
    - `test_field_validation` (parametrised; **Review Focus 2 and 3**). Each case expects `body["error"]["details"]`:
      - hours: "abc", "1e1", "2,5" and `True` → `{"hours": "invalid_number"}`; "0" and "0.2" → `{"hours": "min:0.25"}`; "24.25" → `{"hours": "max:24"}`; "2.1" → `{"hours": "quarter"}`;
      - reason: "nap" → `{"reason": "invalid"}`;
      - details: `other` with `None` or "   " → `{"details": "min_length:10"}`; 501 characters → `{"details": "max_length:500"}`;
      - note: `None` or ten spaces → `{"note": "min_length:10"}`; 501 characters → `{"note": "max_length:500"}`;
      - accepted (`201`, on separate cells): " 2.5 " and "2.50", each stored as 2.5; `forgot_timer` with details "   " stores `manual_details IS NULL`.
    - `test_window`: `TODAY − 7` gives `201`; `TODAY − 8` and `TODAY + 1` give `400 OUTSIDE_WINDOW` with "Pick today or one of the 7 days before".
    - `test_new_york_today_decides_the_window` (**Review Focus 1**): with the clock at `ny(TODAY, 23, 30)` (UTC already the next day), `TODAY` gives `201`, `TODAY − 7` gives `201`, and `TODAY + 1` gives `OUTSIDE_WINDOW`.
    - `test_eligibility`:
      - another person's milestone → `400 NOT_ASSIGNED`;
      - the project on hold, completed or archived, or the milestone archived or completed → `409 PROJECT_NOT_OPEN`;
      - a project starting `TODAY − 2`, with a submission for `TODAY − 3` → `400 OUT_OF_PROJECT_RANGE`;
      - a manager without "Tracks own hours" → `403 TIMESHEET_DISABLED`.
    - `test_only_an_empty_cell`:
      - a typed pending 3h, and also a rejected typed entry → `409 CELL_HAS_HOURS`, with the message "<short_day> already has 3h on Schema Mapping. Change them on your timesheet." and `details == {"entry_id": <id>}`;
      - a stopped, unsubmitted 1.5h timer on the cell → `409 TIMER_HOURS_LOCKED`, "<day> has timer hours on Schema Mapping. Use Request a change to add time.";
      - a running timer on Schema Mapping today, submitting for `TODAY` → `409 TIMER_RUNNING`, "Your timer on Schema Mapping is running. Stop it first.";
      - with that timer running, Schema Mapping on `TODAY − 1` → `201`; with the timer on Cutover, Schema Mapping today → `201`.
    - `test_24h_counts_timer_drafts`:
      - set up `TODAY − 1` with a typed pending 10h on Cutover and a stopped, unsubmitted 12h timer row on a third milestone;
      - manual "2.5" on Schema Mapping → `400 DAY_OVER_24H`; "2" → `201`.
    - `test_over_40_label_and_one_alert`:
      - set up 39h of typed pending hours this week on Cutover (`log_entry`, Mon–Fri 8, 8, 8, 8, 7), then manual 2h on Schema Mapping `TODAY`;
      - the entry has `over_40 True` and the label "Pending (Overtime requested from Eli Park)", and there's exactly one `OVER_40H` notification;
      - a second manual entry on a third milestone `TODAY` leaves it at one.
    - `test_edit_while_pending_stays_pending`:
      - `PUT` with `{"hours": "3", "reason": "meeting_or_call", "details": "Client call ran long", "note": NOTE}` → `200`, `status "pending"`, `edited_after_decision False`;
      - the same body again → `400 NO_CHANGE`.
    - `test_resubmit_after_a_rejection`: with the entry rejected through SQL (status, reason, `decided_by`, `decided_at`), `PUT` gives `pending`, `edited_after_decision True` and `rejection_reason None`. An unchanged `PUT` of a rejected entry also resubmits.
    - `test_changing_approved_manual_hours_sends_them_back`: with the entry approved through SQL, `PUT` with hours "3" gives `pending` and `edited_after_decision True`. An unchanged `PUT` on an approved entry gives `NO_CHANGE`.
    - `test_edit_keeps_its_day_outside_the_window`: an entry for `TODAY − 7` is rejected; with the clock at `TODAY + 3`, `PUT` gives `200`.
    - `test_withdraw`:
      - pending and never decided → `200 {"withdrawn": id}`, and the row is gone;
      - rejected, or pending with `edited_after_decision` → `400 CANNOT_CLEAR_DECIDED`;
      - the project on hold → `409 PROJECT_NOT_OPEN`.
    - `test_only_the_owner`: another employee's `PUT` and `DELETE` → `404`; the owner's own typed entry id → `404`.
    - `test_the_database_backs_the_rules`: each of these raises `DatabaseError`:
      - `UPDATE … SET tracked_hours = 1` on a manual entry;
      - `manual_reason = 'other'` with details "short";
      - `manual_details` set while `manual_reason` is null.
    - `test_public_demo_may_not_submit_edit_or_withdraw`: the demo admin's `POST`, `PUT` and `DELETE` each give `403 DEMO_RESTRICTED`.
- [ ] **Step 2:** Run both files. Expect them to fail (no module `app.rules.manual_hours`, no route).
- [ ] **Step 3: Implement** the migration, the rules, the service changes, `manual.submit`, `manual.edit` and `manual.withdraw`, the three routes and the `DENIED` rows, to the interfaces above.
- [ ] **Step 4: Update `API.md`:** the three routes, their bodies and responses, every error code above, and the `manual` and `updated_at` fields of the entry view. **`DATA_MODEL.md`:** both columns and their checks.
- [ ] **Step 5:** Run both files, then `tests/integration/test_public_demo.py`, `test_migrations.py`, `test_time.py` and `test_timer_workflow.py`, then the whole backend suite. Expect all to pass.
- [ ] **Step 6: Commit:** "Manual hours API: send hours without the timer for review, edit and withdraw them, under every timesheet rule"

### Task 2: The review side: list, decisions, the guards and the bells

**Files:**
- Modify:
  - `backend/v1/app/features/time/manual.py`: `list_pending`, `approve`, `request_changes`, `_notify_submitted`; `submit` and `edit` call the notifier;
  - `backend/v1/app/features/time/service.py`:
    - `list_approvals` (627-679) becomes a call to `_pending_items`;
    - `_decidable` (736-747) and `_apply_decision` (750-774);
    - `_alert_rejected` (723-733) and `_message` (884-950);
    - `_changes_something` (380-387) and `save_week` (558-607);
  - `backend/v1/app/features/time/timers.py`: `start` (307-328);
  - `backend/v1/app/features/time/routes.py`: three routes;
  - `backend/v1/app/public_demo.py`: two `ALLOWED` rows;
  - `docs/project/API.md`: the review routes, and the changed `/approvals`, `approve-week`, approve, reject, `PUT /time-entries` and `POST /timers` rows.
- Test: `backend/v1/tests/integration/test_manual_hours.py`.

**Interfaces:**
- **Consumes:** Task 1's `manual.py`, `_entry_view.manual` / `updated_at` and the rules' `REASONS`; `changes._recipients`; `person_week_flags`; `label`; `_load_entry`.
- **Produces:**
  - `service._pending_items(conn, ctx, params, *, manual: bool) -> list[dict]`. It's today's `list_approvals` body plus `t.manual_reason IS NOT NULL` (manual) or `IS NULL` (not). `list_approvals` is `_pending_items(…, manual=False)`; `manual.list_pending` is `_pending_items(…, manual=True)`. Items keep `{entry, label, delegated_from, user, milestone, project, week_logged_total, progress_update, flags}`.
  - `service.MANUAL_ONLY = ApiError(409, "MANUAL_REVIEW_ONLY", "Manual hours are reviewed one at a time in Timesheets → Manual hours.")`.
  - `_decidable(conn, ctx, entry_id, expected_hours=None, *, manual: bool = False, expected_at: datetime | None = None)`. The order is:
    - `_load_entry` (`404` / `403`), then `SELF_APPROVAL`;
    - not `manual` on a manual entry → `MANUAL_ONLY`;
    - `manual` on a typed entry → `400 NOT_MANUAL`, "These hours weren't logged manually. Review them in To review.";
    - `NOT_PENDING`;
    - `STALE` when the expected hours differ or `expected_at != entry["updated_at"]`.
  - `_apply_decision(…, expected_at: datetime | None = None)`: with `expected_at`, the guard adds `AND updated_at = :ua`.
  - `_alert_rejected` adds `"manual": True` to the payload when `entry["manual_reason"]` is set.
  - `manual.list_pending(conn, ctx, params)`: route `GET /manual-hours` with `roles={"admin", "manager"}`.
  - `manual.approve(conn, ctx, entry_id, body) -> <entry view>` and `manual.request_changes(conn, ctx, entry_id, body) -> <entry view>`:
    - both `require(body, "expected_hours", "expected_updated_at")`;
    - `expected_updated_at` is parsed with `datetime.fromisoformat`; a malformed or naive value is `{"expected_updated_at": "invalid_datetime"}`;
    - request-changes takes `reason` through `as_str(…, max_len=1000)`, as `service.reject` does;
    - then `_decidable(…, manual=True, expected_at=…)` and `_apply_decision` in a transaction;
    - approve then inserts `MANUAL_HOURS_APPROVED` for the employee, with the submission's payload shape (`by` is the approver, `resubmitted` false) and `subject_user_id` the approver.
    - Routes: `POST /manual-hours/{id}/approve` and `POST /manual-hours/{id}/request-changes`, with no `roles=` (checked as in `_load_entry`, like `/time-entries/{id}/approve`).
  - `manual._notify_submitted(conn, ctx, entry, ms, *, resubmitted: bool)`:
    - `MANUAL_HOURS_SUBMITTED` to `changes._recipients(conn, {"p_manager_id", "delegate_approver_id", "delegate_until"}, ctx.user_id)`;
    - the payload is `{entry_id, work_date, week_start, hours, reason, resubmitted, milestone: {id, name}, project: {id, name}, by: {id, first_name, name}}`.
    - `submit` always calls it. `edit` calls it with `resubmitted=True` only when the entry was `rejected` or `approved` before the edit.
  - Every new notification is inserted with `week_start` `NULL`.
  - `_message` texts: `MANUAL_HOURS_SUBMITTED` (the two forms, from `p["by"]["first_name"]` and `REASONS[p["reason"]]`), `MANUAL_HOURS_APPROVED` (`p["by"]["first_name"]`), and `ENTRY_REJECTED` with `p.get("manual")`. Hours use `hours_text` and days `short_day`.
  - **The grid guard:**
    - `_changes_something` answers False for a manual entry re-sent with the same hours and (absent or same) note, even when it's rejected.
    - In `save_week`, inside the transaction, every cell on a manual entry is either an unchanged re-send (dropped from `cells`) or collected. Collected cells raise `409 MANUAL_HOURS_LOCKED`, "Hours logged manually change only with Edit: <Schema Mapping on Fri 16 Oct>", with `{"cells": [{"milestone_id", "milestone", "work_date"}]}`.
    - Hours `0` on a manual cell count as a change.
  - **The timer guard:** in `timers.start`, inside the transaction after the running check, `service.existing_entry(conn, ctx, milestone_id, work_date)` with `manual_reason` set raises `409 MANUAL_HOURS_LOCKED`, "You logged today's hours here manually. Edit that request instead."
  - `public_demo.ALLOWED` gains `("POST", "/manual-hours/{id}/approve")`, "approving manual hours", and `("POST", "/manual-hours/{id}/request-changes")`, "sending manual hours back for changes".

**Rulings for this task:**
- **Ruling: manual decisions require both `expected_hours` and `expected_updated_at`** (`400 VALIDATION_ERROR` when missing). Why: decision 14's guard is worthless if an old tab can leave it out.
- **Ruling: any edit of a decided entry (rejected or approved) bells the reviewers as a resubmission. Edits while pending don't.** Why: both put the entry back in the queue needing a decision (decision 18).
- **Ruling: manual bells are inserted with `week_start` `NULL`.** Why: `notifications` is unique on `(type, subject_user_id, week_start)`, so a second request in one week would be swallowed. `ENTRY_REJECTED` already does this.
- **Ruling: an unchanged manual re-send is no change, even when rejected.** This covers `_changes_something` and `save_week`. Why: otherwise a closed project refuses the re-send and the grid resubmits the request without review (decision 3).
- **Ruling: Start timer checks the manual cell through `service.existing_entry`, inside its own lock.** It doesn't import `manual.py`. Why: `manual.py` imports `timers`, and the check must be serialised with a submission.

- [ ] **Step 1: Write the failing tests** (extend `test_manual_hours.py`):
  - `test_reviewers_list_their_pending_manual_hours`:
    - as Morgan, `GET /manual-hours` gives one item whose keys are exactly the nine above, with `entry.manual` set;
    - the active delegate (`delegate_until` NULL) sees it with `delegated_from == {"id": <Morgan>, "name": "Morgan Reyes"}`;
    - another manager gets `[]`; an admin sees it; an employee and an executive get `403`;
    - `?user=`, `?project=` and `?milestone=` narrow the list;
    - a manager with "Tracks own hours" never sees their own request, and an admin does;
    - an archived milestone's request isn't listed.
  - `test_approvals_leave_manual_hours_out`: `GET /approvals` lists a typed pending entry and not the manual one.
  - `test_the_queue_guard` (**Review Focus 4**):
    - `approve-week` with `[typed, manual]` → `409 MANUAL_REVIEW_ONLY` with the exact message, and both entries stay pending;
    - `/time-entries/{manual}/approve` and `/reject` → `409 MANUAL_REVIEW_ONLY`.
  - `test_approve`: with `{"expected_hours": 2.5, "expected_updated_at": <entry.updated_at>}`:
    - `200`, `status "approved"`, and no `hourly_rate` for a manager;
    - Eli gets `MANUAL_HOURS_APPROVED`, "Morgan approved your 2.5h of manual hours on Schema Mapping (<short_day>)".
  - `test_request_changes`: with `reason "Split these between Mapping and Cutover"`:
    - `status "rejected"` with that `rejection_reason`;
    - Eli's `ENTRY_REJECTED` has `payload["manual"] is True` and reads "Your 2.5h of manual hours on Schema Mapping (<day>) need changes: Split these between Mapping and Cutover";
    - a missing reason → `{"reason": "required"}`; 1001 characters → `{"reason": "max_length:1000"}`.
  - `test_stale_and_vanished` (**Review Focus 4**):
    - `expected_hours "2"` → `409 STALE_ENTRY`;
    - after Eli changes only the note, the old `updated_at` → `409 STALE_ENTRY`, and the entry is still pending;
    - a missing `expected_updated_at` → `{"expected_updated_at": "required"}`; `"yesterday"` → `{"expected_updated_at": "invalid_datetime"}`;
    - after Eli withdraws, approve → `404`; after an approve, a second approve → `400 NOT_PENDING`.
  - `test_decision_errors`:
    - an admin approving their own manual hours → `403 SELF_APPROVAL`;
    - a typed entry through `/manual-hours/{id}/approve` → `400 NOT_MANUAL`;
    - a manager outside the project → `404`; a random uuid → `404`;
    - an executive's approve → `403 READ_ONLY`, from the router;
    - a delegate whose `delegate_until` was yesterday: `GET /manual-hours` → `[]`, and approve → `403` or `404`, as `_load_entry` answers.
  - `test_bells_for_reviewers`:
    - a submission gives Morgan and the active delegate `MANUAL_HOURS_SUBMITTED`, "Eli logged 2.5h on Schema Mapping (<day>) without the timer: Forgot to start the timer". Its payload keys are exactly the nine above, with `resubmitted False`;
    - an edit while pending adds none;
    - after request changes, a resubmit with 3h adds one, "Eli resubmitted 3h of manual hours on Schema Mapping (<day>)", with `resubmitted True`;
    - two submissions in one week give two bells;
    - a manager's own request on their own project bells the first admin.
  - `test_the_grid_cannot_change_manual_hours` (**Review Focus 5**):
    - `PUT /time-entries` with the manual cell at 3, or at 0 → `409 MANUAL_HOURS_LOCKED`, with `details["cells"][0]["milestone"] == "Schema Mapping"`;
    - an unchanged re-send of a pending manual cell → `200`, with the entry unchanged;
    - an unchanged re-send of a rejected manual cell → `200`, still `rejected`;
    - on an on-hold project, an unchanged re-send of a rejected manual cell → `200`, not `PROJECT_NOT_OPEN`.
  - `test_start_timer_waits_on_todays_manual_hours`:
    - with manual hours on Schema Mapping `TODAY`, `POST /timers` there → `409 MANUAL_HOURS_LOCKED` with the exact message;
    - Cutover → `201`;
    - with the manual hours on `TODAY − 1` instead, Schema Mapping today → `201`.
  - `test_a_manual_cell_is_not_timer_locked`: `POST /time-edit-requests` on the manual cell → `400 NOT_LOCKED`.
  - `test_public_demo_may_review`: the demo admin approves, and requests changes on, a manual entry → `200` each.
- [ ] **Step 2:** Run `test_manual_hours.py`. Expect the new tests to fail.
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4: Update `API.md`:**
  - `GET /manual-hours` and the two decision routes, with every error;
  - the `/approvals` exclusion;
  - `409 MANUAL_REVIEW_ONLY` on `approve-week`, approve and reject;
  - `409 MANUAL_HOURS_LOCKED` on `PUT /time-entries` and `POST /timers`;
  - the three notification types under "Notifications" (line 481).
- [ ] **Step 5:** Run `test_manual_hours.py`, `test_time.py`, `test_timer_workflow.py`, `test_public_demo.py` and `test_delegate.py`, then the whole backend suite. Expect all to pass.
- [ ] **Step 6: Commit:** "Manual hours review: a separate queue with stale guards, refused by week approval, the grid and the timer, with bells"

### Task 3: The pop-up and its API hooks

**Files:**
- Create:
  - `frontend/src/features/timer/manualHours.js`;
  - `frontend/src/features/timer/ManualHoursDialog.jsx`.
- Modify:
  - `frontend/src/api/queries.js`: the hooks; `['manual-hours']` joins `timeKeys` (line 153);
  - `frontend/src/lib/permissions.js`: `hours.manual` and `DEMO_BLOCKED`;
  - `frontend/src/test/server.js`: a default `GET /manual-hours` handler answering `[]`.
- Test:
  - `frontend/src/features/timer/manualHours.test.js` (new);
  - `frontend/src/features/timer/manualHoursDialog.test.jsx` (new);
  - `frontend/src/lib/permissions.test.js` (the `DEMO_BLOCKED` list at line 15, and the new rule).

**Interfaces:**
- **Consumes:** Task 1's routes and the `manual` / `updated_at` fields; `useWeek`, `useApiMutation`, `timeKeys`; `formatHours`, `formatDayShort`, `mondayOfIso`, `addDays`, `nyTodayIso`; `NOTE_MIN`, `NOTE_MAX`; `ErrorAlert`.
- **Produces (in `manualHours.js`, pure):**
  - `REASONS`: the five `[code, label]` pairs, mirroring the backend;
  - `WINDOW_DAYS = 7`, `DETAILS_MIN = 10`, `DETAILS_MAX = 500`;
  - `dayOptions(today) → [{ value, label }]`: 8 items, from today back to `today − 7`, labelled as in Global Constraints;
  - `inWindow(day, today) → boolean`;
  - `hoursProblem(text) → string | null`. Text not matching `/^\d{1,2}(\.\d{1,2})?$/`, under 0.25 or over 24 gives "Between 0.25 and 24 hours". Not a multiple of 0.25 gives "Use quarter hours: .25, .5 or .75";
  - `detailsProblem(reason, text) → string | null`: "Say what happened (at least 10 characters)" for Other under 10 trimmed characters;
  - `noteProblem(text) → string | null`: "At least 10 characters" under 10 trimmed characters.
- **Produces (hooks in `queries.js`):**
  - `useManualHours(filters = {}, enabled = true)`: key `['manual-hours', filters]`, `GET /manual-hours`;
  - `useLogManualHours()`: `mutateAsync({ body, name })` sends `POST /manual-hours`. Its toast is "Sent <formatHours(entry.hours)> on <name> (<formatDayShort(entry.work_date)>) for review";
  - `useEditManualHours()`: `mutateAsync({ id, body, name })` sends `PUT /manual-hours/{id}`, with the same toast;
  - `useWithdrawManualHours()`: `mutateAsync({ id, name, hours, date })` sends `DELETE`. Its toast is "Withdrew <h> on <name> (<day>)";
  - `useApproveManual()`: `mutateAsync({ item })` sends `{ expected_hours: item.entry.hours, expected_updated_at: item.entry.updated_at }`. Its toast is "Approved <h> for <item.user.name>";
  - `useRequestManualChanges()`: `mutateAsync({ item, reason })`, with the same expected fields. Its toast is "Sent back to <item.user.name>";
  - every one invalidates `timeKeys`, which now holds `['manual-hours']`.
- **Produces (permissions):** `can(user, 'hours.manual')` is the `timesheet.use` rule; `DEMO_BLOCKED` gains `'hours.manual'`.
- **Produces (the dialog):** `ManualHoursDialog({ milestone, project, day, entry, onClose })`. Here `milestone = { id, name }` and `project = { name }`. Without `entry` it submits, with `day` (default `nyTodayIso()`) preselected. With `entry` it edits:
  - **Frame:** `maxWidth="xs"`, `fullWidth`, labelled by its title, with the subtitle line. `onClose` is ignored while sending.
  - **Day:** a select named "Day" with `dayOptions` (submit), or the entry's day as text (edit).
  - **Hours:** a text field with `inputMode: 'decimal'`, `autoFocus`; input outside `[\d.]` is dropped and kept to 5 characters, as `RequestChangeDialog` does.
  - **Reason:** a `fieldset` whose `legend` is "Why not the timer?", holding a `RadioGroup` of the five.
  - **Details:** multiline, with a `n/500` counter; the label "Details (required for Other)".
  - **Work note:** multiline; the helper "What you worked on · <n>/500".
  - **Hints:** from `useWeek(mondayOfIso(day))`.
  - **The footer**, then **Cancel** and **Send for review**, or **Save changes** / **Resubmit** when editing.
  - **A rejected entry** gets a warning `Alert` at the top holding `entry.rejection_reason`.
  - **Bodies:**
    - submit: `{ milestone_id, work_date, hours: <trimmed text>, reason, details: <trimmed text or null>, note: <trimmed> }`;
    - edit: `{ hours, reason, details, note }`.

**Rulings for this task:**
- **Ruling: a field's message shows once the field has been left (blur), and Send stays disabled until every field is valid.** Why: the spec disables Send while anything is invalid, so the messages can't wait for a click.
- **Ruling: "Already logged that day" counts that day's pending and approved entries plus its timer drafts, and "that week" is `totals.logged`.** Both leave out the entry being edited. Why: each hint then predicts the server's own check (decision 20, and the 40h rule's sum).
- **Ruling: editing and resubmitting toast "Sent <h> on <ms> (<day>) for review"; withdrawing toasts "Withdrew <h> on <ms> (<day>)".** Why: the spec fixes only the submit toast, and every save leaves the hours waiting for review.
- **Ruling: `src/test/server.js` answers `GET /manual-hours` with `[]` by default.** Why: MSW runs with `onUnhandledRequest: 'error'`, so every Timesheets, App and Approvals-tab test would otherwise fail once Task 6's queries exist.

- [ ] **Step 1: Write the failing tests:**
  - **`manualHours.test.js`:**
    - `dayOptions('2026-10-15')`: 8 items, "Today, Thu 15 Oct", "Yesterday, Wed 14 Oct", "Tue 13 Oct" … "Thu 8 Oct"; the values run from `2026-10-15` to `2026-10-08`;
    - `inWindow`: true for `2026-10-08`, false for `2026-10-07` and `2026-10-16`;
    - `hoursProblem` (**Review Focus 2**): `null` for "2.5", "2.50", "0.25" and "24"; "Between 0.25 and 24 hours" for "", "0.2", "24.25", "1e1", "2,5" and "25"; "Use quarter hours: .25, .5 or .75" for "2.1" and "0.3";
    - `detailsProblem('other', '   ')` and `noteProblem('          ')` give their messages (**Review Focus 3**); `detailsProblem('forgot_timer', '')` is `null`.
  - **`manualHoursDialog.test.jsx`** (`m1` "Schema Mapping", project "Apollo Data Migration"; MSW `GET /time-entries?week=2026-10-12` holds a pending 6h on m2 on 2026-10-14 and `totals.logged` 38):
    - **Frame:** the dialog "Log hours manually" shows "Schema Mapping · Apollo Data Migration"; Hours has focus; the group "Why not the timer?" holds five radios; "Send for review" is disabled.
    - **Days:** the "Day" select offers the 8 labels, with "Today, Thu 15 Oct" selected. A `day="2026-10-14"` prop selects "Yesterday, Wed 14 Oct".
    - **Review Focus 1:** at `2026-10-16T02:30:00Z` the selected option is "Today, Thu 15 Oct", and the `POST` carries `work_date: '2026-10-15'`.
    - **Messages after blur:** Hours "0.2" gives "Between 0.25 and 24 hours"; "2.1" gives "Use quarter hours: .25, .5 or .75"; both set `aria-invalid="true"`.
    - **Other:** choosing it and typing "Short" in "Details (required for Other)", then leaving, shows "Say what happened (at least 10 characters)", and Send stays disabled.
    - **Note:** the helper reads "What you worked on · 0/500". Ten spaces, then leaving, shows "At least 10 characters", and Send stays disabled (**Review Focus 3**).
    - **Hints:** on Wed 14 Oct the dialog reads "Already logged that day: 6h · that week: 38h". Typing 3 adds "This takes your week over 40h, so it goes to your manager as overtime."; typing 2 shows no such line. Choosing "Sun 11 Oct" requests `?week=2026-10-05`.
    - **The footer** text shows.
    - **Payload:** with Hours "2.5", "Forgot to start the timer", details "   " and the note "Mapped the address fields", there's exactly one `POST /manual-hours` (Send double-clicked), and its body is `{ milestone_id: 'm1', work_date: '2026-10-14', hours: '2.5', reason: 'forgot_timer', details: null, note: 'Mapped the address fields' }`. While it waits, the button reads "Sending…" and is disabled.
    - **After sending:** the dialog closes, the toast reads "Sent 2.5h on Schema Mapping (Wed 14 Oct) for review", and `GET /time-entries` is requested again, as is `GET /manual-hours` for a mounted `useManualHours()` probe (record requests).
    - **Server error:** a `409 CELL_HAS_HOURS` shows its message in an alert inside the dialog. Hours, reason and note keep what was typed.
    - **Esc:** it closes when idle, and not while sending.
    - **Edit:**
      - a pending entry: the title "Edit manual hours", the day "Wed 14 Oct" as text (no "Day" combobox), the fields prefilled, and "Save changes", which sends `PUT /manual-hours/e1` with `{ hours, reason, details, note }`;
      - a rejected entry: the title "Fix and resubmit", a warning alert holding its reason, and "Resubmit".
    - **Phones and dark mode:** under `setViewport(375)` and `setPrefersDark(true)`, the dialog renders its title with no console error.
  - **`permissions.test.js`:**
    - `can(employee, 'hours.manual')` is true; a manager without `tracks_own_hours` false, with it true; an executive false;
    - `demoBlocks(demoAdmin, 'hours.manual')` is true;
    - the `DEMO_BLOCKED` list includes `'hours.manual'`.
- [ ] **Step 2:** Run the three files. Expect them to fail.
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4:** Run `src/features/timer src/lib src/api`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Log hours manually: the pop-up with its day, hours, reason and note, and the API hooks"

### Task 4: "Log hours manually" beside every Start timer

**Files:**
- Create:
  - `frontend/src/features/timer/ManualHoursButton.jsx`;
  - `frontend/src/features/timer/LogTimeActions.jsx`.
- Modify:
  - `frontend/src/features/timer/TimerButton.jsx`: disabled on today's manual cell;
  - `frontend/src/features/timer/useLoggable.js`: `useManualToday`;
  - `LogTimeActions` replaces `TimerButton` in:
    - `frontend/src/features/home/YourFocusCard.jsx` (line 76);
    - `frontend/src/features/home/MilestoneGroups.jsx` (lines 123 and 138);
    - `frontend/src/features/milestones/panel/DetailsTab.jsx` (line 80);
    - `frontend/src/features/timesheet/WeekGrid.jsx` (line 187);
  - `frontend/src/features/timesheet/DayView.jsx`: `LogTimeActions` where `showTimer` holds (line 47), and `ManualHoursButton` on past days.
- Test:
  - `frontend/src/features/timer/logTimeActions.test.jsx` (new);
  - retarget where needed: `features/home/myWeek.test.jsx`, `features/milestones/panel.test.jsx`, `features/timesheet/dayView.test.jsx`, `features/timesheet/timesheet.test.jsx`, `features/timer/timer.test.jsx`.

**Interfaces:**
- **Consumes:** Task 3's `ManualHoursDialog`, `inWindow` and `can(user, 'hours.manual')`; `useTimer`, `useWeek`, `nyMondayIso`, `nyTodayIso`, `demoBlocks`, `DEMO_DISABLED`.
- **Produces:**
  - `useManualToday() → Set<string>`: the milestone ids whose entry for `nyTodayIso()` has `manual`. It reads the same `useWeek(nyMondayIso(), undefined, can(user, 'timer.use'))` query as `useLoggable`.
  - `TimerButton`: when `useManualToday()` holds the milestone, Start is disabled with the tooltip "You logged today's hours here manually. Edit that request instead."
  - `ManualHoursButton({ milestone, project, day, size = 'small', touch = false })`:
    - an outlined button "Log hours manually", named "Log hours manually on <name>", that opens `ManualHoursDialog` with `day`;
    - it renders nothing without `can(user, 'hours.manual')`, while this milestone's own timer runs, or on a completed milestone;
    - it's disabled with `DEMO_DISABLED` when `demoBlocks(user, 'hours.manual')`, and enabled while a timer runs elsewhere.
  - `LogTimeActions({ milestone, project, size, touch })`: `TimerButton` and `ManualHoursButton` (today) in one wrapping row with a gap of 1. Each call site keeps its own condition (`loggable.has`, `thisWeek && !closed`, `showTimer`).
  - **The Day view's past days:** a row shows `ManualHoursButton day={day}` alone when all of these hold:
    - `day < nyTodayIso()` and `inWindow(day, nyTodayIso())`;
    - the row isn't closed and its milestone isn't completed;
    - the cell has no entry, no lock and no typed hours.

**Ruling for this task:**
- **Ruling: `useManualToday()` sits beside `useLoggable()` instead of changing it.** Why: `useLoggable` returns a `Set` to five callers, and both read the same cached week, so this adds no request.

- [ ] **Step 1: Write the failing tests** in `logTimeActions.test.jsx`. Freeze at 2026-10-15T16:00Z; reuse the fixtures of `myWeek.test.jsx`, `panel.test.jsx` and `dayView.test.jsx`.
  - **Every place:** "Log hours manually on Build" shows beside "Start timer on Build":
    - in My week's Now card, an In progress row and an Upcoming row;
    - in the milestone panel's Details tab;
    - in a Week grid row of this week.
    - It isn't in a Week grid row of a past week or of an on-hold project.
  - **Day view:**
    - today's row has both buttons;
    - Tue Oct 13 with an empty cell has only "Log hours manually on Schema Mapping", and its dialog selects "Tue 13 Oct";
    - Thu Oct 8 (`?week=2026-10-05`, 7 days back) with an empty cell has only the manual button;
    - Tue Oct 13 with an entry, a closed row, and Wed Oct 7 (8 days back) have none.
  - **Hidden where Start timer is hidden:**
    - with a timer running on m1, there's no "Log hours manually on Schema Mapping", and "Log hours manually on Cutover" is enabled;
    - a completed milestone has neither button;
    - a manager without "Tracks own hours" has neither.
  - **Demo:** a public demo admin with `tracks_own_hours` sees the button disabled, with the tooltip "Disabled in the public demo".
  - **Start timer:** with today's m1 entry carrying `manual`, "Start timer on Schema Mapping" is disabled with "You logged today's hours here manually. Edit that request instead.", and Cutover's Start is enabled.
  - **Privacy:** record every request (`server.events.on('request:start', …)`, removed in `afterEach`) while an employee loads My week, opens the dialog and sends it. The only `/manual-hours` request is the `POST`. Every `/time-entries` request has no `user`. Nothing goes to `/approvals` or `/allocations`, and every `/users/<id>` request is for `u-emp`.
- [ ] **Step 2:** Run it. Expect it to fail.
- [ ] **Step 3: Implement**, then retarget the existing tests that count buttons in these places.
- [ ] **Step 4:** Run `src/features/timer src/features/home src/features/milestones src/features/timesheet`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Log hours manually beside every Start timer; Start timer waits on today's manual hours"

### Task 5: Manual requests on the employee's timesheet

**Files:**
- Create: `frontend/src/features/timesheet/ManualCell.jsx`.
- Modify:
  - `frontend/src/features/timesheet/WeekGrid.jsx`: cells (193-214); the note button is hidden on a manual cell;
  - `frontend/src/features/timesheet/DayView.jsx`: the hours cell, and the read-only note;
  - `frontend/src/features/timesheet/EntryStatus.jsx`: `CellStatus` (72-94);
  - `frontend/src/features/timesheet/EntryPanel.jsx`;
  - `frontend/src/features/timesheet/MonthDayPanel.jsx`: `LineCard`;
  - `frontend/src/features/timesheet/useTimesheetWeek.js`: `isManual`, `openKeys` (line 89) and restore (lines 69-72).
- Test:
  - `frontend/src/features/timesheet/manualCell.test.jsx` (new);
  - retarget where needed: `entryPanel.test.jsx`, `monthPanel.test.jsx`, `unsaved.test.jsx`.

**Interfaces:**
- **Consumes:** Task 3's `ManualHoursDialog`, `REASONS`, `useWithdrawManualHours`; `StatusLine`, `StatusWords`, `EntryStatusChip`; `ConfirmDialog`; `formatDayShort`, `formatDayLabel`, `formatHours`.
- **Produces (in `ManualCell.jsx`):**
  - `ManualRequestChip({ manual })`:
    - a chip with an edit icon (`aria-hidden`) and "Manual request", focusable (`tabIndex={0}`), named "Manual request: <reason label>";
    - its tooltip reads "<reason label>", or "<reason label>: <details>".
  - `ManualActions({ entry, row, label, closed, withdraw = false, onWithdrawn })`. It shows nothing when `closed`. Otherwise:
    - **Edit** (pending or approved), named "Edit manual hours, <label>";
    - or **Fix and resubmit** (rejected), named "Fix and resubmit, <label>";
    - either opens `ManualHoursDialog` with the entry;
    - with `withdraw`, **Withdraw**, named "Withdraw, <label>", only while `status === 'pending' && !edited_after_decision`. It opens `ConfirmDialog` titled "Withdraw these hours?" with the body "<h> on <name>, <formatDayShort(date)>, are removed and your manager won't see them.", and confirm "Withdraw". It then calls `onWithdrawn()`.
  - `ManualCell({ entry, label, row, closed })`:
    - a read-only box styled like `LockedCell`, with `EditOutlined` in place of the lock and `role="group"`, named "<label>: <h>, manual request";
    - then `ManualRequestChip`;
    - then `ManualActions`, plus "Reason: <rejection_reason>" when rejected.
- **Produces (in the existing files):**
  - `CellStatus`: with `entry.manual`, `ManualRequestChip` takes `SourceChip`'s place, and there's no Resubmit.
  - `EntryPanel` on a manual entry:
    - Hours are read-only text;
    - "Why not the timer?" shows the label, with details under it;
    - the work note is read-only;
    - Source reads "Manual request";
    - `ManualActions withdraw onWithdrawn={onClose}`, and no Save & resubmit.
  - `MonthDayPanel`'s `LineCard` on a manual line: the reason, details and note, Source "Manual request", and `ManualActions withdraw` in place of "Edit in Day view".
  - `useTimesheetWeek`:
    - `isManual(k) → boolean`;
    - manual keys are left out of `openKeys`, so they're never typed, counted as typed, in `changed` or sent;
    - the restore's `open(k)` also refuses them;
    - their saved hours still count through `entries`.

**Ruling for this task:**
- **Ruling: a manual cell is never typed. It's left out of `openKeys` and out of restore,** and still counted as a saved entry. Why: typing restored from `sessionStorage`, or left from an earlier render, must never reach the `PUT` (decision 3; Review Focus 5).

- [ ] **Step 1: Write the failing tests** in `manualCell.test.jsx` (frozen at 2026-10-15T16:00Z, `?week=2026-10-12`). The fixture: `e1` on m1 "Schema Mapping", Wed 2026-10-14, 2h, pending, `manual: { reason: 'forgot_timer', details: 'Laptop was in for repair' }`, note "Mapped the address fields offline".
  - **Week grid:**
    - there's no textbox "Schema Mapping, Wed Oct 14"; the group "Schema Mapping, Wed Oct 14: 2h, manual request" shows;
    - the status line reads "Pending";
    - "Manual request: Forgot to start the timer" is focusable, and its tooltip reads "Forgot to start the timer: Laptop was in for repair"; with `details: null` it reads "Forgot to start the timer" (**Review Focus 3**);
    - there's no "Add work note, Schema Mapping, Wed Oct 14";
    - "Edit manual hours, Schema Mapping, Wed Oct 14" opens the dialog "Edit manual hours".
  - **Rejected:** "Needs revision", "Fix and resubmit, Schema Mapping, Wed Oct 14", "Reason: Split it between milestones", and no "Resubmit".
  - **Approved:** "Edit" shows, and the Entry details panel has no "Withdraw".
  - **Day view:**
    - the "Work note, Schema Mapping" textbox is read-only and holds the request's note;
    - the row shows "Manual request" and no "Manual" source chip.
  - **Entry details** (`&entry=m1:2026-10-14`):
    - "Why not the timer?" shows "Forgot to start the timer" and "Laptop was in for repair";
    - Source reads "Manual request";
    - "Withdraw, Schema Mapping, Wed Oct 14" opens "Withdraw these hours?" with "2h on Schema Mapping, Wed 14 Oct, are removed and your manager won't see them.";
    - confirming sends `DELETE /manual-hours/e1`, toasts "Withdrew 2h on Schema Mapping (Wed 14 Oct)", and closes the panel;
    - a pending entry with `edited_after_decision` has no Withdraw.
  - **Month:** the day panel for Oct 14 shows the reason and "Withdraw, Schema Mapping, Wed Oct 14", and no "Edit in Day view, Schema Mapping".
  - **Closed:** on an on-hold row there are no actions.
  - **Review Focus 5:**
    - `sessionStorage['overwatch.timesheet.unsaved.u-emp.2026-10-12']` holds `{"drafts": {"m1|2026-10-14": "9", "m2|2026-10-13": "3"}, "notes": {}}`;
    - after load, only m2's cell restores;
    - "Submit 1 change" shows, and its `PUT` body's `entries` holds only `m2` / `2026-10-13`.
  - **Privacy:** record every request while the employee opens Edit, saves, and withdraws in Week, Day and Month. The `/manual-hours` requests are only `PUT` and `DELETE /manual-hours/e1`. No `/time-entries` request has `user`, and nothing goes to `/approvals`.
- [ ] **Step 2:** Run it. Expect it to fail.
- [ ] **Step 3: Implement**, then retarget the existing tests these changes touch.
- [ ] **Step 4:** Run `src/features/timesheet src/features/timer`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Timesheet: manual requests are read-only cells with a Manual request chip, edited, resubmitted or withdrawn from their panels"

### Task 6: The Manual hours tab, its counts and its links

**Files:**
- Create: `frontend/src/features/timesheets/ManualTab.jsx`.
- Modify:
  - `frontend/src/features/timesheets/TimesheetsPage.jsx`: the tab after To review (`tabsFor`, lines 16-22) and `?tab=manual`;
  - `frontend/src/features/timesheets/ReviewTab.jsx`: `PersonWeek`'s caption (lines 46-51);
  - `frontend/src/api/queries.js`: `useWaitingCount`;
  - `frontend/src/app/App.jsx`: `Shell` (lines 33-45) uses `useWaitingCount`;
  - `frontend/src/features/milestones/panel/ApprovalsTab.jsx`: the info line under the heading (387-396) and in the empty state (368-375);
  - `frontend/src/components/NotificationBell.jsx`: `TARGETS` (10-32);
  - `frontend/src/features/puppy/summary.js`: `KNOWN` (244-246) and two sentences.
- Test:
  - `frontend/src/features/timesheets/manualTab.test.jsx` (new);
  - `frontend/src/components/notificationBell.test.jsx` (new);
  - `frontend/src/features/timesheets/timesheets.test.jsx` (retarget "Timesheets tabs by role");
  - `frontend/src/features/milestones/approvals.test.jsx`;
  - `frontend/src/features/puppy/summary.test.js`.

**Interfaces:**
- **Consumes:** Task 3's `useManualHours`, `useApproveManual`, `useRequestManualChanges` and `REASONS`; Task 2's list shape; `FlagChips`, `BreakdownPanel`, `PersonLink`, `UserAvatar`, `EmptyState`, `ErrorAlert`, `groupByPersonWeek`, `mondayOfIso`, `DESKTOP_QUERY`.
- **Produces:**
  - `useWaitingCount(enabled) → number`: `useApprovals({}, enabled)` and `useManualHours({}, enabled)` lengths, added. The sidebar's `/timesheets` badge is this number.
  - `TimesheetsPage`: for `approvals.view`, the tabs are To review, "Manual hours <N>" (N = `useManualHours({})` length once loaded, else "Manual hours"), Approved, then HR. `?tab=manual` renders `ManualTab filters={filters} onClearFilters`.
  - `ManualTab({ filters, onClearFilters })`:
    - the intro line, "Show everyone" when filtered, and `ErrorAlert` with Retry;
    - from `md`: a table labelled "Manual hours" with the seven columns and an actions cell; Date reads `formatDayShort(work_date)`, and Milestone has the project under it;
    - below `md`: one `Paper` card per entry, in the same order, with the actions in a 44 px row;
    - **Why not the timer:** `REASONS` label, with details under it;
    - **Flags:** `FlagChips`, "Overtime" (`entry.over_40`), "Edited after a decision" and "Delegated from <name>";
    - **Budget impact** toggles `BreakdownPanel entryId` under the row;
    - **Request changes** opens a dialog titled "Request changes" with a required "Reason" (`maxLength` 1000), the line "<first name> sees your reason on their timesheet and can fix and resubmit." and the error "Tell the employee why";
    - **Approve <h>** is named "Approve <h>, <name>, <formatDayShort(date)>";
    - **Errors:** a failure keeps its entry id. While the id is listed, its `ErrorAlert` sits in its row; once a refetch drops it, the alert moves to the top of the list, titled "<name> · <day>". Every failure calls `refetch()`.
  - `ReviewTab`'s `PersonWeek` caption adds "· <h> more in Manual hours", linking to `/timesheets?tab=manual&user=<id>`. It's the sum of the cached `useManualHours({})` items with that user and `mondayOfIso(work_date) === group.week`, and shows only when above 0.
  - `ApprovalsTab`: with `useManualHours({ milestone: milestone.id })` holding n > 0, an info line "<n> manual-hours request(s) on this milestone is/are reviewed separately." with the link "Review manual hours" to `/timesheets?tab=manual&milestone=<id>`.
  - `TARGETS`:
    - `MANUAL_HOURS_SUBMITTED: (n) => [`/timesheets?tab=manual&user=${n.subject_user.id}`, 'Review it in Manual hours']`;
    - `MANUAL_HOURS_APPROVED: (n) => [`/timesheet?week=${n.week_start}`, 'Open your timesheet for that week']`.
  - **Puppy:** `KNOWN` gains both types, with two sentences:
    - `MANUAL_HOURS_SUBMITTED` → "<n> manual-hours request(s) is/are waiting for your review", to `/timesheets?tab=manual`;
    - `MANUAL_HOURS_APPROVED` → "Your manual hours on <milestone> were approved" (one) or "<n> of your manual-hours requests were approved", to that week's timesheet.

**Rulings for this task:**
- **Ruling: the list is its own table and cards, not `DataTable`.** Why: `DataTable` puts phone actions in a "⋯" menu, while §7 wants three actions and an inline error in a 44 px row.
- **Ruling: a failure stays on its row while the row is listed, and moves to the top of the list, titled "<Person> · <day>", once a refetch drops it.** Why: §7 puts errors on the row, and an error on a row that vanished (withdrawn, decided elsewhere) would never be seen.
- **Ruling: `useWaitingCount()` in `queries.js` feeds the sidebar badge.** Why: `App.jsx`'s `Shell` has no test harness; the hook is testable alone, and it shares the tab's cache, so it adds no request.
- **Ruling: Puppy's `KNOWN` gets the two new types with a sentence each.** Why: `KNOWN` without a sentence would drop them from its summary, and leaving them out would print the generic "unknown" sentence.

- [ ] **Step 1: Write the failing tests:**
  - **`manualTab.test.jsx`.** As Morgan; two items: Ben Okafor, Wed 2026-10-14, 2.5h, `forgot_timer`, `updated_at '2026-10-14T18:00:00.123456+00:00'`, `over_40` true, delegated from "Kim Lee"; and Ana Ruiz, Thu 2026-10-15, 1h, `other` with details.
    - **Tab:** "Manual hours 2" sits after "To review"; `?tab=manual` selects it.
    - **List:** the intro shows; rows are in the server's order; the seven column headers show; Ben's row reads "Forgot to start the timer", "Overtime" and "Delegated from Kim Lee".
    - **Approve:** "Approve 2.5h, Ben Okafor, Wed 14 Oct" posts `{ expected_hours: 2.5, expected_updated_at: '2026-10-14T18:00:00.123456+00:00' }` to `/manual-hours/e1/approve`, and toasts "Approved 2.5h for Ben Okafor".
    - **Request changes:** an empty Reason shows "Tell the employee why", and nothing is sent. A reason posts `{ reason, expected_hours, expected_updated_at }` and toasts "Sent back to Ben Okafor". The dialog reads "Ben sees your reason on their timesheet and can fix and resubmit."
    - **Review Focus 4:**
      - a `409 STALE_ENTRY` shows its message inside Ben's row, and `GET /manual-hours` is requested again;
      - a `404` followed by a refetch without Ben shows the error at the top, titled "Ben Okafor · Wed 14 Oct".
    - **Filters:** `?tab=manual&user=u-ben` requests `user=u-ben`; "Show everyone" clears it.
    - **Empty:** "No manual hours waiting" and "Hours your team logs without the timer show up here."
    - **Phones:** under `setViewport(375)` there's no `table`, and each card holds its three buttons.
    - **Dark mode:** under `setPrefersDark(true)` the tab renders with no console error.
    - **To review:** with Ben also pending 4h that week in `/approvals`, his person-week card reads "· 2.5h more in Manual hours", linking to `/timesheets?tab=manual&user=u-ben`.
    - **The badge:** a probe rendering `useWaitingCount(true)` shows 5, with 3 approvals and 2 manual items. After an approve, it shows 4 once the list refetches.
    - **Privacy:** as an employee, `useWaitingCount(false)` shows 0 and makes no `/approvals` or `/manual-hours` request (recorded requests).
  - **`notificationBell.test.jsx`:**
    - `MANUAL_HOURS_SUBMITTED` shows its message with "Review it in Manual hours", and a click navigates to `/timesheets?tab=manual&user=u-ben`;
    - `MANUAL_HOURS_APPROVED` goes to `/timesheet?week=2026-10-12`.
  - **`timesheets.test.jsx`** ("tabs by role"): managers get "To review", "Manual hours 0" and "Approved"; admins also "HR submission"; executives only "HR submissions", and no `/manual-hours` request.
  - **`approvals.test.jsx`:**
    - with 2 manual items for the milestone, "2 manual-hours requests on this milestone are reviewed separately." and the link "Review manual hours" to `/timesheets?tab=manual&milestone=m1` show under the heading;
    - with no approvals, the line also shows in the empty state; with one, it reads "1 manual-hours request on this milestone is reviewed separately."
  - **`summary.test.js`:** both sentences, and no generic sentence for either type.
- [ ] **Step 2:** Run the five files. Expect them to fail.
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4:** Run `src/features/timesheets src/features/milestones src/features/puppy src/components src/app`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Timesheets: the Manual hours tab, its count in the sidebar, To review's caption and the milestone panel's link"

### Task 7: The end-to-end loop, phone and dark checks, docs and the README screenshots

**Files:**
- Create: `frontend/e2e/manual-hours.spec.js`.
- Modify:
  - `frontend/e2e/shell.spec.js`: the 375 px test also measures `/timesheets?tab=manual` (manager.demo) and the open dialog (employee.demo, My week);
  - `frontend/src/components/noHexColours.test.js`: the glob adds `../features/timer/*.jsx` and `../features/timesheets/*.jsx`, excluding tests;
  - `README.md`: the tour;
  - `docs/project/USER_STORIES.md`: under "Stories added after the first release", Employee and Manager;
  - `docs/project/LOGIC_WALKTHROUGH.md`: a new "## 29. Manual hours" after §28;
  - `docs/project/API.md`: check Tasks 1-2's rows against the code;
  - `docs/images/manual-hours-dialog.png` and `docs/images/manual-hours-tab.png` (new).

**Interfaces:**
- **Consumes:** everything above, and `e2e/helpers.js` (`signIn`, `signOut`, `DEMO_PASSWORD`).
- **The journey's people and days.** Both tests run in `test.describe.serial`, so the second builds on the first.
  - `PERSON = { desktop: { username: 'ben.okafor', name: 'Ben Okafor', first: 'Ben' }, mobile: { username: 'ana.ruiz', name: 'Ana Ruiz', first: 'Ana' } }`.
  - `nyToday()` is `new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())`. `shortDay(iso)` gives "Sun 11 Oct" and `dayLabel(iso)` gives "Sun Oct 11", matching `formatDayShort` and `formatDayLabel`.
  - The **manual day** is last week's Sunday: this week's Monday − 1. It's always inside the window (Monday is at most 6 days back). Its week is Monday − 7.
  - The **typed day** is last week's Saturday, Monday − 2. Typing has no window, so the grid takes it.
  - The spec asserts each button is visible before using it, so a seed that left the cell full fails loudly.
- **The API check:**
  - `request.post('/api/v1/auth/login', { data: { username: 'manager.demo', password: DEMO_PASSWORD } })` gives `access_token`;
  - `GET /api/v1/manual-hours` with that bearer gives the request's id and hours;
  - `POST /api/v1/approvals/approve-week` with `{ entries: [{ id, expected_hours }] }` must answer `409`, with `error.code === 'MANUAL_REVIEW_ONLY'`.

**Rulings for this task:**
- **Ruling: the journey uses Ben (desktop) and Ana (mobile) on last week's Sunday, not "yesterday".** Why:
  - the seed logs every weekday's Schema Mapping hours for these people, so most "yesterdays" aren't empty;
  - a day in this week would change the overtime journey's 45h, which runs later on the same database;
  - last week's Sunday is always inside the window, and the seed leaves it empty (Eli's seeded change request sits on a Saturday).
- **Ruling: the request-changes path runs on the same request after its first approval,** starting with an Edit that sends it back to pending. Why: the seed leaves only one empty cell per person that is always inside the window and outside the overtime journey's week. Editing approved hours is also a rule the loop should cover (decision 15).
- **Ruling: the week-approval check types 1h on last week's Saturday first.** Why: the person then has a To review card for that week whatever the seed left, so "Approve week" runs beside the waiting manual request.

- [ ] **Step 1: Write `manual-hours.spec.js`** (both projects; `reducedMotion: 'reduce'`; each test `test.slow()`):
  - **Test 1: "employee logs manual hours from My week → not in To review → week approval leaves it → manager approves from Manual hours → employee sees Approved".**
    1. **The employee:**
       - sign in as `person.username`; on My week, click the first "Log hours manually on Schema Mapping";
       - in "Log hours manually", choose the Day option ending in `shortDay(manualDay)`; Hours "2"; "Forgot to start the timer"; Work note "Mapped the legacy address fields offline."; then "Send for review";
       - the toast reads "Sent 2h on Schema Mapping (<shortDay>) for review".
    2. **The cell:** on `/timesheet?week=<last Monday>&day=<manualDay>`:
       - the row shows "Pending" and "Manual request", and has no "Schema Mapping, <dayLabel>" textbox;
       - then on `day=<typedDay>`, type 1 with the note "Reviewed the mapping rules for the import." and "Submit 1 change". No reason is asked.
    3. **The manager:**
       - sign out; sign in as `manager.demo`;
       - the bell has the menu item "<first> logged 2h on Schema Mapping (<shortDay>) without the timer: Forgot to start the timer"; clicking it opens `/timesheets?tab=manual&user=…`, and the tab reads "Manual hours <N ≥ 1>";
       - **To review:** the person's week of <last Monday> shows no entry dated `dayLabel(manualDay)`, and its caption reads "· 2h more in Manual hours". "Approve week" on that card toasts "Approved the week (…)";
       - **Manual hours** still lists the request;
       - **the API check** (above) answers `409 MANUAL_REVIEW_ONLY`, and after a reload the request is still listed;
       - "Approve 2h, <name>, <shortDay>" toasts "Approved 2h for <name>".
    4. **The employee:** sign in again; the bell reads "Morgan approved your 2h of manual hours on Schema Mapping (<shortDay>)", and the cell shows "Approved".
  - **Test 2: "edit approved manual hours → request changes → fix and resubmit → approve".**
    1. **The employee:** "Edit manual hours, Schema Mapping, <dayLabel>" opens "Edit manual hours". Hours "2.5", then "Save changes" → the cell shows "Pending".
    2. **The manager:**
       - the row shows "Edited after a decision";
       - "Request changes" with an empty reason shows "Tell the employee why";
       - with "Please split these hours between Mapping and Cutover." it toasts "Sent back to <name>".
    3. **The employee:**
       - the bell reads "Your 2.5h of manual hours on Schema Mapping (<shortDay>) need changes: Please split these hours between Mapping and Cutover.";
       - the cell shows "Needs revision" and the reason;
       - "Fix and resubmit, Schema Mapping, <dayLabel>" opens "Fix and resubmit" with the reason in its alert. Hours "3", then "Resubmit" → "Pending".
    4. **The manager:** the bell reads "<first> resubmitted 3h of manual hours on Schema Mapping (<shortDay>)"; "Approve 3h, <name>, <shortDay>" toasts "Approved 3h for <name>".
    5. **The employee:** the cell shows "Approved".
- [ ] **Step 2:** Run `npx playwright test e2e/manual-hours.spec.js` alone (it starts its own servers on 3000 and 3001). Keep the failing output as the RED evidence. Then make it pass on desktop Chrome and the iPhone 13 profile. Fix the app with a unit test first for anything it finds.
- [ ] **Step 3:** Extend `shell.spec.js`'s 375 px test and `noHexColours.test.js`. Run `npx vitest run src/components/noHexColours.test.js`, then `npx playwright test` alone. Expect everything to pass in both projects.
- [ ] **Step 4: README screenshots.**
  - Start the local stack: `python backend/v1/scripts/devserver.py --db overwatch_shots --reset --seed` on 3001 and `npm run dev` on 3000. Drive it with a throwaway Playwright script kept in `C:\Users\mizo7\.claude\jobs\5a07e959\tmp`.
  - At 1440×900, light:
    - `docs/images/manual-hours-dialog.png`: ben.okafor's Day view on the manual day, with the dialog filled (2h, Forgot to start the timer, a note) and its hints showing;
    - `docs/images/manual-hours-tab.png`: manager.demo's Manual hours tab with that request.
  - View both. Then stop both servers and check that 3000 and 3001 are free.
- [ ] **Step 5: Docs:**
  - **README:** a tour row with the two images, each with alt text naming what shows;
  - **USER_STORIES:** "Log hours I didn't time" (employee: the pop-up, edit, withdraw, fix and resubmit) and "Decide manual hours one by one" (manager: the tab, approve, request changes, the badge, the panel's link);
  - **LOGIC_WALKTHROUGH §29:** the empty-cell rule, the window on New York dates, the 24 h day with drafts, the locks (the grid, Start timer), the separate queue and its server guards, the stale guard on hours and `updated_at`, the bells, and the demo split;
  - **API.md:** check Tasks 1-2's rows against the code.
- [ ] **Step 6: Commit:** "Manual hours: the end-to-end loop on desktop and phone, the phone and dark checks, docs and screenshots"

### Task 8: Hands-on walkthrough and the final runs

**Files:**
- Modify:
  - `docs/project/TESTING.md`: counts from Step 4's runs, in its summary line and its current-results section, plus a short "Manual hours walkthrough" note (date, stack, pass count);
  - `README.md`: the test counts (line 15).
- Not committed: the walkthrough script and every screenshot, kept in `C:\Users\mizo7\.claude\jobs\5a07e959\tmp`.

**Interfaces:**
- **Consumes:** the whole feature, on your own stack: `python backend/v1/scripts/devserver.py --db overwatch_shots --reset --seed` on 3001 and `npm run dev` on 3000. Never 5173 or 3060.
- **The runs:** every check runs at 1440×900 and at 375×812, each in light and dark (`colorScheme` on the browser context). Each check records:
  - a screenshot named `walk-<role>-<check>-<light|dark>-<1440|375>.png`;
  - every console error and `pageerror`;
  - every response with status ≥ 400.
  - A check passes only with no console error, no 5xx, and no 4xx except the ones it expects. At 375 px it also needs no horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`).
- **The people:**
  - employee: ben.okafor, and ana.ruiz for the today check;
  - manager: manager.demo;
  - delegate: riley.chen, after manager.demo names him Apollo's delegate approver (no end date) through the project's edit dialog;
  - public demo admin: the sign-in page's **Admin** button.
  - If riley.chen can't sign in with the demo password, the delegate checks are reported as "NOT RUN: no delegate account", never left out.

**Ruling for this task:**
- **Ruling: the walkthrough's result is a pass/fail list in the task's report, with its screenshots in the tmp folder.** Only the counts and a one-line note go into `TESTING.md`. Why: the owner asked for a hands-on check reported as a list, and screenshots of seeded people don't belong in the repo.

- [ ] **Step 1: Write the walkthrough script** in the tmp folder. One function per check below; each one prints `PASS <id> <what>` or `FAIL <id> <what>: <reason>`.
  - **Employee:**
    - **E1:** "Log hours manually" shows beside every Start timer: My week's Now card and rows, the milestone panel's Details tab, the Day view (today, and an empty in-window past day alone), and Week grid rows.
    - **E2:** the pop-up's messages, after leaving each field:
      - Hours "0.2" and "2.1";
      - "Other" without details;
      - a 5-character note;
      - Send stays disabled throughout, and focus starts on Hours.
    - **E3:** sending shows the toast. The cell is read-only with the "Manual request" chip, its tooltip opens from the keyboard, and the Day view's note is read-only.
    - **E4:** Edit while pending keeps "Pending". Withdraw asks first, and then the cell is empty again.
    - **E5:** as ana.ruiz, manual hours for today on Schema Mapping. "Start timer on Schema Mapping" is then disabled with "You logged today's hours here manually. Edit that request instead."
    - **E6:** with typing in another cell of the week, "Submit 1 change" sends a `PUT` whose body has no manual cell (network).
    - **E7, privacy (network):** across E1-E6 there's no `GET /manual-hours`, `/approvals` or `/allocations` request, and no `/time-entries` request with `user=`.
  - **Manager:**
    - **M1:** the tab reads "Manual hours <N>", and the sidebar's Timesheets badge equals the To review entries plus N. To review's caption and the milestone panel's Approvals line link to the filtered tab.
    - **M2:** "Approve <h>" toasts. "Request changes" refuses an empty reason, then toasts.
    - **M3, stale:** with the list open in the manager's page, the employee changes only the note in their own context. Approving in the old page shows the stale error on the row, the list refreshes, and approving again then succeeds (expects one `409`).
    - **M4:** "Approve week" on the person's week leaves the manual request listed.
    - **M5:** the bell's submitted and resubmitted alerts open `/timesheets?tab=manual&user=…`.
  - **Delegate:** **D1:** riley.chen sees the request with "Delegated from Morgan Manager", got the submitted bell, and approves it.
  - **Public demo admin:**
    - **P1:** no "Log hours manually" anywhere it can reach (it keeps no timesheet).
    - **P2:** it can open the Manual hours tab, request changes on one request and approve another.
    - **P3:** a direct `POST /api/v1/manual-hours` with its token answers `403 DEMO_RESTRICTED` (the one expected 4xx).
- [ ] **Step 2: Run it** on a fresh `--reset --seed` stack. View every screenshot, dark and 375 px included, for contrast, clipping and overlap.
- [ ] **Step 3: Any FAIL is a bug.** Fix it test-first (a failing Vitest, pytest or Playwright test, then the fix), then re-run the walkthrough from a fresh seed until every line is PASS (or NOT RUN, with its reason). Stop both servers and check that 3000 and 3001 are free.
- [ ] **Step 4: The final runs**, one at a time:
  - `cd frontend && npx vitest run` twice in a row, with zero failures both times;
  - `npm run lint`, clean;
  - `cd backend/v1 && OVERWATCH_TEST_DB=overwatch_test_mh python -m pytest -o addopts="" -q`, all passing;
  - `cd frontend && npx playwright test` alone, with ports 3000 and 3001 free, all passing.
- [ ] **Step 5: Docs:** put Step 4's counts in `TESTING.md` and README line 15, with the walkthrough note.
- [ ] **Step 6:** Scan every changed file for `TODO`, `test.skip`, `.only` and stub tests. There must be none.
- [ ] **Step 7: Report the walkthrough** in the task summary: every check's PASS / FAIL / NOT RUN line, with its screenshot names and the final counts.
- [ ] **Step 8: Commit:** "Manual hours: the hands-on walkthrough and the final test counts"
