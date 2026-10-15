# Logic walkthrough

How the key flows and rules work, one diagram each, with links to the code that implements them. Paths are relative to the repo root.

Two patterns recur:

- **Business rules are pure functions** in [`backend/v1/app/rules/`](../../backend/v1/app/rules/). They take plain values, return plain values and never touch the database, so they're tested exhaustively (100% coverage) without one.
- **Race-prone steps are single SQL statements.** A step like "claim this refresh token" or "count this failed attempt" happens in one atomic `UPDATE … RETURNING`, so two requests can't both win.

---

## 1. Account creation and the welcome email

```mermaid
sequenceDiagram
  actor Admin
  participant UI as CreateUserWizard
  participant API as POST /users
  participant DB as PostgreSQL
  participant Mail as email.py

  Admin->>UI: name → email/role → username → password → review
  UI->>API: GET /users/username-availability (debounced, each keystroke)
  API-->>UI: {available, suggestions[3–5]}
  Admin->>UI: Create account
  UI->>API: POST /users {…, username, password}
  API->>API: validate fields, password policy, role rules (employee needs manager_id)
  API->>DB: INSERT users (hash = PBKDF2-SHA256, 600k iterations, per-user salt,<br/>must_change_password = true, temp expires in 72h) + audit row
  DB-->>API: user (or unique violation → 409 on username/email)
  API->>Mail: welcome email (username, temp password, sign-in link)
  alt email sent
    Mail-->>API: true
    API-->>UI: 201 {user, email_sent: true}
  else SES unreachable / failed
    Mail-->>API: false (3s timeout, then skip SES for 10 min)
    API-->>UI: 201 {user, email_sent: false, temp_password}
    UI->>Admin: "Share these sign-in details" — shown once, with copy buttons
  end
```

- **Username suggestions:** [`app/rules/usernames.py`](../../backend/v1/app/rules/usernames.py) builds candidates from the name (for Quinn Desktop: `qdesktop`, `quinn.desktop`, `desktopq`, `quinn_desktop`, `quinnd`, then numbered variants). The service drops the taken ones, comparing case-insensitively.
- **Account creation:** [`app/features/users/service.py`](../../backend/v1/app/features/users/service.py) and [`welcome.py`](../../backend/v1/app/features/users/welcome.py).
- **Email:** [`app/email.py`](../../backend/v1/app/email.py). Locally, every email is written to `backend/v1/.outbox/`. In the cloud it goes through SES, with fail-fast timeouts. Email failures never fail the request.
- **The wizard:** [`frontend/src/features/people/CreateUserWizard.jsx`](../../frontend/src/features/people/CreateUserWizard.jsx). **Next** stays disabled until the current step is valid.

## 2. Sign-in, lockout and the forced password change

```mermaid
flowchart TD
  A[POST /auth/login] --> B{user exists<br/>and not archived?}
  B -- no --> X1[verify against a dummy hash<br/>so timing is the same] --> F[401 INVALID_CREDENTIALS]
  B -- yes --> C{locked_until in the future?}
  C -- yes --> L[423 ACCOUNT_LOCKED]
  C -- no --> D{password matches?}
  D -- no --> E["atomic UPDATE: failed_login_count + 1;<br/>at 5 → locked_until = now + 15 min"] --> F
  D -- yes --> G{must_change_password?}
  G -- yes, temp expired --> T[401 TEMP_PASSWORD_EXPIRED]
  G -- yes --> R["restricted access token<br/>(only /auth/change-password allowed)"]
  G -- no --> N[full access token 15 min<br/>+ refresh cookie 7 days]
  R --> UI[ForcePasswordChange dialog<br/>cannot be dismissed]
  UI --> CP[POST /auth/change-password]
  CP --> P{policy ok and<br/>different from temp?}
  P -- no --> PE[400 PASSWORD_POLICY / PASSWORD_REUSED]
  P -- yes --> S[store new hash, clear flag,<br/>revoke all refresh tokens] --> N
```

