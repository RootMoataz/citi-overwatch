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
| 404 | `NOT_FOUND` | It doesn't exist, **or you aren't allowed to see it** (so its existence isn't revealed) |
| 405 | `METHOD_NOT_ALLOWED` | The path exists, but not with this method |
| 409 | `STALE_ENTRY` | The time entry changed (edited or decided by someone else) since you loaded it |
| 409 | `CONFLICT`, `ALREADY_MEMBER`, `HAS_DEPENDENTS` | A duplicate username, email or project name; already on the team; archiving someone who still manages projects or has reports (`details` lists them) |
| 423 | `ACCOUNT_LOCKED`, `CODE_LOCKED` | 5 failed sign-ins (15-minute lock), or 5 wrong reset codes |
| 500 | `INTERNAL_ERROR` | An unexpected error. It's logged with a stack trace, under the same `request_id` |

Success codes: `200` OK, `201` created, `204` archived or no content.

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
| GET | `/users?q=&role=&archived=&page=&page_size=` | Admins and managers. Managers get no salaries |
| POST | `/users` | `{first_name, last_name, email, role, manager_id (required for employees), job_title?, salary?, department_id?, username, password}` → `201 {user, email_sent, temp_password?}`. `temp_password` is only returned when the email couldn't be sent |
| GET | `/users/{id}` | |
| GET | `/users/{id}/profile?week=` | Every role. Admins see anyone; managers see themselves and people on a project they manage; employees see only themselves. Anyone else gets `404`. `salary` is only included for admins and the person themselves |
| PUT | `/users/{id}` | Any field, including `username`, `role`, `salary`, `manager_id` and `department_id` (an active department, or `null` to clear it; anything else is `400`). You can't change your own role or salary |
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
| POST | `/project-requests` | Managers only. `{name, description, proposed_start, proposed_end, proposed_budget, reason}` → `201` |
| POST | `/project-requests/{id}/approve` | Admin. Creates the project, with the requester as its manager |
| POST | `/project-requests/{id}/reject` | Admin. `{comment}` |

```json
{"id": "2cb5b5e5-c871-42af-88d7-f7c62061c97a", "name": "Docs Demo", "description": "d",
 "proposed_start": "2026-11-01", "proposed_end": "2026-12-01", "proposed_budget": 10000.0, "reason": "r",
 "status": "pending", "requested_by": {"id": "9315bbc9-…", "name": "Morgan Manager"},
 "decided_at": null, "decision_comment": null, "project_id": null, "created_at": "2026-10-13T18:06:34.468429-04:00"}
```

## Projects

| Method | Path | Notes |
|---|---|---|
| GET | `/projects?q=&status=&manager=&department=&at_risk=true&archived=true&page=&page_size=` | Only the projects you can see. `archived` is admin only; `department` is a department ID. Each item has `team`: its active members as `[{id, name}]`, by last name (for the list's avatars) |
| POST | `/projects` | Admin. `{name, description?, start_date, predicted_end_date, budget, manager_id, status?, department_id?, work_mode?}` → `201`. `work_mode` is `push` (default) or `pull` |
| GET | `/projects/{id}` | `404` if you can't see it |
| PUT | `/projects/{id}` | The project's manager or an admin, including `department_id` (an active department or `null`) and `work_mode`. Only admins can change the manager |
| DELETE | `/projects/{id}` | Admin only (`403` for managers, even their own project). Archives the project → `204` |
| POST | `/projects/{id}/restore` | Admin only (`403` for managers) |
| GET | `/projects/{id}/summary` | Budget, consumed, remaining, percentages, risk reasons and team size |
| GET | `/projects/{id}/milestone-costs` | Per non-archived milestone: `approved_hours`, `pending_hours`, `approved_cost` and `budget_pct`, plus a `total` whose `approved_cost` is the project's `consumed`. Hours are `null` (and `hours_visible` is `false`) unless you manage the project. Never includes an hourly rate |

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
| GET | `/projects/{id}/milestones` | In dependency order, with `display_status`, `blocked`, `predecessors`, `assignees`, `supporting_ids` (assignees who are there as support), `difficulty`, `is_assignee`, `claimable` (a pull project's ready, unassigned milestone) and `can_claim` (claimable and you're on the team) |
| POST | `/projects/{id}/milestones` | `{name, description?, start_date, end_date, difficulty?}` → `201`. `difficulty` is `easy`, `medium` (default) or `hard`; anything else is `400`. The dates must fall within the project's dates |
| GET / PUT / DELETE | `/milestones/{id}` | `DELETE` archives |
| POST | `/milestones/{id}/restore` | Admins and the project's manager (`403` for employees; `404` for other managers, or when the project itself is archived and you're not an admin) |
| PUT | `/milestones/{id}/dependencies` | `{predecessor_ids: [...]}` → `{…, warnings}`. Returns `400 DEPENDENCY_CYCLE` or `CROSS_PROJECT_DEPENDENCY`. `warnings` flags a start date before a predecessor's end |
| PUT | `/milestones/{id}/assignees` | `{user_ids: [...]}`. They must be project members (`NOT_A_MEMBER`) |
| POST | `/milestones/{id}/status` | `{status}`. Assignees can move it to `in_progress` and `ready_for_review`; only the manager or an admin can set `completed` or send it back. Returns `400 INVALID_TRANSITION`, or `403 NOT_ASSIGNED`. The response is the milestone plus `routed_to`: when an assignee sends it for review they're added as support elsewhere ([auto-routing](LOGIC_WALKTHROUGH.md#9-auto-routing-after-ready-for-review)) and `routed_to` is `{milestone: {id, name, end_date}, project: {id, name}}`; otherwise it's `null` |
| POST | `/milestones/{id}/claim` | Pull projects only: a team member makes themselves the primary assignee of a milestone that's ready to start (not started, every predecessor completed) and has nobody on it → the milestone. `409 NOT_PULL_PROJECT` in a push project, `409 PROJECT_NOT_ACTIVE` unless the project is planned or active, `409 NOT_READY`, `409 ALREADY_CLAIMED` (also what the second of two simultaneous claims gets), `403 NOT_A_MEMBER` for anyone not on the team. Audited as `claim`; the project manager gets `MILESTONE_CLAIMED` ([pull mode](LOGIC_WALKTHROUGH.md#11-pull-mode-claiming-a-milestone)) |
| GET / POST | `/milestones/{id}/notes` | `{body}` (1–2,000 characters). Append-only |

```json
{"id": "07ad53b4-fd9d-4947-a584-aed75e47ec08", "project_id": "86a8c3a5-…", "name": "Discovery",
 "description": "Inventory every legacy table.", "start_date": "2026-07-15", "end_date": "2026-08-14",
 "status": "completed", "difficulty": "easy", "display_status": "completed", "blocked": false, "predecessors": [],
 "assignees": [{"id": "81c483ea-…", "name": "Eli Employee"}, {"id": "a250afbe-…", "name": "Chloe Park"}],
 "is_assignee": false, "completed_at": "2026-10-13T18:00:15.020027-04:00", "is_archived": false}
```

## Time entries and approvals

| Method | Path | Notes |
|---|---|---|
| GET | `/time-entries?week=YYYY-MM-DD&user=` | The week grid: rows (assigned milestones, each with `role`: `primary` or `supporting`, the `project`'s `status`, and `open`: `false` when the project is on hold or completed), entries and totals. `user` lets a manager or admin view someone else |
| PUT | `/time-entries` | `{week, entries: [{milestone_id, work_date, hours}]}` saves a week, all or nothing. `hours: 0` clears a pending cell. Every changed entry becomes `pending`. Re-sending a **rejected** cell unchanged resubmits it. See the rules below |
| GET | `/approvals?user=&project=&milestone=` | Pending entries you can decide (never your own) |
| GET | `/time-entries/{id}/breakdown` | The budget impact of approving this entry. `hourly_rate` is included for admins only, because a rate reveals a salary; managers get the cost |
| POST | `/time-entries/{id}/approve` | `{expected_hours?}`: the hours you saw. Copies the hourly rate onto the entry, which then counts toward the budget. Returns `409 STALE_ENTRY` if the entry changed since you loaded it |
| POST | `/time-entries/{id}/reject` | `{reason, expected_hours?}`. Same `409 STALE_ENTRY` guard. Sends the employee an `ENTRY_REJECTED` alert |

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

| `TIMESHEET_EMPTY` | An active employee or manager on at least one active project with no pending or approved hours this week, from Friday 14:00 to the end of Sunday, New York time | "Your timesheet for the week of Mon 12 Oct is empty" | `week_start` |

For `ENTRY_REJECTED`, the top-level `week_start` is the rejected entry's week, so the bell can open that week's timesheet; `TIMESHEET_EMPTY` links to `/timesheet?week=<week_start>` the same way.

`TIMESHEET_EMPTY` is never scheduled: `GET /notifications` creates it for the caller when it is due (and `GET /timesheet-reminders` does the same for a manager), at most once per person-week (the `(type, subject_user_id, week_start)` unique key). Once the caller has logged hours that week, an unread one is marked read. See [the Friday reminder](LOGIC_WALKTHROUGH.md#14-the-friday-timesheet-reminder).

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
| GET | `/dashboard?department=` | Everything the dashboard needs, scoped to what you can see: `status_counts`, `projects`, `at_risk`, `milestones` (`overdue`, `due_soon`), `over_allocated`, `budgets`, `pending_approvals`. `department` (an ID) keeps only that department's projects in every project-based number, only its people in `over_allocated`, and only its projects' entries in `pending_approvals` ([department filter](LOGIC_WALKTHROUGH.md#12-the-dashboards-department-filter)) |
| GET | `/allocations?week=` | Admins and managers. Per person (with their `department_id`): projects with planned, logged and approved hours, totals and `utilization_pct` |
| GET | `/insights/smart?department=` | Everyone, scoped like `/dashboard`. Up to 6 rule-based suggestions (no AI), highest severity first. Employees only get insights about themselves. `department` (an ID) narrows them the way it narrows `/dashboard`: only that department's projects and people; `400 VALIDATION_ERROR` (`department: invalid_id`) if it isn't an ID. See [Smart insights](LOGIC_WALKTHROUGH.md#10-smart-insights) for the rules |
| GET | `/audit-log?actor=&action=&entity_type=&from=&to=&page=&page_size=` | Admin. Newest first. `actor` is a user ID; `action` is a stored action such as `create`, `update`, `archive`, `restore`, `approve` or `reject` |

```json
[{"user": {"id": "81c483ea-…", "name": "Eli Employee", "job_title": "Software Engineer", "department_id": "4f1c…"},
  "projects": [{"id": "86a8c3a5-…", "name": "Apollo Data Migration", "planned": 30.0, "logged": 45.0, "approved": 0.0}],
  "planned_total": 30.0, "logged_total": 45.0, "utilization_pct": 112.5}, "…"]
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
| GET | `/archive?type=` | Admins and managers (`403` for employees). Admins get every archived project, milestone and person. Managers get only the archived projects they manage and the archived milestones in their projects, never people (`?type=user` is `403`). Newest first. `type` is `project`, `milestone` or `user`. Each item has `can_restore`: always `true` for admins; for managers `true` only on milestones whose project isn't archived (projects are restored by an admin). Restoring uses each type's own `POST …/{id}/restore` |

```json
{"items": [{"type": "milestone", "id": "202d87b5-…", "name": "Schema Mapping", "archived_at": "2026-10-13T18:00:15.020027-04:00",
            "archived_by": {"id": "9315bbc9-…", "name": "Avery Admin"}, "project": {"id": "86a8c3a5-…", "name": "Apollo Data Migration"},
            "difficulty": "medium", "can_restore": true},
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
| `{"op": "demo_backfill"}` | `{"departments_created": [...], "users_updated": [...], "projects_updated": [...], "work_mode_updated": [...], "difficulties_updated": ["Apollo Data Migration / Discovery", ...], "already_set": 0, "skipped": [{"item", "reason"}]}`: brings demo data seeded before departments, pull mode and difficulty up to today's seed, filling blanks only. Creates Technology, Operations and Risk & Compliance unless a department with that name exists (any case); gives each demo person and project the seed's department only while it has none; switches Beacon Mobile App to pull only while it's still `push`; sets the seed's difficulty on demo milestones (matched by project and milestone name) only while still `medium`. Never changes assignees or hours. `already_set` counts values left as they were; `skipped` reasons are `missing`, `archived` (that department is archived, so it isn't reused or recreated), `department_archived`, and for Beacon's Design `has_assignees` or `already_started` (left as is, so not claimable). Not audited, like `seed`. A second run changes nothing |
