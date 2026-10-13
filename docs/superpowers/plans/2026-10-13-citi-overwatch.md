# Citi Overwatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy Citi Overwatch, a project tracking platform for ACME (admins, managers and employees managing projects, milestones, people, hours and budgets) that answers the workshop email's seven questions.

**Architecture:**
- **Backend:** one Python Lambda named `v1` (`backend/v1/`), routed by CloudFront at `/api/v1*`. It has an in-house router, pure-function business rules, and `pg8000` talking to Aurora PostgreSQL 17.
- **Frontend:** React + MUI app in `frontend/`, served from S3 behind the same CloudFront, so the API is same-origin.
- **Local:** native PostgreSQL 17, plus `scripts/devserver.py`, which turns HTTP requests into Lambda Function URL events and calls the same handler.

**Tech Stack:**
- Backend: Python 3.12 locally / 3.13 on Lambda, `pg8000`, `PyJWT`, standard-library PBKDF2. Tests with pytest and pytest-cov.
- Frontend: React 19, Vite 7, MUI, MUI X (DataGrid, Charts), React Responsive, React Router, TanStack Query, React Hook Form + Zod. Tests with Vitest, React Testing Library, MSW and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-citi-overwatch-design.md`. Read it alongside this plan. Business-rule values here are copied from it.

## Global Constraints

### Dependencies and runtime
- Backend runtime dependencies are pure Python only: `pg8000`, `PyJWT`. No `pydantic`, `bcrypt`, `psycopg` or anything with native wheels.
- `boto3` is used only for SES, imported lazily, and **not** listed in `requirements.txt`, because the Lambda runtime already provides it.
- Backend code must run on Python 3.12, the local version. Don't use 3.13-only features.
- Every file under `backend/v1/` ships in the Lambda zip. Dev-only dependencies go in `backend/v1/requirements-dev.txt`, never in `requirements.txt`.

### API conventions
- Every route sits under `/api/v1`. The router strips this prefix.
- Error body: `{"error": {"code", "message", "details", "request_id"}}`.
- Status codes: 201 create, 200 OK, 204 archive / no content, 400 validation, 401 auth, 403 forbidden, 404 missing or not visible, 409 duplicate, 423 locked, 500 server error.
- Nothing is hard-deleted. `DELETE` sets `is_archived = true` and `archived_at = now()`, then returns 204. Archived rows are excluded from every list, total and rule unless an admin passes `archived=true`.
- Dates go over the wire as `YYYY-MM-DD`. "Today" is the UTC date.

### Security values
- **Password policy:** at least 6 characters, at least 1 digit, at least 1 special character (any character in `string.punctuation`). The new password must differ from the current one.
- **Generated passwords:** 12 characters, with at least one uppercase letter, lowercase letter, digit and special character.
- **Hashing:** `pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>`. Iterations come from env `PBKDF2_ITERATIONS`, default `600000`; tests set `1000`.
- **Access token:** JWT HS256, valid for 15 minutes. Claims: `sub`, `role`, `rst` (restricted), `iat`, `exp`, `jti`.
- **Refresh token:** random, valid for 7 days, stored as a SHA-256 hash, rotated on every use.
  - Cookie `ow_refresh`: `HttpOnly; SameSite=Strict; Path=/api/v1/auth`, with `Secure` unless `IS_LOCAL=true`.
- **Temporary passwords** expire after 72 hours.
- **Reset codes:** 6 digits, valid for 15 minutes, at most 5 attempts, resend at most once per 60 seconds.
- **Lockout:** 5 failed logins in a row lock the account for 15 minutes.
- **Usernames** match `^[a-z0-9._]{3,20}$` and are unique on `lower()`. Emails are unique on `lower()`.

### Business values
- Weekly cap: `40` hours, on an ISO week (Monday–Sunday).
- Pending labels, exact text: `Pending approval`, and for entries flagged over 40h: `Pending (Overtime requested from {first_name} {last_name})`.
- Every time entry needs approval. Only approved entries count toward the budget. Nobody approves their own entries.
- The over-40h alert is one in-app notification per person-week, sent to the manager of the project whose entry crossed 40.
- Hourly rate: `salary / 2080`, rounded to 2 decimal places and copied onto the time entry when it's approved.
- At-risk budget rule: `budget > 0` and `budget_pct − milestone_done_pct ≥ 20`.

### Frontend
- Frontend is JavaScript/JSX, matching the repo.
- API base URL: `${import.meta.env.VITE_API_URL ?? ''}/api/v1`.
- TanStack Query defaults: `refetchInterval: 30000`, `refetchOnWindowFocus: true`.

### Process
- Commits carry **no Claude / Co-Authored-By attribution**. This is the owner's standing rule.
- Work on feature branches. Never push until the owner says "push". The target is the new public repo `citi-overwatch` under RootMoataz.
- Run all commands in **Git Bash** from the repo root unless a step says otherwise.

## Review Focus

These are inputs the spec doesn't spell out, but a real user will hit them. The test that pins each one lives in the task named.

1. **A manager approving their own hours.** Managers log time on milestones too. Approving your own entry must return 403, and those entries go to an admin. (Task 13, `test_cannot_approve_own_entry`)
2. **A week-grid save that crosses 40 partway through** processes entries in date order. The entry that crosses 40 and every entry after it are flagged `over_40`, and exactly one notification is created, even when the person's hours span several projects or the grid is saved again. (Task 13, `test_batch_crossing_flags_and_single_alert`)
3. **Archived records never leak.** An archived project's members, hours and milestones don't count toward the planned cap, budget, risk or dashboard. A non-admin requesting an archived project gets 404. (Task 10 `test_archived_project_hidden_from_non_admin`; Task 11 `test_archived_project_excluded_from_cap`)
4. **Case-only duplicates are rejected.** `JSmith` vs. `jsmith`, or `A@x.com` vs. `a@x.com`, returns 409 with field details. (Task 8, `test_case_insensitive_duplicates`)
5. **An access token expiring mid-session** with several requests in flight triggers exactly one refresh, and then the requests are retried. If the refresh fails, the user goes to `/login` once, with no loop. (Task 14, `api client refreshes once for concurrent 401s`)

---

## File Structure

```
.gitattributes                         # *.sh eol=lf
README.md                              # project README (Task 25); workshop README moved to docs/WORKSHOP_README.md
backend/v1/
  function.py                          # handler(event, context): internal ops or router.dispatch
  requirements.txt                     # pg8000, PyJWT
  requirements-dev.txt                 # pytest, pytest-cov
  pytest.ini
  app/
    __init__.py
    config.py                          # env-derived settings
    log.py                             # JSON logger
    http.py                            # Request, ApiError, json_response, request ids
    router.py                          # Router, route decorator, auth/role guard
    ctx.py                             # Ctx dataclass, token → Ctx
    db.py                              # connect, transaction, query helpers
    migrate.py                         # apply_migrations
    security.py                        # hashing, policy, tokens, codes
    validation.py                      # field validators → ApiError(400)
    authz.py                           # project/milestone visibility + manage checks
    audit.py                           # record()
    email.py                           # send_email(): outbox locally, SES in cloud
    rules/
      __init__.py
      usernames.py  cycles.py  capacity.py  overtime.py  at_risk.py  milestone_status.py
    features/
      __init__.py                      # registers all routes on the router
      auth/routes.py  auth/service.py
      users/routes.py users/service.py
      projects/routes.py projects/service.py
      requests/routes.py requests/service.py
      members/routes.py members/service.py
      milestones/routes.py milestones/service.py
      time/routes.py time/service.py
      insights/routes.py insights/service.py     # dashboard, allocations, audit-log
  migrations/001_init.sql
  scripts/migrate.py  scripts/seed.py  scripts/devserver.py
  tests/conftest.py  tests/unit/…  tests/integration/…
frontend/
  vite.config.js  vitest.config.js  playwright.config.js
  src/main.jsx
  src/app/        App.jsx, providers.jsx, theme.js, Layout.jsx, routes.jsx
  src/api/        client.js, queries.js
  src/auth/       SessionProvider.jsx, RequireAuth.jsx, ForcePasswordChange.jsx
  src/components/ ErrorAlert, EmptyState, ConfirmDialog, StatusChip, RiskBadges, PageHeader,
                  PasswordPolicyChecklist, ResponsiveTable, Timeline (.jsx each)
  src/features/   login/, dashboard/, projects/, milestones/, people/, requests/,
                  timesheet/, approvals/, allocation/, audit/, profile/
  src/lib/        permissions.js, schemas.js, format.js
  src/test/       setup.js, server.js (MSW)
  e2e/            *.spec.js
