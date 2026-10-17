# Manual hours: "Log hours manually"

Date: 2026-10-17. Status: draft for the owner's review. Nothing is built yet.
Builds on: the timer workflow (migrations 014–015, `backend/v1/app/features/time/`) and the wording, phone and dark-mode rules of `2026-10-16-redesign-from-mockups-design.md` (§2 calls, §8).

## 1. In short

Sometimes the timer wasn't running: someone forgot to start it, worked away from the computer, sat in a meeting, or the timer broke. Today they can only type the hours into the timesheet, and the manager never learns why. With this feature:

- Next to every **Start timer** there's a **Log hours manually** button. It opens a pop-up: which day, how many hours, why the timer wasn't used, and what they worked on. **Send for review** saves the hours as pending.
- On the employee's timesheet the hours show as **Pending** with a **Manual request** tag. Until the manager decides, the employee can edit or withdraw them.
- Managers review these hours one at a time in a new **Manual hours** tab on Timesheets. They never appear in "To review" or in a week approval, so approving a week can't approve them by accident.
- **Approve** counts them like any other hours. **Request changes** (with a reason) sends them back. The employee fixes them in the same pop-up and resubmits.
- Typing hours into the timesheet grid works exactly as it does today, with no reason asked.
- Every existing rule still holds: the 24-hour day, overtime past 40h, closed work refused, assignment, timer locks, proof of work, the stale-entry guard, and a reason on every rejection.

## 2. The owner's decisions (binding)

| # | Decision |
|---|---|
| O1 | A "Log hours manually" button next to every Start timer: My week (the Now card and the milestone rows), the milestone panel's Details tab, and the timesheet Day view rows |
| O2 | Pop-up: date (default today, past days allowed), hours (0.25–24, quarter hours), reason pick list (Forgot to start the timer / Worked away from the computer / Meeting or call / Timer problem / Other; details required for Other), and a work note (10–500 characters). Submit sends the hours as pending |
| O3 | Typing hours into the grid keeps working as today, with no reason asked |
| O4 | Managers review these hours in a separate "Manual hours" list, apart from To review and the milestone panel's Approvals tab |
| O5 | All existing rules apply. No permission changes beyond what the feature needs. Employees never see anyone else's data |

## 3. Decisions made in this spec (change any on review)

