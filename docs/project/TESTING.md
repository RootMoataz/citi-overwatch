# Testing

The tests are built for **debugging**, not only for a green tick:

- Each layer answers a different question, so when something breaks, the first failing layer tells you where to look.
- Test names state the behaviour they protect, such as `test_alert_once_across_projects`.
- The business rules are pure functions with exhaustive edge cases.
- Every API error carries a `request_id`, which matches the server's log line.

| Layer | Tool | Count | What a failure here means |
|---|---|---|---|
| Rules (unit) | pytest | part of 399 unit tests | A business rule is wrong: at-risk, over-40, cycles, the capacity cap, usernames, milestone status, priority, routing, claims, planning checks, messaging permissions, insights, reminders, timers and rounding, timer drafts and locks, over-limit thresholds, proof of work, red flags, the PNG sanitiser, or the password policy. No database is involved |
| Core (unit) | pytest | part of 399 unit tests | The HTTP envelope, router guards, request IDs, hashing and tokens, or the SES fail-fast behaviour |
| API (integration) | pytest + real PostgreSQL 17 | 859 | An endpoint is wrong: permissions (401/403/404), the executive and public demo guards, validation, archiving, an audit row, a race-safe update, or what one role can see vs another |
| Frontend (component) | Vitest + React Testing Library + MSW | 1,513 (98 files) | A screen is wrong: form gating, loading/empty/error states, role-based hiding, or the payload sent to the API |
| End-to-end | Playwright | 3 journeys × 2 devices + 17 layout checks | The pieces don't fit together in a real browser (real API, real database, real cookies), or the layout breaks where jsdom can't see it: overlapping top-bar controls, crumbs under the search field, a page wider than the window |