docs/project/     README-linked docs (Task 25)
```

---

## Day 1 – Tue Oct 13: backend foundation

### Task 1: Repo hygiene and backend skeleton with HTTP layer

**Files:**
- Create: `.gitattributes`, `backend/v1/{function.py,requirements.txt,requirements-dev.txt,pytest.ini}`, `backend/v1/app/{__init__.py,config.py,log.py,http.py,router.py}`, `backend/v1/tests/unit/test_http_router.py`
- Modify: `.gitignore`: add `backend/v1/.outbox/`, `.pytest_cache/`, `.coverage`, `htmlcov/`, `frontend/test-results/`, `frontend/playwright-report/`

**Interfaces:**
- Produces:
  - `Request` with attributes `method: str`, `path: str` (prefix `/api/v1` stripped, always starting with `/`), `path_params: dict[str,str]`, `query: dict[str,str]`, `headers: dict[str,str]` (lowercase keys), `cookies: dict[str,str]`, `request_id: str`, and method `json() -> dict` (raises `ApiError(400,"INVALID_JSON")`).
  - `class ApiError(Exception)` with `__init__(self, status:int, code:str, message:str, details:dict|None=None)`.
  - `json_response(status:int, body=None, *, headers:dict|None=None, cookies:list[str]|None=None) -> dict`, in Lambda Function URL response shape.
  - `Router` with `.route(method:str, pattern:str, *, auth:bool=True, roles:set[str]|None=None, allow_restricted:bool=False)`, a decorator. Patterns look like `/projects/{id}`. Handler signature: `handler(req: Request, ctx, conn) -> dict`.
  - `Router.dispatch(event:dict, conn_factory) -> dict`. Auth resolution is a hook filled in by Task 5. Until then, routes with `auth=True` return 401.
  - `router` is a module-level singleton in `app/router.py`.
  - `function.handler(event, context) -> dict`.

- [ ] **Step 1:** Add `.gitattributes` with `*.sh text eol=lf` and `*.sql text eol=lf`. Then:
  - `git mv README.md docs/WORKSHOP_README.md`
  - Create a placeholder `README.md` containing `# Citi Overwatch` and one sentence. The full README is written in Task 25.
  - Write `requirements.txt` with exactly `pg8000==1.31.2` and `PyJWT==2.9.0`.
  - Write `requirements-dev.txt` with `pytest==8.3.3` and `pytest-cov==5.0.0`.
  - Run `python -m pip install -r backend/v1/requirements.txt -r backend/v1/requirements-dev.txt`.
  - Expected: both files install successfully.

- [ ] **Step 2: Write failing tests** in `tests/unit/test_http_router.py`. Build events with a helper `evt(method, path, body=None, headers=None, cookies=None)` shaped like a Function URL payload v2: `rawPath`, `rawQueryString`, `headers`, `cookies`, `body`, `isBase64Encoded`, `requestContext.http.method`.

  ```python
  def test_strips_prefix_and_matches_path_params(): # GET /api/v1/projects/abc → handler sees path_params == {"id": "abc"}, status 200
  def test_unknown_route_returns_404_envelope():     # body["error"]["code"] == "NOT_FOUND", request_id present
  def test_wrong_method_returns_405():               # code "METHOD_NOT_ALLOWED"
  def test_request_id_echoed_from_header():          # header x-request-id: "r-1" → response header + error body use "r-1"
  def test_request_id_generated_when_missing():      # uuid4 format
  def test_api_error_becomes_envelope():             # handler raises ApiError(400,"VALIDATION_ERROR","bad",{"name":"required"})
  def test_unexpected_exception_is_generic_500():    # message == "Internal server error"; exception text NOT in body
  def test_invalid_json_body_is_400():               # code "INVALID_JSON"
  def test_base64_body_decoded():
  def test_auth_route_without_token_is_401():        # code "AUTH_REQUIRED"
  ```

- [ ] **Step 3:** Run `cd backend/v1 && python -m pytest tests/unit/test_http_router.py -v`. Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 4: Implement.**
  - `log.py`: `log(level:str, msg:str, **fields)` writes one JSON line to stdout.
  - Every response gets an `x-request-id` header.
  - `dispatch` wraps each handler and logs `request_id`, `method`, `path`, `status`, `duration_ms` and `code`.
  - Unexpected exceptions are logged with the stack trace, and the response is a generic 500.
  - `config.py` reads `IS_LOCAL`, the `POSTGRES_*` variables and `PBKDF2_ITERATIONS`.

- [ ] **Step 5:** Run the tests again. Expected: all PASS.

- [ ] **Step 6: Commit.** Branch from `docs/design-spec`, so the spec and plan travel with the code.
  ```bash
  git checkout docs/design-spec && git checkout -b feat/backend
  git add .gitattributes .gitignore README.md docs/WORKSHOP_README.md backend/v1
  git commit -m "Add v1 Lambda skeleton with router, error envelope and request ids"
  ```

### Task 2: Database layer, schema migration and test database

**Files:**
- Create: `app/db.py`, `app/migrate.py`, `migrations/001_init.sql`, `scripts/migrate.py`, `tests/conftest.py`, `tests/integration/test_migrations.py`
- Modify: `function.py` (internal op `{"op":"migrate"}`)

**Interfaces:**
- Produces:
  - `connect() -> pg8000.native.Connection`. Uses TLS (`ssl_context=ssl.create_default_context()`) when `IS_LOCAL != "true"`. Reuses one module-level connection, and reconnects if it was closed.
  - `transaction(conn)`, a context manager that commits on success and rolls back on any exception.
  - `query(conn, sql, **params) -> list[dict]`, `query_one(conn, sql, **params) -> dict|None`, `execute(conn, sql, **params) -> int` (rows affected). These use pg8000 named `:param` syntax.
  - `apply_migrations(conn) -> list[str]` returns the filenames it applied. It records them in `schema_migrations(filename, applied_at)`. On first run it inserts `app_secrets('jwt_secret', secrets.token_urlsafe(48))`.
  - `function.handler({"op":"migrate"}, None) -> {"applied":[...]}`. An event without `requestContext.http` is treated as an internal op.
  - Test fixtures in `tests/conftest.py`:
    - `db`, session scope: creates database `overwatch_test` if it's missing, drops and recreates the `public` schema, and applies migrations.
    - `conn`, function scope: after each test, runs `TRUNCATE` on every table except `schema_migrations` and `app_secrets`, with `RESTART IDENTITY CASCADE`.
    - The fixtures set the env vars `POSTGRES_HOST=localhost`, `POSTGRES_PORT=5432`, `POSTGRES_USER=postgres`, `POSTGRES_PASS=postgres`, `POSTGRES_NAME=overwatch_test`, `IS_LOCAL=true` and `PBKDF2_ITERATIONS=1000`.
    - This truncation approach replaces the spec's "rollback per test" wording. Same isolation, simpler with pg8000.

- [ ] **Step 1: Write `001_init.sql`.** It contains every table, column and constraint in spec §6:
  - Enums: `user_role`, `project_status` (planned, active, on_hold, completed), `milestone_status` (not_started, in_progress, ready_for_review, completed), `request_status`, `entry_status` (pending, approved, rejected).
  - `uuid` primary keys `DEFAULT gen_random_uuid()`.
  - Unique indexes on `lower(username)` and `lower(email)`.
  - A partial unique index on `lower(projects.name) WHERE NOT is_archived`.
  - `CHECK` constraints:
    - `predicted_end_date >= start_date`
    - milestone `end_date >= start_date`
    - `budget >= 0`
    - `planned_hours_per_week > 0 AND <= 40`
    - `hours BETWEEN 0.25 AND 24`
    - `status <> 'rejected' OR rejection_reason IS NOT NULL`
    - `milestone_id <> depends_on_id`
  - Unique `(user_id, milestone_id, work_date)` on `time_entries`.
  - Unique `(type, subject_user_id, week_start)` on `notifications`.
  - `audit_log` with no update path in the app.

- [ ] **Step 2: Write failing tests.**
  ```python
  def test_migrations_create_all_tables(db):     # set ⊇ {"users","refresh_tokens","password_reset_codes","app_secrets","projects","project_requests","project_members","milestones","milestone_dependencies","milestone_assignees","milestone_notes","time_entries","notifications","audit_log"}
  def test_migrations_idempotent(db):            # second apply_migrations(conn) == []
  def test_jwt_secret_created_once(db):          # one row, len(value) >= 48
  def test_internal_migrate_op(db):              # handler({"op":"migrate"}, None) == {"applied": []}
  def test_username_unique_case_insensitive(conn):  # inserting "JSmith" then "jsmith" raises a pg8000 DatabaseError
  ```

- [ ] **Step 3:** Run `python -m pytest tests/integration/test_migrations.py -v`. Expected: FAIL.

- [ ] **Step 4: Implement** `db.py`, `migrate.py` and `scripts/migrate.py`. The script runs `python scripts/migrate.py --db overwatch_dev` and creates the database if it's missing. Add the internal op to `function.py`.

- [ ] **Step 5:** Run the tests. Expected: PASS. Then run `python scripts/migrate.py --db overwatch_dev`. Expected: it prints `applied: ['001_init.sql']`.

- [ ] **Step 6: Commit.** `git commit -m "Add Postgres layer, initial schema migration and test database fixtures"`

### Task 3: Security primitives

**Files:**
- Create: `app/security.py`, `tests/unit/test_security.py`

**Interfaces:**
- Produces:
  - `hash_password(pw:str) -> str` and `verify_password(pw:str, stored:str) -> bool`, which compares in constant time.
  - `password_policy_errors(pw:str) -> list[str]`. The returned codes are a subset of `["TOO_SHORT","NEEDS_DIGIT","NEEDS_SPECIAL"]`.
  - `generate_temp_password() -> str` and `generate_reset_code() -> str`, both using `secrets`.
  - `hash_token(token:str) -> str` (sha256 hex) and `new_refresh_token() -> str`.
  - `create_access_token(*, user_id:str, role:str, restricted:bool, secret:str, now:datetime) -> str`.
  - `decode_access_token(token:str, secret:str, now:datetime) -> dict`. Raises `ApiError(401,"TOKEN_EXPIRED")` or `ApiError(401,"AUTH_REQUIRED")`.
  - `create_purpose_token(*, user_id:str, purpose:str, minutes:int, secret, now) -> str` and `decode_purpose_token(token, purpose, secret, now) -> str`, which returns the user ID. Used for password-reset tokens.

