# API reference

- **Base URL:**
  - In the cloud: `https://d3ucnz03j0sngl.cloudfront.net/api/v1`
  - Locally: `http://localhost:3001/api/v1`, or `http://localhost:3000/api/v1` through the Vite proxy
- **Bodies are JSON.** Dates are `YYYY-MM-DD`, money and hours are numbers, and IDs are UUIDs.
- **Authentication:**
  - Send `Authorization: Bearer <access_token>`. Tokens last 15 minutes.
  - The refresh token is an `HttpOnly; SameSite=Strict` cookie named `ow_refresh` (also `Secure` in the cloud). It's scoped to `/api/v1/auth`, so JavaScript can't read it and it isn't sent to any other endpoint.
- **Request IDs:**
  - Send `x-request-id` to choose one (`[A-Za-z0-9-]{1,64}`), or let the server generate a UUID.
  - It comes back in the `x-request-id` response header and inside every error.
- **Lists:** paged lists take `page` (default 1) and `page_size` (default 25, max 100), and return `{"items": […], "total": n}`. Short lists (milestones, members, approvals, notifications, allocations) return a plain array.

Every example below is a real response from the local server, loaded with the demo seed. IDs are shortened in the prose only.

## Errors

Every error has the same envelope:

```json
{"error": {"code": "VALIDATION_ERROR", "message": "planned_hours_per_week: max:40",
           "details": {"planned_hours_per_week": "max:40"}, "request_id": "93913342-5bb5-4232-b3c9-979bacfd3cc3"}}
```

`details` maps field names to a short reason (`required`, `taken`, `max:40`, …). The UI uses it to show the error next to the right field.

| Status | Codes | When |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `FIELD_NOT_EDITABLE` | A missing or invalid field, malformed JSON, or a field your role can't set |
| 400 | `PASSWORD_POLICY`, `PASSWORD_REUSED`, `CODE_INVALID`, `CODE_EXPIRED`, `TOKEN_INVALID`, `TOKEN_EXPIRED` | Password and reset flow (here `TOKEN_*` refers to the short-lived reset token) |
| 400 | `PLANNED_HOURS_EXCEEDED` | Staffing would plan someone past 40 h/week across overlapping projects |
| 400 | `DEPENDENCY_CYCLE`, `CROSS_PROJECT_DEPENDENCY`, `INVALID_TRANSITION`, `MILESTONES_OUT_OF_RANGE`, `MILESTONES_INCOMPLETE` | Milestone and project rules |
| 400 | `NOT_ASSIGNED`, `NOT_A_MEMBER`, `OUTSIDE_WEEK`, `OUT_OF_PROJECT_RANGE`, `CANNOT_CLEAR_DECIDED`, `NOT_PENDING` | Timesheet and approval rules |
| 400 | `REQUEST_CLOSED`, `SELF_ARCHIVE`, `SELF_DEMOTION` | Deciding a request twice; archiving or demoting yourself |
| 401 | `AUTH_REQUIRED`, `TOKEN_EXPIRED` | No token, or an expired access token (the client refreshes and retries once) |
| 401 | `INVALID_CREDENTIALS`, `TEMP_PASSWORD_EXPIRED`, `REFRESH_INVALID` | Sign-in and refresh |
| 403 | `FORBIDDEN`, `NOT_ASSIGNED`, `SELF_APPROVAL`, `PASSWORD_CHANGE_REQUIRED`, `DEMO_ACCOUNT` | Not allowed for your role or this record; approving your own hours; a temporary password is still in use; changing a published demo account's password |
| 403 | `READ_ONLY` | An executive called a `POST`, `PUT`, `PATCH` or `DELETE` route other than their own account's (see [Executives](#executives-read-only)) |
| 404 | `NOT_FOUND` | It doesn't exist, **or you aren't allowed to see it** (so its existence isn't revealed) |
| 405 | `METHOD_NOT_ALLOWED` | The path exists, but not with this method |
| 409 | `STALE_ENTRY` | The time entry changed (edited or decided by someone else) since you loaded it |
| 409 | `CONFLICT`, `ALREADY_MEMBER`, `HAS_DEPENDENTS` | A duplicate username, email or project name; already on the team; archiving someone who still manages projects or has reports (`details` lists them) |
| 423 | `ACCOUNT_LOCKED`, `CODE_LOCKED` | 5 failed sign-ins (15-minute lock), or 5 wrong reset codes |
| 500 | `INTERNAL_ERROR` | An unexpected error. It's logged with a stack trace, under the same `request_id` |

Success codes: `200` OK, `201` created, `204` archived or no content.

## Executives (read-only)

`role: "executive"` is read-only leadership. Executives read what an admin reads for delivery oversight: `/dashboard`, `/insights/smart`, `/allocations`, `/projects` (all, archived ones included) and every project tab, `/milestones/…`, `/archive` (every type, `can_restore` always `false`), `/audit-log`, `/departments`, `/users` (names only, like a manager) and anyone's `/users/{id}/profile`. They have no timesheet and no approvals queue (`/approvals`, `/timesheets/approved`, `/project-requests` and someone else's `/time-entries` are `403`). They read the list of HR submissions (`GET /hr-submissions`, totals only) but not its per-person rows, and can't submit.

- **No writes.** The router refuses every `POST`, `PUT`, `PATCH` and `DELETE` for an executive with `403 READ_ONLY` before the handler runs. A route opts in with `allow_executive=True`; only their own account does: `POST /auth/change-password`, `PUT /me`, `PUT /me/avatar`, `DELETE /me/avatar`, `POST /notifications/read-all`, `POST /notifications/{id}/read`, and sending their own messages: `POST /conversations`, `POST /conversations/{id}/messages`, `POST /conversations/{id}/read` (sign-in, refresh and logout need no token). A test walks every registered write route and checks this list.
- **No pay.** Every JSON response to an executive has every `salary` and `hourly_rate` field removed, at any depth, including the audit log's `changes` and their own `/me` and profile.

---

## Auth