1. **Decision:** a manual submission is an ordinary `time_entries` row with two new columns, `manual_reason` (a code) and `manual_details`. `manual_reason IS NOT NULL` is the only marker of a pop-up entry; there's no separate `submitted_via` column. **Why:** the 24h day, the 40h week, budgets, flags, Approved and HR then count these hours with no new code, and with one marker there's nothing to fall out of step.
2. **Decision:** the pop-up fills only an empty cell, meaning that milestone and day have no entry of any status, no timer hours and no running timer. Otherwise it refuses and names the right tool. **Why:** adding to existing hours would reopen approved hours and mix reviewed with unreviewed time in one entry, and replacing them would silently drop hours. Timer hours already have Request a change, and typed hours are changed in the grid.
3. **Decision:** a cell holding pop-up hours is read-only in the grid; the server refuses changes with `MANUAL_HOURS_LOCKED`. It changes only through the pop-up (Edit / Fix and resubmit). **Why:** otherwise the grid becomes a back door that drops the reason or resubmits without review.
4. **Decision:** Start timer is refused on a milestone whose cell for today holds pop-up hours ("Edit that request instead"). **Why:** the timer's draft would otherwise merge into the manual entry at Save week. This is decision 2 seen from the other side.
5. **Decision:** the day can be today or any of the 7 days before it, on New York dates (the timer's clock). No future days, and the day must fall inside the project's dates. Edits and resubmits keep the entry's day and ignore the window. **Why:** 7 days is the app's BACKDATED limit, so pop-up hours never arrive already flagged. Older hours can still be typed into the grid (O3), and a request that was sent back must stay fixable.
6. **Decision:** hours are 0.25–24 in steps of 0.25. The grid keeps two decimals. **Why:** O2, and it matches how the timer rounds.
7. **Decision:** the work note (10–500 characters) is always required in the pop-up, even when a progress update was posted that day. **Why:** no timer stands behind these hours, and the reviewer judges each entry on its own.
8. **Decision:** details are optional (up to 500 characters) for the four fixed reasons and required (10–500) for Other. **Why:** O2. The 10-character minimum matches the app's other "explain why" fields.
9. **Decision:** the pop-up has the same eligibility as Start timer: the person keeps a timesheet and is assigned, the project is planned or active, and the milestone is neither archived nor completed. **Why:** "next to every Start timer" means wherever a timer could start, plus past days. Completed milestones keep grid logging, as today.
10. **Decision:** one shared `LogTimeActions` puts the button beside `TimerButton` at every Start timer, including the Week grid rows, which the owner's list didn't name but which also show Start timer. The button is hidden while this milestone's own timer runs and enabled while a timer runs elsewhere. In the Day view it also appears on open rows of past days inside the window when the cell is empty, preset to that day. **Why:** the Day view is where people notice a missed day, but its Start timer shows only for today.
11. **Decision:** the server enforces the separate queue. `GET /approvals` leaves pop-up entries out. `POST /approvals/approve-week`, `/time-entries/{id}/approve` and `/reject` refuse them with `409 MANUAL_REVIEW_ONLY`, and approve-week then approves nothing (all or nothing, as today). The only way to decide them is `/manual-hours/{id}/approve` or `/request-changes`. **Why:** hiding them on screen wouldn't stop an old tab or a script from approving them unseen.
12. **Decision:** the reviewers are the people who decide that person's hours today: the project's manager, its active delegate, and any admin. Nobody reviews their own hours, so a manager's own manual hours go to an admin. Executives don't get the list. **Why:** O5, so no permission changes.
13. **Decision:** "Request changes" is today's rejection: the status becomes rejected, with a required reason, and the employee sees "Needs revision". There's no separate outright Reject. **Why:** a rejection already means "fix and resubmit", and the redesign spec already calls it Request changes.
14. **Decision:** each decision sends `expected_hours` and `expected_updated_at`, and the update applies only to that exact version. **Why:** while the manager reads, the employee may change the reason or note without touching the hours.
15. **Decision:** the employee can edit while the entry is pending (it stays pending), fix and resubmit after Request changes (pending again, marked "Edited after a decision"), or change approved hours (back to pending, as in the grid). Withdraw deletes the entry only while it's pending and has never been decided. **Why:** typed hours follow the same lifecycle today (`CANNOT_CLEAR_DECIDED`).
16. **Decision:** the API keeps `source: "manual"` for pop-up entries, so the Tracked/Manual shares stay right. On screen they get a **Manual request** chip in place of the plain "Manual" source chip. **Why:** typed hours already show "Manual", and one word for two different things side by side would mislead.
17. **Decision:** the list is a **Manual hours N** tab on Timesheets, right after To review, and its count adds to the sidebar's Timesheets badge. The milestone panel's Approvals tab doesn't list these entries but shows one line linking to the tab, filtered to that milestone. **Why:** O4, and managers working from a milestone still learn that manual hours are waiting.
18. **Decision:** reviewers get a bell for each new submission and each resubmission, but not for edits while pending. The employee gets one on Request changes (today's `ENTRY_REJECTED`, reworded) and one on approval. **Why:** this is a request that needs a decision, like change requests, which notify in both directions; bells for pending edits would only add noise.
19. **Decision:** the public demo account can't submit, edit or withdraw, but can approve and request changes. **Why:** this is the same split as change requests; the demo admin keeps no timesheet.
20. **Decision:** the 24h check adds the day's unsubmitted timer drafts to its saved pending and approved hours. **Why:** those drafts will be submitted later, and counting them now avoids a day that can't be saved.

## 4. Data: `backend/v1/migrations/016_manual_hours.sql` (additive)

```sql
-- "Log hours manually" (spec 2026-10-17). Additive: existing entries keep NULL = not a manual request.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS manual_reason text CHECK (manual_reason IS NULL OR manual_reason IN
  ('forgot_timer', 'away_from_computer', 'meeting_or_call', 'timer_problem', 'other'));
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS manual_details text
  CHECK (manual_details IS NULL OR char_length(manual_details) <= 500);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_manual_details_need_reason
  CHECK (manual_details IS NULL OR manual_reason IS NOT NULL);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_manual_other_details
  CHECK (manual_reason IS DISTINCT FROM 'other' OR char_length(coalesce(manual_details, '')) >= 10);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_manual_untracked CHECK (manual_reason IS NULL OR tracked_hours = 0);
CREATE INDEX IF NOT EXISTS time_entries_manual_pending ON time_entries (project_id)
  WHERE manual_reason IS NOT NULL AND status = 'pending';
```

- `UNIQUE (user_id, milestone_id, work_date)` stays as it is: one entry per cell (decision 2).
- Entry views (`service._entry_view`, used by week, month and approvals) gain `updated_at` and `manual: null | {"reason": "<code>", "details": "<text>" | null}`.
- `write_entry(..., manual=(reason, details))` writes the two columns (None leaves them unchanged). It runs with `tracked=0` and `needs_note=False`.

**Where the code goes:**
- Backend: pure rules in `app/rules/manual_hours.py` (`REASONS` code → label, mirrored by the frontend; `WINDOW_DAYS = 7`; `in_window()`, `is_quarter()`, `clean_details()`). The service is `app/features/time/manual.py`, reusing `_validate_cell`, `cell_state`, `lock_person`, `_check_daily_cap`, `write_entry`, `_load_entry`/`_apply_decision`, `person_week_flags` and `changes._recipients`. Routes go in `routes.py`.
- Frontend: `timer/ManualHoursButton.jsx`, `ManualHoursDialog.jsx`, `LogTimeActions.jsx`; `timesheet/ManualCell.jsx`; `timesheets/ManualTab.jsx`; hooks in `api/queries.js`; `can(user, 'hours.manual')` (the same rule as `timesheet.use`, listed in `DEMO_BLOCKED`).

## 5. The pop-up (employee)

The milestone comes from where the button was pressed. The dialog uses the same pattern as Request a change (`maxWidth="xs"`, `fullWidth`), titled **Log hours manually**, with "Schema Mapping · Apollo Data Migration" under the title.

| Field | Control | Rule | Message |
|---|---|---|---|
| Day | select of 8 days: "Today, Sat 17 Oct", "Yesterday, Fri 16 Oct", "Thu 15 Oct"… | default today (in the Day view: the open day) | server: "Pick today or one of the 7 days before" |
| Hours | text, decimal keyboard, focused first | 0.25–24, quarter hours | "Between 0.25 and 24 hours" · "Use quarter hours: .25, .5 or .75" |
| Why not the timer? | radio group of the 5 reasons, with that legend | required | "Pick a reason" |
| Details | multiline, counter | Other: 10–500 required, else optional ≤ 500 | label "Details (required for Other)" · "Say what happened (at least 10 characters)" |
| Work note | multiline, counter | 10–500, always | "What you worked on · 0/500" · "At least 10 characters" |

- **Hints:**
  - Under the fields, "Already logged that day: 6h · that week: 38h", from the chosen day's week.
  - When the hours would take the week past 40h: "This takes your week over 40h, so it goes to your manager as overtime."
- **Footer:** "Your manager reviews manual hours one by one. They count toward the budget once approved."
- **Buttons:** Cancel and **Send for review** ("Sending…" while it sends). Send is disabled while any field is invalid.
- **Server errors** show in an `ErrorAlert` inside the dialog, and what was typed stays.
- **After sending:**
  - the dialog closes;
  - toast "Sent 2h on Schema Mapping (Fri 16 Oct) for review";
  - the week, month and manual-hours queries refresh.
- **Edit mode:** the title is **Edit manual hours**, or **Fix and resubmit** with the manager's reason in a warning alert at the top. The day shows as text, not a select. The button reads **Save changes** or **Resubmit**.

## 6. On the employee's timesheet

- **Week grid and Day view:**
  - The cell's hours are read-only. It looks like a timer-locked cell, with an edit icon instead of the lock.
  - Under the hours: the status words (Pending / Approved / Needs revision, plus Overtime) and the **Manual request** chip, whose tooltip shows the reason and details.
  - Actions: **Edit** when pending or approved; **Fix and resubmit** plus the manager's reason when sent back.
  - The Day view row's work-note field shows the request's note, read-only.
- **Entry details panel and the Month day panel:** the reason, details, note and status, the same actions, and **Withdraw** (only while pending and never decided). Withdraw asks first: "Withdraw these hours? 2h on Schema Mapping, Fri 16 Oct, are removed and your manager won't see them."
- **Refusals name the fix:**
  - "Fri 16 Oct already has 3h on Schema Mapping. Change them on your timesheet."
  - "Fri 16 Oct has timer hours on Schema Mapping. Use Request a change to add time."
  - "Your timer on Schema Mapping is running. Stop it first."
- **Start timer** on a milestone whose cell for today holds manual hours is disabled, with the tooltip "You logged today's hours here manually. Edit that request instead." `useLoggable` already loads the week, and the server refuses too.

## 7. The Manual hours list (managers, admins, delegates)

- **Tab:** "Manual hours N", where N counts the pending items the viewer may decide. URL: `?tab=manual`, with the same `?user=&project=&milestone=` filters and "Show everyone" button as To review.
- **Intro:** "Hours logged without the timer. Each needs its own decision; Approve week never includes them."
- **Order:** oldest work date first, then last name. No grouping by week, because each entry gets its own decision.
- **Desktop columns:**
  - **Person** · **Date** · **Milestone** (project under it) · **Hours**;
  - **Why not the timer** (the reason label, details under it) · **Work note**;
  - **Flags**: `FlagChips` plus Overtime, "Edited after a decision" and "Delegated from …";
  - actions: **Budget impact** (today's `BreakdownPanel`), **Request changes**, **Approve 2h**.
- **Phones:** one card per entry in the same order, with the actions in a 44 px row.
- **Approve:** toast "Approved 2h for Ben Okafor".
- **Request changes:** a dialog titled "Request changes" with a required "Reason" (up to 1000 characters) and the line "Ben sees your reason on their timesheet and can fix and resubmit." Without a reason: "Tell the employee why". Then the toast "Sent back to Ben Okafor".
- **Errors** (stale, already decided) show on the row, and the list refetches.
- **Empty:** "No manual hours waiting", with "Hours your team logs without the timer show up here."
- **To review:** when a person also has manual hours waiting that week, their person-week card adds "· 2h more in Manual hours". It links to the tab filtered to that person and is computed from the cached manual list, so it needs no API change.
- **Milestone panel, Approvals tab:** when the milestone has pending manual hours, an info line under the heading, also shown in the empty state: "2 manual-hours requests on this milestone are reviewed separately. Review manual hours". It links to `/timesheets?tab=manual&milestone=<id>`.

## 8. Rules interplay

| Rule | For manual hours |
|---|---|
| 24h day | The day's saved pending and approved hours, plus its timer drafts, plus these hours must be ≤ 24, or `400 DAY_OVER_24H` (decision 20) |
| 40h week | They count from submission, because pending hours count. `write_entry` sets the overtime flag, the label "Pending (Overtime requested from …)" and the one-per-week `OVER_40H` alert |
| Closed work | On submit, edit, resubmit and withdraw: a project on hold, completed or archived, or a milestone archived or completed, gives `409 PROJECT_NOT_OPEN` |
| Assignment, dates | `NOT_ASSIGNED` and `OUT_OF_PROJECT_RANGE`, the grid's checks |
| Timer locks | Decisions 2–4. Change requests are unaffected (a manual cell isn't timer-locked, so `NOT_LOCKED`) |
| Proof of work | The note is always 10–500 characters (decision 7); `needs_note` is false |
| Stale entry, rejection reason | Decision 14 gives `409 STALE_ENTRY`. The database check already requires a reason on every rejection |
| Concurrency | Submit and edit run under `lock_person` in one transaction. A unique-key race (23505) becomes `CELL_HAS_HOURS` |
| Flags, HR | The usual flags show in the list; BACKDATED can't fire inside the window. Approved hours go to HR like any others, and later edits flag "Changed after HR submission" as today |

## 9. API (all additive)

**`POST /manual-hours`**: for anyone who keeps a timesheet.
- Request: `{"milestone_id", "work_date": "2026-10-16", "hours": "2.5", "reason": "forgot_timer", "details": null, "note": "…"}`.
- Response: `201 {"entry": <entry view>, "week_start": "2026-10-12"}`.
- Errors: `403 TIMESHEET_DISABLED`; `400 VALIDATION_ERROR` by field (`hours` invalid_number / min / max / quarter; `reason` invalid; `details` and `note` min_length:10 / max_length:500); `400 OUTSIDE_WINDOW`, `NOT_ASSIGNED`, `OUT_OF_PROJECT_RANGE`, `DAY_OVER_24H`; `409 PROJECT_NOT_OPEN`, `CELL_HAS_HOURS {entry_id}`, `TIMER_HOURS_LOCKED`, `TIMER_RUNNING`.

**`PUT /manual-hours/{id}`**: owner only; anyone else gets 404.
- Request: `{"hours", "reason", "details", "note"}`. Response: `200 {"entry"}`.
- A pending entry stays pending. A rejected or approved one goes back to pending with `edited_after_decision`.
- Errors: `400 NO_CHANGE` when a pending entry comes back unchanged, plus the submit errors except the window.

**`DELETE /manual-hours/{id}`**: owner only. If pending and never decided: `200 {"withdrawn": id}`. Otherwise `400 CANNOT_CLEAR_DECIDED`.

**`GET /manual-hours?user=&project=&milestone=`**: managers and admins.
- Returns `[{"entry", "label", "user", "milestone", "project", "delegated_from", "week_logged_total", "progress_update", "flags"}]`.
- Lists pending pop-up entries the caller may decide (`APPROVER_SQL`; admins see all). Never the caller's own, and no archived work.

**`POST /manual-hours/{id}/approve`** with `{"expected_hours", "expected_updated_at"}`, and **`POST /manual-hours/{id}/request-changes`** with `{"reason", "expected_hours", "expected_updated_at"}`.
- Both return 200 and the entry view.
- Errors: `404 NOT_FOUND` / `403 FORBIDDEN` (not a reviewer, checked as in `_load_entry`); `403 SELF_APPROVAL`; `400 NOT_PENDING`, `NOT_MANUAL`, `VALIDATION_ERROR` (reason); `409 STALE_ENTRY`.

**Changed:**
- `GET /approvals` adds `AND t.manual_reason IS NULL`.
- `approve-week`, `/time-entries/{id}/approve` and `/reject` answer `409 MANUAL_REVIEW_ONLY`: "Manual hours are reviewed one at a time in Timesheets → Manual hours."
- `PUT /time-entries`: a changed manual cell answers `409 MANUAL_HOURS_LOCKED {cells}`. An unchanged re-send is skipped, so a rejected manual cell is never resubmitted from the grid.
- `POST /timers` answers `409 MANUAL_HOURS_LOCKED` (decision 4).
- `public_demo.py`: POST, PUT and DELETE `/manual-hours…` go in DENIED; approve and request-changes go in ALLOWED.

## 10. Notifications

| Type | To | Message | Opens |
|---|---|---|---|
| `MANUAL_HOURS_SUBMITTED` | Project manager and active delegate; if that's only the sender, the first admin (`changes._recipients`) | "Ben logged 2h on Schema Mapping (Fri 16 Oct) without the timer: Forgot to start the timer". On resubmit: "Ben resubmitted 2.5h of manual hours on Schema Mapping (Fri 16 Oct)" | `/timesheets?tab=manual&user=<id>`, hint "Review it in Manual hours" |
| `ENTRY_REJECTED` with `payload.manual: true` | The employee | "Your 2h of manual hours on Schema Mapping (Fri 16 Oct) need changes: <reason>" | That week's timesheet, as today |
| `MANUAL_HOURS_APPROVED` | The employee | "Kim approved your 2h of manual hours on Schema Mapping (Fri 16 Oct)" | That week's timesheet |

- Payload: `entry_id`, `work_date`, `week_start`, `hours`, `reason` (code), `resubmitted`, `milestone`, `project`, `by`.
- Add the new types to `_message`; unknown types currently fall back to the 40h text.
- Also add them to `NotificationBell` TARGETS and the Puppy's `KNOWN` set.

## 11. Accessibility, phones, dark mode (redesign §8)

- **Dialog:** labelled by its title, with focus on Hours. The reasons are a radio group under the legend "Why not the timer?". Errors use helper text and `aria-invalid`. Esc closes the dialog unless it's sending.
- **Buttons:** 44 px targets with full names ("Log hours manually on Schema Mapping"). The chip pairs an icon with its word, and its tooltip can be reached by keyboard.
- **Phones:** no horizontal page scroll at 375 px in the dialog or the tab. Below `md` the table becomes stacked cards.
- **Dark mode:** theme colours only, plus a dark-mode smoke render of the dialog and the tab.

## 12. Testing

- **Backend unit:** `tests/unit/test_rules_manual_hours.py` covers the window (day −7 allowed; −8 and the future refused), quarter hours, details for Other, and reason codes and labels.
- **Backend integration:** `tests/integration/test_manual_hours.py` covers:
  - **Lists:** a submitted entry is pending with its reason, appears in the week view with `manual`, is absent from `GET /approvals`, and is listed for the manager and the delegate but not for another manager. Employees get 403 on the list.
  - **Queue guard:** approve-week that includes a manual id gives 409 and approves nothing; single approve and reject give 409.
  - **Decisions:** stale hours and stale `updated_at`, SELF_APPROVAL, NOT_PENDING, a missing reason, and both bells.
  - **Rules:** 24h with drafts, the over-40 label and a single OVER_40H, closed / on-hold / archived / completed work, not assigned, CELL_HAS_HOURS, TIMER_HOURS_LOCKED, TIMER_RUNNING, Start timer on a manual cell, a grid edit giving MANUAL_HOURS_LOCKED, and an unchanged grid re-send of a rejected manual cell staying rejected.
  - **Edit and withdraw:** editing while pending, resubmitting (pending, edited, a new bell), withdrawing pending versus decided, someone else's id giving 404, and a manager's own submission notifying an admin.
  - **Existing suites:** `test_public_demo` and `test_migrations` still pass.
- **Frontend (Vitest):**
  - the dialog's fields, messages, 8 day options, Other's details, payload and server errors;
  - the button at all five places and hidden where Start timer is hidden, plus the demo state;
  - the manual cell's read-only state, chip and actions (Edit / Fix and resubmit / Withdraw);
  - the Manual hours tab: count, rows, approve, request changes and the stale error;
  - the To review caption, the Approvals tab line, the sidebar badge sum, and the bell's messages and links;
  - 375 px and dark-mode smoke tests.
- **E2E:** a new `frontend/e2e/manual-hours.spec.js`, on desktop and phones, on a milestone and day the seed leaves empty:
  1. The employee opens yesterday in the Day view and logs 2h manually ("Forgot to start the timer", with a note). The cell shows Pending and Manual request.
  2. The manager gets the bell. To review doesn't list the entry; Manual hours does. The manager requests changes with a reason.
  3. The employee sees Needs revision and resubmits with 2.5h. The manager approves, and the cell shows Approved.

## 13. Out of scope

- Asking for a reason when hours are typed into the grid (O3).
- Bulk-approving manual hours, or including them in Approve week.
- Moving a request to another day or milestone (withdraw it and send a new one instead).
- The pop-up for days more than 7 days back (the grid still takes them).
- Attachments or evidence files; editable reason lists; emails; a CSV export of the list; executives seeing the list.
- Reports that split manual-request hours from typed hours.
- Changes to timers, change requests or HR submission.