- [ ] **Step 1: Write failing tests.**
  ```python
  @pytest.mark.parametrize("pw,errs", [("ab1!", ["TOO_SHORT"]), ("abcdef!", ["NEEDS_DIGIT"]), ("abcde1", ["NEEDS_SPECIAL"]), ("abc1!x", []), ("", ["TOO_SHORT","NEEDS_DIGIT","NEEDS_SPECIAL"])])
  def test_password_policy(pw, errs): assert password_policy_errors(pw) == errs
  def test_hash_roundtrip_and_format(): # startswith("pbkdf2_sha256$1000$"); verify ok; verify("wrong") False
  def test_same_password_different_salts():
  def test_generated_temp_password_meets_policy_100_times(): # len == 12, has upper/lower/digit/special, policy errors == []
  def test_reset_code_six_digits(): # re.fullmatch(r"\d{6}", code)
  def test_access_token_roundtrip_and_claims(): # sub, role, rst, exp - iat == 900
  def test_access_token_expired_raises_token_expired():   # now + 16 min
  def test_tampered_token_raises_auth_required():
  def test_purpose_token_wrong_purpose_rejected():
  ```

- [ ] **Step 2:** Run `python -m pytest tests/unit/test_security.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement** using `hashlib.pbkdf2_hmac("sha256", …)`, `hmac.compare_digest`, `secrets` and `jwt.encode/decode(..., algorithms=["HS256"])`.

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add password hashing, policy, tokens and reset codes"`

### Task 4: Pure business rules

**Files:**
- Create: `app/rules/{usernames,cycles,capacity,overtime,at_risk,milestone_status}.py` and `tests/unit/test_rules_*.py`, one per module.

**Interfaces:**
- Produces (all pure, with no database access):
  - **Usernames:**
    - `normalize_username(s) -> str` lowercases and trims.
    - `is_valid_username(s) -> bool` checks the regex from Global Constraints.
    - `suggest_usernames(first:str, last:str, typed:str|None, is_taken:Callable[[str],bool], count:int=5, rng=random) -> list[str]`. Candidates are valid and not taken, with no duplicates. Order: base forms first (`jsmith`, `john.smith`, `smithj`, `john_smith`, `johns`), then the typed text (normalized, if valid and free), then each base form plus 2 random digits.
  - **Cycles:**
    - `creates_cycle(edges:dict[str,set[str]], milestone_id:str, predecessors:set[str]) -> bool`. `edges` maps a milestone to its predecessors. Uses depth-first search from each new predecessor looking for `milestone_id`.
    - `dependency_order(edges) -> list[str]` returns a topological order, used for the chain view.
  - **Capacity:** `fits_weekly_plan(other_hours:Decimal, requested:Decimal, cap:Decimal=Decimal(40)) -> bool`.
  - **Over-40, forecast and breakdown** (`overtime.py`):
    - `week_flags(*, before_total:Decimal, after_total:Decimal, cap=Decimal(40)) -> tuple[bool, bool]` returns `(over_40, crossed)`, where `over_40 = after_total > cap` and `crossed = before_total <= cap < after_total`.
    - `forecast_total(*, consumed:Decimal, weekly_costs:list[Decimal], weeks_remaining:int) -> Decimal` = consumed + (average of up to the last 4 values) × `max(weeks_remaining, 0)`. An empty list forecasts `consumed`.
    - `approval_breakdown(*, hours:Decimal, hourly_rate:Decimal, milestone_cost:Decimal, budget:Decimal, consumed:Decimal, forecast:Decimal) -> dict` returns `request_cost`, `milestone_cost_after`, `remaining_before`, `remaining_after`, `pct_of_remaining` (None when remaining ≤ 0), `forecast` and `forecast_over_budget`.
  - **At-risk:** `at_risk_reasons(*, status:str, is_archived:bool, predicted_end:date, budget:Decimal, consumed:Decimal, milestones:list[dict], today:date) -> list[str]`.
    - Each milestone dict has `end_date` and `status`.
    - Possible codes, in this order: `OVERDUE_MILESTONE`, `PAST_DUE`, `BUDGET_BURN`.
    - Returns `[]` when the project is completed or archived.
  - **Milestone status:** `can_transition(*, current:str, target:str, is_manager:bool, blocked:bool) -> bool`.
    - Employees may move `not_started→in_progress` and `in_progress→ready_for_review`.
    - Managers may do anything an employee can, plus `ready_for_review→completed`, `in_progress→completed`, `ready_for_review→in_progress` and `completed→in_progress`.
    - `blocked` forbids leaving `not_started`.

- [ ] **Step 1: Write failing tests.** Each module gets a test file aiming for 100% branch coverage. Required cases:
  ```python
  def test_suggestions_skip_taken_and_are_valid():    # is_taken = {"jsmith","john.smith"}.__contains__ → neither returned; all valid; len == 5
  def test_suggestions_include_typed_when_free():
  def test_cycle_direct_and_indirect():               # A←B, B←C; making A depend on C → True; D depends on A → False
  def test_self_dependency_is_cycle():
  def test_fits_plan_boundary():                      # 30 + 10 → True; 30 + 10.5 → False
  def test_week_flags():                              # (36, 40) → (False, False); (36, 42) → (True, True); (42, 45) → (True, False)
  def test_forecast_uses_last_four_weeks():           # consumed 1000, costs [100,200,300,400,500], 4 weeks → 1000 + 350*4 = 2400
  def test_forecast_empty_history():                  # → consumed
  def test_breakdown_numbers():                       # 8h × 50 = 400; budget 2000, consumed 1200 → remaining 800 → 400, pct 50.0
  def test_breakdown_no_remaining_pct_none():
  def test_at_risk_each_rule_and_combined():          # overdue milestone; today > predicted_end; budget 1000, consumed 500, 1/4 done (50 − 25 = 25 ≥ 20)
  def test_at_risk_budget_zero_skips_burn_rule():
  def test_at_risk_no_milestones_counts_zero_done():
  def test_completed_or_archived_never_at_risk():
  def test_employee_transitions():                    # in_progress→completed False for employee
  def test_blocked_cannot_start():
  ```

- [ ] **Step 2:** Run `python -m pytest tests/unit -k rules -v`. Expected: FAIL.

- [ ] **Step 3: Implement** the six modules.

- [ ] **Step 4:** Run `python -m pytest tests/unit --cov=app/rules --cov-branch --cov-report=term-missing`. Expected: PASS, and `app/rules` shows 100% coverage.

- [ ] **Step 5: Commit.** `git commit -m "Add pure business rules with full test coverage"`

### Task 5: Auth context, guards, audit and email helpers

**Files:**
- Create: `app/ctx.py`, `app/authz.py`, `app/audit.py`, `app/email.py`, `app/validation.py`, `tests/helpers.py`, `tests/integration/test_guards.py`
- Modify: `app/router.py` (fill in the auth hook)

**Interfaces:**
- Consumes: Task 3 `decode_access_token`; Task 2 `query_one`.
- Produces:
  - `@dataclass(frozen=True) class Ctx` with fields `user_id:str`, `role:str`, `restricted:bool`, `request_id:str`, and properties `is_admin` and `is_manager`. `is_manager` is true for both `manager` and `admin`.
  - `jwt_secret(conn) -> str`, cached in the module after the first read.
  - Router guard order:
    1. Missing or invalid bearer token → 401 `AUTH_REQUIRED` / `TOKEN_EXPIRED`.
    2. The user is archived or no longer exists → 401 `AUTH_REQUIRED`.
    3. `rst=True` on a route without `allow_restricted` → 403 `PASSWORD_CHANGE_REQUIRED`.
    4. Role not in `roles` → 403 `FORBIDDEN`.
  - `authz.load_project(conn, ctx, project_id, *, manage:bool=False) -> dict`.
    - Visible to: admins (archived projects only when the request passes `archived=true`); the project's manager; members of a non-archived project.
    - Not visible → 404 `NOT_FOUND`.
    - `manage=True` and the user isn't an admin or the project's manager → 403 `FORBIDDEN`.
  - `authz.load_milestone(conn, ctx, milestone_id, *, manage=False) -> tuple[dict, dict]` returns `(milestone, project)` using the same visibility rules.
  - `authz.is_assignee(conn, milestone_id, user_id) -> bool`.
  - `audit.record(conn, ctx, action:str, entity_type:str, entity_id:str, before:dict|None=None, after:dict|None=None) -> None`. Saves the changed values as JSON, with `password_hash` and token fields removed.
  - `email.send_email(to:str, subject:str, body:str) -> bool`.
    - When `IS_LOCAL=true`, writes `.outbox/<timestamp>-<to>.txt`.
    - Otherwise, sends via SES `send_email`, using source address `SES_FROM` (env, default `no-reply@codingworkshop.net`).
    - Returns `False` on any exception and logs it.
  - Validators: `require(body, *fields)`, `as_date(v, field)`, `as_decimal(v, field, min=None, max=None)`, `as_enum(v, field, allowed)`, `as_str(v, field, min_len=1, max_len=…)`. Each raises `ApiError(400,"VALIDATION_ERROR",…,{field: reason})`.
  - Test helpers in `tests/helpers.py`, used by every later integration task:
    - `make_user(conn, *, role="employee", username=None, password="Passw0rd!", manager_id=None, salary=Decimal("104000"), must_change=False) -> dict`
    - `token_for(conn, user, *, restricted=False) -> str` mints an access token directly.
    - `client` fixture (in `conftest.py`): `client.request(method, path, json=None, token=None, cookies=None) -> (status, body, headers, set_cookies)`. It builds a Function URL event and calls `function.handler`.
    - `outbox` fixture: points `.outbox` at `tmp_path` and returns a function that reads the newest message.