- **Login, the lockout and the password change:** [`app/features/auth/service.py`](../../backend/v1/app/features/auth/service.py).
- **Hashing, tokens and the password policy:** [`app/security.py`](../../backend/v1/app/security.py).
- **The restricted token** carries a claim that the router checks. [`app/router.py`](../../backend/v1/app/router.py) returns `403 PASSWORD_CHANGE_REQUIRED` for every route except the ones marked `allow_restricted=True`.
- **UI:** [`frontend/src/auth/ForcePasswordChange.jsx`](../../frontend/src/auth/ForcePasswordChange.jsx), with the live [`PasswordPolicyChecklist`](../../frontend/src/components/PasswordPolicyChecklist.jsx).

## 3. Forgotten password

```mermaid
sequenceDiagram
  actor User
  participant API
  participant DB
  User->>API: POST /auth/forgot-password {username}
  API->>DB: if the user exists and the last code is ≥ 60s old:<br/>store hash(6-digit code), expires in 15 min
  API-->>User: 200 "If that account exists, a code has been sent." (always the same)
  User->>API: POST /auth/verify-reset-code {username, code}
  API->>DB: atomic UPDATE attempts + 1 … RETURNING
  alt wrong code
    API-->>User: 400 CODE_INVALID (423 CODE_LOCKED after 5)
  else expired
    API-->>User: 400 CODE_EXPIRED
  else correct
    API-->>User: 200 {reset_token} (short-lived, single-use)
  end
  User->>API: POST /auth/reset-password {reset_token, new_password}
  API->>DB: re-check expiry, mark code used, store new hash,<br/>revoke every refresh token
  API-->>User: 200 — sign in with the new password
```

- **Code:** [`app/features/auth/reset.py`](../../backend/v1/app/features/auth/reset.py).
- **Codes are stored only as hashes.** The same response for unknown usernames means the endpoint can't be used to discover accounts.
- **UI:** [`frontend/src/features/login/ForgotPasswordPage.jsx`](../../frontend/src/features/login/ForgotPasswordPage.jsx), a three-step form with a 60-second resend countdown.

## 4. Token refresh

```mermaid
sequenceDiagram
  participant Page as Any page (TanStack Query)
  participant Client as api/client.js
  participant API
  Page->>Client: GET /projects (Bearer access token, x-request-id)
  Client->>API: request
  API-->>Client: 401 TOKEN_EXPIRED
  Note over Client: several requests may fail at once —<br/>they all await ONE shared refresh promise
  Client->>API: POST /auth/refresh (ow_refresh cookie: HttpOnly, SameSite=Strict, Path=/api/v1/auth)
  API->>API: atomic UPDATE refresh_tokens SET revoked_at=now()<br/>WHERE token_hash=… AND not revoked AND not expired RETURNING
  alt claimed
    API-->>Client: new access token + rotated cookie
    Client->>API: retry the original request once
    API-->>Page: 200
  else reused, revoked or expired
    API-->>Client: 401 REFRESH_INVALID
    Client->>Page: session expired → redirect to /login
  end
```

- **Server:** `refresh()` in [`app/features/auth/service.py`](../../backend/v1/app/features/auth/service.py). Claiming the token and revoking it is one statement, so a replayed cookie can only ever win once.
- **Client:** [`frontend/src/api/client.js`](../../frontend/src/api/client.js). Concurrent callers share a single `refreshing` promise, and each request is retried at most once.
- **Storage:** the access token lives only in memory. When the page reloads, [`SessionProvider.jsx`](../../frontend/src/auth/SessionProvider.jsx) restores the session from the cookie.

## 5. Time approval and the over-40-hour alert

