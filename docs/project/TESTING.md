# Testing

The tests are built for **debugging**, not only for a green tick:

- Each layer answers a different question, so when something breaks, the first failing layer tells you where to look.
- Test names state the behaviour they protect, such as `test_alert_once_across_projects`.
- The business rules are pure functions with exhaustive edge cases.
- Every API error carries a `request_id`, which matches the server's log line.

| Layer | Tool | Count | What a failure here means |
|---|---|---|---|
| Rules (unit) | pytest | part of 102 unit tests | A business rule is wrong: at-risk, over-40, cycles, the capacity cap, usernames, milestone status, or the password policy. No database is involved |
| Core (unit) | pytest | part of 102 unit tests | The HTTP envelope, router guards, request IDs, hashing and tokens, or the SES fail-fast behaviour |
| API (integration) | pytest + real PostgreSQL 17 | 188 | An endpoint is wrong: permissions (401/403/404), validation, archiving, an audit row, a race-safe update, or what one role can see vs another |
| Frontend (component) | Vitest + React Testing Library + MSW | 84 | A screen is wrong: form gating, loading/empty/error states, role-based hiding, or the payload sent to the API |
| End-to-end | Playwright | 3 journeys × 2 devices | The pieces don't fit together in a real browser: real API, real database, real cookies |

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
```

- Set `OVERWATCH_TEST_DB=<name>` to use a separate test database. Two runs at the same time can then never truncate each other's data.
- Tests set `PBKDF2_ITERATIONS=1000`, so hashing is fast. Production uses 600,000.

### Frontend

```bash
cd frontend
npm test                      # Vitest, all component tests
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

1. **Onboarding:** an admin creates an account in the wizard. The test reads the welcome email from `backend/v1/.outbox/`, then the new user signs in with the temporary password, is forced to change it, and lands on the dashboard.
2. **Milestones:** a manager adds a milestone that depends on *Discovery* and assigns Eli. Eli starts it and moves it to *ready for review*; Eli can't complete it. The manager then completes it.
3. **Overtime:** an employee logs 9 h Monday to Friday. Only Friday shows "Pending (Overtime requested from …)". The manager gets exactly one notification and opens it in Approvals. The manager then views the budget impact and approves, and the project's consumed budget goes up.

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
TOTAL                                  2109     72    97%
290 passed in 15.23s
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

## Known gaps

| Gap | Why, and what covers it instead |
|---|---|
| The People list and user detail page have low component coverage (`features/people` at 38%) | The wizard and the show-once dialog are component-tested. The list → wizard → detail path is covered end to end by the onboarding journey. Detail-page edits (archive with dependents, reset password) are covered by API integration tests, but not by UI tests |
| SES is never called for real | `test_email_cloud.py` mocks boto3 to prove the 3-second fail-fast behaviour and the 10-minute cooldown. The live VPC has no route to SES (see [DECISIONS.md](DECISIONS.md)) |
| The Aurora connection with TLS isn't tested locally | Exercised by the deployed Lambda. The checks after each deploy are in the README's Deploy section |
| No load or concurrency tests | The race-prone steps (login lockout counter, reset-code attempts, refresh-token claim, the one-time over-40 alert) are single atomic SQL statements or unique constraints, each with an integration test |
| No automated accessibility audit | Queries in the component and e2e tests use roles and labels (`getByRole`, `getByLabel`), which fail if a control has no accessible name. Contrast relies on the theme's palette and hasn't been machine-audited |
| The e2e tests sign out by clearing cookies, not through the user menu | The menu lives in the drawer on phones. The menu item itself isn't tested directly; the server's logout endpoint is covered by integration tests |
| The request log line doesn't include the user ID | The audit log records the actor with the same `request_id` |