- [ ] **Step 1: Write failing tests**, using a throwaway route registered on a test router.
  ```python
  def test_expired_token_401_token_expired(conn):
  def test_restricted_token_blocked_except_allowed(conn):   # 403 PASSWORD_CHANGE_REQUIRED; allow_restricted route → 200
  def test_role_guard_403(conn):
  def test_archived_user_token_rejected(conn):
  def test_project_visibility_rules(conn):                  # employee non-member → 404; member → ok; manager of other project → 404
  def test_manage_requires_owner_or_admin(conn):            # member employee manage=True → 403
  def test_audit_strips_secrets(conn):                      # before={"password_hash":"x","name":"a"} → stored changes has no "password_hash"
  def test_local_email_writes_outbox(tmp_path, monkeypatch):
  ```

- [ ] **Step 2:** Run `python -m pytest tests/integration/test_guards.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add auth guard, visibility helpers, audit and email"`

### Task 6: Auth endpoints: login, refresh, logout, change password, me

**Files:**
- Create: `app/features/__init__.py`, `app/features/auth/{routes,service}.py`, `tests/integration/test_auth.py`
- Modify: `tests/helpers.py` (add `login`)

**Interfaces:**
- Consumes: Tasks 3 and 5.
- Produces these routes (as in spec §7):
  - `POST /auth/login` with body `{username, password}`.
    - Returns 200 `{access_token, user:{id,username,first_name,last_name,email,role,must_change_password}}` and sets the refresh cookie. A restricted login gets **no** refresh cookie.
    - Errors: 401 `INVALID_CREDENTIALS`, 423 `ACCOUNT_LOCKED` (details `{until}`), 401 `TEMP_PASSWORD_EXPIRED`.
  - `POST /auth/refresh` (no auth; reads the cookie) → 200 `{access_token, user}`, rotating the cookie. Errors: 401 `REFRESH_INVALID`.
  - `POST /auth/logout` (no auth) revokes the cookie's token and clears it → 204.
  - `POST /auth/change-password` (`allow_restricted=True`) with body `{current_password, new_password}`.
    - Errors: 400 `PASSWORD_POLICY` (details `{rules:[codes]}`) and 400 `PASSWORD_REUSED`.
    - On success: clears `must_change_password`, revokes all refresh tokens, issues a fresh unrestricted token and cookie → 200 `{access_token, user}`.
  - `GET /me` → the user, plus `salary`.
  - `PUT /me` with body `{first_name?, last_name?, email?}`. Any other key → 400 `FIELD_NOT_EDITABLE`.
- Produces in `tests/helpers.py`: `login(client, username, password) -> str` returns the access token.

- [ ] **Step 1: Write failing tests.**
  ```python
  def test_login_success_sets_refresh_cookie(client, conn):     # "ow_refresh=" in set_cookies[0]; "HttpOnly" in it
  def test_login_wrong_password_401_and_counts(client, conn):
  def test_lockout_after_5_failures_423(client, conn):           # 6th attempt with correct password → 423
  def test_temp_password_expired_401(client, conn):              # temp_password_expires_at in the past
  def test_must_change_login_is_restricted(client, conn):        # GET /me → 403 PASSWORD_CHANGE_REQUIRED
  def test_change_password_policy_and_reuse(client, conn):
  def test_change_password_unlocks_session(client, conn):        # then GET /me → 200
  def test_refresh_rotates_and_old_token_rejected(client, conn):
  def test_logout_revokes_refresh(client, conn):
  def test_put_me_rejects_role_and_salary(client, conn):         # {"role":"admin"} → 400 FIELD_NOT_EDITABLE
  ```

- [ ] **Step 2:** Run `python -m pytest tests/integration/test_auth.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement.** A successful login resets `failed_login_count`. Lockout sets `locked_until = now() + 15 min` and is cleared on expiry. Every state change is written to the audit log (`login`, `password_change`).

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add login, refresh, logout, forced password change and profile endpoints"`

### Task 7: Forgotten password and admin reset

**Files:**
- Modify: `app/features/auth/{routes,service}.py`
- Create: `app/features/users/welcome.py`, `tests/integration/test_password_reset.py`

**Interfaces:**
- Produces:
  - `POST /auth/forgot-password` with body `{username}`.
    - Always returns 200 `{"message":"If that account exists, a code has been sent."}`.
    - Creates a code and emails it only if the user exists and isn't archived.
    - A second request within 60 seconds creates no new code.
  - `POST /auth/verify-reset-code` with body `{username, code}`.
    - Returns 200 `{reset_token}` (purpose `reset`, valid 10 minutes).
    - Errors: 400 `CODE_INVALID` (and the attempt count goes up), 400 `CODE_EXPIRED`, 423 `CODE_LOCKED` once attempts reach 5.
  - `POST /auth/reset-password` with body `{reset_token, new_password}`.
    - Applies the password policy, marks the code as used, and revokes all refresh tokens → 204.
  - `POST /users/{id}/reset-password` (`roles={"admin"}`).
    - Sets a new temporary password (generated, or `{password}` from the body if it passes the policy), `must_change_password=true` and `temp_password_expires_at=now()+72h`, then sends the welcome email.
    - Returns 200 `{email_sent: bool, temp_password: str|None}`. `temp_password` is only returned when `email_sent` is false.
  - `send_welcome(conn, user:dict, temp_password:str) -> bool` in `app/features/users/welcome.py`. The email contains the username, the temporary password and the login link (`APP_URL` env, default `http://localhost:3000`) + `/login`.

- [ ] **Step 1: Write failing tests.**
  ```python
  def test_forgot_same_response_for_unknown_user(client, conn):
  def test_forgot_rate_limited_60s(client, conn):               # two calls → one code row
  def test_full_reset_flow_reads_code_from_outbox(client, conn, outbox):
  def test_code_lock_after_5_wrong(client, conn):
  def test_code_expired(client, conn):
  def test_code_single_use(client, conn):
  def test_admin_reset_forces_change_and_hides_password_when_emailed(client, conn):
  def test_admin_reset_returns_password_when_email_fails(client, conn, monkeypatch):
  ```

- [ ] **Step 2:** Run `python -m pytest tests/integration/test_password_reset.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add forgotten-password codes and admin password reset"`

### Task 8: Users

**Files:**
- Create: `app/features/users/{routes,service}.py`, `tests/integration/test_users.py`

**Interfaces:**
- Consumes: Task 4 `suggest_usernames`, `is_valid_username`; Task 7 `send_welcome`.
- Produces:
  - `GET /users?q=&role=&archived=&page=&page_size=` (admin) → `{items:[user], total}`. `q` matches name, username or email, ignoring case.
  - `POST /users` (admin) with body `{first_name, last_name, email, role, job_title?, salary?, manager_id?, username?, password?}`.
    - A missing `username` is generated (the first suggestion). A missing `password` is generated.
    - `manager_id` is required when role is `employee`, and it must reference a non-archived user with role `manager` or `admin`.
    - Returns 201 `{user, email_sent, temp_password|null}`.
  - `GET /users/{id}`: admins see anyone. Others may only see themselves; any other ID → 404. `salary` is included only for an admin or the user themselves.
  - `PUT /users/{id}` (admin): any field, including `username` (re-validated) and `role`.
    - An admin can't demote themselves → 400 `SELF_DEMOTION`.
  - `DELETE /users/{id}` (admin) archives and revokes refresh tokens → 204. Archiving yourself → 400 `SELF_ARCHIVE`.
  - `POST /users/{id}/restore` (admin).
  - `GET /users/username-availability?username=&first=&last=` (admin) → `{username, valid, available, suggestions:[5]}`.
  - Also used by Task 10's people picker: `GET /users?role=employee` may be called by managers, returning `id`, `username`, `first_name`, `last_name`, `job_title` only, never salary.

- [ ] **Step 1: Write failing tests.**
  ```python
  def test_create_user_generates_username_and_password(client, conn, outbox):  # 201; outbox has username + temp password + login link
  def test_case_insensitive_duplicates(client, conn):                         # Review Focus 4 → 409 details {"username": "taken"} / {"email": "taken"}
  def test_employee_requires_manager(client, conn):
  def test_availability_suggestions_exclude_taken(client, conn):
  def test_salary_visible_to_self_and_admin_only(client, conn):
  def test_manager_cannot_create_user(client, conn):                          # 403
  def test_archive_user_blocks_login_and_restore(client, conn):
  def test_admin_cannot_demote_or_archive_self(client, conn):
  def test_list_search_and_role_filter(client, conn):
  ```

- [ ] **Step 2:** Run `python -m pytest tests/integration/test_users.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement.** Unique-constraint errors from the database are mapped to 409 with field details.

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add user management with username suggestions and welcome email"`

### Task 9: Local dev server, seed data and first cloud deploy

**Files:**
- Create: `scripts/devserver.py`, `scripts/seed.py`, `tests/integration/test_seed.py`
- Modify: `function.py` (internal op `{"op":"seed"}`)

