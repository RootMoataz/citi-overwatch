# ACME Scout (Moataz Hikal Project)

*See every project, person and dollar — before it slips.*

**Author:** Built by Moataz Hikal

Scout is a project tracking platform for ACME Inc. It gives admins, project managers and employees one place to manage projects, milestones, people, hours and budgets, and it answers the seven questions in the [workshop brief](docs/project/REQUIREMENTS.md) on a single live dashboard.

![The dashboard, signed in as a manager](docs/images/dashboard.png)

| | |
|---|---|
| **Live site** | https://d3ucnz03j0sngl.cloudfront.net |
| **Stack** | React 19 · Material UI 9 · React Responsive · Python 3 on AWS Lambda · Aurora PostgreSQL 17 |
| **Tests** | 1,117 backend (376 unit · 741 integration, 97% coverage) · 912 frontend component (71 files) · 6 end-to-end (3 journeys × desktop + mobile), all passing on 15 Oct — see [TESTING.md](docs/project/TESTING.md) |
| **Source** | https://github.com/RootMoataz/citi-overwatch (the repository keeps its original name for now) |

## What it does

| The brief asks… | Where Scout answers it |
|---|---|
| Q1 What is the status of each active project? | Dashboard status counts and project table (progress, budget used, due date) |
| Q2 Which projects are at risk of missing their deadlines? | Dashboard at-risk list; every reason is shown as a badge (overdue milestone, past due, budget burning faster than progress) |
| Q3 How are resources allocated across projects? | **Allocation** page: people × projects, planned vs logged hours, utilization |
| Q4 What are the key deliverables and their completion status? | Milestones on each project, plus overdue and due-soon lists on the dashboard |
| Q5 Which team members are over-allocated? | Dashboard "over 40h this week" list; the manager gets one alert per person-week |
| Q6 What is the dependency chain between deliverables? | Each project's timeline: date bars in dependency order, "after …" chains, automatic **blocked** status |
| Q7 How much budget has been consumed versus planned? | Dashboard bar chart (planned, consumed, forecast) and each project's Budget tab |

Highlights:

