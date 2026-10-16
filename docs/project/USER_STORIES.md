# User stories

The user stories behind every screen in ACME Scout, grouped by page.

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

| Can… | Admin | Manager | Employee | Executive (read-only) |
|---|---|---|---|---|
| Create, edit, archive and restore accounts; change usernames; reset passwords; edit salaries | ✅ | — | — | — |
| See other people's salaries | ✅ | — | — | — (never, not even their own) |
| Create projects, approve or reject project requests | ✅ | — | — | — |
| Submit a project request | — | ✅ | — | — |
| Edit a project, plan it on the board, staff it, manage its milestones, approve its hours | every project | projects they manage (and hours of projects delegated to them) | — | sees every project, changes nothing |
| Move an assigned milestone to *in progress* / *ready for review*, kick it back, post updates | ✅ | ✅ | milestones assigned to them | — |
| Log their own hours (timesheet and timer) | only with "Tracks own hours" | only with "Tracks own hours" | ✅ | — |
| See running timers (**Live now**); stop one with a message | everyone's, and may stop them | their people's and projects', and may stop them | — | everyone's, read-only |
| Decide a change request on locked timer hours | ✅ (never their own) | projects they manage or approve as delegate | asks for one on their own cells | sees them, decides nothing |
| Submit approved pay periods to HR | ✅ | — | — | sees the list of submissions |
| Start a conversation | with anyone active | with anyone active | with their managers and other employees | with anyone active |
| See the audit log | ✅ | — | — | ✅ (no pay fields) |
| See someone's profile and history | anyone | themselves and people on their projects | themselves | anyone |