**Interfaces:**
- Produces:
  - `python scripts/devserver.py [--port 3001] [--db overwatch_dev] [--reset] [--seed]` serves HTTP. Each request is converted to a Function URL v2 event and passed to `function.handler`. `--reset` drops and re-migrates the database.
  - `seed(conn) -> dict` returns the demo credentials `{role: (username, password)}`.
    - Demo users: `admin.demo`, `manager.demo`, `employee.demo`, all with password `Demo123!`, `must_change_password=false`.
    - About 15 people and 5 projects.
    - At least one project with a dependency chain of 3 milestones.
    - Pending, approved and rejected time entries, and one employee over 40h this week, with the manager's unread `OVER_40H` notification.
    - One project that meets the at-risk rule.
  - Seeding again is a no-op when `admin.demo` already exists.

- [ ] **Step 1: Write failing tests.**
  ```python
  def test_seed_idempotent_and_demo_logins_work(client, conn):
  def test_seed_contains_at_risk_and_overtime(conn):
  ```
  These pass only once Tasks 10–13 are complete. Mark them `@pytest.mark.xfail(strict=True, reason="needs Tasks 10-13")`, then remove the mark in Task 13 Step 4.

- [ ] **Step 2: Implement** `devserver.py` (standard-library `http.server`) and `seed.py`, inserting directly with SQL. Run `python scripts/devserver.py --reset --seed`, then:
  ```bash
  curl -s -XPOST localhost:3001/api/v1/auth/login -d '{"username":"admin.demo","password":"Demo123!"}'
  ```
  Expected: JSON containing `access_token`.

- [ ] **Step 3: First cloud deploy.**
  1. Run `./bin/deploy-backend.sh`.
     - Expected: `terraform` applies with `module.lambda["v1"]` created, and CloudFront updated with `/api/v1*`.
     - If packaging fails, check the `python3.13.bat` shim in `~/bin`.
  2. Run:
     ```bash
     aws lambda invoke --function-name coding-workshop-v1-$PARTICIPANT_ID --payload '{"op":"migrate"}' --cli-binary-format raw-in-base64-out /dev/stdout
     ```
     Expected: `{"applied":["001_init.sql"]}`.
  3. Run the same command with `{"op":"seed"}`.
  4. Run `curl -s -XPOST https://<cloudfront>/api/v1/auth/login …`. Expected: `access_token`.
  5. **SES check:** create a user from the admin account and read the response.
     - If `email_sent` is false, record "SES not permitted for the Lambda role" in `docs/project/DECISIONS.md` and continue. The fallback is already built.
  6. **Timing check:** record the cold-start and login times. If login takes more than 2 seconds, record it in `DECISIONS.md`; tuning `PBKDF2_ITERATIONS` is the owner's call.

- [ ] **Step 4: Commit.** `git commit -m "Add dev server and seed data; first v1 deploy"`

---

## Day 2 – Wed Oct 14: domain API and frontend foundation

### Task 10: Projects and project requests

**Files:**
- Create: `app/features/projects/{routes,service}.py`, `app/features/requests/{routes,service}.py`, `tests/integration/test_projects.py`, `tests/integration/test_requests.py`

**Interfaces:**
- Consumes:
  - Task 5 `load_project`, `audit.record`.
  - Task 4 `at_risk_reasons`.
  - `project_consumed(conn, project_id) -> Decimal`, defined here and reused by Task 13: the sum of `hours * hourly_rate` over approved entries on non-archived milestones.
- Produces:
  - `GET /projects?q=&status=&manager=&at_risk=&archived=&page=&page_size=` returns only projects the user can see.
    - Each item: `{id,name,status,start_date,predicted_end_date,budget,consumed,budget_pct,progress_pct,at_risk_reasons,manager:{id,name}}`.
    - `progress_pct` = completed ÷ non-archived milestones × 100, rounded to 1 decimal place; 0 when there are no milestones.
  - `POST /projects` (admin) with body `{name, description?, start_date, predicted_end_date, budget, manager_id, status?="planned"}` → 201.
  - `GET /projects/{id}`.
  - `PUT /projects/{id}` (manage).
    - Managers can't change `manager_id` → 403 `FORBIDDEN`.
    - Status `completed` with unfinished milestones → 400 `MILESTONES_INCOMPLETE`.
    - Allowed status changes: `planned→active`, `active⇄on_hold`, `active→completed`, `on_hold→completed`. Anything else → 400 `INVALID_TRANSITION`.
  - `DELETE /projects/{id}` and `POST /projects/{id}/restore` (admin).
  - `GET /projects/{id}/summary` → `{project, budget, consumed, remaining, budget_pct, progress_pct, at_risk_reasons, member_count}`.
  - `GET /project-requests?status=`: admins see all; managers see their own.
  - `POST /project-requests` (`roles={"manager"}`) with body `{name, description?, proposed_start, proposed_end, proposed_budget?, reason}` → 201.
  - `POST /project-requests/{id}/approve` (admin) creates the project with `manager_id = requested_by` → 200 `{request, project}`. Approving a request that isn't pending → 400 `REQUEST_CLOSED`.
  - `POST /project-requests/{id}/reject` (admin) with body `{comment}` (required).

- [ ] **Step 1: Write failing tests.**
  ```python
  def test_admin_creates_project_manager_required(client, conn):
  def test_end_before_start_400(client, conn):
  def test_duplicate_active_name_409_but_archived_name_reusable(client, conn):
  def test_visibility_by_role(client, conn):                       # admin all; manager own; employee member only
  def test_archived_project_hidden_from_non_admin(client, conn):   # Review Focus 3 → 404
  def test_manager_cannot_reassign_manager(client, conn):
  def test_complete_requires_all_milestones(client, conn):
  def test_invalid_status_transition(client, conn):
  def test_summary_numbers(client, conn):                          # budget 2080, one approved 8h entry at salary 104000 (rate 50) → consumed 400, budget_pct 19.2
  def test_list_filters_q_status_at_risk(client, conn):
  def test_request_approve_creates_project(client, conn):
  def test_request_reject_requires_comment(client, conn):
  def test_employee_cannot_request(client, conn):                  # 403
  ```

- [ ] **Step 2:** Run `python -m pytest tests/integration/test_projects.py tests/integration/test_requests.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add projects, status rules, summaries and project requests"`

### Task 11: Project members and the planned 40-hour cap

**Files:**
- Create: `app/features/members/{routes,service}.py`, `tests/integration/test_members.py`

**Interfaces:**
- Consumes: Task 4 `fits_weekly_plan`; Task 5 `load_project(manage=True)`.
- Produces:
  - `GET /projects/{id}/members` → `[{user:{id,first_name,last_name,job_title}, planned_hours_per_week}]`.
  - `POST /projects/{id}/members` with body `{user_id, planned_hours_per_week}`.
    - The user must be non-archived with role `employee` or `manager`.
    - Errors: 409 `ALREADY_MEMBER`, 400 `PLANNED_HOURS_EXCEEDED` with details `{current_total, requested, cap:40}`.
  - `PUT /projects/{id}/members/{userId}` with body `{planned_hours_per_week}`.
  - `DELETE /projects/{id}/members/{userId}` → 204. Removing someone with milestone assignments also removes those assignments.
  - `other_planned_hours(conn, user_id, project) -> Decimal` adds up `planned_hours_per_week` over the user's memberships in **other**, non-archived, non-completed projects whose dates overlap this project's dates.

- [ ] **Step 1: Write failing tests.**
  ```python
  def test_add_member_within_cap(client, conn):
  def test_cap_exceeded_across_overlapping_projects(client, conn):    # 30 + 12 → 400, details current_total 30
  def test_non_overlapping_projects_do_not_count(client, conn):
  def test_archived_project_excluded_from_cap(client, conn):          # Review Focus 3
  def test_employee_cannot_add_members(client, conn):                 # 403
  def test_remove_member_drops_assignments(client, conn):
  ```

- [ ] **Step 2:** Run `python -m pytest tests/integration/test_members.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add project members with the 40-hour planned cap"`

### Task 12: Milestones, dependencies, assignees, status and notes

**Files:**
- Create: `app/features/milestones/{routes,service}.py`, `tests/integration/test_milestones.py`

**Interfaces:**
- Consumes: Task 4 `creates_cycle`, `dependency_order`, `can_transition`; Task 5 `load_milestone`, `is_assignee`.
- Produces:
  - `GET /projects/{id}/milestones` returns `[{id,name,description,start_date,end_date,status,display_status,predecessors:[id],assignees:[{id,name}],is_assignee,completed_at}]`, sorted by `dependency_order`, then `start_date`.
    - `display_status` is `"blocked"` when any predecessor isn't completed; otherwise it's the stored status.
  - `POST /projects/{id}/milestones` (manage).
    - Dates outside the project's dates → 400 `OUT_OF_PROJECT_RANGE`.
  - `GET /milestones/{id}`, `PUT /milestones/{id}` (manage; name, description and dates), `DELETE` (manage), `POST /milestones/{id}/restore` (admin).
  - `PUT /milestones/{id}/dependencies` (manage) with body `{predecessor_ids:[…]}`.
    - Predecessors in another project → 400 `CROSS_PROJECT_DEPENDENCY`.
    - A loop → 400 `DEPENDENCY_CYCLE`.
    - The response includes `warnings:["STARTS_BEFORE_PREDECESSOR_ENDS"]` when that applies.
  - `PUT /milestones/{id}/assignees` (manage) with body `{user_ids:[…]}`. Each user must be a member → otherwise 400 `NOT_A_MEMBER`.
  - `POST /milestones/{id}/status` with body `{status}`.
    - Allowed for the project's manager or an admin, or an assignee.
    - Anyone else on the project → 403 `NOT_ASSIGNED`.
    - A change `can_transition` doesn't allow → 400 `INVALID_TRANSITION`.
    - Sets `completed_at` when the milestone is completed, and clears it when reopened.
  - `GET /milestones/{id}/notes` and `POST /milestones/{id}/notes` with body `{body}` (1–2,000 characters). Allowed for assignees and the manager or admin. Everyone visible on the project can read.