```mermaid
flowchart TD
  S[PUT /time-entries — save a week grid] --> V{each cell valid?<br/>0.25–24h, assigned, in project dates, in this week}
  V -- no --> VE[400 with the field / code]
  V -- yes --> W[upsert entry → status = pending<br/>edited after a decision? tag edited_after_decision]
  W --> T["week total = person's pending + approved hours,<br/>all projects, Mon–Sun"]
  T --> O{total > 40?}
  O -- no --> P1[label: Pending approval]
  O -- yes --> P2["over_40 = true (frozen on the entry)<br/>label: Pending (Overtime requested from First Last)"]
  P2 --> C{did THIS save take the week<br/>from ≤ 40 to > 40?}
  C -- yes --> N["INSERT notification for the entry's project manager<br/>(unique on type, person, week → never twice)"]
  C -- no --> Done
  N --> Done
  P1 --> Done[Approvals queue]
  Done --> B["GET /time-entries/{id}/breakdown<br/>cost, remaining before/after, 4-week forecast"]
  B --> A{manager decides}
  A -- approve --> AP["status = approved; hourly_rate = salary ÷ 2080 copied on;<br/>consumed budget += hours × rate"]
  A -- reject --> RJ[status = rejected + reason shown to employee<br/>+ ENTRY_REJECTED alert in their bell]
  A -- own entry --> SA[403 SELF_APPROVAL]
```

- **The over-40 flag** and the "did this save cross 40" test are pure functions in [`app/rules/overtime.py`](../../backend/v1/app/rules/overtime.py), along with `hourly_rate()`.
- **The week save, labels, approve and reject, and the breakdown** are in [`app/features/time/service.py`](../../backend/v1/app/features/time/service.py).
- **One alert per person-week** is guaranteed twice: by the crossing check, and by a unique constraint on `(type, subject_user_id, week_start)`.
- **The forecast** is consumed + (the average approved cost over the last 4 complete weeks × the weeks left until the predicted end date).
- **UI:** [`TimesheetPage.jsx`](../../frontend/src/features/timesheet/TimesheetPage.jsx), [`ApprovalRow.jsx`](../../frontend/src/features/approvals/ApprovalRow.jsx), [`BreakdownPanel.jsx`](../../frontend/src/features/approvals/BreakdownPanel.jsx) and [`NotificationBell.jsx`](../../frontend/src/components/NotificationBell.jsx).

## 6. The at-risk rule

```mermaid
flowchart LR
  P[project, not completed, not archived] --> R1{any milestone past its end date<br/>and not completed?}
  P --> R2{today > predicted end date?}
  P --> R3{"budget > 0 and<br/>% budget used − weighted % milestones completed ≥ 20?"}
  R1 -- yes --> A1[OVERDUE_MILESTONE]
  R2 -- yes --> A2[PAST_DUE]
  R3 -- yes --> A3[BUDGET_BURN]
  A1 & A2 & A3 --> OUT[at_risk_reasons = every reason that applies<br/>at risk ⇔ list is non-empty]
```

- **Code:** [`app/rules/at_risk.py`](../../backend/v1/app/rules/at_risk.py), a pure function of dates and numbers.
- **The inputs** (milestone counts, consumed budget) are gathered in one query by [`app/features/insights/`](../../backend/v1/app/features/insights/) and [`projects/`](../../backend/v1/app/features/projects/).
- **Completed % is weighted by difficulty** (easy 1, medium 2, hard 3), the same figure as the project's progress.
- **A project with no milestones** counts as 0% complete, so spending on it can flag burn.
- **Each reason is shown as a badge** by [`RiskBadges.jsx`](../../frontend/src/components/RiskBadges.jsx), on the dashboard, in the project list and on the project overview.

**Worked example:**
- **Atlas Customer Portal** in the demo data ended 4 days ago, and its *Build* and *Launch* milestones are past their end dates. It shows two reasons: *Past due date* and *Overdue milestone*.
- **Apollo** is healthy: 5.4% of its budget is used against 16.7% progress (its easy *Discovery* is done; medium *Schema Mapping* and hard *Cutover* are not).

## 7. Dependency loop detection

```mermaid
flowchart TD
  Q["PUT /milestones/{id}/dependencies {predecessor_ids}"] --> X{all predecessors in the<br/>same project and not archived?}
  X -- no --> XE[400 CROSS_PROJECT_DEPENDENCY]
  X -- yes --> G[load the project's graph:<br/>milestone → set of predecessors]
  G --> D["creates_cycle(edges, id, new_preds):<br/>depth-first search from each new predecessor<br/>through ITS predecessors"]
  D --> F{reached id itself?}
  F -- yes --> CE[400 DEPENDENCY_CYCLE<br/>'That dependency would create a loop']
  F -- no --> OK[replace the edges, audit]
  OK --> B["display_status = blocked while any<br/>predecessor isn't completed (computed, not stored)"]
```