The **public demo admin** (`demo.admin`) is an admin whose password is published: it signs out after 5 minutes and every write that changes people, credentials, departments, skills, project archiving or HR is refused (`403 DEMO_RESTRICTED`). See story [V1](#v1-try-the-admin-view-without-the-real-admin-password-u--done).

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
  - **Q2 comes first, as a Risk section:** a row of counts (at-risk projects, then how many have each reason: *Overdue milestone*, *Past due date*, *Budget burning faster than progress*), then the at-risk projects, each with its reasons as badges. Employees' counts cover only their own projects.
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
  - A "Cost by milestone" table lists each milestone's approved cost and share of the budget, with a bar scaled to the costliest milestone. Its total row is the Consumed figure, so the two always agree. The project's manager and admins also see approved and pending hours; nobody sees an hourly rate.
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
  - A bar above the timeline shows the milestones by state, headed "<done> of <total> milestones done".
  - Horizontal date bars appear in dependency order on a month axis, with a "Today" marker. Every bar reads "<Mon D> – <Mon D> · <state>", shows its progress, marks an overdue milestone and tags your own with "You"; clicking one (or pressing Enter or Space on it) scrolls to that milestone's card below and highlights it, opening its details.
  - Each milestone lists what it waits on, with a "Waiting on: …" tooltip on its disabled Start button.
- **Empty:** "No milestones yet", with **Add milestone** for managers.

### M3. Move my milestone forward (U)
**As** an employee assigned to a milestone, **I want to** start it and mark it ready for review **so that** my manager knows it's done.

- **Success:**
  - **Start** moves it from *not started* to *in progress*.
  - **Ready for review** moves it on to *ready for review*.
  - I can't mark it completed. That button only appears for the project's manager or an admin.
  - Milestones assigned to me are marked "Assigned to you".
  - **Ready for review** also adds me as support on the most urgent in-progress milestone of my active projects that I'm not already on ([auto-routing](LOGIC_WALKTHROUGH.md#9-auto-routing-after-ready-for-review-and-completed)). The toast names it, the bell tells me and that project's manager, and my name shows a "Supporting" chip on its card. If nothing qualifies, or I'm planned past 40 hours, nothing happens.
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

- **Loading:** a skeleton. **Submit** shows "Saving…".
- **Success:**
  - The **Day view** is the default, one day at a time:
    - A week bar has previous/next week buttons, **This week**, the week total ("22h / 40h") and a strip of seven day buttons (Mon to Sun), each showing that day's hours. A day over 24h turns red.
    - The page opens on today in the current week, otherwise on Monday. The open day is kept in the address (`?week=…&day=…`).
    - The open day has one row per assigned milestone, grouped by project when there is more than one, each with an hours field and a work note that is always visible (10-500 characters, with a counter, marked "needed" when the hours are new or changed and there's no note or same-day progress update).
    - A **Start** button appears on today's rows only.
    - Switching day keeps what I typed. **Submit N changes** in the page header sends every changed cell of the week, on any day, in one save.
    - Completed milestones, and milestones of a closed or on-hold project, sit behind **Show N closed milestones**. A completed milestone stays editable while its project is open; a closed or on-hold project's rows are read-only.
  - The **Day | Week | Month** toggle swaps in the **Week grid** (one row per assigned milestone, grouped by project, with daily and weekly totals) or the **Month** calendar. The choice is remembered in this browser. Weekends are hidden behind a switch on phones.
  - The **Month** calendar (`?month=YYYY-MM&day=YYYY-MM-DD`, with previous/next month buttons) is about hours, not milestones:
    - Each day shows its total (pending and approved only) and a chip per line with an icon and a word: approved, "Pending", "Needs revision" (hours struck through) or "Not submitted" (a timer draft). On a phone the lines are small shapes instead.
    - "⚠ Over 40h" marks an overtime day, and "📅 N milestone deadlines" a day when one of my unfinished milestones ends.
    - The header reads "<total>h logged in <Month>" with "Pending + approved · Rejected hours excluded."; a legend explains the statuses.
    - Clicking a day selects it. A panel (beside the grid, or under it on a phone) lists that day's hours, one card per line with status, project, hours, whether it is timer-linked and its source (Manual, Tracked or Mixed), and the manager's reason on a rejected line. Timer hours are locked, with **Request a change** (a timer draft instead says to submit it in the Day view; hours on a milestone I am no longer assigned to have no action); other lines have **Edit in Day view**. The day's milestone dates follow, with **View milestones**.
    - From the keyboard the grid is one Tab stop: the arrow keys move between days, Home and End to the ends of the week, Page Up and Page Down to the previous and next month, and Enter or Space selects the day and moves focus to its panel.
  - Each saved entry shows its status:
    - "Pending approval"
    - "Pending (Overtime requested from *First Last*)" for the entry that takes my week past 40 hours, and any after it
    - "Approved"
    - "Rejected", with the reason (shown under the field in the Day view, in a tooltip in the Week grid)
  - Editing an entry that was already decided sends it back for approval and tags it "Edited".
  - A rejected entry has a **Resubmit** button, so the same hours can go back for approval after a conversation with the manager.
  - When hours are rejected, my bell shows "Your 8h on *Milestone* (Mon 12 Oct) was rejected: *reason*", and opening it takes me to that week.
  - A milestone I was auto-routed to support shows a "Supporting" chip on its row.
- **Failure:**
  - An hours field takes plain numbers only: digits and one decimal point, at most 2 digits on each side (7.5 and 7.25, not 7.255). Typed or pasted `-`, `+`, `e`, letters and spaces are dropped. The server refuses more than 2 decimal places too ("Use at most 2 decimal places").
  - A value under 0.25 is flagged on the field and blocks submitting, with a link to the day when it's another day's; 0 or empty clears a pending entry.
  - More than 24 hours in a day is blocked before submitting, and the message links to that day.
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
  - Above the grid, a bar chart compares each person's planned and logged hours this week against a 40h line. Anyone over 40 gets an orange bar, a ⚠ on the axis and their name in the note under the chart.
  - A donut shows this week's logged hours by project.
  - Every name opens that person's profile.
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

### F2. See someone's history (U)
**As** an employee, **I want to** see everything I've worked on; **as** a manager or admin, **I want to** see the same for my people.

- **Success:**
  - The profile shows name, job title, role and manager. Admins also see the salary; so does the person themselves.
  - This week: hours logged, overtime (hours past 40) and planned hours. All time: hours logged and hours approved.
  - History tables list every project they've been on (including completed ones) and every milestone they've worked on, with their role (primary or supporting), status, dates and hours.
  - Employees reach it from **My history** in the menu; managers and admins click a name on the Allocation page.
- **Failure:** anyone outside the rules above gets "Profile not available" (the server returns `404`, so it doesn't reveal who exists).

---

## Audit log (admin)

### L1. See who changed what (U)
**As** an admin, **I want** a tamper-proof history **so that** I can answer "who did this?".

- **Success:**
  - Every create, edit, archive, restore, approval and rejection is listed with the time, the person, the action and the record.
  - I can filter by who made the change (a searchable list of people, archived ones included), the action, the record type and a date range.
  - **Show changes** lists each changed field as "field: old → new" (unchanged fields are skipped) with the request ID. **Show raw JSON** reveals the stored before/after.
- **Empty:** "No entries for these filters."
- **Failure:** error banner with Retry. Entries can't be edited or deleted through any endpoint.

### L2. Find and restore anything archived (U: never delete)
**As** an admin, **I want** one page listing everything archived **so that** I can bring something back without hunting for it.

- **Success:**
  - **Archive** in the menu lists archived projects, milestones (with their project) and people, newest first, with when and by whom (when the audit log knows).
  - A type filter shows the count per type.
  - **Restore** asks first, then calls that record's own restore, shows "Restored *name*" and drops the row.
- **Empty:** "Nothing is archived."
- **Failure:** a restore the server refuses (such as a project whose name is now taken) shows "Couldn't restore *name*" with the server's message and the request ID. Managers and employees can't open the page (`403`).

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

### X3. Know where I am (R)
- **Success:** every page has breadcrumbs (a `Breadcrumb` navigation): "Workspace" or, for an admin's pages, "Administration", then the page, and for a project or person its name; the last crumb is the current page. Earlier crumbs are links, and the root is plain text. On a phone the top bar shows a back link to the parent instead ("‹ Projects").
- **Loading:** a short skeleton stands in for the name.
- **Failure:** a project or person that can't be loaded shows "Not found" as its last crumb.

### X4. One account menu (R)
- **Success:** my name at the bottom of the sidebar (or just my avatar when it's collapsed) and the avatar in the top bar open the same menu: My profile, Profile photo, Theme (Light, Dark, System) and Sign out. The top bar reads Search, running timer, Puppy, notifications, then the avatar.

---

## Stories added after the first release

Everything below was built after the first deploy and is live. **Status** is **Done** for every story here; the requirements checklist in [REQUIREMENTS.md](REQUIREMENTS.md#part-3--built-after-the-first-release) lists the same items. Shared behaviour (loading skeletons, toasts, error banners with a request ID, empty states, disabled controls with a reason) applies as described at the top of this file.

### Everyone

#### N1. Try the demo in one click (U) — Done
**As** a grader, **I want** one button per role on the sign-in page **so that** I can explore without typing credentials.
- **Success:** Employee, Manager, Executive and Admin buttons sign in to the published demo accounts and land on that role's home. A **View the source on GitHub** link under them opens the repository in a new tab.
- **Failure:** "Too many demo sign-ins from your network" (`429`) after 20 Admin-demo sign-ins a minute from one address; the demo accounts never lock.

#### N2. Search and jump anywhere (U) — Done
**As** anyone, **I want** Ctrl+K to search pages, projects, people, milestones and actions, and to understand phrases like "at-risk projects in Technology" **so that** I get there without clicking through menus.
- **Success:** results are scoped to what I may open; a matched phrase shows as an "Interpreted" chip (e.g. *Projects · At risk · Technology*) and Enter opens the filtered page.
- **Empty:** "No matches" with the phrases I can try. Nothing leaves the browser.

#### N3. Ask Puppy what needs me (U) — Done
**As** anyone, **I want** a small assistant that summarises what needs my attention **so that** I don't have to visit every page.
- **Success:** the panel's Summary lists "What needs you" (approvals waiting, red-flagged entries, people over 40 hours, missing timesheets, timer hours not submitted yet, a timer at its limit, who's running timers, change requests waiting), tips and the top insights; Do it runs a confirmed action; Ask answers fixed help questions; Sound picks an alert sound for new notifications.
- **Privacy:** Puppy reads only what my role already sees, through an allow-list, and says "Puppy follows rules from your data — no AI service involved."

#### N4. Message the people I work with (U) — Done
**As** anyone, **I want** one-to-one conversations and a discussion thread per milestone **so that** questions stay next to the work.
- **Success:** an inbox with unread counts, threads grouped by day, "Seen" receipts, a bell alert per conversation (never the text), and a **Discuss** button on each milestone.
- **Rules:** admins, executives and managers can start a conversation with anyone active; an employee with their own manager, the managers and active delegates of their projects, and other employees.
- **Failure:** "Employees can message their manager, their project managers and other employees." (`403`); "You're sending messages too fast" after 20 a minute (`429`).

#### N5. Choose light or dark (U) — Done
**As** anyone, **I want** the app to follow my system theme, or a theme I pick in the account menu, **so that** it's comfortable to read.

#### N6. Add a profile photo (U) — Done
**As** anyone, **I want** to upload and crop a photo **so that** people recognise me in lists and threads.
- **Failure:** anything but a well-formed PNG of 16–512 px under 300 KB is refused with the reason; the server rebuilds the image from its pixels, dropping metadata.

### Employee

#### E1. See my week at a glance (U) — Done
**As** an employee, **I want** a home page with my hours this week and the milestones on my plate **so that** I know what to do next.
- **Success:** "31.75h of 40h" with logged and planned bars, my milestones ordered overdue first then by priority and due date (status, priority and difficulty chips), and milestones I can claim on pull-mode projects.

#### E2. Time my work with a start/stop timer (U) — Done
**As** an employee, **I want** to start a timer on a milestone and stop it when I'm done **so that** my hours are logged for me.
- **Success:** one running timer at a time, a live clock in the header. **Stop your timer?** says what it adds; stopping rounds to the nearest quarter hour and keeps the hours as a **draft** of that day's cell ("Added 0.25h to Thursday's cell — open your timesheet to submit."), never submitting them. The timesheet shows the cell pre-filled and locked ("from timer, not submitted yet"), with "You have 0.25h of timer time not submitted yet — press Submit to send it."; **Submit** sends it with proof of work like any hours. Entries show Tracked, Manual or Mixed.
- **Warnings:** at 100% of the 8h day, the milestone's estimate or the 40h week, a banner and a toast ("You've reached your 8h for today on this timer") and the header chip turns amber. It never stops the timer.
- **Failure:** starting a second timer is refused (`409 TIMER_RUNNING`); under 7.5 minutes adds nothing and says so; a timer left running stops at midnight New York time into a draft and tells me; if the hours can't be recorded (the day would pass 24h, the project was paused) the timer still stops and says why. Typing over a locked cell is refused (`409 TIMER_HOURS_LOCKED`).

#### E8. Ask to change timer hours (U) — Done
**As** an employee, **I want** to ask my manager to correct hours my timer recorded **so that** a timer I forgot to stop doesn't stand, without my being able to rewrite tracked time myself.
- **Success:** **Request a change** on a locked cell asks for **Hours you want instead** and **Why?** (10–500 characters); the cell then shows "Change requested: 1.5h". When my manager decides, my bell says "Your change to Schema Mapping was approved" (the cell becomes the requested hours, pending approval) or declined (the cell stays).
- **Failure:** a second request on the same cell (`409 CHANGE_REQUEST_PENDING`), the hours the cell already holds (`400 NO_CHANGE`), or a reason under 10 characters is refused.

#### E9. Message my manager in one press (U) — Done
**As** an employee, **I want** to see who my manager is and message them straight away **so that** I know who to ask.
- **Success:** a **Your manager** card under **This week** on My week (and on my own profile) with their photo, job title and department, **View profile** and **Message Morgan**, which opens Messages with that conversation.
- **Empty:** no card when I have no manager or they were archived.

#### E3. Explain my hours (U) — Done
**As** an employee, **I want** to add a short work note to new or changed hours **so that** my manager can approve them with confidence.
- **Failure:** a save with new hours and neither a 10–500 character note nor a progress update that day is refused (`400 PROOF_REQUIRED`), listing the cells and highlighting the work note box on each of those rows (the note icon under each cell in the Week grid).

#### E4. Kick back a milestone I can't progress (U) — Done
**As** an assignee, **I want** to send a milestone back to my manager with a category and reason **so that** blockers are visible instead of silent.
- **Success:** the milestone becomes **Blocked**, my manager (and the active delegate) gets an alert, the project shows "Kicked back – needs review" in its risk reasons, and the resolution comes back to everyone on it.
- **Failure:** a reason under 10 characters is blocked; work already handed in can't be kicked back.

#### E5. Be routed to the next piece of work (U) — Done
**As** an employee, **I want** to be added where I'm needed when I hand work in or it's completed **so that** I'm never idle while urgent work waits.
- **Success:** after *Ready for review* I'm added as **Supporting** on the most urgent in-progress milestone I have the skills for; after *Completed* I may become primary on the next ready milestone. I get an alert naming it; my 40-hour plan and skills are respected.

#### E6. Claim work on a pull-mode project (U) — Done
**As** a team member, **I want** to claim a ready milestone nobody owns **so that** the team pulls work instead of waiting to be assigned.

#### E7. Be reminded on Friday (U) — Done
**As** someone who keeps a timesheet, **I want** a reminder when my week is empty **so that** my hours reach payroll on time.
- **Success:** from Friday 14:00 New York time, if I am on an active project and have no pending or approved hours that week, my bell shows one reminder linking to that week (once per week, cleared when I log hours). Managers and admins see the same people on a **Missing timesheets** card.

### Manager

#### G1. Review timesheets week by week (U) — Done
**As** a manager, **I want** pending hours grouped by person-week with red flags **so that** I approve fast and look closer only where it matters.
- **Success:** each week shows entries, hours waiting, hours logged, "Tracked 68% · Manual 32%" and a red-flag count; each entry shows its note or progress update and its flags (same hours daily, long day, closed milestone, backdated, over plan, no activity, no proof). **Only flagged** filters the list; **Approve week** approves a whole person-week; **Approved** lists approved weeks.
- **Failure:** an entry changed since I loaded it is refused (`409 STALE_ENTRY`) and reloads; I can never approve my own hours.

#### G9. See who's timing work and stop a timer (U) — Done
**As** a manager, **I want** a live list of my people's running timers **so that** I can spot a timer left running and stop it with a reason.
- **Success:** **Live now** on my dashboard and on Timesheets lists each running timer (person, milestone, project) ticking every second, with **Warning** (100% of a limit) or **Over** (125%) chips. **Stop timer** asks for a message (10–500 characters) and **Stop timer and send**: the time so far becomes the person's draft, they get a bell alert, and the message appears in our one-to-one conversation.
- **Alerts:** one bell alert per timer and limit once it passes 125% ("Eli's timer on Schema Mapping is at 10h today — over the 8h daily limit").
- **Empty:** "Nobody is running a timer right now." Executives see the card read-only; the public demo admin can't stop timers.

#### G10. Decide change requests on timer hours (U) — Done
**As** a manager (or delegate, or admin), **I want** to approve or reject requests to change locked timer hours **so that** tracked time changes only with my say-so.
- **Success:** **Timesheets → Change requests** shows "2h → 1.5h", the project and the reason; **Approve** or **Reject** opens "Approve Eli's change?" with an optional comment and **Approve change** / **Reject change**. Approving makes the cell the requested hours, pending approval like any hours; rejecting keeps it. The employee is told either way.
- **Failure:** my own request is refused (`403 SELF_APPROVAL`); a request already decided is refused (`400 NOT_PENDING`).

#### G2. Plan a project on a board and finalize it (U) — Done
**As** a manager, **I want** to move milestones from Backlog through Ready to Scheduled and finalize the plan **so that** a project starts only when it's ready.
- **Success:** cards show priority, difficulty, dates, dependencies, skills and assignees, with a warning icon for problems; **Finalize plan** lists six checks (something scheduled, nothing left in Backlog or Ready, dates inside the project, everyone staffed, no cross-project or looping dependencies, order respects dependencies) and moves the project from Planned to Active, telling the team where they start.
- **Failure:** finalize stays disabled while any check fails, with each problem listed.

#### G3. Start a project from my department's template (U) — Done
**As** a manager or admin, **I want** a new project to start from its department's milestone plan **so that** I don't build the same steps every time.
- **Success:** Technology, Operations and Risk & Compliance each have six steps with objectives, done-when checklists, skills, estimates and dependencies, laid over the project's dates; the project starts Planned.

#### G4. Tell urgency from effort (U) — Done
**As** a manager, **I want** priority (how urgent) and difficulty (how much it weighs in progress) as separate, clearly labelled chips **so that** nobody mistakes one for the other.
- **Success:** "Critical Priority" in red with a flag, "High Priority" in amber, "Hard Difficulty" in teal with weight dots; insights say "High Severity". Priority orders routing, lists and insights; difficulty weights progress.

#### G5. Hand approvals to a delegate (U) — Done
**As** a manager, **I want** to name another manager or admin to approve a project's hours until a date **so that** approvals don't stall while I'm away.
- **Success:** the delegate sees the hours labelled "Delegated from *manager*" and gets an alert; I keep every right.
- **Failure:** a delegate who isn't an active manager or admin, is the project's manager, or an end date in the past is refused.

#### G6. Resolve a kickback (U) — Done
**As** a manager (or delegate, or admin), **I want** to answer a kickback with instructions **so that** the person can carry on or the milestone goes back in the queue.

#### G7. Keep my employees' skills current (U) — Done
**As** a manager, **I want** to set the skills of the employees I manage **so that** routing picks the right people.

#### G8. Email or print the dashboard (U) — Done
**As** a manager, admin or executive, **I want** to email the dashboard report to myself or someone else, or print it **so that** stakeholders get the numbers without signing in.
- **Success:** a per-recipient result ("Sent to …"); the report follows the department filter.
- **Failure:** without the EmailJS template configured, the button explains that email isn't set up.

### Admin

#### AD1. Start from a control centre (U) — Done
**As** an admin, **I want** shortcuts (people, departments, open requests, archive, audit) above the organisation dashboard **so that** my daily tasks are one click away.

#### AD2. Submit pay periods to HR, with corrections (U) — Done
**As** an admin, **I want** to submit a week, fortnight or month of approved hours to HR and download its payroll CSV **so that** payroll gets exactly what was approved.
- **Success:** a preview of entries, hours, cost and people; each approved entry is sent once; a sent entry edited later goes back to pending, is listed under **Needs re-submission**, and the next submission re-sends it as a correction.
- **Failure:** entries still waiting for approval are excluded and called out; two admins can't send the same entry (row locks).

#### AD8. Create several accounts in one conversation with Puppy (U) — Done
**As** an admin, **I want** to onboard a group (for example the instructors) by answering Puppy's questions **so that** I don't run the wizard once per person.
- **Success:** **Do it → Create user accounts** (or "create accounts for the instructors" in Ask) asks for the names, then the emails in the same order, then each person's role, manager and department, shows a summary with **Edit** and **Remove**, and creates nothing until **Yes, create and email**. Each row goes Creating… → Created ✓ → Emailed ✓; each person gets a random temporary password by email and must change it at first sign-in. Up to 25 people.
- **Failure:** mismatched counts ("I got 2 emails for 3 people — who's missing?"), invalid, repeated or taken addresses are caught before anything is created; a row the server refuses shows its message and **Retry failed**; if an email can't be sent, **Show passwords once**. The public demo admin gets "Creating accounts is disabled in the public demo." and is never offered as anyone's manager. Locally rows say "Saved to the local outbox (not sent)".

#### AD3. Manage departments and the skills catalogue (U) — Done
**As** an admin, **I want** to add, rename, archive and restore departments and skills **so that** filters, presets and routing match the organisation.

#### AD4. Decide who keeps a timesheet (U) — Done
**As** an admin, **I want** managers and admins to log hours only when I switch on "Tracks own hours" **so that** their timesheets and reminders don't nag people who don't bill time.

#### AD5. Create executives (U) — Done
**As** an admin, **I want** to create read-only executive accounts **so that** sponsors can see everything without changing anything or seeing pay.

#### AD6. Read the audit log as sentences (U) — Done
**As** an admin or executive, **I want** audit entries grouped by day as readable sentences with before → after changes **so that** I can tell what happened without reading JSON (raw JSON stays behind a toggle).

#### AD7. See live activity (U) — Done
**As** anyone with a dashboard, **I want** a Live activity card of recent changes I'm allowed to see **so that** I notice what moved since I last looked.

### Executive

#### EX1. See the whole organisation, read-only (U) — Done
**As** an executive sponsor, **I want** an organisation dashboard, every project, allocation, the archive and the audit log **so that** I can follow delivery without asking for reports.
- **Success:** the dashboard is marked **Read-only view** and shows projects by status, risk, insights and budgets; every write control is hidden.
- **Failure:** any write I attempt directly is `403 READ_ONLY`; no response ever contains a salary or hourly rate.

### Public demo visitor

#### V1. Try the admin view without the real admin password (U) — Done
**As** a visitor, **I want** a public Admin demo **so that** I can see the admin experience safely.
- **Success:** a welcome dialog, then a "Demo session · 4:49" pill in the top bar that counts down and opens a short explanation (a screen reader hears one notice at 1:00); People, Departments, Skills and Archive carry a "Demo access ·" notice; approving hours, deciding requests, editing projects and milestones, staffing and messages work normally.
- **Failure:** restricted actions are disabled with "Disabled in the public demo." (`403 DEMO_RESTRICTED` if called directly); after 5 minutes the session ends with "Your 5-minute demo session has ended."

### Operator

#### O1. Improve the live demo data without resetting it (U) — Done
**As** the owner, **I want** additive operations (`demo_backfill`, `demo_curate`, dry run first) **so that** the demo stays rich without wiping what graders did.
