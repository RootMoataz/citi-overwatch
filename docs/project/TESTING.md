# Testing

The tests are built for **debugging**, not only for a green tick:

- Each layer answers a different question, so when something breaks, the first failing layer tells you where to look.
- Test names state the behaviour they protect, such as `test_alert_once_across_projects`.
- The business rules are pure functions with exhaustive edge cases.
- Every API error carries a `request_id`, which matches the server's log line.

| Layer | Tool | Count | What a failure here means |
|---|---|---|---|
| Rules (unit) | pytest | part of 377 unit tests | A business rule is wrong: at-risk, over-40, cycles, the capacity cap, usernames, milestone status, priority, routing, claims, planning checks, messaging permissions, insights, reminders, timers and rounding, timer drafts and locks, over-limit thresholds, proof of work, red flags, the PNG sanitiser, or the password policy. No database is involved |
| Core (unit) | pytest | part of 377 unit tests | The HTTP envelope, router guards, request IDs, hashing and tokens, or the SES fail-fast behaviour |
| API (integration) | pytest + real PostgreSQL 17 | 741 | An endpoint is wrong: permissions (401/403/404), the executive and public demo guards, validation, archiving, an audit row, a race-safe update, or what one role can see vs another |
| Frontend (component) | Vitest + React Testing Library + MSW | 923 (71 files) | A screen is wrong: form gating, loading/empty/error states, role-based hiding, or the payload sent to the API |
| End-to-end | Playwright | 3 journeys × 2 devices | The pieces don't fit together in a real browser: real API, real database, real cookies |

Counts as of 2026-10-15: **1,120 backend** (377 unit, 743 integration, 97% coverage) and **923 frontend** in 71 files, plus **6 end-to-end**, all passing. Four date-dependent backend tests fail when the suite is run after 8 pm New York time (see [Known issue](#known-issue-date-dependent-backend-tests)). Results are under [Current results](#current-results-2026-10-15); older dated results further down are snapshots taken at the time.

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
2. **Milestones:** a manager adds a milestone that depends on *Discovery* and assigns Eli. Eli starts it and moves it to *ready for review*; Eli can't complete it. The manager then completes it.
3. **Overtime:** an employee logs 9 h Monday to Friday in the timesheet's Day view: for each day they pick it in the week strip, type the hours and a work note (proof of work), and they press **Submit** once at the end. Stepping through the days afterwards, only Friday shows "Pending (Overtime requested from …)". The manager gets exactly one notification and opens it on the Timesheets page, filtered to that person. The manager then views the budget impact and approves, and the project's consumed budget goes up.

## Current results (2026-10-15)

Windows 11, PostgreSQL 17, Node 24, Python 3.12. Backend: 1,120 tests (377 unit, 743 integration), 30 more than before the Month view. The timed runs below come from `59d29fe` (the timer workflow) and `323ea89`, which had 1,087 tests; `f6c27bd` (no timer on a completed milestone) then added 3. The plain run was repeated at `3e61cd3` after 8 pm New York time, so it shows the known issue below. Frontend and end-to-end figures from the timesheet Month view (15 October), after the Day view rewrite of the end-to-end overtime journey.

```
# backend/v1: OVERWATCH_TEST_DB=overwatch_test_docs2 python -m pytest -o addopts="" -q
1087 passed in 182.73s (0:03:02)                  # at 323ea89, before f6c27bd added 3 tests
1086 passed, 4 failed in 172.21s (0:02:52)        # at 3e61cd3, run after 8 pm New York time: the 4 date-dependent tests

# backend/v1: same, with --cov=app (at 323ea89)
app\features\time\timers.py                240      9    96%
app\rules\timer_limits.py                   59      0   100%
TOTAL                                     6456    175    97%
1087 passed in 276.86s (0:04:36)

# collected per layer
tests/unit:        377 tests
tests/integration: 743 tests

# frontend: npx vitest run
 Test Files  71 passed (71)
      Tests  923 passed (923)

# frontend: npm run lint && npm run build
no problems; built in 9.68s

# frontend: npx playwright test
  6 passed (1.6m)
```

The end-to-end suite (3 journeys × desktop Chrome and iPhone 13 WebKit, 6 tests) was brought up to date on 15 October: the overtime journey logs day by day in the Day view (hours and a work note per day, one **Submit** for the week) and follows the alert to the Timesheets page (after submitting, it switches to **Month**, finds Friday's button by its name and hours, and checks that clicking it opens the Day view on that day), and the onboarding journey lands on My week. All 6 pass. When the machine is busy with other suites, the milestones journey can time out waiting on the API; run the end-to-end suite on its own.

### Known issue: date-dependent backend tests

Four backend tests fail when the suite is run after 8 pm New York time and pass at any other time:

- `tests/integration/test_smart_insights.py::test_demo_manager_gets_at_least_three_meaningful_insights`
- `tests/integration/test_smart_insights.py::test_department_filter_narrows_insights_like_the_dashboard`
- `tests/integration/test_insights.py::test_dashboard_answers_all_seven_questions`
- `tests/integration/test_curate.py::test_a_second_run_adds_nothing`

From 8 pm in New York (EDT) the UTC date is already the next day, and these tests depend on today's date. The failure is identical at `5b2df05`, so it predates the timesheet work. It is recorded here, not fixed.

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