- **Code:** `creates_cycle()` and `dependency_order()` in [`app/rules/cycles.py`](../../backend/v1/app/rules/cycles.py). `dependency_order()` is a topological sort that the timeline uses, with ties broken by start date.
- **The blocked status** is computed in [`app/rules/milestone_status.py`](../../backend/v1/app/rules/milestone_status.py). A blocked milestone can't move out of `not_started`.
- **Example:** with *Discovery → Schema Mapping → Cutover*, making *Discovery* depend on *Cutover* walks Cutover → Schema Mapping → Discovery. That reaches the milestone being edited, so the change is rejected.
- **UI:** the dependency picker is in [`MilestoneDialog.jsx`](../../frontend/src/features/milestones/MilestoneDialog.jsx), and the date bars in [`Timeline.jsx`](../../frontend/src/components/Timeline.jsx).

## 8. The planned 40-hour cap

```mermaid
flowchart TD
  A["POST /projects/{id}/members or PUT …/members/{user}<br/>{planned_hours_per_week}"] --> B{0 < hours ≤ 40?}
  B -- no --> BE[400 VALIDATION_ERROR on the field]
  B -- yes --> C["other = SUM(planned hours) on this person's other<br/>active, non-archived projects whose dates overlap this one"]
  C --> D{"fits_weekly_plan(other, hours):<br/>other + hours ≤ 40?"}
  D -- no --> DE["400 PLANNED_HOURS_EXCEEDED<br/>message shows their current total"]
  D -- yes --> OK[save + audit]
```

- **Code:** [`app/rules/capacity.py`](../../backend/v1/app/rules/capacity.py) holds the rule, and [`app/features/members/service.py`](../../backend/v1/app/features/members/service.py) runs the overlap query.
- **The cap is planned vs logged:** planned hours are a hard cap, while *logged* hours over 40 are only a warning (section 5). Allocation answers "who is over-planned?", and the dashboard's Q5 answers "who actually worked over 40?".

## 9. Auto-routing after "Ready for review"

```mermaid
flowchart TD
  A["POST /milestones/{id}/status {ready_for_review}"] --> B{sent by one of<br/>its assignees?}
  B -- no --> Done[status change only]
  B -- yes --> C[candidates: milestones on projects<br/>where the person is a member]
  C --> D["pick_support_milestone():<br/>in progress, not archived, active non-archived project,<br/>not already assigned, not this milestone"]
  D --> E{any left?}
  E -- no --> Done
  E -- yes --> F[most urgent: overdue first,<br/>then nearest end date, then name]
  F --> G{"fits_weekly_plan(other planned, planned here)?"}
  G -- no --> Done
  G -- yes --> H["INSERT milestone_assignees role = 'supporting'<br/>audit auto_assign_support (actor = the employee)<br/>SUPPORT_ASSIGNED to them, SUPPORT_ROUTED to that project's manager"]
```

- **Code:** the choice is a pure function in [`app/rules/routing.py`](../../backend/v1/app/rules/routing.py). `_route_to_support()` in [`app/features/milestones/service.py`](../../backend/v1/app/features/milestones/service.py) gathers the candidates and writes the result inside the status change's transaction, so either all of it happens or none of it does.
- **Planned hours don't change:** the person is already a member of the project, so they're only routed while their existing plan fits under 40 hours ([`app/rules/capacity.py`](../../backend/v1/app/rules/capacity.py), with the same overlap query as section 8).
- **They stay on the reviewed milestone**, in case the manager sends it back.
- **A manager moving the milestone** isn't routed anywhere unless they're one of its assignees.
- **Example:** Ada marks *Discovery* ready for review. The in-progress milestones on her projects that she isn't on are *Build* (ended 3 days ago) and *Cutover* (due in 5 days), so she's added to *Build* as support. She sees "You've been added as support on Build (Apollo), due …", and the project's manager sees "Ada Lovelace was auto-routed to support Build".
- **UI:** the toast after **Ready for review** names the milestone, and a "Supporting" chip ([`SupportingChip.jsx`](../../frontend/src/components/SupportingChip.jsx)) appears next to the person's name on the milestone card and on their timesheet row.

