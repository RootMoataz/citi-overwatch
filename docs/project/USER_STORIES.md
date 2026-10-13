# User stories

The user stories behind every screen in Citi Overwatch, grouped by page.

Each story has acceptance criteria covering three outcomes: what the person sees while data **loads**, what happens on **success**, and what happens on **failure**.

Tags link each story to its source:
- **Q1–Q7**: the seven questions in the [brief](REQUIREMENTS.md)
- **E**: a feature the brief requires
- **R**: the rubric
- **U**: a rule the project owner set, recorded in the [design spec](../superpowers/specs/2026-10-13-citi-overwatch-design.md)

Shared behaviour on every page (so it isn't repeated in each story):

- **Loading.** Skeleton placeholders take the shape of the content. Buttons show "Saving…" and are disabled while a change is in flight.
- **Success.** A toast confirms each change, and lists refresh straight away. Every page also refetches every 30 seconds and when the tab regains focus.
- **Failure.** Errors appear next to the field they belong to. Other errors appear in a banner that shows the server's message and its `request_id`, and lists offer a **Retry** button. If the session expires, the person is sent to sign in again.
- **Empty.** An empty state always says what to do next.
- **Permissions.** Actions a role can never perform are hidden. Actions that aren't possible right now are disabled, with a tooltip saying why. The server enforces every rule regardless (`403`).

## Roles at a glance

| Can… | Admin | Manager | Employee |
|---|---|---|---|
| Create, edit, archive and restore accounts; change usernames; reset passwords; edit salaries | ✅ | — | — |
| See other people's salaries | ✅ | — | — |
| Create projects, approve or reject project requests | ✅ | — | — |
| Submit a project request | — | ✅ | — |
| Edit a project, staff it, manage its milestones, approve its hours | every project | projects they manage | — |
| Move an assigned milestone to *in progress* / *ready for review*, add notes | ✅ | ✅ | milestones assigned to them |
| Log their own hours | ✅ | ✅ | ✅ |
| See the audit log | ✅ | — | — |

---

## Signing in

### S1. Sign in (E, R)
**As** anyone with an account, **I want to** sign in with my username and password **so that** I see only what my role allows.

- **Loading:** the button reads "Signing in…" and both fields are disabled.
- **Success:** I land on the dashboard. My session lasts 7 days and renews itself silently, using a 15-minute access token and a rotating refresh cookie.
- **Failure:**
  - A wrong username or password shows "Incorrect username or password". The message never reveals which one was wrong.
  - After 5 failures in a row, the account locks for 15 minutes and the message says so (`423`).
  - Empty fields are flagged before anything is sent.

### S2. Change a temporary password at first sign-in (U)
**As** a new user, **I want to** be made to choose my own password **so that** the temporary one in my email stops working.

- **Loading:** "Saving…" while the change is submitted.
- **Success:** a full-screen dialog that can't be dismissed asks for the temporary password, a new password, and the new password again. A live checklist ticks off each rule: at least 6 characters, a digit, a special character, and different from the temporary password. Once saved, the dialog closes and the dashboard appears.
- **Failure:**
  - The form stays blocked until every rule passes and the two new passwords match.
  - A wrong temporary password is flagged on its field.
  - A temporary password older than 72 hours is refused at sign-in, with a prompt to ask an admin for a new one.
  - Until the change is made, every other API call returns `403 PASSWORD_CHANGE_REQUIRED`.

### S3. Reset a forgotten password (U)
**As** a user who forgot my password, **I want to** reset it with an emailed code **so that** I don't need an admin.

- **Loading:** each of the three steps (username → 6-digit code → new password) disables its button while it's sent.
- **Success:**
  - The code arrives by email and is valid for 15 minutes.
  - After the reset, I'm signed out everywhere and can sign in with the new password.
  - The "Resend code" button counts down 60 seconds between sends.
- **Failure:**
  - The first step always says a code was sent, whether or not the username exists, so it can't be used to discover accounts.
  - A wrong code is rejected. After 5 wrong attempts, the code locks (`CODE_LOCKED`).
  - An expired code asks me to request a new one.
  - The page says "No email? Ask an admin to reset your password." On the live site, email can't leave the VPC, so that's the route there (see [DECISIONS.md](DECISIONS.md)).

---

## Dashboard

### D1. One live view of delivery health (Q1, Q2, Q4–Q7)
**As** a manager or admin, **I want** one page that answers the brief's questions **so that** I don't have to assemble reports.

Each panel is titled with the question it answers, and the panels are labelled regions for screen readers.

- **Loading:** skeleton panels.
- **Success:**
  - **Q1:** counts per status, plus a table of active projects with milestone progress, budget used and due date.
  - **Q2:** at-risk projects, each with its reasons as badges: *Overdue milestone*, *Past due date*, *Budget ahead of progress*.
  - **Q3:** planned vs logged hours per person, linking to the full Allocation page.
  - **Q4:** overdue milestones and milestones due in the next 14 days.
  - **Q5:** people over 40 logged hours this week, with their totals.
  - **Q6:** a link to each project's timeline.
  - **Q7:** a bar chart of planned, consumed and forecast budget per project.
  - A button reads "*n* waiting for your approval" when I have entries to approve.
- **Failure:** an error banner with Retry. Each panel has its own empty state, such as "Nothing at risk — every visible project is on track."

### D2. Dashboard scoped to me (U)
**As** an employee, **I want** the same dashboard limited to my projects **so that** I see my own work without other teams' data.

- **Success:**
  - I see only the projects I'm assigned to.
  - Allocation details are replaced by a link to my timesheet.
  - No salary-derived numbers about other people are shown.
- **Failure / empty:** if I'm on no projects, each panel explains that items appear once a manager adds me.

---

## Projects

### P1. Find a project (E: search and filter)
**As** any user, **I want to** search and filter the projects I can see **so that** I can get to the right one quickly.

- **Loading:** table skeleton.
- **Success:**
  - I can search by name, filter by status and manager, and tick "At risk only". Admins can also show archived projects.
  - Each row shows status, milestone progress, budget used, risk badges and due date.
  - On phones, rows become cards.
  - Clicking a row opens the project.
- **Failure / empty:**
  - "No projects match these filters", with a **Clear filters** button.
  - Admins with no projects at all see **Create the first project**.

### P2. Create and edit a project (E: CRUD projects)
**As** an admin, **I want to** create a project with its manager, dates and budget. **As** its manager, I want to edit its description, dates, budget and status.

- **Loading:** fields are disabled and the button shows "Saving…".
- **Success:**
  - The project appears in the list, and the change is audited.
  - Status moves *planned → active ⇄ on hold → completed*.
- **Failure:**
  - Required fields are marked.
  - An end date before the start date is flagged on the field.
  - A duplicate name shows "That name is already taken" (`409 CONFLICT`).
  - Completing a project with unfinished milestones is refused (`MILESTONES_INCOMPLETE`).
  - Moving dates so that milestones fall outside them is refused with `MILESTONES_OUT_OF_RANGE`.

### P3. Archive and restore a project (U: never delete)
**As** an admin, **I want to** archive a project instead of deleting it **so that** its history and costs are kept.

- **Success:**
  - A confirm dialog explains the effect.
  - The project disappears from everyone else's views and from calculations, and shows an "Archived" chip for admins.
  - **Restore** brings it back.
- **Failure:** an error banner with the `request_id`.

### P4. See a project's overview (Q1, Q2)
**As** anyone on the project, **I want** its summary **so that** I know where it stands.

- **Success:**
  - Tiles show milestones done, budget used (consumed of planned), predicted end and team size.
  - A "Why it's at risk" box lists every reason that applies.
- **Failure:** a project I can't see returns *Not found*, so its existence isn't revealed.

### P5. Staff a project within 40 planned hours (Q3, U)
**As** the project's manager, **I want to** add people with planned hours per week **so that** nobody is planned past a full week.

- **Success:**
  - I can add a person, change their hours or remove them from the project (with a confirmation).
  - The Team table shows each person's planned hours.
- **Failure:**
  - Hours must be more than 0 and at most 40.
  - If the person's planned hours across overlapping active projects would go over 40, the change is refused (`PLANNED_HOURS_EXCEEDED`), and the message shows their current total.
  - Adding someone already on the team returns `409 ALREADY_MEMBER`.
  - Removing someone also removes their milestone assignments on that project. Their logged hours stay on record.

### P6. Track the budget (Q7, E: CRUD budget tracking)
**As** a manager, **I want to** see planned vs consumed budget **so that** I can act before it runs out.

- **Success:**
  - The Budget tab shows the planned budget, the consumed amount (approved hours only, at each person's hourly rate when approved), the remaining amount and the percentage used, plus a bar chart.
  - Admins set the budget, and the project's manager can adjust it. Every change is audited.
- **Failure:** a negative budget is rejected on the field.

### P7. See the team's hours (Q3, Q5)
**As** the project's manager, **I want to** see each person's logged, pending and approved hours per week on my project.

- **Success:** a week picker with previous/next buttons and a per-person table.
- **Empty:** "No hours this week — hours appear as the team logs them."
- **Failure:** employees see "Team hours are private" rather than other people's data.

---

## Milestones (the brief's deliverables)

### M1. Plan milestones with dependencies (Q4, Q6, E: CRUD deliverables)
**As** the project's manager, **I want to** add milestones with dates, predecessors and assignees **so that** the plan and its order are visible.

- **Loading:** dialog fields are disabled while saving.
- **Success:**
  - The milestone appears on the timeline and in the list, with "after *Predecessor*" and its assignees.
  - While any predecessor isn't completed, the milestone shows **Blocked** and can't be started.
  - If it starts before a predecessor ends, a warning appears, but the save is still allowed.
- **Failure:**
  - Dates outside the project's dates are flagged on the field.
  - A dependency that would form a loop is refused with "That dependency would create a loop" (`DEPENDENCY_CYCLE`).
  - Assigning someone who isn't on the team says "Add these people to the project team first."
  - Archiving asks for confirmation first ("Archive this milestone?"), and an admin can restore it.

### M2. See the dependency chain (Q6)
**As** anyone on the project, **I want** a timeline **so that** I can see what waits on what.

- **Success:**
  - Horizontal date bars appear in dependency order, with a "Today" marker.
  - Each milestone lists what it waits on, with a "Waiting on: …" tooltip on its disabled Start button.
- **Empty:** "No milestones yet", with **Add milestone** for managers.

### M3. Move my milestone forward (U)
**As** an employee assigned to a milestone, **I want to** start it and mark it ready for review **so that** my manager knows it's done.

- **Success:**
  - **Start** moves it from *not started* to *in progress*.
  - **Ready for review** moves it on to *ready for review*.
  - I can't mark it completed. That button only appears for the project's manager or an admin.
  - Milestones assigned to me are marked "Assigned to you".
- **Failure:**
  - Milestones I'm not assigned to show no status buttons, and the API returns `403` if I try anyway.
  - A blocked milestone's Start button is disabled, and its tooltip names what it's waiting on.

### M4. Complete or send back a milestone (U)
**As** the project's manager, **I want to** complete a milestone, send it back, or reopen it.

- **Success:**
  - **Complete** marks it done and unblocks the milestones that depend on it.
  - **Send back** returns it to *in progress*.
  - **Reopen** undoes a completion.
- **Failure:** a transition that isn't allowed returns `INVALID_TRANSITION`, shown on the card.

### M5. Leave progress notes (U)
**As** an assignee or the manager, **I want to** add notes to a milestone **so that** progress is recorded where the work is.

- **Success:** notes are append-only and show the author and time.
- **Failure:** people who can't post don't see the box. An empty note can't be sent.

---

## Timesheet and approvals

### T1. Log my week (Q5, U)
**As** anyone, **I want to** log hours per day on the milestones I'm assigned to **so that** my manager can approve them.

- **Loading:** grid skeleton. **Save week** shows "Saving…".
- **Success:**
  - The grid has one row per assigned milestone, grouped by project, with daily and weekly totals and previous/next week buttons.
  - Weekends are hidden behind a switch on phones.
  - Each saved cell shows its status:
    - "Pending approval"
    - "Pending (Overtime requested from *First Last*)" for the entry that takes my week past 40 hours, and any after it
    - "Approved"
    - "Rejected", with the reason in a tooltip
  - Editing an entry that was already decided sends it back for approval and tags it "Edited".
  - A rejected cell has a **Resubmit** button, so the same hours can go back for approval after a conversation with the manager.
- **Failure:**
  - More than 24 hours in a day is blocked before saving.
  - A day outside the project's dates, or on a milestone I'm no longer assigned to, is refused with the server's message.
  - Going over 40 hours shows a warning but is allowed.
- **Empty:** "You're not assigned to any milestones this week. Your project manager assigns you to milestones."

### T2. Hear about overtime once (Q5, U)
**As** a project manager, **I want** one alert when a person's week goes past 40 hours **so that** I can follow up without being spammed.

- **Success:**
  - The bell in the top bar shows an unread count.
  - The alert reads "*Name* passed 40h for the week of *date*".
  - Opening it marks it read and filters Approvals to that person.
  - Later entries in the same week don't alert again, even on other projects.
- **Empty:** "You're all caught up."

### T3. Approve or reject hours with the budget in view (Q7, U)
**As** a project manager, **I want to** see what approving an entry does to the budget **so that** I approve with my eyes open.

- **Loading:** the breakdown shows a skeleton while it's calculated.
- **Success:**
  - Pending entries are grouped by project and milestone, with each person's weekly total.
  - **Budget impact** shows:
    - the request's cost (hours × hourly rate)
    - the milestone's cost before → after
    - the budget remaining before → after
    - the share of the remaining budget this approval uses
    - a projected total: consumed plus the average approved weekly cost of the last 4 complete weeks × the weeks left
  - The breakdown warns if the forecast goes over budget.
  - **Approve** counts the hours toward the budget immediately.
  - **Reject** requires a reason, which the employee sees on their timesheet.
- **Failure:**
  - Approving your own hours is refused (`SELF_APPROVAL`). A manager's own hours go to an admin.
  - An entry someone else already decided returns `NOT_PENDING`.
  - If the hours changed since the queue loaded, the decision is refused (`STALE_ENTRY`), the message says so, and the queue reloads.
  - Managers see each request's cost but not the person's hourly rate, which would reveal their salary.
- **Empty:** "Nothing waiting for approval."

---

## Allocation

### A1. See allocation across projects (Q3, Q5)
**As** a manager or admin, **I want** a people × projects grid **so that** I can rebalance work.

- **Success:**
  - Each cell reads "*planned* planned · *logged* logged" for the chosen week.
  - Utilization (logged ÷ 40) is shown per person and highlighted over 100%.
  - Managers see their own projects; admins see all.
- **Empty:** "Nobody to show. People appear once they're added to a project."
- **Failure:** error banner with Retry.

---

## Project requests

### R1. Request a project (U)
**As** a manager, **I want to** propose a project with dates, budget and a reason **so that** an admin can approve it.

- **Success:** the request appears as *Pending* in my list.
- **Failure:** required fields are marked, an end date before the start date is flagged, and a negative budget is rejected.

### R2. Decide on a request (U)
**As** an admin, **I want to** approve or reject requests.

- **Success:**
  - **Approve** creates the project, with the requester as its manager.
  - **Reject** records a comment, which the requester sees.
  - Status chips are *Pending*, *Approved* and *Rejected*.
- **Failure:** a request that has already been decided returns `REQUEST_CLOSED`. An approval whose project name is already taken returns `409`.

---

## People (admin)

### U1. Create an account in a guided wizard (E: CRUD resources, U)
**As** an admin, **I want** a step-by-step form **so that** new accounts are complete and valid.

- **Steps:**
  1. First and last name.
  2. Email, role, "Reports to" (required for employees), job title and salary.
  3. Username:
     - It's pre-filled from the first free suggestion.
     - It's checked live (debounced), with an **Available** or **Taken** icon.
     - 3–5 suggestion chips are offered.
     - It's unique regardless of capitals.
  4. Temporary password, typed or created with **Generate password** (12 characters), with the live policy checklist.
  5. Review, then **Create account**.
- **Loading:** the review step shows "Creating…". **Next** is disabled until the current step is valid.
- **Success:**
  - The welcome email carries the username, the temporary password and the sign-in link.
  - If the email can't be sent, a "Share these sign-in details" dialog shows the username and password **once**, with copy buttons.
- **Failure:** a duplicate email or username sends me back to that step, with the error on the field.

### U2. Manage people (E: CRUD resources)
**As** an admin, **I want to** search, edit, archive and restore accounts.

- **Success:**
  - I can search by name, username or email, filter by role, and show archived accounts.
  - The detail page edits every field, including username, role, manager and salary.
  - **Reset password** issues a new temporary password and ends their sessions.
- **Failure:**
  - I can't change my own role or salary, or archive myself. Those controls are disabled, with the reason shown.
  - Archiving someone who still manages projects or has direct reports is refused, and the page lists exactly which projects and people (`HAS_DEPENDENTS`).

---

## Profile

### F1. Keep my details up to date (U)
**As** anyone, **I want to** change my name and email **so that** they're correct.

- **Success:**
  - The changes are saved and the top bar updates.
  - Username, role, job title and my own salary are shown read-only. Everyone can see their own salary.
- **Failure:** an invalid email is flagged on the field, and a duplicate email returns `409`.

---

## Audit log (admin)

### L1. See who changed what (U)
**As** an admin, **I want** a tamper-proof history **so that** I can answer "who did this?".

- **Success:**
  - Every create, edit, archive, restore, approval and rejection is listed with the time, the person, the action and the record.
  - I can filter by record type and date range.
  - **Show changes** reveals the before/after JSON and the request ID.
- **Empty:** "No entries for these filters."
- **Failure:** error banner with Retry. Entries can't be edited or deleted through any endpoint.

---

## Layout and accessibility

### X1. Works on my phone (E: responsive, R)
- On desktop there's a sidebar. Below the `md` breakpoint there's a menu drawer, the tables become cards, and dialogs go full-screen.
- The end-to-end tests run every journey on an iPhone 13 profile as well as desktop Chrome.

### X2. Usable without a mouse or perfect vision (R)
- Every input has a label, and every action works from the keyboard, with visible focus.
- Status is shown by text as well as colour.
- Dashboard panels are labelled regions.
- Colours come from one theme, with contrast checked against WCAG AA.