Counts as of 2026-10-16, after phase 3 of the redesign (the employee screens: My week, My timesheet and My history): **1,258 backend** (399 unit, 859 integration, collected; 97% coverage at the last full run) and **1,513 frontend** in 98 files, plus **23 end-to-end** (6 journey runs and 17 layout checks); all three suites pass. The four backend tests that failed whenever the UTC date was a Friday, Saturday or Sunday are fixed (see [Weekday-dependent backend tests](#weekday-dependent-backend-tests-fixed-16-october)), and so are the two that failed on a few dates because of Delta's demo budget (see [Delta's spend](#deltas-spend-on-some-dates-fixed-16-october)). Results are under [Current results](#current-results-2026-10-16); older dated results further down are snapshots taken at the time.

**Fail-closed guard tests.** Two integration tests walk every registered write route (66 of 114 routes): [`test_public_demo.py`](../../backend/v1/tests/integration/test_public_demo.py) fails while any write route is neither allowed nor denied for the public demo admin, and [`test_executive.py`](../../backend/v1/tests/integration/test_executive.py) fails if the set of routes that let an executive write differs from the expected list, and checks that no executive response carries `salary` or `hourly_rate`. A new endpoint can't ship without a decision for both.

Development was test-first: each rule and endpoint started as a failing test.

## Running the tests

### Backend

The integration tests need a local PostgreSQL 17 with the superuser password `postgres`. The suite creates its own database, rebuilds the schema on every run, and wraps each test in a transaction that's rolled back.

```bash
cd backend/v1
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m pytest                                   # everything
python -m pytest tests/unit                        # rules + core only, no database needed
python -m pytest --cov=app --cov-report=term       # with coverage
python -m pytest -k overtime -vv                   # one area, verbose

# what the counts above came from (own database, default -q addopts overridden):
OVERWATCH_TEST_DB=overwatch_test_docs2 python -m pytest -o addopts="" -q
OVERWATCH_TEST_DB=overwatch_test_docs2 python -m pytest -o addopts="" -q --cov=app
```

- Set `OVERWATCH_TEST_DB=<name>` to use a separate test database. Two runs at the same time can then never truncate each other's data.
- Tests set `PBKDF2_ITERATIONS=1000`, so hashing is fast. Production uses 600,000.

### Frontend

```bash
cd frontend
npm test                      # Vitest, all component tests
npx vitest run --maxWorkers=4 # the same, capped at 4 workers (what the counts above came from)
npx vitest run src/features/timesheet   # one feature
npm run coverage
npm run lint
```

API calls are answered by MSW handlers in [`src/test/server.js`](../../frontend/src/test/server.js). An unhandled request fails the test, so a missing or misspelled endpoint can't slip through. [`renderAsUser()`](../../frontend/src/test/render.jsx) renders a screen as an admin, manager or employee.

### End-to-end

```bash
cd frontend
npx playwright install chromium webkit   # once
npm run e2e                              # starts both servers itself
npx playwright show-report               # traces + screenshots of any failure
```

[`playwright.config.js`](../../frontend/playwright.config.js) starts:
- `devserver.py --db overwatch_e2e --reset --seed` on port 3001, with a fresh database every run;
- the Vite dev server on port 3000.

Each journey runs on **desktop Chrome (1280×800)** and on an **iPhone 13 profile (WebKit)**. The journeys:

1. **Onboarding:** an admin creates an account in the wizard. The test reads the welcome email from `backend/v1/.outbox/`, then the new user signs in with the temporary password, is forced to change it, and lands on **My week** with the **Your manager** card.
2. **Milestones:** a manager adds a milestone that depends on *Discovery* and assigns Eli; its row reads "Dependency: after Discovery" and names Eli. Eli opens the row, and in the panel's Details clicks **Start** and then **Ready for review**; **Complete** isn't offered to him. The manager then completes it from the row's **⋯** menu, and the row shows Completed.
3. **Overtime:** an employee logs 9 h Monday to Friday in the timesheet's Day view: for each day they pick it in the week strip, type the hours and a work note (proof of work), and they press **Submit** once at the end. Stepping through the days afterwards, only Friday shows "Pending (Overtime requested from …)". The manager gets exactly one notification and opens it on the Timesheets page, filtered to that person. The manager then views the budget impact and approves, and the Budget tab's **Approved spend** goes up.

[`shell.spec.js`](../../frontend/e2e/shell.spec.js) adds 17 layout checks that jsdom can't make (no layout engine). Each runs once, in its own project: tagged `@phone` (mobile only) or `@desktop` (desktop only), so nothing shows as skipped.

4. **Phone top bar** at 320, 375 and 390 px (3 checks): for the public demo admin's home and project page, an employee's project page, and an employee with a running timer (home and project page), no top-bar control draws over another or off the screen. Each control is measured with everything drawn inside it, text included, minus what an ellipsis clips. On every project page the back link is at least 24 × 24 px (WCAG 2.5.8). At 320 px Puppy is in the account menu and opens from there; from 375 px its button is in the bar.
5. **Desktop crumbs** at 1440 px: with a 113-character project name (stretched in the API response; nothing is saved) no crumb's text runs under the next, and the name ends in an ellipsis before the search field.
6. **Desktop top bar between md and lg** at 900, 960 and 1024 px (3 checks), sidebar open: for the demo admin's home, a project page and a person page, no crumb runs under the next or under the search field, the current page's crumb keeps at least 40 px, and the bar's controls don't overlap.
7. **No sideways scroll at 375 px:** every page in each role's navigation, a project page with each of its tabs (Overview, Milestones, Team, Budget, Hours) and an open milestone panel, and My profile, for employee, manager, executive and admin, once with the seeded names and once with every name stretched (a long name plus a 35-letter word): `document.documentElement.scrollWidth` must stay 375 (8 checks).
8. **No sideways scroll between md and lg:** the manager's Dashboard and the demo admin's Control centre at 900, 960 and 1024 px (2 checks): `scrollWidth` must stay the window's width.

## Current results (2026-10-16)

Windows 11, PostgreSQL 17, Node 24, Python 3.12. Backend: 1,227 tests (387 unit, 840 integration): 110 more than before the Month view, then 27 more with the weekday fix below. The full plain run on 16 October is the weekday fix's; the coverage run comes from `323ea89` (the timer workflow), which had 1,087 tests. The plain run at `3e61cd3` was on Thursday evening in New York, when the UTC date was already Friday, so it shows the four weekday-dependent tests fixed below. The latest figures come from phase 2 of the redesign (Task 12 of the project-page plan, 16 October): backend 1,250 passed (399 unit, 851 integration; the additions are the `sort`, `dir` and `counts` options on `GET /projects`), frontend 1,290 passed in 86 files twice in a row, lint clean, and end-to-end 23 passed (6.6 minutes, run alone). Phase 2's final fix wave then had backend 1,254 passed (399 unit, 855 integration; the four new integration tests pin the New York date in the at-risk check, an upper-case department id and an employee's `archived=true`), frontend 1,315 passed in 87 files twice in a row, lint clean, and end-to-end 23 passed (6.7 minutes, run alone). Its follow-up (the dashboard's milestone lists on the New York date, and the List/Timeline toggle keeping Back working) added one test each: backend 1,255 passed (856 integration), frontend 1,316 passed in 87 files, lint clean; end-to-end was not re-run for it. Phase 3 of the redesign (the employee screens, Task 11, 16 October) then had backend 1,258 passed (399 unit, 859 integration), frontend 1,513 passed in 98 files twice in a row, lint clean, and end-to-end 23 passed (7.1 minutes, run alone). The release run at `bc663bf`, just before the 16 October deploy, had backend 1,227, frontend 1,016 (twice in a row), lint clean and end-to-end 23 passed (5.4 minutes, run alone).

```
# backend/v1: OVERWATCH_TEST_DB=overwatch_test_docs2 python -m pytest -o addopts="" -q
1087 passed in 182.73s (0:03:02)                  # at 323ea89, before f6c27bd added 3 tests
1086 passed, 4 failed in 172.21s (0:02:52)        # at 3e61cd3, Thursday evening New York = Friday UTC: the 4 weekday-dependent tests
1227 passed in 209.94s (0:03:29)                  # 16 Oct, 07:53 UTC (a Friday), with the weekday fix
1227 passed in 211.16s (0:03:31)                  # 16 Oct, 08:05 UTC, with Delta's $37,000 budget too
1227 passed in 312.50s (0:05:12)                  # 16 Oct, 09:04 UTC, at bc663bf: the release run before the deploy
1250 passed in 212.65s (0:03:32)                  # 16 Oct, phase 2 (Task 12): the project page and the Projects list
1254 passed in 210.65s (0:03:30)                  # 16 Oct, phase 2's final fix wave
1255 passed in 211.80s (0:03:31)                  # 16 Oct, its follow-up
1258 passed in 211.41s (0:03:31)                  # 16 Oct, phase 3 (Task 11): the employee screens; run with OVERWATCH_TEST_DB=overwatch_test_p3

# backend/v1: same, with --cov=app (at 323ea89)
app\features\time\timers.py                240      9    96%
app\rules\timer_limits.py                   59      0   100%
TOTAL                                     6456    175    97%
1087 passed in 276.86s (0:04:36)

# collected per layer
tests/unit:        399 tests
tests/integration: 859 tests

# frontend: npx vitest run (two runs in a row, each the same)
 Test Files  98 passed (98)
      Tests  1513 passed (1513)      # phase 3 (Task 11), both runs (119.1 s and 121.5 s, then 124.2 s and 122.5 s after a lint fix to one test file)
      Tests  1316 passed (1316)      # phase 2's final fix wave's follow-up, 87 files (109.0 s)
      Tests  1315 passed (1315)      # phase 2's final fix wave, both runs (106.2 s, 107.7 s)
      Tests  1290 passed (1290)      # phase 2 (Task 12), both runs, 86 files; 73 files and 1016 tests at bc663bf

# frontend: npm run lint
no problems

# frontend: npx playwright test
  23 passed (5.2m)
  23 passed (5.4m)                                 # the release run at bc663bf, alone
  23 passed (6.6m)                                 # phase 2 (Task 12), alone
  23 passed (6.7m)                                 # phase 2's final fix wave, alone
  23 passed (7.1m)                                 # phase 3 (Task 11), alone
```

The end-to-end suite (3 journeys × desktop Chrome and iPhone 13 WebKit, plus 17 layout checks: 23 tests, 5.2 minutes) was last brought up to date on 16 October, with the shell fix wave and wave 3 (the layout checks: 320 px phones, the 24 px back link, 900–1024 px desktops; the Month panel's buttons are now named "Edit in Day view, <milestone>"): the overtime journey logs day by day in the Day view (hours and a work note per day, one **Submit** for the week) and follows the alert to the Timesheets page (after submitting, it switches to **Month**, selects Friday, checks that the day's panel lists its 9h pending, and presses **Edit in Day view** to land on that day; on a phone the panel sits under the grid), and the onboarding journey lands on My week. Phase 3 then brought them up to the employee screens: the overtime journey reads "45h counted of 40h" in the **Week totals** group before and after **Submit** and finds **Overtime** only on Friday in the Day view; the onboarding journey checks the **Your manager** and **Your focus** regions ("Nothing assigned to you right now"); the milestones journey collapses My week's **Completed** group, reloads to see it still collapsed, and expands it; and the 375 px layout check also measures My week's previous week, My timesheet's Day, Week (the grid scrolls inside its card while the page does not, and the Milestone column stays put), Entry details and Month views, and My history's Projects tab. All 23 pass. When the machine is busy with other suites, the milestones journey can time out waiting on the API; run the end-to-end suite on its own.

**Load flakes fixed (16 October).** Three tests used to fail now and then when the whole suite ran, and pass alone. Each waited for the wrong thing:
- `access.test.jsx` (the 403/404 redirects): the toast and the move home start together, but React Router runs navigation as a transition, which can commit after the toast under load. The tests now wait for the landing page or the location, not the toast.
- `messages.test.jsx` ("shows my messages… and marks it read"): the stubbed thread never moved `last_read_at`, so the page marked it read again after every refetch (22 times in 1.5 s), and "read once" only passed if the check landed between two posts. The stub now behaves like the server.
- `login.test.jsx` (the demo session running out): it waited 1.5 s of real time; the session timer now runs on a controlled clock.
Proof: the three files ran 10 times in a row next to a full suite (107/107 each time), and the full suite then passed five times in a row.

### The at-risk clock in the backend tests

The at-risk check counts from the New York date (`risk_today()` in `projects/service.py`). Most integration tests build their dates from the UTC date, so `conftest.py` pins that clock (`risk_clock_midday`, autouse, like the reminder clock) to 16:00 UTC of today's UTC date, which is midday in New York on the same date; the tests then agree with the server at any hour of the run. The two New York evening tests in `test_projects.py` move it themselves: 02:00 UTC (22:00 the evening before in New York) is not yet *Past due* or overdue, 05:00 UTC is.

### Weekday-dependent backend tests (fixed 16 October)

Four backend tests failed whenever the **UTC date was a Friday, Saturday or Sunday**, at any hour, and passed Monday to Thursday:

- `tests/integration/test_smart_insights.py::test_demo_manager_gets_at_least_three_meaningful_insights`
- `tests/integration/test_smart_insights.py::test_department_filter_narrows_insights_like_the_dashboard`
- `tests/integration/test_insights.py::test_dashboard_answers_all_seven_questions`
- `tests/integration/test_curate.py::test_a_second_run_adds_nothing`

An earlier note here blamed the hour (after 8 pm New York). It was the weekday: 8 pm on a Thursday in New York is already Friday in UTC, which is when they were first seen, and they failed again at 3 am New York on Friday. With Python's clock moved to each day of the week (and nothing else changed) they failed exactly on Friday, Saturday and Sunday UTC. The database session's time zone (UTC, America/New_York or Pacific/Kiritimati) made no difference: the app takes its dates from `datetime.now(timezone.utc)`, not from the database.

What was wrong:

1. **`demo_curate` put its overtime example in this week from Friday on.** Its timesheet step ([`app/curate.py`](../../backend/v1/app/curate.py) `_timesheets`) used this week "when there are days enough". From Friday, Monday to Thursday are in the past, and 4 × 11h fits the 42.5h example. A fresh seed already has Eli at 45h this week, so the dashboard and the smart insights showed a second person over 40h (Gia Rossi). That broke the dashboard test and the demo manager's insights test.
2. **The examples weren't made once.** A second run stopped only because every person-week the examples could use was already taken. From Friday the overtime example no longer used a slot in last week, so a second run made another overtime week there: 5 entries, an `OVER_40H` alert and an audit row. The same happens on any day when one more person on an in-progress milestone still has last week free.
3. **The department-filter test's own data.** Its 45h weeks were pending entries from Monday to Friday. From Friday the Monday entry is more than 3 days old, so the Technology view really did have an approval backlog.
4. **Found by the same runs: the seed on a weekend.** On a Saturday or Sunday the seed put Eli's timer change-request entry (2h) on that day of this week. Eli then had 47h, while his alert said 45h, and the demo manager's insights test failed again.

The fixes:

- `app/curate.py`: the overtime example always goes in last week, the latest complete one. This week only gets hours so far (at most 38h), so nobody curated is over 40h this week. Each example is made once: `_examples_made()` finds the ones an earlier run wrote, and the run skips them. It looks for a week holding the step's notes that is over 40h, the step's wrong-day rejection, and a week last week holding its notes at 32–38h with no rejection.
- `app/seed.py` `_change_request_slot`: last week's weekend comes before this week's.
- `test_smart_insights.py`: the department test's overtime weeks are approved, so the only pending entry is the stale one in Operations. The test now also checks that the unfiltered list shows that backlog, so the filter is what removes it.
- 27 tests added. `test_a_second_run_adds_nothing` runs once for each day of this week (7). `test_each_timesheet_example_is_made_once_even_while_someone_could_take_another` adds a fourth person whose last week is still free (7). `test_the_overtime_example_is_last_weeks_so_nobody_goes_over_40_this_week` (7). `test_elis_week_is_his_9h_a_day_whichever_day_the_seed_runs` pins the seed's clock to each day of the week, the way `conftest.py` pins the reminder clock (7). Before the fix these failed on Friday to Sunday, and the fourth-person test failed on every day.

Proof: the four tests plus the new ones (31 runs) pass on the real clock. They also pass with Python's clock moved to Monday, Friday, Sunday, and 23:30 New York on Thursday, Saturday and Sunday (that is, Friday, Sunday and Monday in UTC). On the same clocks the old code fails the four tests on Friday, Sunday and Thursday 23:30 New York. The scratch plugin used for this is not part of the repo: it swaps `datetime.now()` for a shifted one before the app and test modules import it, and it can't shift PostgreSQL's `now()`. So a test whose data mixes the two clocks can fail under the plugin and still pass on the real clock: `test_seed.py::test_seed_gives_gia_notes_and_tracked_hours_and_starts_the_flags_after_the_history` can fail with the clock moved to 17 October or later, even though it passes on the real clock.

### Delta's spend on some dates (fixed 16 October)

`test_curate.py::test_a_fresh_seed_is_curated_the_same_way` and `test_budgets_stay_plausible` each failed on a few dates. With Python's clock moved, the first failed on 13, 20 and 21 October, and the second on 27 October and 3 and 4 November.

Delta Compliance Audit is a completed project, and the curation aims to end its spend at 70–85% of its budget. Its new plan steps are filled at the people's planned hours (Kira Sato and Leo Martin, 20h a week each). That costs $27,400–30,000, depending on the date: the steps are placed relative to today, and each person's weekly day off rotates. Against the seed's $40,000 budget that was 68.7–74.9%. On a date under 70%, the curation warned ("spend ends at 69% of the budget, under 70%") and the tests' `70 <= budget_pct` check failed.

**Fix:** the seed gives Delta a **$37,000** budget, so its spend ends at 74–81% on every date, in the middle of the band. The tests and the 70–85% rule are unchanged. Proof:

- Both tests ran once a day from 16 October to 30 November with Python's clock moved. Before the change, 41 of 46 dates passed: they failed on 20 and 21 October and 27 October, and 3 and 4 November. After it, all 46 passed.
- The measured spend on those dates is $27,463–29,976 (74.2–81.0% of $37,000).

The live database keeps its own $40,000. Its Delta steps and hours already exist, so a later `demo_curate` adds no history there.

## Results (2026-10-13, after the final review's fixes; Windows 11, PostgreSQL 17.11, Node 24, Python 3.12)

### Backend: `python -m pytest --cov=app --cov-report=term`

```
app\rules\__init__.py                     0      0   100%
app\rules\at_risk.py                     18      0   100%
app\rules\capacity.py                     4      0   100%
app\rules\cycles.py                      32      0   100%
app\rules\milestone_status.py             7      0   100%
app\rules\overtime.py                    25      0   100%
app\rules\usernames.py                   37      0   100%
TOTAL                                  2110     72    97%
291 passed in 17.98s
```

The targets were ≥ 80% for `app/` and 100% for `app/rules/`. **Both are met**: 97% overall and 100% on the rules.

Selected modules from the same run:

| Module | Coverage |
|---|---|
| `router.py`, `email.py`, `dberrors.py`, `auth/reset.py`, `requests/service.py` | 100% |
| `members/service.py`, `seed.py`, `auth/service.py`, `security.py` | 98–99% |
| `projects/service.py`, `time/service.py`, `insights/service.py`, `milestones/service.py` | 93–97% |
| `db.py` | 72% (the cloud TLS connection path isn't exercised locally) |

### Frontend: `npx vitest run --coverage`

```
 Test Files  12 passed (12)
      Tests  84 passed (84)
File               | % Stmts | % Branch | % Funcs | % Lines |
All files          |   80.18 |    75.77 |   75.12 |   83.71 |
 api               |    87.5 |    78.16 |   81.45 |   93.79 |
 components        |   90.14 |    82.95 |   83.87 |   91.52 |
 lib               |   97.34 |    88.29 |     100 |   98.87 |
 features/login    |   91.11 |       82 |      96 |   93.58 |
 features/requests |   90.74 |    88.37 |    87.5 |   93.33 |
 features/profile  |   85.18 |    76.47 |   71.42 |    90.9 |
 features/projects |   79.29 |    74.28 |   64.36 |   81.92 |
 features/people   |   38.17 |    44.66 |   41.33 |   41.42 |
```

### End-to-end: `npx playwright test`

```
  6 passed (1.2m)
```

The suite was run twice in a row, with no flaky results.

### Lint: `npm run lint`

No problems reported.

## Live verification (2026-10-13, https://d3ucnz03j0sngl.cloudfront.net)

These checks were run after the final deploy, scripted in Playwright against the real site. They ran on desktop Chrome (1280×800) and on WebKit with an iPhone 13 profile.

| # | Check | Result |
|---|---|---|
| 1 | Sign in as each demo role (admin, manager, employee), on desktop and mobile | ✅ Pass |
| 2 | Dashboard shows all seven question sections, on desktop and mobile | ✅ Pass |
| 3 | Admin creates a user in the wizard. SES isn't reachable from the VPC, so the "Share these sign-in details" dialog shows the credentials once | ✅ Pass |
| 4 | The new user signs in with the temporary password, is forced to change it, then lands on the dashboard | ✅ Pass |
| 5 | Manager adds a milestone depending on *Discovery* and assigns Eli. Eli starts it and marks it ready for review, with no Complete button; the manager completes it | ✅ Pass |
| 6 | Manager opens the over-40h notification for Eli, then Approvals and the budget impact (cost shown, no hourly rate), and approves. Consumed budget on the Budget tab rises | ✅ Pass |
| 7 | Admin archives an account, restores it and archives it again from the People page. Archived milestones disappear from the project | ✅ Pass |
| 8 | Forgotten password: generic response, the code step appears, and the page points to an admin, since email can't be sent from the live site | ✅ Pass |
| 9 | As an employee, People, Audit log, Approvals and Allocation are absent from the navigation. Direct `POST /projects` and `GET /users` return `403`, and an unknown project shows an error, not a blank screen | ✅ Pass |
| — | Mobile: the drawer navigation works, the timesheet and approvals render, and the page doesn't scroll sideways | ✅ Pass |

**Found during these checks, and fixed before the results above:**
- **Opening any page other than `/` returned S3's `403` XML.** The bucket is private, so S3 answers unknown keys with 403, not the 404 that CloudFront maps to `index.html`. Fixed with a CloudFront Function on the S3 behaviour only (`infra/cloudfront.tf`), which serves `index.html` for app routes. `/api/*` is untouched.
- **The live check accounts and the milestone created by these checks were archived afterwards**, so the demo data looks as seeded.

## Known gaps

| Gap | Why, and what covers it instead |
|---|---|
| The People list and user detail page have low component coverage (`features/people` at 38%) | The wizard and the show-once dialog are component-tested. The list → wizard → detail path is covered end to end by the onboarding journey. Detail-page edits (archive with dependents, reset password) are covered by API integration tests, but not by UI tests |
| SES is never called for real | `test_email_cloud.py` mocks boto3 to prove the fail-fast behaviour and the 10-minute cooldown. The live Lambda has no route to SES and its role has no SES permission (see [DECISIONS.md](DECISIONS.md)); the EmailJS relay is tested against an MSW handler for the EmailJS endpoint in `emailRelay.test.js` |
| The Aurora connection with TLS isn't tested locally | Exercised by the deployed Lambda. The checks after each deploy are in the README's Deploy section |
| No load or concurrency tests | The race-prone steps (login lockout counter, reset-code attempts, refresh-token claim, the one-time over-40 alert) are single atomic SQL statements or unique constraints, each with an integration test |
| No automated accessibility audit | Queries in the component and e2e tests use roles and labels (`getByRole`, `getByLabel`), which fail if a control has no accessible name. Contrast relies on the theme's palette and hasn't been machine-audited |
| The e2e tests sign out by clearing cookies, not through the user menu | The menu lives in the drawer on phones. The menu item itself isn't tested directly; the server's logout endpoint is covered by integration tests |
| The end-to-end journeys don't use the timer | The timer workflow is covered by `test_timer_workflow.py` and `timerWorkflow.test.jsx` |
| The request log line doesn't include the user ID | The audit log records the actor with the same `request_id` |