- [ ] **Step 1: Write failing tests.**
  ```python
  def test_dates_must_fit_project(client, conn):
  def test_dependency_cycle_rejected(client, conn):
  def test_cross_project_dependency_rejected(client, conn):
  def test_blocked_display_status_and_cannot_start(client, conn):
  def test_employee_sees_all_milestones_of_project(client, conn):
  def test_unassigned_employee_cannot_change_status(client, conn):   # 403 NOT_ASSIGNED
  def test_assignee_moves_to_ready_for_review_not_completed(client, conn):
  def test_manager_completes_and_reopens(client, conn):
  def test_assignee_must_be_member(client, conn):
  def test_notes_append_and_author(client, conn):
  def test_start_before_predecessor_warning(client, conn):
  ```

- [ ] **Step 2:** Run `python -m pytest tests/integration/test_milestones.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add milestones with dependencies, assignees, status rules and notes"`

### Task 13: Time entries, approvals, notifications, dashboard, allocations, audit log

**Files:**
- Create: `app/features/time/{routes,service}.py`, `app/features/insights/{routes,service}.py`, `tests/integration/test_time.py`, `tests/integration/test_insights.py`

**Interfaces:**
- Consumes: Task 4 `week_flags`, `forecast_total`, `approval_breakdown`; Task 5 `is_assignee`; Task 10 `project_consumed`, `at_risk_reasons`.
- Produces:
  - `GET /time-entries?user=&week=YYYY-MM-DD` (any date in the week; defaults to the current week).
    - Users see their own entries. Admins can see anyone's. A manager can see entries on their own projects.
    - Returns `{week_start, rows:[{milestone:{id,name}, project:{id,name}}], entries:[{id,milestone_id,project_id,work_date,hours,status,over_40,edited_after_decision,rejection_reason,note,label}], totals:{logged, approved}}`.
    - `label` is `"Pending approval"`, `"Pending (Overtime requested from {first} {last})"`, `"Approved"` or `"Rejected"`.
    - `rows` lists every non-archived milestone the user is assigned to that overlaps the week.
  - `PUT /time-entries` (self only) with body `{week, entries:[{milestone_id, work_date, hours, note?}]}`.
    - Processes entries in `(work_date, milestone_id)` order.
    - `hours: 0` on an existing pending entry deletes it. That's allowed because a pending entry isn't a budget record. On an approved or rejected entry → 400 `CANNOT_CLEAR_DECIDED`.
    - Every created or changed entry becomes `pending`, with `edited_after_decision = true` if it was approved or rejected before.
    - `over_40` and the alert come from `week_flags`, using the person's logged total across all projects before and after that entry. When `crossed` is true, insert the `OVER_40H` notification for the manager of the entry's project with `ON CONFLICT DO NOTHING`. The unique key makes it once per person-week.
    - Errors: 400 `NOT_ASSIGNED`, 400 `OUT_OF_PROJECT_RANGE`, 400 `OUTSIDE_WEEK`.
    - Returns the same shape as GET.
  - `GET /approvals?project=&milestone=`: pending entries on projects the user manages (all projects for admins), excluding the user's own entries. Returns `[{entry, label, user:{id,name}, milestone:{id,name}, project:{id,name}, week_logged_total}]`.
  - `GET /time-entries/{id}/breakdown` (manage on the entry's project) → the `approval_breakdown` dict plus `{hours, hourly_rate, milestone_cost, budget, consumed, remaining, weeks_remaining}`.
  - `POST /time-entries/{id}/approve` and `POST /time-entries/{id}/reject` with body `{reason}`.
    - Both need manage on the entry's project. Your own entry → 403 `SELF_APPROVAL`.
    - Approve sets `hourly_rate = round(salary/2080, 2)`.
    - Reject without a reason → 400 `VALIDATION_ERROR`.
    - A non-pending entry → 400 `NOT_PENDING`. Both are audited.
  - `GET /notifications?unread=`, `POST /notifications/{id}/read`, `POST /notifications/read-all`. Users only see their own.
  - `GET /dashboard` (visible projects only) returns:
    - `status_counts:{planned,active,on_hold,completed}`
    - `projects:[list item from Task 10]`
    - `at_risk:[{id,name,reasons}]`
    - `milestones:{overdue:[…], due_soon:[…]}` (next 14 days)
    - `over_allocated:[{user:{id,name}, week_logged_total}]` (current week, logged total > 40)
    - `budgets:[{project_id,name,budget,consumed,forecast}]`
    - `pending_approvals` (a count, for managers and admins)
  - `GET /allocations?week=` (managers and admins) returns `[{user:{id,name,job_title}, projects:[{id,name,planned,logged,approved}], planned_total, logged_total, utilization_pct}]`.
    - `utilization_pct = logged_total / 40 × 100`.
    - Managers see people on their projects plus their direct reports.
  - `GET /audit-log?actor=&entity_type=&from=&to=&page=` (admin).

- [ ] **Step 1: Write failing tests.**
  ```python
  def test_new_entry_is_pending_and_not_in_budget(client, conn):
  def test_only_assigned_milestones_loggable(client, conn):        # 400 NOT_ASSIGNED
  def test_batch_crossing_flags_and_single_alert(client, conn):    # Review Focus 2: Mon–Fri 9h → Fri over_40; one notification; save again → still one
  def test_alert_once_across_projects(client, conn):               # 38h on project A, then 4h on B → B's manager alerted; 2h more on A → no new alert
  def test_overtime_label_names_employee(client, conn):            # label == "Pending (Overtime requested from Ada Lovelace)"
  def test_edit_approved_entry_returns_to_pending(client, conn):   # leaves the budget; edited_after_decision True
  def test_reject_requires_reason_visible_to_employee(client, conn):
  def test_cannot_approve_own_entry(client, conn):                 # Review Focus 1 → 403 SELF_APPROVAL
  def test_breakdown_numbers_and_forecast(client, conn):
  def test_approve_snapshots_rate_and_updates_budget(client, conn):
  def test_other_manager_cannot_approve(client, conn):             # 404
  def test_dashboard_answers_all_seven_questions(client, conn):
  def test_dashboard_filtered_for_employee(client, conn):
  def test_allocations_utilization(client, conn):
  def test_audit_log_admin_only(client, conn):
  ```

- [ ] **Step 2:** Run `python -m pytest tests/integration/test_time.py tests/integration/test_insights.py -v`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Remove the `xfail` marks from `test_seed.py`. Run:
  ```bash
  python -m pytest --cov=app --cov-branch --cov-report=term-missing
  ```
  Expected: every test passes; `app` coverage ≥ 80%; `app/rules` at 100%.

- [ ] **Step 5:** Redeploy: `./bin/deploy-backend.sh`, then invoke `migrate` and `seed`. Run:
  ```bash
  curl -s https://<cloudfront>/api/v1/dashboard -H "Authorization: Bearer <admin token>"
  ```
  Expected: JSON with all seven dashboard keys.

- [ ] **Step 6: Commit.** `git commit -m "Add time approval, over-40h alerts, budget breakdown, dashboard, allocations and audit log"`

### Task 14: Frontend foundation (theme, layout, API client, test setup)

**Files:**
- Modify: `frontend/package.json`, `frontend/vite.config.js`, `frontend/src/main.jsx`, `frontend/index.html` (title "Citi Overwatch")
- Delete: `frontend/src/App.jsx`, `App.css`, `assets/react.svg` (the starter template)
- Create: `frontend/vitest.config.js`, `src/test/{setup.js,server.js}`, `src/app/{App.jsx,providers.jsx,theme.js,Layout.jsx,routes.jsx}`, `src/api/client.js`, `src/components/{ErrorAlert,EmptyState,ConfirmDialog,StatusChip,RiskBadges,PageHeader,ResponsiveTable}.jsx`, `src/lib/{permissions.js,format.js}`, and tests next to each file (`*.test.jsx` / `*.test.js`)

**Interfaces:**
- Produces:
  - `api.request(method, path, {body, query, signal} = {}) -> Promise<any>`.
    - Sends `Authorization` from the in-memory token, sets `credentials:"include"`, and generates an `x-request-id`.
    - On 401 `TOKEN_EXPIRED`, makes **one** shared `POST /auth/refresh` and retries. If the refresh fails, it calls `onSessionExpired()`.
    - Throws `ApiError {status, code, message, details, requestId}`.
  - `api.setToken(t)` and `api.onSessionExpired(fn)`.
  - `can(user, action, resource)` in `lib/permissions.js` mirrors spec §2. Actions: `user.manage`, `project.create`, `project.manage`, `project.archive`, `request.submit`, `request.decide`, `milestone.manage`, `milestone.progress`, `time.approve`, `audit.view`. Resources look like `{managerId}`, `{assigneeIds}`.
  - Components:
    - `<ErrorAlert error={ApiError}/>` shows the message and "ref: {requestId}".
    - `<EmptyState title action/>`, `<ConfirmDialog open title body confirmLabel onConfirm onClose/>`
    - `<StatusChip status/>` always shows a text label, never color alone.
    - `<RiskBadges reasons/>` with labels `OVERDUE_MILESTONE`→"Overdue milestone", `PAST_DUE`→"Past due date", `BUDGET_BURN`→"Budget burning faster than progress".
    - `<PageHeader title actions/>`
    - `<ResponsiveTable rows columns renderCard/>` renders a DataGrid at the `md` breakpoint and up, and stacked cards below it, using `useMediaQuery` from `react-responsive`.
  - `providers.jsx` exports `useToast() -> {success(msg), error(msg)}`, backed by a single MUI Snackbar, and sets up `QueryClient` with the Global Constraints defaults.
  - `theme.js` exports `buildTheme(mode)`: one brand primary color (`#0B5CAD`), an 8-pixel spacing grid, the Inter or system font stack, and status colors shared by `StatusChip`.
  - `Layout`: a permanent left drawer on `md` and up; a temporary drawer with a menu button on smaller screens. Navigation items are filtered by `can()`.

- [ ] **Step 1: Install dependencies** in `frontend/`:
  ```bash
  npm i @mui/material @emotion/react @emotion/styled @mui/icons-material @mui/x-data-grid @mui/x-charts @mui/x-date-pickers dayjs react-router-dom @tanstack/react-query react-hook-form zod @hookform/resolvers react-responsive
  npm i -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom msw @playwright/test @vitest/coverage-v8
  ```
  Add scripts `"test":"vitest run"`, `"test:watch":"vitest"`, `"coverage":"vitest run --coverage"` and `"e2e":"playwright test"`. Set the Vite `server.proxy` so `'/api'` goes to `'http://localhost:3001'`.

- [ ] **Step 2: Write failing tests.**
  ```js
  test('api client refreshes once for concurrent 401s')        // Review Focus 5: 3 parallel requests → MSW sees exactly 1 /auth/refresh, all 3 resolve
  test('api client calls onSessionExpired once when refresh fails')
  test('ApiError carries requestId from the error body')
  test('ErrorAlert shows ref id')
  test('permissions: employee can progress only assigned milestone')   // can(emp,'milestone.progress',{assigneeIds:[emp.id]}) true; other → false
  test('permissions: admin inherits manager rights')
  test('Layout shows drawer button on mobile width')               // matchMedia mocked to < md
  test('StatusChip renders text label')
  ```

- [ ] **Step 3:** Run `cd frontend && npm test`. Expected: FAIL.

- [ ] **Step 4: Implement.**

- [ ] **Step 5:** Run `npm test` and `npm run lint`. Expected: PASS, with no lint errors.

- [ ] **Step 6: Commit.** Branch from `feat/backend`, because the end-to-end tests need both halves.
  ```bash
  git checkout -b feat/frontend
  git commit -m "Add frontend foundation: theme, responsive layout, API client, shared components"
  ```

### Task 15: Auth screens

**Files:**
- Create: `src/auth/{SessionProvider,RequireAuth,ForcePasswordChange}.jsx`, `src/components/PasswordPolicyChecklist.jsx`, `src/features/login/{LoginPage,ForgotPasswordPage}.jsx`, `src/lib/schemas.js`, and their tests

**Interfaces:**
- Consumes: Task 14 `api`.
- Produces:
  - `useSession() -> {user, status:'loading'|'anon'|'restricted'|'ready', login(username,password), logout(), setUser}`. On mount, it tries `POST /auth/refresh` once.
  - `<RequireAuth roles?>` redirects anonymous users to `/login`, and shows `<ForcePasswordChange/>` instead of the page when `status==='restricted'`.
  - `passwordSchema` (Zod) mirrors the backend policy, with the same rule codes.
  - `<PasswordPolicyChecklist value/>` shows live ticks for "At least 6 characters", "At least 1 number" and "At least 1 special character".
  - Forgot-password flow:
    1. Username → **Next**.
    2. 6-digit code field with a resend button, disabled for 60 seconds and showing a countdown.
    3. New password + confirm.
    4. Success → back to login with a success message.

- [ ] **Step 1: Write failing tests.**
  ```js
  test('login shows field errors and disables submit while pending')
  test('restricted user sees non-dismissible ForcePasswordChange')   // no close button; Escape does nothing; nav links absent
  test('confirm password must match; checklist ticks live')
  test('forgot flow walks username → code → new password')         // MSW handlers
  test('resend disabled for 60s')                                     // fake timers
  test('expired temp password message shown')                         // TEMP_PASSWORD_EXPIRED → "Temporary password expired — ask an admin to reset it."
  ```

- [ ] **Step 2:** Run `npm test -- auth login`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add login, forced password change and forgotten-password screens"`

### Task 16: Projects and project requests UI

**Files:**
- Create: `src/api/queries.js` (TanStack hooks), `src/features/projects/{ProjectsPage,ProjectDetailPage,ProjectForm,OverviewTab,TeamTab,BudgetTab}.jsx`, `src/features/requests/RequestsPage.jsx`, and their tests

**Interfaces:**
- Consumes: Task 14 components and `can()`; the Task 10/11 endpoints.
- Produces:
  - Query keys: `['projects', filters]`, `['project', id]`, `['project-summary', id]`, `['members', id]`, `['requests', status]`.
  - `useProjects(filters)`, `useProject(id)`, `useCreateProject()` and `useUpdateProject(id)`. Mutations invalidate the related keys and show a success toast through a shared `useToast()`, exported from `providers.jsx`.
  - **ProjectsPage:**
    - Search box (debounced 300 ms) and filters for status, manager and at-risk, mirrored in the URL search params.
    - `ResponsiveTable` with name, status, manager, progress bar, budget %, risk badges.
    - "New project" button only when `can(user,'project.create')`.
  - **ProjectDetailPage tabs:** Overview, Milestones (Task 17), Team, Budget, Hours (Task 18). Tab state is kept in the URL (`?tab=`).
  - **TeamTab:** add or edit members with planned hours. Displays `PLANNED_HOURS_EXCEEDED` as "{name} is already planned for {current_total}h of 40h per week."
  - **BudgetTab:** an MUI X bar chart of planned vs. consumed, plus remaining and percentage used.
  - **RequestsPage:** managers get a form and their list. Admins get a queue with approve, and reject with a required comment.

- [ ] **Step 1: Write failing tests.**
  ```js
  test('projects filters sync to URL and refetch')
  test('employee does not see New project or archive actions')
  test('project form validates end date after start')
  test('team tab shows cap error message with current total')
  test('admin approves a request and is routed to the new project')
  test('reject requires a comment')
  test('empty projects list shows EmptyState with action for admin')
  ```

- [ ] **Step 2:** Run `npm test -- projects requests`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add projects list, detail tabs and project requests UI"`

---

## Day 3 – Thu Oct 15: remaining UI, end-to-end, docs, final deploy

### Task 17: Milestones UI (table, timeline, dependencies, status, notes)

**Files:**
- Create: `src/features/milestones/{MilestonesTab,MilestoneDialog,MilestoneNotes}.jsx`, `src/components/Timeline.jsx`, and their tests

**Interfaces:**
- Consumes: Task 12 endpoints and `can(user,'milestone.manage'|'milestone.progress', …)`.
- Produces:
  - `<Timeline items={[{id,name,start_date,end_date,display_status,predecessors}]} range={{start,end}}/>`.
    - Draws horizontal bars scaled to the project's dates, with a "today" marker.
    - Shows a predecessor list under each bar.
    - Keyboard-focusable bars, each with an `aria-label` describing name, dates and status.
  - **MilestoneDialog** (manage): name, description, dates inside the project range, a predecessors multi-select (excluding itself), and an assignees multi-select (members only).
    - Shows `DEPENDENCY_CYCLE` as "That dependency would create a loop."
    - Shows the `STARTS_BEFORE_PREDECESSOR_ENDS` warning as a non-blocking alert.
  - **Status actions:**
    - Assignees see "Start" and "Ready for review".
    - Managers additionally see "Complete" and "Send back".
    - Blocked milestones show the disabled control with the tooltip "Waiting on: {predecessor names}".
  - **Notes** thread with author and time. The input is shown only to assignees and managers.

- [ ] **Step 1: Write failing tests.**
  ```js
  test('employee sees all milestones but actions only on assigned ones')
  test('blocked milestone start button disabled with tooltip naming predecessors')
  test('cycle error shown in dialog')
  test('timeline renders a bar per milestone with accessible labels')
  test('assignee marks ready for review; manager completes')
  ```

- [ ] **Step 2:** Run `npm test -- milestones`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add milestones tab with timeline, dependencies, status actions and notes"`

### Task 18: Timesheet, approvals with budget breakdown, and notifications

**Files:**
- Create: `src/features/timesheet/TimesheetPage.jsx`, `src/features/approvals/{ApprovalsPage,BreakdownPanel}.jsx`, `src/features/projects/HoursTab.jsx`, `src/components/NotificationBell.jsx`, and their tests
- Modify: `src/app/Layout.jsx` (bell in the top bar); `src/features/milestones/MilestonesTab.jsx` (pending hours and breakdown inside the milestone)

**Interfaces:**
- Consumes: Task 13 time and notification endpoints.
- Produces:
  - **TimesheetPage:**
    - A week picker (previous / next / this week) and a grid with **one row per assigned milestone**, grouped by project, and columns Monday–Sunday. Weekends are collapsed by default on mobile.
    - Inputs are numbers from 0 to 24 in steps of 0.25. Row, column and weekly totals, with a "/ 40h" indicator that switches to the warning color above 40.
    - **Save** sends one `PUT /time-entries`.
    - Each cell shows the backend `label` as a chip (`Pending approval`, `Pending (Overtime requested from …)`, `Approved`, `Rejected`), an "Edited" tag when relevant, and the rejection reason in a tooltip.
  - **ApprovalsPage** (managers and admins): pending entries grouped by milestone, showing the label and the person's week total, with Approve and Reject buttons. Rejecting requires a reason. Selecting a row opens the **BreakdownPanel**.
  - **BreakdownPanel:** request cost, milestone cost so far, remaining budget before and after, share of the remaining budget, and projected total vs. budget. A forecast over budget is shown in the warning color.
  - **Milestone detail** (inside MilestonesTab): the milestone's pending entries with the same BreakdownPanel, for its manager.
  - **NotificationBell:** an unread-count badge and a menu ("{First Last} passed 40h for the week of {date}"). Clicking a notification marks it read and opens Approvals filtered to that person. Polls with the 30-second default.
  - **HoursTab:** approved and pending hours per person for the selected week, on that project.

- [ ] **Step 1: Write failing tests.**
  ```js
  test("timesheet rows are the employee's assigned milestones")
  test('totals update as you type and save sends one PUT')
  test('cells show backend labels, Edited tag and rejection reason')
  test('reject requires a reason')
  test('breakdown panel shows before/after remaining and forecast warning')
  test('notification bell shows unread count and marks read on click')
  test('employee does not see Approvals in navigation')
  ```

- [ ] **Step 2:** Run `npm test -- timesheet approvals notification`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run the tests. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add timesheet, approvals with budget breakdown, and notifications"`

### Task 19: Dashboard, allocation, people, profile and audit UI

**Files:**
- Create: `src/features/dashboard/DashboardPage.jsx`, `src/features/allocation/AllocationPage.jsx`, `src/features/people/{PeoplePage,CreateUserWizard,UserDetailPage}.jsx`, `src/features/profile/ProfilePage.jsx`, `src/features/audit/AuditPage.jsx`, and their tests

**Interfaces:**
- Consumes: the Task 8 and Task 13 endpoints.
- Produces:
  - **DashboardPage** has one section per email question, each with a heading naming the question:
    - Status cards
    - Projects table
    - At-risk list
    - Milestones overdue / due soon
    - Over-allocated people
    - Budget bar chart
    - Dependency chains are linked through each project's timeline.

    Auto-refreshes every 30 seconds through the query defaults.
  - **AllocationPage:** a people × projects matrix with planned and logged hours and a utilization bar. It becomes a card list on mobile.
  - **CreateUserWizard**, a 5-step MUI Stepper; each step stays disabled until the previous one is valid:
    1. Name.
    2. Email + role. The manager picker appears when the role is employee.
    3. Username: availability check debounced 300 ms, an ✓/✗ icon, and clickable suggestion chips.
    4. Password: text field, a "Generate password" button, and `PasswordPolicyChecklist`.
    5. Review → Submit.

    On `email_sent:false`, a show-once dialog displays the username and temporary password with copy buttons.
  - **PeoplePage** (admin): search, role and archived filters; archive, restore and reset-password actions with confirm dialogs.
  - **UserDetailPage:** admin edit form, including salary.
  - **ProfilePage:** edit your own first name, last name and email; your own salary is shown read-only.
  - **AuditPage** (admin): filterable table with an expandable before/after view.

- [ ] **Step 1: Write failing tests.**
  ```js
  test('dashboard renders a section for each of the seven questions')
  test('wizard steps stay disabled until previous step valid')
  test('username suggestions clickable and taken name shows ✗')
  test('generate password satisfies checklist')
  test('show-once dialog when email_sent is false')
  test('profile cannot edit salary or role')
  test('audit page not reachable by manager')     // redirected / 403 view
  ```

- [ ] **Step 2:** Run `npm test -- dashboard people profile audit allocation`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4:** Run `npm test` and `npm run coverage`. Expected: every test passes; frontend coverage ≥ 70% overall. 80% is a stretch target (STRETCH.md #10).

- [ ] **Step 5: Commit.** `git commit -m "Add dashboard, allocation, people wizard, profile and audit pages"`

### Task 20: End-to-end tests (Playwright)

**Files:**
- Create: `frontend/playwright.config.js`, `frontend/e2e/{onboarding,milestones,overtime}.spec.js`

**Interfaces:**
- Consumes: Task 9 devserver `--reset --seed` and the outbox; the demo logins.
- Produces:
  - A config with two `webServer` entries:
    - `python ../backend/v1/scripts/devserver.py --db overwatch_e2e --reset --seed` on port 3001
    - `npm run dev` on port 3000
  - Two projects: `desktop` (Chrome, 1280×800) and `mobile` (iPhone 13 profile).

- [ ] **Step 1: Write the specs.**
  ```js
  test('admin creates user → user logs in with emailed temp password → forced change → dashboard')  // reads newest file in backend/v1/.outbox
  test('manager adds a dependent milestone; assignee moves it to ready for review; manager completes')
  test('employee logs 9h Mon–Fri → Friday shows the overtime label → manager gets one notification → opens the breakdown → approves → budget consumed rises')
  ```

- [ ] **Step 2:** Run `cd frontend && npx playwright install chromium webkit && npm run e2e`. Expected: 3 tests × 2 projects all pass.

- [ ] **Step 3: Commit.** `git commit -m "Add Playwright end-to-end tests for the critical journeys"`

### Task 21: Documentation

**Files:**
- Create or modify:
  - `README.md`
  - `docs/project/{USER_STORIES,ARCHITECTURE,DATA_MODEL,API,LOGIC_WALKTHROUGH,TESTING,DECISIONS}.md`
  - `docs/project/REQUIREMENTS.md`: tick the boxes that are done

**Interfaces:**
- Consumes: the spec sections, plus real test output and deploy URLs.

- [ ] **Step 1: Root README.**
  - What the app is, with a screenshot (Playwright `page.screenshot` into `docs/images/`).
  - The architecture Mermaid diagram from spec §5.
  - **Quick start on Windows** (Git Bash): Postgres, `pip install`, migrate, devserver `--seed`, `npm i`, `npm run dev`.
  - Deploy: `deploy-backend.sh`, the migrate/seed invokes, `deploy-frontend.sh`.
  - Demo logins.
  - Test commands.
  - Trade-offs and assumptions, linking to `DECISIONS.md`.
  - Links to every doc in `docs/project/`.

- [ ] **Step 2: `USER_STORIES.md`.**
  - Stories per role, each with acceptance criteria that include loading, success and failure behavior.
  - Every story is tagged with the email question or rule it serves.
  - Covers every page in Tasks 15–19.

- [ ] **Step 3: `LOGIC_WALKTHROUGH.md`**, with Mermaid sequence or flow diagrams for:
  - account creation and the welcome email
  - first login and forced change
  - forgotten password
  - token refresh
  - time approval and the over-40h alert
  - the at-risk rule
  - dependency loop detection
  - the planned 40-hour cap

  Each diagram has a short explanation linking to the code file that implements it.

- [ ] **Step 4: Remaining docs.**
  - `ARCHITECTURE.md`: cloud and local diagrams, request lifecycle, request IDs and logging.
  - `DATA_MODEL.md`: the ER diagram and table notes.
  - `API.md`: every endpoint with an example request and response, and the error codes.
  - `TESTING.md`: the commands, **pasted real results** (pytest coverage summary, Vitest summary, Playwright summary) and known gaps.
  - `DECISIONS.md`: every row of spec §13, plus whatever Task 9's SES and timing checks found.

- [ ] **Step 5:** Run:
  ```bash
  grep -rnE "TODO|TBD|lorem" README.md docs/project
  ```
  Expected: no output.

- [ ] **Step 6: Commit.** `git commit -m "Add README, user stories, architecture, logic walkthrough, API and testing docs"`

### Task 22: Final deploy and live verification

**Files:**
- Modify: `docs/project/TESTING.md` (the live verification log)

- [ ] **Step 1:** Run `./bin/deploy-backend.sh`, invoke `migrate` and `seed`, then run `./bin/deploy-frontend.sh`. Expected: the S3 sync and CloudFront invalidation succeed.

- [ ] **Step 2: Live checks** on `https://<cloudfront>`, at desktop and mobile widths. Record each one as pass or fail in `TESTING.md`:
  1. Log in as each demo role.
  2. The dashboard shows all seven sections.
  3. Create a user, and check the email or the show-once fallback.
  4. Forced change.
  5. Milestone dependency and status flow.
  6. Time approval, the over-40h notification and the budget breakdown.
  7. Archive and restore.
  8. Forgotten password.
  9. Unauthorized actions are hidden, and direct API calls return 403.

- [ ] **Step 3:** Run the full suites one last time:
  ```bash
  cd backend/v1 && python -m pytest --cov=app
  cd frontend && npm test && npm run e2e
  ```
  Expected: all green. Paste the summaries into `TESTING.md`.

- [ ] **Step 4: Commit,** then **ask the owner for the go-ahead to push.**
  ```bash
  git commit -m "Record live verification"
  ```
  After the owner says "push":
  ```bash
  gh repo create citi-overwatch --public --source . --remote overwatch
  git push overwatch --all
  ```