## 10. Smart insights

A "Smart insights" panel under the dashboard's Risk section, labelled *Rule-based suggestions from your live data*. It's plain rules over our own data: no AI and no outside calls (the Lambda has no internet access).

```mermaid
flowchart TD
  A["GET /insights/smart"] --> S{role}
  S -- admin --> ALL[every project and person]
  S -- manager --> MINE["projects they can see (as on /dashboard)<br/>their reports and their projects' people<br/>pending entries on projects they manage"]
  S -- employee --> ME[only their own hours and rejections]
  ALL & MINE & ME --> R["smart_insights(): seven pure rules"]
  R --> K["rank(): high → medium → low, rule order breaks ties<br/>at most 2 per kind, 6 in all"]
```

| Rule (`kind`) | Fires when | Severity | Links to |
|---|---|---|---|
| `budget_overrun` | Not completed, budget > 0, and the forecast at the end date (the dashboard's forecast) is above the budget | high | project |
| `milestone_overdue` | A milestone on a non-completed project is past its end date and still *not started* or *in progress* | high | project's milestones |
| `over_allocated` | Someone has more than 40 logged hours (pending + approved) this week | high | person |
| `budget_burn` | Not completed, budget > 0, and % budget used − weighted % complete ≥ 20 points (the at-risk `BUDGET_BURN` threshold) | medium | project |
| `milestone_due_soon` | Due in the next 0–7 days and still *not started* or *in progress* | medium | project's milestones |
| `rebalance` | Paired with each over-40 person: the least-loaded person under 20h (50% of 40h), preferring someone who shares a project with them, each suggested once | medium | the person with spare time |
| `approval_backlog` | Entries waiting for this manager (not their own) whose work date is more than 3 days ago | medium | approvals |
| `idle_milestone` | An *in progress* milestone on a project that isn't on hold has had no pending or approved hours for 14+ days (counted from its start if nobody ever logged) | medium | project's milestones |
| `rejections` | Someone has had 2+ entries rejected in the last 30 days | low | person |

- **Code:** the rules and thresholds are pure functions and constants in [`app/rules/insights.py`](../../backend/v1/app/rules/insights.py), unit-tested in `tests/unit/test_rules_insights.py`. [`app/features/insights/smart.py`](../../backend/v1/app/features/insights/smart.py) gathers the data with the dashboard's own scoping helpers (`visible_projects`, `_people_scope`, the same forecast).
- **Each insight** is `{id, kind, severity, title, detail, link}`; `detail` is one sentence with the actual numbers and names.
- **Employees get insights, not a 403:** `/dashboard` is open to every role and filtered to what you may see, so this follows the same pattern. An employee only hears about themselves (over 40 hours, repeated rejections), never about budgets, projects or colleagues.
- **No salary or rate leaves the server.** Rates only feed the cost totals that `/dashboard` already shows as money.
- **UI:** [`SmartInsightsPanel.jsx`](../../frontend/src/features/dashboard/SmartInsightsPanel.jsx). Each row has a severity icon and colour plus a *High/Medium/Low* chip (so colour isn't the only signal), the title, the detail and a link. With nothing to say it shows "No suggestions right now". It shares the dashboard's query key, so approvals and project edits refresh it.

**Worked example (demo data, as `manager.demo`):** Eli has 45h logged this week (*high*); Ana, on the same project, has 0h, so she's suggested to take some of his work (*medium*); Ben's hours from last Thursday are still pending (*medium*); and Ana has had two entries rejected this month (*low*).

## 11. Pull mode: claiming a milestone

Each project works in **push** mode (the default: its manager assigns people, as before) or **pull** mode, set by the project's manager or an admin in the project dialog. In a pull project, people on the team pick up ready work themselves.

```mermaid
flowchart TD
  A["POST /milestones/{id}/claim"] --> V{can see the project?}
  V -- no --> N404[404]
  V -- yes --> P{project in pull mode?}
  P -- no --> E1["409 NOT_PULL_PROJECT"]
  P -- yes --> M{caller on the team?}
  M -- no --> E2["403 NOT_A_MEMBER"]
  M -- yes --> L["BEGIN; SELECT the milestone … FOR UPDATE<br/>(a second claim waits here)"]
  L --> R["claim_blocker(): project planned or active,<br/>milestone not started, not archived,<br/>every predecessor completed, nobody on it"]
  R -- project on hold, completed or archived --> E5["409 PROJECT_NOT_ACTIVE"]
  R -- not ready --> E3["409 NOT_READY"]
  R -- someone on it --> E4["409 ALREADY_CLAIMED"]
  R -- ok --> W["INSERT milestone_assignees role = 'primary'<br/>audit claim (actor = the claimer)<br/>MILESTONE_CLAIMED to the project manager; COMMIT"]
```

- **Code:** the eligibility check is a pure function, `claim_blocker()` in [`app/rules/claim.py`](../../backend/v1/app/rules/claim.py). `claim_milestone()` in [`app/features/milestones/service.py`](../../backend/v1/app/features/milestones/service.py) locks the milestone row, re-reads its status and the project's status, assignees and predecessors, and writes the assignment, the audit entry and the notification in one transaction.
- **Race:** the row lock means two claims at once can't both win. The second waits for the first to commit, then sees an assignee and gets `409 ALREADY_CLAIMED` (tested with two real database connections in `tests/integration/test_claim.py`).
- **Who can claim:** active team members only. The manager and admins (unless they're on the team) assign through the milestone dialog, as in push mode, which still works in pull projects.
- **The 40-hour cap is unchanged:** claimers are already on the team, so their planned hours don't move; the cap is checked when someone joins a team (section 8). Manager assignments don't check it either.
- **The list says what's claimable:** each milestone has `claimable` (pull project that's planned or active, ready, nobody on it) and `can_claim` (claimable and the caller is on the team), from the same `claim_blocker()`.
- **UI:** [`MilestonesTab.jsx`](../../frontend/src/features/milestones/MilestonesTab.jsx) shows a short pull-mode explanation and a **Claim** button on each milestone the viewer can claim; a lost race shows the server's message on that card. The manager's bell links to the project's milestones.
- **Example (demo data):** *Beacon Mobile App* is in pull mode. Gia and Hugo are on its team; *Design* has nobody on it and nothing to wait on, so either can claim it. *Prototype* waits on *Design*, so it can't be claimed until *Design* is completed.

## 12. The dashboard's department filter

Admins keep a list of departments (the **Departments** page); people (set by an admin on the person's page) and projects (set by the project's manager or an admin) can each be in one.

- **Filtered on the server:** the dashboard sends `GET /dashboard?department=<id>`. [`visible_projects()`](../../backend/v1/app/features/projects/service.py) adds `p.department_id = :dept` to the same visibility query, so the status counts, risk section, active-projects table, deliverables, dependency links and budget chart all come from that department's projects. `over_allocated` keeps only that department's people, and `pending_approvals` only entries on its projects.
- **Why the server:** the response's milestone lists and budgets are built from the visible projects, so filtering the rows once there keeps every widget consistent, and nothing outside the department is sent.
- **Allocation widget:** `/allocations` returns each person's `department_id`, and the dashboard's "busiest people" table hides people from other departments.
- **The choice is in the URL** (`/?department=<id>`), so a filtered dashboard can be shared or reloaded. "All departments" removes it. The filter only appears once there's at least one department.
- **Smart insights follow it too:** the panel (section 10) sends `GET /insights/smart?department=<id>`, which uses the same `visible_projects(department=)` for the project, budget and milestone insights, keeps only that department's people for the hours and rejection insights, and counts only its projects' entries in the approval backlog.
- **Code:** [`DashboardPage.jsx`](../../frontend/src/features/dashboard/DashboardPage.jsx), [`app/features/departments/`](../../backend/v1/app/features/departments/) and [`DepartmentsPage.jsx`](../../frontend/src/features/departments/DepartmentsPage.jsx).