- **Four roles plus a public demo.** Admin, manager, employee and a read-only executive, enforced on the server and reflected in the UI ([permission matrix](docs/project/USER_STORIES.md#roles-at-a-glance)). A public demo admin gets 5-minute sessions and a fail-closed list of allowed writes.
- **Accounts.** Admins create them in a five-step wizard with live username checks and a generated password, or several at once in a conversation with Puppy. The welcome email carries a temporary password, which must be changed at first sign-in. After you sign out, the next sign-in lands on home; if a session merely expires, signing in again returns you to the page you were on, but only for the same person. Everyone sees a **Your manager** card on My week and their profile, with one press to message their manager.
- **Timesheets.** Employees (and managers or admins an admin has switched to "Tracks own hours") log hours on the milestones they're assigned to, one day at a time: a week strip with each day's hours, a row per milestone with its hours and a work note, and one **Submit** for the whole week (a **Day | Week | Month** toggle brings back the full week grid, or shows the month: milestone bars across the calendar and each day's hours by milestone and status, with approved, pending, rejected and timer hours drawn differently. Clicking a day opens it in the Day view, and `?month=YYYY-MM` in the address keeps the month). Every hour needs the project manager's (or delegate's) approval before it counts toward the budget. Going over 40 hours is a warning, not a block. Admins submit approved pay periods to HR, and later edits come back as corrections.
- **Approvals.** The Timesheets page groups pending hours by person-week. Each entry shows its budget impact: the cost of the request, the remaining budget before and after, and a 4-week-pace forecast.
- **Hour-tracking safeguards.** A start/stop timer on My week and the timesheet (one at a time, a live clock in the header, stopped at midnight) whose hours pre-fill a locked timesheet cell until **Submit** sends them (a **Request a change** goes to the manager), a **Live now** card where managers watch running timers tick and can stop one with a message, warnings at 100% of the 8h day, the milestone's estimate or the 40h week (the manager is alerted at 125%), proof of work on new hours (a work note or that day's progress update), and red flags for approvers (same hours daily, long days, closed milestones, backdated, over plan, no activity, no proof) with a "Tracked 68% · Manual 32%" share per person-week ([Logic walkthrough §28](docs/project/LOGIC_WALKTHROUGH.md#28-hour-tracking-safeguards-timers-proof-of-work-red-flags)).
- **Nothing is ever deleted.** Records are archived and an admin can restore them. Every change is written to the **audit log**.
- **Responsive.** A sidebar on desktop, a drawer on phones, and tables that become cards on small screens.

- **Planning and milestones.** Department templates, a Backlog → Ready → Scheduled planning board with a finalize checklist, priority and difficulty, skills, auto-routing when work is handed in or completed, and kickbacks when an employee is blocked.
- **Messages, Puppy and the command palette.** One-to-one and milestone threads under clear who-may-message-whom rules, a rule-based assistant that summarises what needs you, and Ctrl+K search that understands phrases like "at-risk projects in Technology". None of it uses an AI service.

## Feature tour

Screenshots from the live site with the demo data (light mode unless noted).

### Signing in

| | |
|---|---|
| ![Sign-in page: the ACME Scout brand panel on the left, the sign-in form, four one-click demo buttons and a View the source on GitHub link on the right](docs/images/login.png) | ![The same sign-in page in dark mode](docs/images/login-dark.png) |
| Sign-in with one-click demo logins and a link to this repository | Dark mode follows the system or the account menu |

### Employee

| | |
|---|---|
| ![My week: hours logged against the 40-hour week, the Your manager card, and the employee's milestones with status, priority and difficulty chips and a Start button for the timer](docs/images/my-week.png) | ![Kick back dialog on the Hypercare milestone: a category and an explanation, with Cancel and Kick back buttons](docs/images/kickback.png) |
| **My week**: hours so far, your manager, assigned milestones, a start/stop timer | **Kick back** a blocked milestone to the manager with a reason |
| ![My timesheet, Day view, on Thursday 15 Oct: the week strip with each day's hours, a Submit 1 change button, and the Schema Mapping row holding 2h of timer hours, locked, with "from timer, not submitted yet", a Request a change button and the work note](docs/images/timer-locked-cell.png) | ![The This week card above the Your manager card: Morgan Manager, Delivery Manager in Technology, with a Message Morgan button](docs/images/your-manager.png) |
| **My timesheet, one day at a time**: a week strip, a row per milestone, and timer hours pre-filling a locked row; **Request a change** asks the manager | **Your manager**: who they are, and one press to message them |
| ![My timesheet, Month view, October 2026: milestone bars across the calendar, each day's hours by milestone and status, and a legend for line styles and milestone states](docs/images/timesheet-month.png) | |
| **My timesheet, Month**: bars for your milestones and each day's hours by status (approved solid, pending outlined, rejected struck through, timer dashed); click a day to open it | |

<p>
  <img src="docs/images/timesheet-mobile.png" alt="My timesheet on a phone, Day view: Submit 1 change, the week strip with Thursday selected at 3.5h, and the Schema Mapping row with a Start button for the timer, its hours and a work note" width="30%">
</p>

### Manager

| | |
|---|---|
| ![Manager dashboard: approvals waiting beside Live now with one running timer, then the risk tiles](docs/images/dashboard.png) | ![Timesheets To review filtered to flagged weeks: Gia Rossi's entries with work notes, Same hours daily and Over plan red flags, and the tracked/manual share](docs/images/timesheets-review.png) |
| **Dashboard**: approvals, Live now, risk, insights and project status | **Timesheets → To review**: red flags, work notes and the tracked share |
| ![Manager home: Approvals beside the Live now card, where Eli Employee's timer on Schema Mapping ticks with 8h today, a Warning: 8h day chip and a Stop timer button](docs/images/live-now.png) | ![Timesheets page: Live now with Eli's running timer, then Change requests with Eli Employee's request on Schema Mapping, Sat Oct 10, 2h → 1.5h, his reason and Approve and Reject buttons](docs/images/change-requests.png) |
| **Live now**: running timers tick here, with Warning/Over chips and **Stop timer** | **Change requests**: approve or reject a change to locked timer hours |
| ![Beacon Mobile App planning board with Backlog, Ready and Scheduled columns of milestone cards](docs/images/planning-board.png) | ![Finalize the plan dialog listing six plan checks, two of them needing fixes](docs/images/finalize-checklist.png) |
| **Planning board** for a planned project | **Finalize** checks before the project goes active |
| ![Apollo Data Migration Milestones tab: a state bar of milestones done, then a month-axis timeline with a date range and state on every bar](docs/images/milestones.png) | ![Apollo Data Migration Budget tab: planned, consumed and remaining budget, a forecast marker and cost by milestone with bars compared against the costliest milestone](docs/images/budget.png) |
| **Milestones**: a state bar and a readable timeline above the list | **Budget**: consumed vs planned, forecast, cost per milestone (the costliest fills its bar) |
| ![Messages: the Schema Mapping discussion thread with Ana and Ben](docs/images/messages.png) | ![Puppy assistant Summary tab: what needs you, a tip and the top insight](docs/images/puppy.png) |
| **Messages**: one-to-one and milestone discussions | **Puppy**: a rule-based summary of what needs you |

![The manager dashboard in dark mode](docs/images/dark-mode.png)

### Executive (read-only)

| | |
|---|---|
| ![Organisation dashboard marked Read-only view, with a projects-by-status donut, the Live now card and risk tiles](docs/images/executive.png) | ![Audit log grouped by day, with readable sentences and before/after changes](docs/images/audit.png) |
| **Organisation dashboard**: every project, no edits, no salaries | **Audit log**: who changed what, and when |

![Command palette with the query "at-risk projects in Technology" interpreted as Projects · At risk · Technology](docs/images/palette.png)

### Admin (public demo admin)

| | |
|---|---|
| ![Control centre with the demo admin's countdown banner, admin shortcut tiles, Live now and projects by status](docs/images/control-centre.png) | ![Timesheets HR submission tab: pick a pay period, totals, and past submissions with a payroll CSV](docs/images/hr-submission.png) |
| **Control centre** (the 5-minute demo banner is visible) | **HR submission**: pay periods, corrections and payroll CSV |
| ![Puppy's Do it tab for the public demo admin: Create user accounts replaced by the notice "Creating accounts is disabled in the public demo."](docs/images/puppy-create-users.png) | |
| **Puppy → Do it → Create user accounts**: a real admin gets the create-accounts conversation; the public demo admin gets this notice | |

## Architecture

```mermaid
flowchart LR
  B[Browser<br/>React + MUI] -->|"/ (static files)"| CF[CloudFront]
  CF --> S3[S3 bucket<br/>React build]
  CF -->|"/api/v1/*"| L["Lambda 'v1' (Function URL)<br/>Python, in the VPC"]
  L -->|pg8000, TLS| A[(Aurora PostgreSQL 17)]
  L --> CW[CloudWatch Logs<br/>one JSON line per request]
  B -.->|"sign-in emails, report email<br/>(EmailJS relay)"| EJ[EmailJS]
```

One Python Lambda (`backend/v1`) serves the whole API, organized by feature, with the business rules kept as pure functions in `app/rules/`. The React app is a static build on S3 behind the same CloudFront distribution, so the app and API share one origin. The Lambda has no internet route, so emails go out from the browser through EmailJS. More detail is in [ARCHITECTURE.md](docs/project/ARCHITECTURE.md).

## Quick start (Windows, Git Bash)

You need **PostgreSQL 17** (local superuser password `postgres`), **Python 3.12+** and **Node 20.19+**.

```bash
# 1. Backend: install, then start the API on :3001 with fresh demo data
cd backend/v1
python -m pip install -r requirements.txt -r requirements-dev.txt
python scripts/devserver.py --reset --seed      # creates and migrates the overwatch_dev database

# 2. Frontend, in a second terminal: start Vite on :3000 (it proxies /api to :3001)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 and sign in with a demo login. Locally, emails aren't sent. They're written to `backend/v1/.outbox/` as text files, so you can read a new user's temporary password there.

| Role | Username | Password |
|---|---|---|
| Admin | `admin.demo2`, `admin.demo3`, `admin.demo4` | Private, held by the owner (live site) |
| Manager | `manager.demo` | `Demo123!` |
| Employee | `employee.demo` | `Demo123!` |
| Executive (read-only): Moataz Hikal (Executive sponsor) | `executive.demo` | `Demo123!` |
| Admin demo (public, 5-minute limit) | `demo.admin` | `Demo123!` |

The **Admin demo** (the sign-in page's "Admin" button) is a separate public account, Dana Demo-Admin, not the real admin login, whose password stays private. Because its password is published, the server limits it:

- **5-minute sessions.** It is signed out 5 minutes after sign-in, enforced by the server: its access token expires by then and refreshing can't extend it. The app shows a countdown banner and, at the end, "Your 5-minute demo session has ended." on the sign-in page.
- **Restricted actions** (`403 DEMO_RESTRICTED`, "Disabled in the public demo."): changing its own password, name, email or photo; creating, editing, archiving or restoring people, password resets for anyone, or removing someone's photo; archiving or restoring projects; any department change; anything that changes credentials or submits timesheets to HR. The app shows these buttons disabled with a tooltip.
- **Still allowed:** everything read-only, plus the normal admin workflow: approving and rejecting hours, deciding project requests, creating and editing projects and milestones, archiving and restoring milestones, staffing, messages and notifications.
- **Sign-in:** like the other demo logins it never locks after wrong passwords; instead each network address gets 20 Admin-demo sign-ins a minute.

The full allow and deny lists are in `backend/v1/app/public_demo.py`; [Logic walkthrough §26](docs/project/LOGIC_WALKTHROUGH.md#26-the-public-demo-admin) explains them. Seed creates it; on an existing database run the `demo_backfill` operation (it adds `demo.admin` only if missing).

**Creating several accounts at once.** Signed in as a real admin (not `demo.admin`), open Puppy and choose **Do it → Create user accounts**, or ask "create accounts for the instructors". Puppy asks for the names, then the emails, then each person's role, manager and department, shows a summary and creates nothing until you confirm. It uses the same `POST /users` as the People page and emails each person a random temporary password (through the browser email relay when the server can't), or shows each password once if you prefer. Up to 25 people per batch. The public demo admin is told it's disabled, and it is never offered (or accepted by the server) as anyone's manager, because its login is shared. Locally the server writes the welcome emails to `backend/v1/.outbox/`, and each row says "Saved to the local outbox (not sent)" instead of "Emailed". See [Logic walkthrough §27](docs/project/LOGIC_WALKTHROUGH.md#27-puppy-the-rule-based-assistant).

The published demo logins never lock and can't change their password, so nobody can lock graders out. The executive sees every project, workload, the archive and the audit log but never a salary or hourly rate, and can't change anything; on the live site it's created by the `demo_backfill` operation, which also renames an existing `executive.demo` from the earlier seed's "Eve Executive" to Moataz Hikal, Executive Sponsor (only while it still has that old name). On the live site, the other seeded accounts get random passwords. The admin logins were created with the `create_admins` operation (see [Deploy to AWS](#deploy-to-aws)); the local seed's admin login is defined in `backend/v1/app/seed.py`.

Other useful commands:

```bash
python scripts/migrate.py --db overwatch_dev         # apply migrations without starting the server
python scripts/devserver.py                          # restart without wiping data
```

Optional: to have the live site email sign-in details from the admin's browser (the Lambda has no internet route for email), copy `frontend/.env.example` to `frontend/.env.production.local` and fill in the EmailJS IDs before deploying the frontend. See [DECISIONS.md](docs/project/DECISIONS.md).

Connection settings come from `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASS` and `POSTGRES_NAME` (defaults: `localhost`, `5432`, `postgres`, `postgres`, `overwatch_dev`).

## Tests

```bash
cd backend/v1 && python -m pytest --cov=app              # 1,117 unit + integration tests against local Postgres
cd frontend && npm test                                  # 912 component tests (Vitest + Testing Library)
cd frontend && npx playwright install chromium webkit    # once
cd frontend && npm run e2e                               # 3 journeys × desktop Chrome and iPhone 13 (WebKit)
cd frontend && npm run lint
```

The end-to-end run starts its own API on a fresh `overwatch_e2e` database. Results, coverage and known gaps are recorded in [TESTING.md](docs/project/TESTING.md).

## About the demo data

Demo data by Moataz Hikal. The seed (`backend/v1/app/seed.py`) and the `demo_curate` operation (`backend/v1/app/curate.py`) build a curated demo dataset by Moataz Hikal: ACME's three departments (Technology, Operations, Risk & Compliance), their people and skills, and projects with milestones, dependencies, hours history, approvals, a kickback, messages and an HR submission, so every dashboard question has something real to show.

- **Department presets.** Each department has its own milestone plan in `backend/v1/app/presets.py` (Technology: discovery → architecture → build → QA → release → hypercare; Operations: assessment → vendor selection → pilot → training → rollout → review; Risk & Compliance: scoping → control testing → findings → remediation → verification → sign-off). A new project can start from its department's template, and `demo_curate` rounds the demo projects out into the same plans. See [Logic walkthrough §22](docs/project/LOGIC_WALKTHROUGH.md#22-department-presets-and-project-templates) and [§23](docs/project/LOGIC_WALKTHROUGH.md#23-curating-the-demo-data-demo_curate).
- **Demo people.** Everyone is fictional except the executive login, `executive.demo`, which is Moataz Hikal as Executive sponsor.
- **Dates are relative to today**, so the demo always looks current whenever it is loaded.

## Deploy to AWS

The workshop environment provides the AWS account, Terraform and the deploy scripts in `bin/`.

```bash
./bin/deploy-backend.sh                  # Terraform: packages backend/v1 into the 'v1' Lambda

# Aurora isn't reachable from a laptop, so migrations and demo data run inside the Lambda
# through a direct, IAM-authorized invoke (HTTP requests can't trigger these operations):
aws lambda invoke --function-name coding-workshop-v1-<suffix> \
  --cli-binary-format raw-in-base64-out --payload '{"op":"migrate"}' out.json && cat out.json
aws lambda invoke --function-name coding-workshop-v1-<suffix> \
  --cli-binary-format raw-in-base64-out --payload '{"op":"seed"}' out.json && cat out.json

# Extra admin logins for a demo: each gets a random password, returned only in out.json.
# Usernames that already exist are skipped. Delete out.json once the passwords are saved somewhere safe.
aws lambda invoke --function-name coding-workshop-v1-<suffix>   --cli-binary-format raw-in-base64-out   --payload '{"op":"create_admins","users":[{"username":"admin.demo2","first_name":"Jordan","last_name":"Admin"}]}' out.json

# Demo data seeded before departments, pull mode and difficulty: fills only the blanks (run "migrate" first).
# Safe to run again; it never overwrites what an admin set and never touches assignees or hours.
aws lambda invoke --function-name coding-workshop-v1-<suffix>   --cli-binary-format raw-in-base64-out --payload '{"op":"demo_backfill"}' out.json && cat out.json

# Round the demo projects out into their department plans (milestones, people, hours history, submitted
# timesheets, estimates) and archive the two leftover test items. A DRY RUN unless "dry_run" is false: read the
# summary first, then run it for real. Additive and archive-only, never deletes; a second run adds nothing.
aws lambda invoke --function-name coding-workshop-v1-<suffix>   --cli-binary-format raw-in-base64-out --payload '{"op":"demo_curate"}' out.json && cat out.json
aws lambda invoke --function-name coding-workshop-v1-<suffix>   --cli-binary-format raw-in-base64-out --payload '{"op":"demo_curate","dry_run":false}' out.json && cat out.json

./bin/deploy-frontend.sh                 # builds the React app and syncs it to S3 + invalidates CloudFront
```

**Windows notes:** the workshop scripts expect Linux tools. On Windows, put shims for `dig`, `jq`, `terraform` and `python3` in `~/bin`, and run AWS CLI log commands with `MSYS_NO_PATHCONV=1` so Git Bash doesn't rewrite `/aws/lambda/...` paths. The workshop's original setup guide is preserved in [docs/WORKSHOP_README.md](docs/WORKSHOP_README.md).

## Trade-offs and assumptions

- **Milestones are the brief's "deliverables".** It's the instructor's term, and using one entity means nothing is duplicated.
- **`DELETE` archives instead of deleting.** This keeps history and audit trails intact; admins can restore anything.
- **Cost = approved hours × salary ÷ 2,080.** The rate is copied onto each entry when it's approved, so a raise doesn't rewrite past costs. Benefits and overhead aren't modelled.
- **40 hours is a warning for logged time but a hard cap for planned time.** Managers can't plan anyone past 40 hours a week. People can log overtime, which shows as "Pending (Overtime requested from …)" and alerts the manager once.
- **Pure-Python dependencies only** (`pg8000`, `PyJWT`, standard-library PBKDF2), so the Lambda package builds on Windows without Docker.
- **Email on the live site:** the workshop Lambda has no internet route and its pre-made role carries no SES permission, so the server can't send email. The admin's browser relays welcome and reset emails (and "Email this report") through EmailJS; if that isn't configured or fails, the admin sees the temporary password once, with a copy button. Forgotten-password codes are never relayed, so they only work locally.

Every decision, with its reasoning and cost, is in [DECISIONS.md](docs/project/DECISIONS.md).

## Documentation

| Document | What's in it |
|---|---|
| [REQUIREMENTS.md](docs/project/REQUIREMENTS.md) | The brief, word for word, and the checklist of what's done |
| [USER_STORIES.md](docs/project/USER_STORIES.md) | Stories per role and page, with acceptance criteria for loading, success and failure |
| [ARCHITECTURE.md](docs/project/ARCHITECTURE.md) | Components, feature modules, operator ops, security model, key data flows, request lifecycle and logging |
| [DATA_MODEL.md](docs/project/DATA_MODEL.md) | ER diagram and table notes |
| [API.md](docs/project/API.md) | Every endpoint, example requests and responses, error codes |
| [LOGIC_WALKTHROUGH.md](docs/project/LOGIC_WALKTHROUGH.md) | Diagrams of the key flows and rules, linked to the code |
| [TESTING.md](docs/project/TESTING.md) | How to run each test layer, real results, known gaps |
| [DECISIONS.md](docs/project/DECISIONS.md) | Why it's built this way, plus findings from the cloud deploy |
| [STRETCH.md](docs/project/STRETCH.md) | Ideas beyond the minimum |
| [Design spec](docs/superpowers/specs/2026-10-13-citi-overwatch-design.md) | The full design this was built from |
