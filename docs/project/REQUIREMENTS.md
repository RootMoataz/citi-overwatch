# Project Requirements

This file is the source of truth for scope. Part 1 is the workshop email, copied word for word. Part 2 is the minimum checklist we must deliver, built from the email and the scored rubric. Stretch items live in [STRETCH.md](./STRETCH.md).

**Deadline:** day 3 of the workshop.

**Rubric:** [docs/full-stack.md → Evaluation Expectations](../full-stack.md#evaluation-expectations)

---

## Part 1 – Workshop email (verbatim)

> **Workshop Guidance**
>
> Read the workshop guidance below and follow the instructions in the repository to get started. Ask questions if unsure or need help.
>
> **Requirements: Business Problem**
>
> Our company ACME Inc. operates multiple projects across different departments, but lacks visibility into project progress, resource allocation, and delivery timelines. Project managers struggle to track deliverables, identify bottlenecks, and communicate status to stakeholders. This fragmentation leads to missed deadlines, resource conflicts, and difficulty in forecasting project completion dates.
>
> We need answers to critical questions like:
>
> - What is the current status of each active project?
> - Which projects are at risk of missing their deadlines?
> - How are resources allocated across projects?
> - What are the key deliverables and their completion status?
> - Which team members are over-allocated across multiple projects?
> - What is the dependency chain between deliverables?
> - How much budget has been consumed versus planned for each project?
>
> **Requirements: Technical Solution**
>
> We are building a centralized project management and tracking platform that enables real-time visibility into project health, resource utilization, and delivery progress. The solution will provide a self-service capability for project managers and team leads to manage projects, track deliverables, allocate resources, and monitor budgets without requiring integration with external systems.
>
> The technical solution involves developing a stand-alone web application using modern technologies. The application will have the following features:
>
> - User authentication and authorization
> - Role-based access control
> - CRUD operations for projects, deliverables, resources, and budget tracking
> - Search and filter functionality
> - Responsive design for mobile and desktop usage
>
> **Requirements: Technology Stack**
>
> The following technologies are required to build the application:
>
> - Frontend: HTML, CSS, React.js with React Responsive and Material UI Components
> - Backend: Python
> - Database: PostgreSQL
>
> The following technologies are good to know, as they are used to manage and deploy code:
>
> - Version Control: Git, GitHub
> - Infrastructure: Terraform
> - Deployment Mode: Shell Scripts
> - Deployment Target: AWS Serverless (e.g. S3, CloudFront, Lambda, RDS)
>
> **Expectations: Value-Based Outcomes**
>
> By the end of the workshop, participants will have developed a functional web application that meets the requirements outlined above. The application will be deployed to a cloud environment and accessible via a web browser. Participants will also gain hands-on experience with modern web development technologies and best practices.

---

## Part 2 – Minimum checklist

Each item names its source: **E** = email, **R** = scored rubric, **G** = the full-stack guide's implementation checklist, **U** = the project owner.

### Business questions (E)

The app must answer every one of these questions in the UI.

- [x] Q1. Current status of each active project
- [x] Q2. Projects at risk of missing their deadline
- [x] Q3. Resource allocation across projects
- [x] Q4. Key deliverables and their completion status
- [x] Q5. Team members over-allocated across projects
- [x] Q6. Dependency chain between deliverables
- [x] Q7. Budget consumed versus planned, per project

### Features (E)

- [x] User authentication (login, hashed passwords, token with expiry) (E, G)
- [x] Authorization and role-based access control, enforced on the backend and reflected in the UI (E, G)
- [x] Create, read, update and delete (CRUD) for projects
- [x] CRUD for deliverables
- [x] CRUD for resources
- [x] CRUD for budget tracking
- [x] Search and filter on list views (E)
- [x] Responsive layout for mobile and desktop (E, R)

### Technology (E)

- [x] Frontend: React, React Responsive, Material UI
- [x] Backend: Python (AWS Lambda)
- [x] Database: PostgreSQL (AWS Aurora)

### Delivery (E, R)

- [x] Deployed to AWS and reachable in a browser (E, R)
- [x] Runs locally from documented commands (R)
- [x] Deploy steps can be repeated and produce verifiable output (R)

### API quality (G)

- [x] REST methods: POST, GET, PUT, DELETE
- [x] Status codes: 201 created, 200 OK, 204 deleted, 400 validation, 401 not logged in, 403 not allowed, 404 not found, 500 server error
- [x] One consistent JSON error format
- [x] Backend validation: required fields, formats, references to other records exist, duplicates rejected

### UI quality (R, U)

- [x] Clear loading, success and failure feedback on every action (R)
- [x] Frontend form validation: required fields marked, errors shown next to the field, submit blocked until the form is valid, inputs disabled while saving (G)
- [x] Consistent typography, spacing, colors and interaction states (R)
- [x] Basic accessibility: labels, keyboard navigation, color contrast (R)
- [x] Actions the user's role can't perform are hidden or disabled (G)

### Code (R)

- [x] Organized by feature, not by giant files
- [x] Shared code reused, not copy-pasted
- [x] Linting and formatting applied consistently

### Testing, aimed at debugging (R, U)

- [x] Backend unit tests for business rules (at-risk, over-allocation, dependency loops, permissions)
- [x] Backend integration tests for the API against a real Postgres
- [x] Frontend component tests for core screens, including error states
- [x] At least one end-to-end test of the main user journey
- [x] Test commands, results and known gaps written up in `TESTING.md`

### Documentation, published on GitHub (R, U)

- [x] Root README: what the app is, architecture, setup, run, deploy, trade-offs and assumptions
- [x] Architecture diagram showing how requests and data move through the system
- [x] User stories for the UI, with acceptance criteria
- [x] Logic walkthrough explaining how the key rules work
- [x] API reference
- [x] Decision log (why each major choice was made)

---

## Part 3 – Built after the first release

Requirements the owner (**U**) added once the minimum was live, grouped by role. Every item is done and deployed; the matching stories are in [USER_STORIES.md](USER_STORIES.md#stories-added-after-the-first-release).

### Everyone

- [x] One-click demo sign-in for each role; demo accounts never lock, with a per-address sign-in rate limit
- [x] Ctrl+K command palette over pages, projects, people, milestones and actions, with fixed plain-English phrases (no AI)
- [x] Puppy, a rule-based assistant: summary of what needs you, confirmed actions, help answers, alert sounds, privacy allow-list
- [x] Messages: one-to-one conversations and milestone Discuss threads, unread counts, read receipts, bell alerts without the text, 20 messages a minute
- [x] Light, dark or system theme
- [x] Profile photos, cropped in the browser and rebuilt by a server-side PNG sanitiser
- [x] Live activity feed and readable audit sentences

### Employee

- [x] My week home page: hours against 40, milestones by urgency, milestones to claim
- [x] Start/stop timer: one at a time, header clock, quarter-hour rounding, midnight auto-stop, Tracked/Manual/Mixed labels
- [x] Timer workflow: a stop keeps a draft that pre-fills a locked timesheet cell and **Submit** sends it; **Request a change** on a locked cell goes to the manager
- [x] Over-limit warnings at 100% of the 8h day, the milestone's estimate or the 40h week (banner, toast, amber clock)
- [x] **Your manager** card on My week and the person's own profile, with one press to message them
- [x] Proof of work: a 10–500 character note or a same-day progress update on new or changed hours
- [x] Kick back a milestone with a category and reason; see the resolution
- [x] Auto-routing: support on *Ready for review*, next ready milestone as primary on *Completed*, skill- and capacity-aware
- [x] Pull mode: claim a ready, unowned milestone
- [x] Friday timesheet reminder

### Manager

- [x] Timesheets → To review grouped by person-week, Approve week, Approved weeks, tracked share
- [x] Red flags for approvers (same hours daily, long day, closed milestone, backdated, over plan, no activity, no proof) and an Only flagged filter
- [x] Planning board (Backlog → Ready → Scheduled) with a six-check Finalize that moves the project to Active
- [x] Department presets and project templates (Technology, Operations, Risk & Compliance)
- [x] Milestone priority, difficulty and estimates, labelled in words with distinct colours
- [x] Delegate approver with an end date
- [x] **Live now**: running timers ticking on the dashboard and Timesheets, Warning/Over chips, remote **Stop timer** with a message; one alert per timer and limit at 125%
- [x] **Change requests** on Timesheets: approve or reject changes to locked timer hours
- [x] Resolve kickbacks; skills for the employees they manage
- [x] Email this report (browser relay) and Print / PDF; Missing timesheets card; department filter on the dashboard

### Admin

- [x] Control centre home with admin shortcuts
- [x] HR submissions per pay period with payroll CSV and corrections for entries changed after sending
- [x] Departments and skills catalogue
- [x] "Tracks own hours" switch: managers and admins keep a timesheet only when turned on
- [x] Executive accounts; one reporting manager per person (never the shared public demo admin)
- [x] Create several accounts in a conversation with Puppy (names, emails, roles, a summary, nothing created until confirmed; real admins only); local runs say "Saved to the local outbox (not sent)"
- [x] Welcome and reset emails relayed from the admin's browser (EmailJS) while the Lambda has no email route

### Executive

- [x] Read-only role: organisation dashboard, every project, allocation, archive and audit log; every write refused by the router; salaries and rates stripped from every response

### Public demo and operations

- [x] Public demo admin (`demo.admin`): 5-minute sessions, fail-closed allow list of writes, disabled controls with a tooltip, a countdown pill in the top bar
- [x] Fail-closed route tests: every write route must be classified for the public demo and the executive guard
- [x] Additive demo-data operations (`demo_backfill`, `demo_curate` with a dry run); the live data is never reset