| Method | Path | Auth | Body → response |
|---|---|---|---|
| POST | `/auth/login` | — | `{username, password}` → `200 {access_token, user}` and sets the `ow_refresh` cookie |
| POST | `/auth/refresh` | cookie | → `200 {access_token, user}`; rotates the cookie |
| POST | `/auth/logout` | cookie | → `204`; revokes the refresh token and clears the cookie |
| POST | `/auth/change-password` | Bearer (a restricted token is allowed) | `{current_password, new_password}` → `200 {access_token, user}` |
| POST | `/auth/forgot-password` | — | `{username}` → `200 {"message": "If that account exists, a code has been sent."}` (always the same) |
| POST | `/auth/verify-reset-code` | — | `{username, code}` → `200 {reset_token}` |
| POST | `/auth/reset-password` | — | `{reset_token, new_password}` → `204`; ends every session |
| GET | `/me` | Bearer | → your profile, including your own salary |
| PUT | `/me` | Bearer | `{first_name?, last_name?, email?}` → the updated profile |
| PUT | `/me/avatar` | Bearer | `{image}`: your profile photo as base64 PNG → the updated profile. See [Profile photos](#profile-photos) |
| DELETE | `/me/avatar` | Bearer | Removes your photo → the updated profile (`200` even if you had none) |

```http
POST /api/v1/auth/login
{"username": "manager.demo", "password": "Demo123!"}
```
```json
{"access_token": "eyJhbGciOiJIUzI1NiIs…",
 "user": {"id": "9315bbc9-0e17-4115-b1c3-8331a806ec6b", "username": "manager.demo", "first_name": "Morgan",
          "last_name": "Manager", "email": "manager.demo@acme.example", "role": "manager", "must_change_password": false}}
```

A wrong password:
```json
{"error": {"code": "INVALID_CREDENTIALS", "message": "Incorrect username or password", "details": null,
           "request_id": "fdfa307a-f154-4463-bfa4-74b2091890b8"}}
```

If `user.must_change_password` is `true`, the token is **restricted**: every endpoint except `/auth/change-password` returns `403 PASSWORD_CHANGE_REQUIRED`.

## Users (admin, except where noted)

| Method | Path | Notes |
|---|---|---|
| GET | `/users?q=&role=&archived=&page=&page_size=` | Admins, managers and executives. Managers and executives get only `id`, `username`, names and `job_title`. `role` is `admin`, `manager`, `employee` or `executive` |
| POST | `/users` | `{first_name, last_name, email, role, manager_id (required for employees), job_title?, salary?, department_id?, tracks_own_hours?, username, password}` → `201 {user, email_sent, temp_password?}`. `temp_password` is only returned when the email couldn't be sent. `tracks_own_hours` defaults to `true` for employees and `false` for managers, admins and executives |
| GET | `/users/{id}` | |
| GET | `/users/{id}/profile?week=` | Every role. Admins and executives see anyone; managers see themselves, their reports, people on a project they manage and anyone whose hours wait for them (delegated projects included); employees see only themselves. Anyone else gets `404`. `salary` is only included for admins and the person themselves, never for an executive |
| PUT | `/users/{id}` | Any field, including `username`, `role`, `salary`, `manager_id`, `department_id` (an active department, or `null` to clear it; anything else is `400`) and `tracks_own_hours` (`true`/`false`, else `400 {"tracks_own_hours": "must_be_boolean"}`): whether a manager or admin keeps a personal timesheet. Changing `role` without sending `tracks_own_hours` resets it to the new role's default. You can't change your own role or salary. Moving a manager or admin to `employee` or `executive` is `409 HAS_DEPENDENTS` while they manage projects or have reports |
| DELETE | `/users/{id}` | Archives the account → `204`. Returns `409 HAS_DEPENDENTS` if they manage projects or have reports |
| POST | `/users/{id}/restore` | |
| POST | `/users/{id}/reset-password` | Issues a new temporary password, forces a change at the next sign-in and ends their sessions → `{email_sent, temp_password?}` |
| GET | `/users/username-availability?username=&first=&last=` | Live check while typing |

```json
{"user": {"id": "81c483ea-…", "name": "Eli Employee", "job_title": "Software Engineer", "role": "employee",
          "manager": {"id": "9315bbc9-…", "name": "Morgan Manager"}, "department": {"id": "4f1c…", "name": "Technology"},
          "is_archived": false},
 "this_week": {"week_start": "2026-10-12", "logged": 45.0, "overtime": 5.0, "planned": 30.0},
 "all_time": {"logged": 212.0, "approved": 160.0},
 "projects": [{"id": "86a8c3a5-…", "name": "Apollo Data Migration", "status": "active", "planned_hours_per_week": 30.0,
               "on_team": true, "logged_hours": 120.0, "approved_hours": 96.0, "can_open": true, "…": "…"}],
 "milestones": [{"id": "…", "name": "Schema Mapping", "role": "supporting", "status": "in_progress",
                 "project": {"id": "86a8c3a5-…", "name": "Apollo Data Migration", "status": "active", "is_archived": false},
                 "logged_hours": 24.0,
                 "approved_hours": 16.0, "can_open": true, "…": "…"}]}
```

`logged` counts pending and approved hours; `overtime` is the hours logged this week beyond 40. Totals leave out archived projects and milestones. The history lists every project they've been on and every milestone they're assigned to or logged time on, completed ones included; `role` is `null` once they're no longer assigned. Archived projects and milestones are in the history only for admins and for the person themselves (their own past work); a manager viewing someone sees live work only. Each milestone's `project` carries its `status` and `is_archived`. Nothing on the profile is editable.

```http
GET /api/v1/users/username-availability?username=jsmith&first=Jane&last=Smith
```
```json
{"username": "jsmith", "valid": true, "available": true,
 "suggestions": ["jsmith", "jane.smith", "smithj", "jane_smith", "janes"]}
```

## Profile photos

Every role can set and remove their own photo; admins can also remove anyone's. Any signed-in user can view photos. User JSON (`/me`, `/users`, `/users/{id}`) carries `avatar_url`: the photo's path under `/api/v1` with a version for cache busting, or `null`.

| Method | Path | Notes |
|---|---|---|
| GET | `/avatars` | Every signed-in user. `{items: {user_id: version}}` for everyone who has a photo, so lists know whose photo to fetch without asking per person |
| PUT | `/me/avatar` | `{image}`: base64 (standard alphabet, no `data:` prefix) of a PNG, at most 300 KB decoded and 16–512 px on each side. The server checks it and stores a rebuilt copy (see [LOGIC_WALKTHROUGH §13](LOGIC_WALKTHROUGH.md#13-avatar-upload-safety)) → the updated profile |
| DELETE | `/me/avatar` | → the updated profile |
| GET | `/users/{id}/avatar?v=` | Every signed-in user. The PNG bytes (not JSON), or `404` if they have no photo. The server ignores `v`; it only makes each version a new URL |
| DELETE | `/users/{id}/avatar` | Admin. → `204`, or `404` for an unknown user |

A refused upload is `400 VALIDATION_ERROR` with `details: {"image": reason}` and a message that says what's wrong. `reason` is one of `required`, `invalid_base64`, `too_large`, `not_png` (SVG, GIF, HTML, JPEG or anything else), `bad_dimensions`, `bad_header`, `bad_chunk`, `bad_crc`, `trailing_data`, `truncated` or `bad_image_data`.

```json
{"error": {"code": "VALIDATION_ERROR", "message": "That image has extra data hidden after it, so it was refused.",
           "details": {"image": "trailing_data"}, "request_id": "…"}}
```

The photo itself comes back as a Function URL response with `isBase64Encoded: true` (Lambda decodes it, so the browser gets raw bytes; the CloudFront `/api` behaviour doesn't cache) and these headers:

```http
content-type: image/png
x-content-type-options: nosniff
content-disposition: inline
content-security-policy: default-src 'none'
cache-control: private, max-age=300
```

Setting and removing a photo are audited as `avatar_set` / `avatar_remove` on the `user`; the entry records the stored size, never the image.

## Departments

| Method | Path | Notes |
|---|---|---|
| GET | `/departments?include_archived=true` | Everyone signed in. Active departments by name, each with `user_count` and `project_count` (non-archived people and projects in it). `include_archived` only works for admins |
| POST | `/departments` | Admin. `{name}` (1–80 characters) → `201`. A name already used, ignoring case, is `409 CONFLICT` with `{name: "taken"}` |
| PUT | `/departments/{id}` | Admin. `{name}`: renames it |
| DELETE | `/departments/{id}` | Admin. Archives it → `204`. It leaves the pickers and the dashboard filter; people and projects already in it keep it |
| POST | `/departments/{id}/restore` | Admin |

Every change is in the audit log (`entity_type` `department`).

```json
{"items": [{"id": "4f1c…", "name": "Technology", "is_archived": false, "archived_at": null,
            "user_count": 7, "project_count": 2}]}
```

## Project requests

| Method | Path | Notes |
|---|---|---|
| GET | `/project-requests?status=` | Admins see all requests; managers see their own |
| POST | `/project-requests` | Managers only. `{name, description?, proposed_start, proposed_end, proposed_budget?, department_id?, work_mode?}` → `201`. No reason is asked for any more; a `reason` sent by an older client is ignored. `work_mode` is `push` (default) or `pull`; `department_id` an active department |
| POST | `/project-requests/{id}/approve` | Admin. One step: creates the project (`planned`, the requester as its manager, the request's dates, budget, department and work mode; a department archived since is left off) and closes the request → `{request, project}`. Optional body `{department_id?, template?}`: `department_id` overrides the request's department, `template: true` starts the project from that department's template (same rules as `POST /projects`) |
| POST | `/project-requests/{id}/reject` | Admin. `{comment?}`: an optional note for the requester, at most 500 characters (`400 {"comment": "max_length:500"}`); empty means none |

```json
{"id": "2cb5b5e5-c871-42af-88d7-f7c62061c97a", "name": "Docs Demo", "description": "d",
 "proposed_start": "2026-11-01", "proposed_end": "2026-12-01", "proposed_budget": 10000.0, "reason": null,
 "department": {"id": "4f1c…", "name": "Technology"}, "work_mode": "push", "status": "pending", "requested_by": {"id": "9315bbc9-…", "name": "Morgan Manager"},
 "decided_at": null, "decision_comment": null, "project_id": null, "created_at": "2026-10-13T18:06:34.468429-04:00"}
```

## Projects

| Method | Path | Notes |
|---|---|---|
| GET | `/projects?q=&status=&manager=&department=&at_risk=true&archived=true&page=&page_size=` | Only the projects you can see (admins and executives: all). `archived` is for admins and executives; `department` is a department ID. Each item has `team`: its active members as `[{id, name}]`, by last name (for the list's avatars), and `delegate` (below) |
| GET | `/project-templates` | Anyone signed in. `{items: [{department, milestones: [{name, description, weight, estimated_hours, difficulty, priority, after, skills}]}]}`: the department plans a new project can start from ([presets](LOGIC_WALKTHROUGH.md#22-department-presets-and-project-templates)). `estimated_hours` is for a 26-week project; a template scales it to the dates |
| POST | `/projects` | Admin. `{name, description?, start_date, predicted_end_date, budget, manager_id, status?, department_id?, work_mode?, template?}` → `201`. `work_mode` is `push` (default) or `pull`. `template: true` also creates the department's plan inside the project's dates in the same transaction (not started, nobody assigned, with dependencies, difficulty, priority and estimates; audited as `apply_template`). `400 VALIDATION_ERROR` with `{template: "no_department"}`, `"no_preset"` (that department has no plan), `"too_short"` (fewer days than plan stages) or `"invalid"` (not a boolean) |
| GET | `/projects/{id}` | `404` if you can't see it |
| PUT | `/projects/{id}` | The project's manager or an admin, including `department_id` (an active department or `null`) and `work_mode`. Only admins can change the manager. `delegate_approver_id` (an active manager or admin other than the project's manager, or `null` to remove it, which also clears the date; otherwise `400 VALIDATION_ERROR` `{delegate_approver_id: "invalid"}`) and `delegate_until` (optional date, not in the past: `{delegate_until: "past"}`; without a delegate: `{delegate_until: "no_delegate"}`). Naming a new delegate sends them `DELEGATE_ASSIGNED`. Every project view has `delegate`: `null` or `{id, name, until, active}`, where `active` means no end date or today ≤ `until` |
| DELETE | `/projects/{id}` | Admin only (`403` for managers, even their own project). Archives the project → `204` |
| POST | `/projects/{id}/restore` | Admin only (`403` for managers) |
| GET | `/projects/{id}/summary` | Budget, consumed, remaining, percentages, risk reasons and team size |

Every project view (list, detail and the summary's `project`) also has the expected time frame: `total_estimated_hours` (sum of its non-archived milestones' estimates, `null` when none has one), `logged_hours` (pending and approved hours on them), `duration_days` and `working_days` (from the project's dates) and `estimate_used_pct` (logged hours on estimated milestones ÷ total estimate, `null` without estimates).
| GET | `/projects/{id}/milestone-costs` | Per non-archived milestone (`milestone` is `{id, name, status, priority}`): `approved_hours`, `pending_hours`, `approved_cost` and `budget_pct`, plus a `total` whose `approved_cost` is the project's `consumed`. Hours are `null` (and `hours_visible` is `false`) unless you manage the project or are an executive. Never includes an hourly rate |

```http
GET /api/v1/projects?page_size=1
```
```json
{"items": [{"id": "86a8c3a5-ce0c-4f80-8ca3-8ec702661dc8", "name": "Apollo Data Migration",
            "description": "Move customer records from the legacy warehouse to the new platform.", "status": "active",
            "start_date": "2026-07-15", "predicted_end_date": "2026-12-27", "budget": 250000.0, "consumed": 13465.92,
            "budget_pct": 5.4, "progress_pct": 16.7, "at_risk_reasons": [],
            "manager": {"id": "9315bbc9-…", "name": "Morgan Manager"},
            "department": {"id": "4f1c…", "name": "Technology"}, "work_mode": "push",
            "is_archived": false, "completed_at": null, "created_at": "2026-10-13T18:00:15.020027-04:00"}],
 "total": 3}
```

`at_risk_reasons` lists any of `OVERDUE_MILESTONE`, `PAST_DUE` and `BUDGET_BURN` ([rule](LOGIC_WALKTHROUGH.md#6-the-at-risk-rule)).

A missing field:
```json
{"error": {"code": "VALIDATION_ERROR", "message": "Missing required fields", "details": {"manager_id": "required"},
           "request_id": "1b0e4e20-86ad-46eb-b314-045a2dd3b66b"}}
```

## Members (staffing)

| Method | Path | Notes |
|---|---|---|
| GET | `/projects/{id}/members` | |
| POST | `/projects/{id}/members` | `{user_id, planned_hours_per_week}` (more than 0, at most 40) → `201`. Returns `400 PLANNED_HOURS_EXCEEDED` past 40 h/week across overlapping projects, or `409 ALREADY_MEMBER` |
| PUT | `/projects/{id}/members/{user_id}` | `{planned_hours_per_week}` |
| DELETE | `/projects/{id}/members/{user_id}` | Removes them from the project and from its milestones → `204` |

## Milestones

| Method | Path | Notes |
|---|---|---|
| GET | `/projects/{id}/milestones` | In dependency order, with `display_status`, `blocked`, `predecessors`, `assignees`, `supporting_ids` (assignees who are there as support), `difficulty`, `priority`, `estimated_hours`, `duration_days`, `working_days`, `logged_hours` (pending and approved), `estimate_used_pct`, `is_assignee`, `claimable` (a pull project's ready, unassigned milestone) and `can_claim` (claimable and you're on the team) |
| POST | `/projects/{id}/milestones` | `{name, description?, start_date, end_date, difficulty?, priority?, estimated_hours?}` → `201`. `estimated_hours` (person-hours, optional) is more than 0, at most 10,000 and has at most one decimal, else `400 VALIDATION_ERROR` `{estimated_hours: "min:0.1" / "max:10000" / "one_decimal" / "invalid_number"}`; `null` or `""` means no estimate. `difficulty` is `easy`, `medium` (default) or `hard`; `priority` is `low`, `medium` (default), `high` or `critical`; anything else is `400 VALIDATION_ERROR` (`{difficulty: invalid_choice}` or `{priority: invalid_choice}`). Priority is how urgent the milestone is and never changes progress (difficulty does). The dates must fall within the project's dates |
| GET / PUT / DELETE | `/milestones/{id}` | `PUT` takes any of `name`, `description`, `start_date`, `end_date`, `difficulty`, `priority`, `estimated_hours` (`null` clears it) (the project's manager or an admin; audited as `update`). `DELETE` archives |
| POST | `/milestones/{id}/restore` | Admins and the project's manager (`403` for employees; `404` for other managers, or when the project itself is archived and you're not an admin) |
| PUT | `/milestones/{id}/dependencies` | `{predecessor_ids: [...]}` → `{…, warnings}`. Returns `400 DEPENDENCY_CYCLE` or `CROSS_PROJECT_DEPENDENCY`. `warnings` flags a start date before a predecessor's end |
| PUT | `/milestones/{id}/assignees` | `{user_ids: [...]}`. They must be project members (`NOT_A_MEMBER`) |
| POST | `/milestones/{id}/status` | `{status}`. Assignees can move it to `in_progress` and `ready_for_review`; only the manager or an admin can set `completed` or send it back. Returns `400 INVALID_TRANSITION`, or `403 NOT_ASSIGNED`. The response is the milestone plus `routed_to`: when an assignee sends it for review they're added as support elsewhere ([auto-routing](LOGIC_WALKTHROUGH.md#9-auto-routing-after-ready-for-review)) and `routed_to` is `{milestone: {id, name, end_date}, project: {id, name}}`; otherwise it's `null` |
| POST | `/milestones/{id}/claim` | Pull projects only: a team member makes themselves the primary assignee of a milestone that's ready to start (not started, every predecessor completed) and has nobody on it → the milestone. `409 NOT_PULL_PROJECT` in a push project, `409 PROJECT_NOT_ACTIVE` unless the project is planned or active, `409 NOT_READY`, `409 ALREADY_CLAIMED` (also what the second of two simultaneous claims gets), `403 NOT_A_MEMBER` for anyone not on the team. Audited as `claim`; the project manager gets `MILESTONE_CLAIMED` ([pull mode](LOGIC_WALKTHROUGH.md#11-pull-mode-claiming-a-milestone)) |
| GET / POST | `/milestones/{id}/notes` | `{body}` (1–2,000 characters). Append-only |

```json
{"id": "07ad53b4-fd9d-4947-a584-aed75e47ec08", "project_id": "86a8c3a5-…", "name": "Discovery",
 "description": "Inventory every legacy table.", "start_date": "2026-07-15", "end_date": "2026-08-14",
 "status": "completed", "difficulty": "easy", "priority": "medium", "display_status": "completed", "blocked": false, "predecessors": [],
 "assignees": [{"id": "81c483ea-…", "name": "Eli Employee"}, {"id": "a250afbe-…", "name": "Chloe Park"}],
 "is_assignee": false, "completed_at": "2026-10-13T18:00:15.020027-04:00", "is_archived": false}
```

`reason` is `null` for new requests; requests made before it was dropped keep theirs (read-only, not shown in the app).
Every milestone also has `plan_column` (`backlog`, `ready` or `scheduled`) and `sequence` (its place in that column, from 1): where it sits on the planning board below.

## Planning board

While a project is `planned` and its plan isn't finalized, its manager or an admin arranges the milestones on a board (Backlog → Ready → Scheduled) and then finalizes the plan, which moves the project to `active` ([rules](LOGIC_WALKTHROUGH.md#22-the-planning-board-and-finalizing-a-plan)). Cards are created, edited and archived with the milestone endpoints above.

| Method | Path | Notes |
|---|---|---|
| GET | `/projects/{id}/plan` | Anyone who can see the project. `{project_id, status, plan_finalized_at, editable, ready, checks}`: `editable` is true for the project's manager or an admin while the project is `planned` and not finalized; `ready` is true when every check passes; `checks` is the finalize checklist below |
| PUT | `/projects/{id}/plan/order` | The project's manager or an admin (`403 FORBIDDEN` otherwise; executives `403 READ_ONLY`). `{items: [{milestone_id, plan_column, sequence}]}`, 1 to 500 items, each milestone once; cards left out stay where they are. All or nothing, audited as `plan_order` on the project → the project's milestone list. `400 VALIDATION_ERROR` for a bad column, a sequence that isn't a whole number ≥ 0, a repeated milestone or an empty list; `400 UNKNOWN_MILESTONE` when an id isn't a live (non-archived) milestone of this project; `409 PROJECT_NOT_PLANNED` unless the project is `planned`; `409 PLAN_FINALIZED` once the plan is finalized |
| POST | `/projects/{id}/plan/finalize` | The project's manager or an admin. Runs the checks; when they all pass it sets `plan_finalized_at`, moves the project `planned` → `active`, audits `finalize_plan` and sends `PLAN_FINALIZED` to the team → `{project, first_milestone: {id, name}}`. `422 PLAN_INVALID` with `details.checks` (every check, passing or not) when any fails; `409 PROJECT_NOT_PLANNED` / `409 PLAN_FINALIZED` as above |

Each check is `{code, label, ok, problems: [{milestone_id, name, message}]}`, always in this order:

| `code` | Passes when |
|---|---|
| `HAS_SCHEDULED` | At least one milestone is in Scheduled |
| `ALL_SCHEDULED` | Nothing is left in Backlog or Ready |
| `DATES_IN_RANGE` | Every scheduled milestone's dates fall within the project's start and predicted end dates |
| `HAS_ASSIGNEE` | Every scheduled milestone has at least one assignee |
| `DEPENDENCIES_VALID` | No dependency points to another project's milestone and none forms a loop |
| `SEQUENCE_MATCHES_DEPENDENCIES` | No scheduled milestone is ordered before a milestone it depends on |

```json
{"error": {"code": "PLAN_INVALID", "message": "The plan isn't ready to finalize yet", "details": {"checks": [
  {"code": "HAS_SCHEDULED", "label": "At least one milestone is scheduled", "ok": true, "problems": []},
  {"code": "ALL_SCHEDULED", "label": "Nothing is left in Backlog or Ready", "ok": false,
   "problems": [{"milestone_id": "5d1e…", "name": "User Research", "message": "User Research is still in Backlog"}]},
  …]}, "request_id": "…"}}
```

`PUT /projects/{id}` with `{"status": "active"}` on a `planned` project that has live milestones and no finalized plan is refused with `409 PLAN_NOT_FINALIZED` "Finalize the plan on the Plan tab to start this project"; a planned project without milestones can still start directly. Every project view has `plan_finalized_at` (`null` until the plan is finalized).

## Time entries and approvals

Who logs hours: employees always; managers and admins only when `tracks_own_hours` is on (an admin sets it per person); executives never. Anyone else saving a week gets `403 TIMESHEET_DISABLED`. Reading your own week (`GET /time-entries`) is always allowed.

| Method | Path | Notes |
|---|---|---|
| GET | `/time-entries?week=YYYY-MM-DD&user=` | The week grid: rows (assigned milestones, each with `role`: `primary` or `supporting`, the `project`'s `status`, and `open`: `false` when the project is on hold or completed), entries and totals. `user` lets a manager or admin view someone else |
| PUT | `/time-entries` | `{week, entries: [{milestone_id, work_date, hours}]}` saves a week, all or nothing. `hours: 0` clears a pending cell. Every changed entry becomes `pending`. Re-sending a **rejected** cell unchanged resubmits it. See the rules below |
| GET | `/approvals?user=&project=&milestone=` | Admins and managers. Pending entries you can decide (never your own): admins all; managers their projects' and those of projects delegated to them while the delegation is active. Each item has `delegated_from`: `{id, name}` of the project's manager when it's in your queue as the delegate, otherwise `null` |
| GET | `/time-entries/{id}/breakdown` | The budget impact of approving this entry, for whoever may decide it (the project's manager, an admin, or its active delegate). `hourly_rate` is included for admins only, because a rate reveals a salary; managers and delegates get the cost |
| POST | `/time-entries/{id}/approve` | `{expected_hours?}`: the hours you saw. Copies the hourly rate onto the entry, which then counts toward the budget. Returns `409 STALE_ENTRY` if the entry changed since you loaded it |
| POST | `/time-entries/{id}/reject` | `{reason, expected_hours?}`. Same `409 STALE_ENTRY` guard. Sends the employee an `ENTRY_REJECTED` alert |
| POST | `/approvals/approve-week` | Admins and managers. `{entries: [{id, expected_hours}]}`: approves one person's week in one step, all or nothing (at most 100 entries). Each entry gets the same checks as a single approval (`403 SELF_APPROVAL`, `404`, `400 NOT_PENDING`, `409 STALE_ENTRY`); entries of more than one person or week are `400 MIXED_WEEKS` → `{approved, user_id, week_start}` |
| GET | `/timesheets/approved?from=&to=` | Admins and managers. Approved hours per person and week (default: the last 8 weeks; at most a year): admins everyone, managers the projects they manage plus anything they approved themselves. Each row: `user {id, name, username}`, `week_start`, `entry_count`, `hours`, `projects`, `hr_submitted` (every entry sent to HR and unchanged since), `hr_submitted_count`, `hr_submitted_at`, `hr_changed_count` (entries changed after they were sent), and `cost` for admins only (cost ÷ hours would reveal a rate) |

Entries also carry `hr_submitted_at`, `changed_after_hr_submission` and `hr_changed_at` (see [HR submissions](#hr-submissions)).

```http
GET /api/v1/time-entries          (as employee.demo, this week)
```
```json
{"week_start": "2026-10-12", "user": {"id": "81c483ea-…", "name": "Eli Employee"},
 "rows": [{"milestone": {"id": "202d87b5-…", "name": "Schema Mapping"}, "project": {"id": "86a8c3a5-…", "name": "Apollo Data Migration"}}],
 "entries": [{"id": "c990c51e-…", "milestone_id": "202d87b5-…", "work_date": "2026-10-12", "hours": 9.0, "status": "pending",
              "over_40": false, "edited_after_decision": false, "rejection_reason": null, "hourly_rate": null,
              "label": "Pending approval"}, "…"],
 "totals": {"logged": 45.0, "approved": 0.0}}
```

The entry that takes the week past 40 hours carries `"over_40": true` and `"label": "Pending (Overtime requested from …)"`. Going over 40 is never refused: the hours above 40 go to the manager as an overtime request.

**Saving rules** (`PUT /time-entries`):

| Rule | Error |
|---|---|
| `hours` is a JSON number, or text made of digits and one decimal point (`"7.5"`). Letters, `"1e1"`, `"+5"`, `"7,5"`, booleans, lists are refused | `400 VALIDATION_ERROR`, `details: {"hours": "invalid_number"}` |
| Not negative | `400 VALIDATION_ERROR`, `details: {"hours": "min:0"}`, message "Hours on Mon 12 Oct can't be negative" |
| At most 24 in one cell, at least 0.25 unless clearing it | `400 VALIDATION_ERROR`, `{"hours": "max:24"}` / `{"hours": "min:0.25"}` |
| At most 2 decimal places (`7.25` is fine, `7.255` isn't) | `400 VALIDATION_ERROR`, `{"hours": "Use at most 2 decimal places"}` |
| A day's total across all the person's milestones stays at or under 24: their saved pending and approved hours on live (non-archived) work, with each cell in the save replacing what it held. Rejected hours don't count | `400 DAY_OVER_24H`, `details: {"work_date": "2026-10-14", "hours": 26.0}`, message "More than 24h on Wed 14 Oct (26h across your milestones). …" |
| No new or changed hours on a project that's on hold or completed, on an archived project, or on an archived milestone. Re-sending an unchanged cell there is fine (nothing is written); changing, clearing or resubmitting it isn't | `409 PROJECT_NOT_OPEN`, message e.g. "Atlas is on hold — logging is paused" |
| Only milestones you're assigned to (checked first) | `400 NOT_ASSIGNED` |

```http
GET /api/v1/time-entries/d273b5fc-02a1-41a8-8388-5d2c33698ee5/breakdown
```
As an admin (managers get the same without `hourly_rate`):
```json
{"entry_id": "d273b5fc-02a1-41a8-8388-5d2c33698ee5", "hours": 9.0, "hourly_rate": 50.0, "request_cost": 450.0,
 "milestone_cost": 13465.92, "milestone_cost_after": 13915.92,
 "budget": 250000.0, "consumed": 13465.92, "remaining": 236534.08,
 "remaining_before": 236534.08, "remaining_after": 236084.08, "pct_of_remaining": 0.2,
 "forecast": 50497.2, "forecast_over_budget": false, "weeks_remaining": 11}
```

## HR submissions

Admins hand the approved hours of a pay period (a week, up to 31 days) to HR. There is no HR system, so a submission is a record plus a payroll CSV the app builds from its rows ("Submitted to HR (export ready)"). Each approved entry is sent once. Submitted hours are **not locked**: the normal rules still apply (an employee's edit sends the entry back to `pending`; the manager approves or rejects it again). An entry changed after it was sent keeps `hr_submission_id` and is flagged `changed_after_hr_submission` (with `hr_changed_at`) until a later submission re-sends it as a **correction**.

| Method | Path | Notes |
|---|---|---|
| GET | `/hr-submissions/preview?period_start=&period_end=` | Admin. What a submission would send: `entry_count`, `total_hours`, `total_cost`, `people` (approved, not yet sent, in the period), `pending_count` (still waiting for approval in the period), `corrections_ready` (changed entries decided again) and `corrections_waiting` (changed entries back in `pending`) |
| POST | `/hr-submissions` | Admin. `{period_start, period_end, include_corrections?}` (default `true`) → `201`: sends the period's approved, unsent entries plus every correction that's ready (any date). A correction is the entry's current hours, or `0` when it was rejected since. Nothing to send is `409 NOTHING_TO_SUBMIT`; a bad period is `400` (`before_start`, `max_31_days`). Audited as `submit` on `hr_submission` |
| GET | `/hr-submissions` | Admins and executives. Newest first: `id`, `period_start`, `period_end`, `submitted_by {id, name}`, `submitted_at`, `entry_count`, `correction_count`, `people`, `total_hours`, `total_cost`, `resubmission_of` (`{id, period_start, period_end}` of the latest submission it corrects, or `null`) |
| GET | `/hr-submissions/changes` | Admin. "Needs re-submission": every entry changed after it was sent: `entry_id`, `user {id, name, username}`, `work_date`, `hours` now, `status`, `ready` (approved or rejected again), `previous_hours`, `previous_submission`, `changed_at`, `project`, `milestone` |
| GET | `/hr-submissions/{id}/entries` | Admin only (per-person cost reveals pay). Every row the submission sent, as sent: `id`, `user {id, name, username}`, `work_date`, `hours`, `hourly_rate`, `cost`, `is_correction`, `previous_hours`, `corrects` (`{id, period_start, period_end}` or `null`), `project`, `milestone`. The app turns it into the payroll CSV: one line per person per type (Regular / Correction) with hours, previously submitted hours and cost |

```json
{"id": "5b0e…", "period_start": "2026-10-05", "period_end": "2026-10-11", "submitted_at": "2026-10-13T10:02:11+00:00",
 "submitted_by": {"id": "1d2c…", "name": "Avery Admin"}, "entry_count": 26, "correction_count": 1, "people": 6,
 "total_hours": 180.0, "total_cost": 9512.4, "resubmission_of": {"id": "77aa…", "period_start": "2026-09-28", "period_end": "2026-10-04"}}
```

## Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?unread=true` | Your alerts, newest first. `message` is ready to show; `payload` depends on `type` (below) |
| POST | `/notifications/{id}/read` | |
| POST | `/notifications/read-all` | |

```json
[{"id": "f73295ac-a674-485e-a528-21d8231ccf40", "type": "OVER_40H", "week_start": "2026-10-12",
  "payload": {"name": "Eli Employee", "week_total": 45}, "read_at": null,
  "created_at": "2026-10-13T18:00:15.020027-04:00", "subject_user": {"id": "81c483ea-…", "name": "Eli Employee"},
  "message": "Eli Employee passed 40h for the week of 2026-10-12"}]
```

| `type` | Sent to | `message` | `payload` |
|---|---|---|---|
| `OVER_40H` | The entry's project manager (an admin for a manager's own hours) | "*Name* passed 40h for the week of *date*" | `name`, `week_total`, `project_id` |
| `ENTRY_REJECTED` | The employee | "Your 8h on Schema Mapping (Mon 12 Oct) was rejected: *reason*" | `entry_id`, `work_date`, `week_start`, `hours`, `reason`, `milestone {id, name}`, `project {id, name}` |
| `SUPPORT_ASSIGNED` | The employee who was auto-routed | "You've been added as support on *milestone* (*project*), due *date*" | `name`, `end_date`, `milestone`, `project`, `from_milestone` |
| `SUPPORT_ROUTED` | That milestone's project manager | "*Name* was auto-routed to support *milestone*" | Same as `SUPPORT_ASSIGNED` |
| `MILESTONE_CLAIMED` | The project's manager (not when they claim it themselves) | "*Name* claimed *milestone* (*project*)" | `name`, `milestone {id, name}`, `project {id, name}` |
| `DELEGATE_ASSIGNED` | The newly named delegate approver (not when the same delegate is saved again) | "*Name* made you the delegate approver for *project*: you can approve hours for *manager* until *date*" (or "until further notice") | `project {id, name}`, `manager {id, name}`, `until` |
| `PLAN_FINALIZED` | Everyone on the project (active members and assignees) and its manager, except whoever finalized the plan | "*Project* plan finalized: your first milestone is *milestone*" (or "the first milestone is …" for someone on no milestone) | `project {id, name}`, `milestone {id, name}` (their first by plan order, else the project's first), `assigned` |
| `MESSAGE_RECEIVED` | Every other active participant of a conversation when a message arrives; at most one unread per conversation per person (a newer message refreshes it, reading the conversation marks it read) | "*Name* sent you a message" | `conversation_id`, `name`, `subject`, `is_group` (never the text) |
| `TIMESHEET_EMPTY` | An active employee or manager on at least one active project with no pending or approved hours this week, from Friday 14:00 to the end of Sunday, New York time | "Your timesheet for the week of Mon 12 Oct is empty" | `week_start` |

For `ENTRY_REJECTED`, the top-level `week_start` is the rejected entry's week, so the bell can open that week's timesheet; `TIMESHEET_EMPTY` links to `/timesheet?week=<week_start>` the same way.

`TIMESHEET_EMPTY` is never scheduled: `GET /notifications` creates it for the caller when it is due (and `GET /timesheet-reminders` does the same for a manager), at most once per person-week (the `(type, subject_user_id, week_start)` unique key). Once the caller has logged hours that week, an unread one is marked read. See [the Friday reminder](LOGIC_WALKTHROUGH.md#14-the-friday-timesheet-reminder).

## Messages

One-to-one conversations, group threads and a milestone's discussion. Who may start a conversation with whom is
[the messaging rule](LOGIC_WALKTHROUGH.md#21-messages-who-may-message-whom). Only participants see a conversation:
anyone else gets `404` for its id. Bodies are plain text, trimmed, 1 to 2000 characters (`400 VALIDATION_ERROR` with
`{"body": "required" | "must be text" | "max_length:2000"}`); sending more than 20 messages in a rolling minute is
`429 RATE_LIMITED`. Starting a conversation is audited (`create` on `conversation`, participants and subject only);
message bodies are never audited.

| Method | Path | Notes |
|---|---|---|
| GET | `/messages/contacts` | Who you may start a conversation with: `{"items": [{id, name, first_name, last_name, role, job_title, avatar_url, is_archived, relation}], "can_group": bool}`. Employees get their managers and every other active employee, each with a `relation` ("Your manager", "Manages Apollo Data Migration", "Delegate approver for …", "Colleague · Engineering", or just "Colleague" without a department), ordered: their manager, then project managers and delegate approvers, then colleagues by name; everyone else gets every active person but themselves (`relation` null) |
| GET | `/messages/unread-count` | `{"unread": messages from others after your last read, "conversations": how many conversations have any}` |
| GET | `/conversations` | Your conversations, latest activity first: `{"items": [conversation]}` (below) |
| POST | `/conversations` | `{participant_ids: [uuid, …], subject?, milestone_id?, body}` → the conversation. One participant: the one-to-one with them, created (`201`) or reused (`200`, the message is added). Several: a new group (`201`; `subject` up to 120 characters). With `milestone_id`: that milestone's discussion (as `POST /milestones/{id}/discussion`) plus the message. `403 MESSAGING_NOT_ALLOWED` "Employees can message their manager, their project managers and other employees." when an employee names an admin, an executive or a manager who isn't theirs; `403 MESSAGING_NOT_ALLOWED` for an archived or unknown person or an employee starting a group; `400` for yourself |
| GET | `/conversations/{id}/messages?before=<message id>&limit=50` | A page of the thread, oldest first: `{"items": [{id, conversation_id, body, created_at, sender {id, name}}], "has_more": bool, "conversation": conversation}`. Without `before`, the newest `limit` (max 100) messages |
| POST | `/conversations/{id}/messages` | `{body}` → the message (`201`). Any participant may reply, whatever their role. `403 MESSAGING_NOT_ALLOWED` when every other participant is archived |
| POST | `/conversations/{id}/read` | Marks everything so far read for you (and clears that conversation's `MESSAGE_RECEIVED` alert) → `{conversation_id, last_read_at}` |
| GET | `/milestones/{id}/discussion` | The milestone's discussion if you're in it, else `404` |
| POST | `/milestones/{id}/discussion` | The project's manager or an admin opens it: created (`201`) as a group with the milestone's active assignees, the project's manager and the caller, subject "*Milestone* · *Project*"; or returned (`200`) with anyone assigned since added. `403` for others who can see the milestone, `409 NOBODY_TO_DISCUSS` when nobody is assigned |

A conversation: `{id, subject, is_group, milestone: {id, name, project {id, name}} | null, created_by, created_at,
last_activity_at, last_read_at (yours), participants: [{id, name, role, job_title, avatar_url, is_archived,
last_read_at}], last_message: {id, body (first 140 characters), created_at, sender {id, name}} | null, unread_count}`.
A participant's `last_read_at` is the read receipt: a message is seen by everyone whose `last_read_at` is at or after
its `created_at`. Sending a message counts as reading the conversation.

### Missing timesheets

| Method | Path | Notes |
|---|---|---|
| GET | `/timesheet-reminders?department=` | Admins and managers. People in the same scope as `/dashboard` (admins: every active employee and manager; managers: their reports and the people on their live projects; `department` narrows it) whose week is empty. The week is this one from Friday 14:00 New York time (`due: true`), otherwise last week (`due: false`). `403` for anyone else |

```json
{"week_start": "2026-10-05", "due": false,
 "people": [{"id": "c1d2…", "name": "Chloe Park", "job_title": "Business Analyst"}]}
```

## Insights and audit

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard?department=` | Everything the dashboard needs, scoped to what you can see: `status_counts`, `projects`, `at_risk`, `milestones` (`overdue`, `due_soon`; each milestone has `difficulty` and `priority`, and each list is most important first: critical, high, medium, low, then earliest due), `over_allocated`, `budgets`, `pending_approvals`. `department` (an ID) keeps only that department's projects in every project-based number, only its people in `over_allocated`, and only its projects' entries in `pending_approvals` ([department filter](LOGIC_WALKTHROUGH.md#12-the-dashboards-department-filter)) |
| GET | `/allocations?week=` | Admins, managers and executives. Per person (with their `department_id`): projects with planned, logged and approved hours, totals and `utilization_pct` |
| GET | `/insights/smart?department=` | Everyone, scoped like `/dashboard`. Up to 6 rule-based suggestions (no AI), highest severity first. Employees only get insights about themselves. `department` (an ID) narrows them the way it narrows `/dashboard`: only that department's projects and people; `400 VALIDATION_ERROR` (`department: invalid_id`) if it isn't an ID. See [Smart insights](LOGIC_WALKTHROUGH.md#10-smart-insights) for the rules |
| GET | `/audit-log?actor=&action=&entity_type=&from=&to=&page=&page_size=` | Admins and executives (without any `salary` or `hourly_rate` inside `changes`). Newest first. An approval or rejection made as a delegate has `changes.after.as_delegate_for` (the project manager's ID). `actor` is a user ID; `action` is a stored action such as `create`, `update`, `archive`, `restore`, `approve` or `reject`. Each item also has `summary` (`actor`, `verb`, `object`, `tail`, `project`, `sentence`), the same readable sentence `/activity` gives, e.g. "Morgan Manager approved 9h for Eli Employee on Schema Mapping" |
| GET | `/activity?limit=&department=` | Everyone signed in. The newest audit events in the caller's scope as display-ready items, newest first: `limit` 1–50 (default 20; `400` `limit: invalid_number` otherwise), `department` (an ID) keeps only events on that department's projects. Sign-ins and password events never appear, and items carry no `changes`, so no salary or rate can leak. Scope: admins and executives everything; managers their own actions, every event on live projects they manage or are the active delegate approver of, milestone events on live projects they're a member of, decisions on their own hours and their project requests; employees their own actions, decisions on their own hours and milestone events on live projects they're on ([Live activity](LOGIC_WALKTHROUGH.md#18-live-activity-and-readable-audit-entries)) |

```json
[{"user": {"id": "81c483ea-…", "name": "Eli Employee", "job_title": "Software Engineer", "department_id": "4f1c…"},
  "projects": [{"id": "86a8c3a5-…", "name": "Apollo Data Migration", "planned": 30.0, "logged": 45.0, "approved": 0.0}],
  "planned_total": 30.0, "logged_total": 45.0, "utilization_pct": 112.5}, "…"]
```

`GET /activity?limit=1` as `manager.demo`. `object.type` is `project`, `milestone`, `user`, `project_request` or `department` (or `object` is null, e.g. "updated their profile photo"); `tail` finishes the sentence after the object ("to In progress"):

```json
{"items": [{"id": "0b6c…", "created_at": "2026-10-14T13:02:11Z", "action": "approve", "entity_type": "time_entry",
  "actor": {"id": "a41f…", "name": "Morgan Manager"}, "verb": "approved 9h for Eli Employee on",
  "object": {"type": "milestone", "id": "7d2e…", "name": "Schema Mapping"}, "tail": null,
  "project": {"id": "86a8c3a5-…", "name": "Apollo Data Migration"},
  "sentence": "Morgan Manager approved 9h for Eli Employee on Schema Mapping"}]}
```

`GET /insights/smart` as `manager.demo`. `link.to` is `project` (with `id`, and `tab` for milestone insights), `person` (`id`) or `approvals`. Salaries and rates are never included:

```json
[{"id": "over_allocated:81c483ea-…", "kind": "over_allocated", "severity": "high",
  "title": "Eli Employee is over 40 hours",
  "detail": "Eli Employee has logged 45h this week, 5h over the 40h cap.",
  "link": {"to": "person", "id": "81c483ea-…"}},
 {"id": "rebalance:81c483ea-…>5d0e7b12-…", "kind": "rebalance", "severity": "medium",
  "title": "Rebalance work from Eli Employee to Ana Ruiz",
  "detail": "Ana Ruiz has 0h this week while Eli Employee is at 45h; consider shifting some work to Ana Ruiz.",
  "link": {"to": "person", "id": "5d0e7b12-…"}},
 {"id": "approval_backlog:pending", "kind": "approval_backlog", "severity": "medium", "title": "Approvals are piling up",
  "detail": "1 time entry is waiting for approval from more than 3 days ago (the oldest is 7 days old).",
  "link": {"to": "approvals"}},
 {"id": "rejections:5d0e7b12-…", "kind": "rejections", "severity": "low", "title": "Ana Ruiz keeps getting hours rejected",
  "detail": "Ana Ruiz has had 2 time entries rejected in the last 30 days.", "link": {"to": "person", "id": "5d0e7b12-…"}}]
```

## Archive

| Method | Path | Notes |
|---|---|---|
| GET | `/archive?type=` | Admins, managers and executives (`403` for employees). Admins and executives get every archived project, milestone and person (executives with `can_restore: false` on everything). Managers get only the archived projects they manage and the archived milestones in their projects, never people (`?type=user` is `403`). Newest first. `type` is `project`, `milestone` or `user`. Each item has `can_restore`: always `true` for admins; for managers `true` only on milestones whose project isn't archived (projects are restored by an admin). Restoring uses each type's own `POST …/{id}/restore` |

```json
{"items": [{"type": "milestone", "id": "202d87b5-…", "name": "Schema Mapping", "archived_at": "2026-10-13T18:00:15.020027-04:00",
            "archived_by": {"id": "9315bbc9-…", "name": "Avery Admin"}, "project": {"id": "86a8c3a5-…", "name": "Apollo Data Migration"},
            "difficulty": "medium", "priority": "high", "can_restore": true},
           {"type": "user", "id": "81c483ea-…", "name": "Lee Leaver", "username": "lleaver", "archived_at": "…", "archived_by": null,
            "can_restore": true}]}
```

`archived_by` comes from the latest `archive` entry in the audit log, and is `null` when there isn't one (for example, seeded data).

## Internal operations (not HTTP)

These run only through an IAM-authorized `aws lambda invoke`, never through the Function URL:

| Payload | Result |
|---|---|
| `{"op": "migrate"}` | `{"applied": ["001_init.sql"]}`, or `[]` when nothing is new |
| `{"op": "rotate_demo"}` | `{"rotated": 13}`: gives every seeded account except `admin.demo`, `manager.demo` and `employee.demo` a random password (run once on the public site) |
| `{"op": "seed"}` | `{"seeded": true, "demo_users": ["admin.demo", "manager.demo", "employee.demo"]}`. Does nothing once the demo data exists |
| `{"op": "create_admins", "users": [{"username", "first_name", "last_name"}, ...]}` | `{"created": [{"username", "password"}], "skipped": [...]}`: adds ready-to-use admin logins with random passwords (no forced change on first login); usernames that already exist are skipped. Used to create the live demo admins `admin.demo2`–`admin.demo4` |
| `{"op": "demo_curate", "dry_run": true}` | A **dry run unless `dry_run` is exactly `false`**: the dry run does everything in a transaction and rolls it back. Rounds the five demo projects out into their department plans and archives the two leftover test items ([rules](LOGIC_WALKTHROUGH.md#23-curating-the-demo-data-demo_curate)). Additive and archive-only: never deletes, never changes existing time entries, passwords, roles, salaries or planned hours. Returns `{dry_run, today, archived: [{type, name, id}], projects: {<name>: {department, added: [{name, start_date, end_date, status, difficulty, priority, assignees: [{name, role}]}], dependencies_added: ["X after Y"], team_added: [{name, job_title, planned_hours}], hours_added: {entries, hours, cost}, pending_added, rejected_added, estimates_set: [{name, status, estimated_hours, logged_hours}], skipped: [{name, reason}], before/after: {at_risk, budget_pct, progress_pct}}}, timesheets: {pending_added, rejected_added, hours, notifications, scenarios: [{kind, person, week, pending, rejected, pending_hours, week_total}], by_project, by_manager}, warnings: [...]}`. One `curate_demo_plan` audit entry per changed project, by System. A second run adds nothing |
| `{"op": "demo_backfill"}` | `{"departments_created": [...], "users_created": ["executive.demo"], "users_updated": [...], "projects_updated": [...], "work_mode_updated": [...], "difficulties_updated": ["Apollo Data Migration / Discovery", ...], "priorities_updated": ["Apollo Data Migration / Cutover", ...], "already_set": 0, "skipped": [{"item", "reason"}]}`: brings demo data seeded before departments, pull mode, difficulty and priority up to today's seed, filling blanks only. Creates Technology, Operations and Risk & Compliance unless a department with that name exists (any case); gives each demo person and project the seed's department only while it has none; creates the read-only `executive.demo` login (published password `Demo123!`, in Operations) only if that username doesn't exist yet; switches Beacon Mobile App to pull only while it's still `push`; sets the seed's difficulty and priority on demo milestones (matched by project and milestone name), each only while still `medium` (priorities: Apollo Cutover critical, Schema Mapping high, Atlas Build critical, Atlas Launch high, Delta Audit Fieldwork low). Never changes assignees or hours. `already_set` counts values left as they were; `skipped` reasons are `missing`, `archived` (that department is archived, so it isn't reused or recreated), `department_archived`, and for Beacon's Design `has_assignees` or `already_started` (left as is, so not claimable). Not audited, like `seed`. A second run changes nothing |
| `{"op": "demo_backfill"}` | `{"departments_created": [...], "users_created": ["executive.demo"], "users_updated": [...], "projects_updated": [...], "work_mode_updated": [...], "difficulties_updated": ["Apollo Data Migration / Discovery", ...], "priorities_updated": ["Apollo Data Migration / Cutover", ...], "plan_board_arranged": ["Design", "QA & user acceptance testing", ...], "already_set": 0, "skipped": [{"item", "reason"}]}`: brings demo data seeded before departments, pull mode, difficulty and priority up to today's seed, filling blanks only. Creates Technology, Operations and Risk & Compliance unless a department with that name exists (any case); gives each demo person and project the seed's department only while it has none; creates the read-only `executive.demo` login (published password `Demo123!`, in Operations) only if that username doesn't exist yet; switches Beacon Mobile App to pull only while it's still `push`; sets the seed's difficulty and priority on demo milestones (matched by project and milestone name), each only while still `medium` (priorities: Apollo Cutover critical, Schema Mapping high, Atlas Build critical, Atlas Launch high, Delta Audit Fieldwork low); lays out Beacon's planning board (the Technology plan: Discovery & requirements, Design, Prototype and Build: backend services in Scheduled in that order, QA & user acceptance testing in Ready, Release & cutover and Hypercare in Backlog; any other milestone stays in Scheduled after them), only while Beacon is still `planned` with no finalized plan (otherwise `skipped` reason `plan_closed`) and nobody has arranged it yet (every card still in Scheduled and no `plan_order` in the audit log; otherwise it counts as `already_set`). Never changes assignees or hours. `already_set` counts values left as they were; `skipped` reasons are `missing`, `archived` (that department is archived, so it isn't reused or recreated), `department_archived`, and for Beacon's Design `has_assignees` or `already_started` (left as is, so not claimable). Not audited, like `seed`. A second run changes nothing |
