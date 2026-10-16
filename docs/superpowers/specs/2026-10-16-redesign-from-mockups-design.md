# Redesign from the owner's mockups

Date: 2026-10-16. Status: draft for the owner's review.

- **Replaces** Part B (projects area) of `2026-10-15-timesheet-and-projects-redesign-design.md`. Its Parts A (Day view) and C (readable charts) shipped and stay.
- **Merges** the My week screen of `2026-10-15-employee-now-and-next-design.md`. That spec's backend stays exactly as written.
- **Keeps** the Month view of `2026-10-15-timesheet-month-calendar-design.md`, including its Revision 2 (hours-first, 16 Oct).
- **Mockups:** `.superpowers/redesign/*.png` (22 files: the first 21 on 15 Oct, plus `My timesheet - Month (v2).png` on 16 Oct). Their layouts are the target; their numbers are sample data.

## 1. Why, success, scope

### Why

The owner drew the app they want, screen by screen. Compared with today:
- the shell is calmer: a grouped sidebar, breadcrumbs, one demo signal;
- a project is one header with five clear tabs, and a milestone opens in a side panel instead of a long card;
- employee screens start with "what now";
- admin screens are tables with side panels.

Part B of the 15 Oct spec (project cards, a tabless employee page) was never built. The mockups replace it.

### Success criteria

- Every mocked screen exists at the mockup's layout, with real data, for every role that can open it.
- An employee opens a project and sees where it stands and their own part. They never see anyone else's hours or pending entries.
- A manager decides a milestone's pending hours without leaving the project page.
- No role loses an action it has today. No role sees data it can't see today.
- Every screen works at 375 px with no horizontal page scroll, and in dark mode.
- Each phase ships on its own, after the owner's OK: tests green, docs updated, screenshots retaken, pushed to `overwatch`, deployed, smoke-tested live.

### Scope: four phases

| Phase | Screens | Mockups |
|---|---|---|
| **1 Shell** | logo, sidebar, top bar, breadcrumbs, demo pill, the demo-disabled pattern | the frame of every mockup; `Departments.png` and `Skills.png` for the pill |
| **2 Project page** | Projects list; project header; Overview, Milestones (list, timeline, side panel), Team, Budget, Hours | `Projects list (file was named People tab).png`, `Project - Overview.png`, `Projects - Milestones.png`, `Projects - Milestones2.png`, `Projects - Milestone3.png`, `Projects - Team.png`, `Projects - Budget.png`, `Projects - Hours.png` |
| **3 Employee screens** | My week, My timesheet, My history (the Month view ships earlier, see 5.2) | `My Week (Employee).png`, `My Timesheet.png`, `My timesheet - Month (v2).png`, `My History.png` |
| **4 Manager and admin screens** | Timesheets, Dashboard, Control centre, People, Departments, Skills, Archive, Audit log, Puppy | `Timesheet - Approval (Manager).png`, `Dashboard.png`, `Control Centre.png`, `People.png`, `Departments.png`, `Skills.png`, `Archive.png`, `Archive (Admin demo version).png`, `Audit log.png`, `Puppy.png` |

The three Milestones mockups are three states of one tab: list, timeline, and list with a milestone open in the side panel.

### Not changing

- **Business rules:** proof of work, the 24 h/day stop, the 40 h warning and overtime, timer locks and change requests, closed or on-hold gating, auto-routing, kickbacks, the planning board, HR submissions, the at-risk rule (§6 of LOGIC_WALKTHROUGH; §7.1 and §10).
- **Permissions:** the server's checks, `lib/permissions.js` and `app/access.js`. The employee variants below only hide things.
- **Approvals:** who may decide, Approve week being all or nothing, the stale-entry guard, a reason to reject.
- **Timesheets:** entering and saving hours (one `PUT /time-entries` per Submit), Day | Week | Month.
- **Shipped work:** Part A, Part C, the Month view, and the now-and-next backend (profile fields, `coming_up`, employees never reading archived milestones).
- **The API:** every change in §7 is additive.

**Screens without a mockup** get the phase-1 shell and the shared table and panel parts where they already use tables, nothing else: Login, Messages, Allocation, Project requests, My profile, a person's admin page (`/people/:id`), the Plan tab, and the Approved and HR tabs of Timesheets.

**Dropped from the old Part B (none were built):** `my_hours`, the project cards and `ProjectCard.jsx`, the tabless employee page, the merged "Budget & hours" tab and the "progress share" figure.

## 2. Decisions

### The owner's decisions (binding)

| # | Decision | Reason |
|---|---|---|
| D1 | The mockups replace Part B. Four phases (Shell; Project page; Employee screens; Manager and admin screens), each shipped on its own with the owner's OK | Smaller reviews; each phase is useful alone |
| D2 | The logo reads "ACME Scout" everywhere, not "SCOUT" | The product's name |
| D3 | Sidebar: a WORK section, plus an always-visible ADMIN section for admins. A user chip at the bottom (avatar and name) opens the account menu. The Collapse control stays | Admin pages one click away; the account in a predictable place |
| D4 | Breadcrumbs on every page: "Workspace / …", "Administration / …", "Projects / <name>" | Orientation across 20-odd screens |
| D5 | Demo sessions get one countdown pill in the top bar ("Demo session · 4:29"). Demo-disabled actions are shown disabled with the existing reason | One signal instead of a banner on every page |
| D6 | The project header is the same on every project tab | Switching tabs never loses context |
| D7 | Projects list: the mockup's table, without its sample numbers; its Risk column shows the existing at-risk reasons in words (§7.1) | Scannable, and risk is said in words |
| D8 | Employees never see archived work anywhere. My history's "Include archived" and "Archived" chips are dropped for employees; admins and executives keep what they see today | Archived means withdrawn; matches the now-and-next backend |
| D9 | No timesheet autosave. "Saved a few seconds ago" is dropped and the explicit Submit stays. Unsaved typing may be kept in the browser only | Every save becomes a pending entry for the manager |
| D10 | My timesheet keeps Day \| Week \| Month | Month shipped; the mockup shows only Day and Week |
| D11 | The Budget tab keeps Part C's relative cost-by-milestone bars, inside the mockup's table | Milestones stay comparable |
| D12 | Project tabs have an employee variant: no Approvals column, nobody else's pending hours, dollars only where employees see them today, and "your part" where managers see team data | Employees see their impact without seeing colleagues' hours |
| D13 | New server data is additive: entry source, audit changes, project risk, missing-timesheet count, My week's week picker | Older clients keep working |
| D14 | Phones and dark mode on every screen. Side panels become full-screen sheets on phones, tables become stacked rows, and there's no horizontal page scroll at 375 px | The app's existing standard |

### Calls made in this spec (change any on review)

- **Wording from the mockups where it fits:** managers "Request changes" (the reject action); employees see a rejected entry as "Needs revision". API values and alert texts don't change.
- **Projects list "Manager" column**, not "Owner": it matches the filter and the project header.
- **The Projects list KPI strip** counts every live project the viewer can see, whatever the filters.
- **My week's week picker** sits in the page header, as drawn. It drives only the hours card, whose title names the week.
- **Unsaved timesheet typing** is kept in `sessionStorage` (this tab only), and cleared on Submit and on sign-out.
- **The top bar keeps its avatar**, as every mockup shows. It and the sidebar chip open the same menu.
- **Live now has no mockup.** It becomes a header line ("No running timers" / "2 timers running") on the Dashboard, the Control centre and Timesheets. The line opens today's Live now card in a side panel.
- **Change requests on timer hours have no mockup.** They become a Timesheets tab.
- **Audit times** are in the browser's time zone, which the list names.
- **Skills' "Milestones requiring skill"** is a plain number: no screen lists milestones by skill.
- **My history's "Employment details"** start collapsed, so a salary isn't on screen during a screen share.

## 3. Phase 1: the shell

Mockups: the frame of every file. Code: `app/Layout.jsx`, `app/nav.jsx`, `app/DemoSession.jsx`, a new `app/breadcrumbs.js`.

### 3.1 Logo

- Today's `BrandLogo`: the radar glyph, "ACME" over "Scout", 36 px, at the top of the sidebar. The glyph alone shows when the sidebar is collapsed.
- On phones it sits in the top bar beside the menu button.
- It links to the home page (`/`). Its accessible name is "ACME Scout".

### 3.2 Sidebar

- **Width** 248 px, or 72 px collapsed, as today.
- **Groups:**
  - "Work" for everyone;
  - "Admin" for admins only, under a divider, always expanded.
  - The titles are small uppercase labels.
  - The collapsible "Administration" footer in `Control Centre.png`, `Project - Overview.png` and `Timesheet - Approval (Manager).png` is not used (D3).
- **Items:** labels, icons, order, badges and permission checks are exactly `NAV` in `app/nav.jsx`. Nothing is added or removed.
- **The selected item:** a tinted background, primary text and a left accent bar, as today.
- **Badges:** Timesheets "N waiting" (warning colour) and Messages "N unread" (primary colour), as today.
- **At the bottom, in this order:**
  1. **User chip:** a 32 px avatar, the full name and a chevron. It's a button named "<Full name>, account menu". It opens the account menu: My profile, Profile photo, Theme (Light, Dark, System), Sign out. When the sidebar is collapsed, the avatar alone shows, with the name as a tooltip.
  2. **Collapse:** the label "Collapse" with the `[` key hint. `[` toggles it from anywhere; the choice is remembered in `overwatch.sidebarCollapsed`. Both are today's behaviour.
- **Phones:** the sidebar is the menu drawer, as today, with the same groups and the user chip at the bottom, but no Collapse.

**Items per role** (from `NAV` and `can()`):

| Role | Work | Admin | Mockup |
|---|---|---|---|
| Employee | My week, Messages, Projects, My timesheet, My history | — | `My Week (Employee).png`, `My History.png` |
| Manager | Dashboard, Messages, Projects, My timesheet\*, Timesheets, Allocation, Project requests, Archive | — | `Dashboard.png`, `Projects list (file was named People tab).png` |
| Executive | Dashboard, Messages, Projects, Timesheets, Allocation, Archive, Audit log | — | none |
| Admin | Control centre, Messages, Projects, My timesheet\*, Timesheets, Allocation | People, Departments, Skills, Project requests, Archive, Audit log | `People.png`, `Departments.png`, `Skills.png`, `Archive.png`, `Control Centre.png` |

\* Only when an admin has turned on "Tracks own hours" (`timesheet.use`).

### 3.3 Top bar

- **Left (desktop):** the breadcrumbs (3.4).
- **Left (phones):**
  - the menu button and the logo;
  - on a nested page (a project or a person), a back link to the parent crumb, e.g. "‹ Projects".
- **Right, in this order, on every page:**
  1. **Search:** today's command palette button, drawn as a field: a magnifier, "Search…" and the key hint "Ctrl K" ("⌘K" on Apple devices). It's icon-only under `md`. Its name is "Search (Ctrl+K)".
  2. **Running-timer chip:** today's `TimerChip`, only while a timer runs.
  3. **Puppy.**
  4. **Notification bell.**
  5. **Demo pill:** demo sessions only (3.5).
  6. **Account avatar:** opens the same menu as the user chip.

The mockups vary this order slightly. Use the order above everywhere.

### 3.4 Breadcrumbs

- **Markup:** `<nav aria-label="Breadcrumb">` with an ordered list. The last crumb is the current page: plain text with `aria-current="page"`.
- **The root crumb** is plain text, because no page sits behind it:
  - "Workspace" for a page in the viewer's Work group;
  - "Administration" for a page in their Admin group.
- **Every other crumb** except the last is a link.
- **The page title** stays the page's H1 in its header. Crumbs aren't headings.

| Page | Crumbs |
|---|---|
| Home (`/`) | Workspace / My week, Dashboard or Control centre (the role's home label) |
| Any other Work item | Workspace / <item label> |
| Any Admin item (admins) | Administration / <item label> |
| A project | Projects / <project name>; "Projects" links to `/projects` and carries a back arrow |
| `/people/:id/profile` | your own as an employee: Workspace / My history; admins: Administration / People / <name>; anyone else: Workspace / <name> |
| `/people/:id` | Administration / People / <name> |
| `/messages/:id` | Workspace / Messages / <subject or name> |
| `/profile` | Workspace / My profile |
| Not found | Workspace / Page not found |

- **A page names its last crumb** (a project's or person's name) with a `useBreadcrumb(label)` hook. A short skeleton shows while it loads.
- **The rest comes from `NAV`**, so a new nav item gets its crumb for free.

### 3.5 Demo pill and demo-disabled actions

Mockups: `Departments.png` ("Demo session · 3:41"), `Skills.png`, `Project - Overview.png`.

**The pill:**
- **Who sees it:** public demo accounts only (`is_public_demo`; today that's `demo.admin`).
- **Label:** "Demo session · m:ss", counting down to `session_expires_at`. It uses today's `useDemoNotice`, a timer icon, the warning colour and tabular numbers. It turns the error colour under 1:00.
- **It's a button.** Its name is "Demo session, signed out in 4 minutes 29 seconds". It opens a popover: "Public demo admin. Some actions are disabled, and you'll be signed out when the timer ends."
- **Screen readers:** a polite live region says "1 minute left in the demo session" once, at 1:00. Nothing is announced each second.
- **Phones:** the pill shows the timer icon and "m:ss"; the popover is the same.
- **Removed:** the page-top `DemoBanner` and the `DemoChip`.
- **Kept:** the one-time welcome dialog (`DemoWelcome`).

**Demo-disabled actions:**
- Actions in `DEMO_BLOCKED` stay visible and disabled, inside today's `DemoLock`.
- The tooltip is the existing reason, "Disabled in the public demo" (`DEMO_DISABLED`). The mockup's "Editing unavailable in demo mode." isn't used.
- The wrapper takes focus and carries the tooltip, because a disabled button can't.

**Page notices:** a page whose main actions are blocked shows one notice under its header. It's warning style, starts with **"Demo access ·"** and uses the page's text from §6 (People, Departments, Skills, Archive). No other page shows a demo notice.

### 3.6 Page frame

- **Header:** the H1 title, a one-line subtitle in secondary text, and actions on the right. On phones the actions wrap under the title.
- **Content:** up to 1440 px wide, with 32 px side padding (16 px on phones).
- **Cards:** outlined, with the theme's 10 px radius and 16–24 px padding.
- **Dates in footers** ("As of Oct 15, 2026", "Today is October 15, 2026") are the New York date, which is the date the server works in.

## 4. Phase 2: project page and Projects list

### 4.0 Shared parts (built here, reused in phases 3 and 4)

- **`SidePanel`** (`components/SidePanel.jsx`):
  - **Desktop (`md` and up):** a panel to the right of a list, 45–55% of the width. The list narrows to its first columns, as in `Projects - Milestone3.png`.
  - **Phones:** a full-screen sheet with a top bar (title and close).
  - **Roles:** a labelled `complementary` region on desktop (not modal), a modal `dialog` on phones.
  - **Focus:** it moves to the panel's title on open and returns to the row on close. Esc closes.
  - **URL:** the open record is in the URL (`?milestone=`, `?entry=`, `?record=`, `?event=`), so links and Back work.
- **`KpiStrip`:** 3–4 labelled numbers in one card with dividers between them. It becomes 2 columns on phones.
- **`FilterBar`:** a search field, selects and switches, with a count or actions on the right. It stacks on phones.
- **`DataTable`:**
  - sortable headers with `aria-sort`; sorting is stable;
  - row hover;
  - a row click opens its panel or page;
  - under `md`, each row becomes a stacked card (label: value), using today's `ResponsiveTable`;
  - each table below states its default order.

### 4.1 Projects list (`/projects`)

Mockup: `Projects list (file was named People tab).png`.

**Header:**
- the title "Projects" and the subtitle "Keep delivery, budget and risk in view.";
- **Export:** today's CSV, plus a Risk column;
- **New project:** admins (`project.create`);
- **Request a project:** managers (`request.submit`), as today.

The mockup's "Sample data" tag isn't built.

**KPI strip:** "N projects", "N active" and "N at risk". The last has a warning icon and the warning colour when above 0. Clicking it turns on At risk only. The numbers come from `counts` (§7.1).

**Filter bar**, kept in the URL as today:
- "Search projects…" (`q`);
- a status select: "All statuses", Planned, Active, On hold, Completed;
- "All managers": admins and executives only (`projects.filterByManager`), as today (§10.2);
- **At risk only** (`at_risk=true`);
- **Archived:** admins and executives, as today;
- a removable **Department: <name>** chip when the URL has `?department=` (the Departments page links here).

**Table** (25 per page; sorted on the server, §7.1; default: name ascending):

| Column | Shows | Source | Sort key |
|---|---|---|---|
| Project | the name (a link), with the department under it | `name`, `department.name` | `name` |
| Status | a status chip, plus an "Archived" chip when archived | `status`, `is_archived` | `status` |
| Manager | avatar and name | `manager` | `manager` |
| Progress | a bar and percent | `progress_pct` | `progress` |
| Budget used | a bar and percent; the bar is warning-coloured from 80% and error-coloured from 100% (today's `budgetTone`) | `budget_pct` | `budget_used` |
| Due date | the date. Under it: "N days left", "Due today", or, when not completed, "N days overdue" in the error colour. Nothing extra for a completed project | `predicted_end_date`, `status` | `due` |
| Risk | an icon and the first at-risk reason in words ("Past due", "Budget ahead of progress", "Overdue milestone"); otherwise "—", named "No risk" | `at_risk_reasons` | `risk` (sort key) |

- **Risk tooltips:**
  - Past due: "Ended Oct 12, 2026, 3 days ago, and isn't completed."
  - Budget ahead: "81% of the budget used against 62% progress: 19 points ahead."
- **The row** opens the project. The name is the real link inside it.
- **Footer:**
  - ⓘ "Progress is milestone completion weighted by difficulty. Budget used is approved spend against the budget. The due date is the project's planned end."
  - on the right, "Today is <date>".
  - The mockup's "Predicted end date is based on current velocity" isn't true of the data, so it's dropped.
- **Employees** get the same table. Progress and budget percent already reach them. They don't get New project, Request a project or the manager filter.
- **States:**
  - loading: skeleton rows;
  - error: `ErrorAlert` with Retry;
  - no match: "No projects match" with Clear filters;
  - no projects at all: today's empty state for the role.
- **Phones:** the KPI strip stays 3 compact columns and the filters stack. Each project becomes a card: name and department, status chip, risk line, the progress and budget bars with their percents, and the due line.

### 4.2 The project frame (`/projects/:id`)

Mockups: every `Project(s) - *.png`.

**Header** (D6):
- **Crumbs** in the top bar: Projects / <name>.
- **H1** the name, then chips:
  - the status;
  - "Archived" when archived;
  - **health**, for planned, active and on-hold projects: "On track" (success, check icon) when `at_risk_reasons` is empty, otherwise the first reason in words (§7.1) in the warning colour. Completed projects get no health chip.
- **Description:** up to 3 lines, then "More".
- **Meta line:** the manager's avatar and name (a profile link when `canViewProfile` allows), "·" the department, "·" the dates ("Jul 15 – Dec 27, 2026").
- **Delegate line** when a delegate is set: today's `DelegateLine` text, small, under the meta line.
- **Actions:**
  - **Edit project:** outlined, with a pencil. For `project.manage`, on a project that isn't archived. It opens today's `ProjectForm`.
  - **"⋯":** admins only. It holds Archive project or Restore project, inside `DemoLock`.

**Tabs:**
- Plan (as today: only while planning or after a finalized plan), Overview, Milestones, Team, Budget, Hours.
- The URL keeps `?tab=` with today's values. The default is Plan while planning, otherwise Overview (today's `projectTabs`).
- Old links (`?tab=milestones&milestone=<id>` from the bell and the palette) keep working.
- Every role gets every tab; what's inside differs (4.8).

### 4.3 Overview

Mockup: `Project - Overview.png`.

**KPI strip** (full width):

| Tile | Value | Under it | Source |
|---|---|---|---|
| Progress | "53.8%" and a bar | "Weighted milestone completion" | `progress_pct` |
| Approved spend | "$21,745 / $250,000" and a bar | "8.7% of budget used" | summary `consumed`, `budget`, `budget_pct` |
| Forecast at finish | "$61,293" | "Based on last 4 weeks"; "⚠ Over budget" when above the budget | summary `forecast` |
| Delivery | "Dec 27, 2026" | "73 days remaining", "N days overdue" or "Completed <date>" | `predicted_end_date`, `completed_at` |

Below the strip are two columns (about 2/3 and 1/3).

**Left column:**
- **"Milestone schedule":**
  - "N of M milestones complete" and "View milestones →", which opens the Milestones tab in Timeline view;
  - the shipped `Timeline` (Part C) in a compact form: names with their state, the month axis and the Today line;
  - clicking a row opens that milestone's panel on the Milestones tab.
- **"Next milestones":** the next 3 milestones that aren't completed, by start date. Columns: Milestone (state dot and name), Dates, Owner (the first primary assignee, or "Unassigned"). A row opens its panel. The card is hidden when nothing is left.

**Right column, manager variant:**
- **"Needs attention"** (warning card). It's hidden when it would be empty. Rows, in this order:
  - for people who can decide hours: "N pending entries", "Nh awaiting approval" and the button **Review hours** (`/timesheets?project=<id>`). Source: `GET /approvals?project=<id>`;
  - the project's risk, in words;
  - "N overdue milestones" and "N kicked back" (from `at_risk_reasons` and the milestone list).
- **"Team this week"** (`project.manage` only, like today's Hours tab):
  - "Week of Oct 12, 2026";
  - columns Name, Planned, Logged, with a "+Nh" warning chip when logged is above planned;
  - source: `GET /allocations?week=`, filtered to this project, as `HoursTab` does today.
- **"Project details":**
  - Budget available: the remaining money "of $250,000", in the error colour as "over budget" when negative;
  - Estimated effort: "1,272h", "over 166 days · 40% used" (today's `projectEffort`);
  - Team: "5 people" (`member_count`);
  - the work-mode line (today's "Push mode: …" or "Pull mode: …").

**Right column, employee variant:**
- **"Needs attention":** only the risk and milestone rows.
- **"Your part"**, in place of the pending entries and Team this week:
  - "Your milestones: 2 of 7" (assigned as primary or support, not archived), with your next one's name and due date linking to its panel;
  - "Your hours: 38h logged · 34h approved" on this project, from your profile's `projects[]` (`logged_hours`, `approved_hours`);
  - "This week: 6h of 10h planned": your hours this week from `GET /time-entries?week=`, filtered to this project, against your `planned_hours_per_week` from the member list;
  - **Open my timesheet.**
  - Someone not on the team reads "You aren't on this project's team."
- **"Project details":** as for managers.

**Executives:** the manager layout, read-only. There are no pending entries (they can't read `/approvals`), no Team this week (team hours stay private, as today), and no Edit.

**States:**
- skeleton tiles while loading;
- a summary error shows `ErrorAlert` with Retry in the strip, and the rest still renders from the project's own fields;
- a project being planned shows "This project is being planned. Open the Plan tab." in place of the schedule.

### 4.4 Milestones

Mockups: `Projects - Milestones.png` (List), `Projects - Milestones2.png` (Timeline), `Projects - Milestone3.png` (side panel).

**Summary card:**
- "N of M milestones complete" and the shipped `MilestoneStatusBar` (Part C).
- **On the right, manager variant:** "8 pending entries · 62h" in the warning colour with a clock icon, linking to `/timesheets?project=<id>`. It's hidden at 0.
- **On the right, employee variant:** "Your part: 2 of 7 milestones · 38h logged".

**Toolbar:**
- "Search milestones…" (name and description);
- **Status:** All, Not started, In progress, Ready for review, Completed, Waiting, Blocked (by `display_status`);
- **List | Timeline** toggle: `?view=timeline`; List by default; remembered in `overwatch.milestones.view`;
- **Add milestone** (primary): `milestone.manage`, on a project that isn't archived. It opens today's `MilestoneDialog`.

**List** (default order: the API's dependency order):

| Column | Shows | Source |
|---|---|---|
| # | position in dependency order | the index in `GET /projects/{id}/milestones` |
| Milestone | the name; under it "Dependency: None" or "Dependency: after A, B"; a "You" tag when you're on it | `name`, `predecessors`, `is_assignee` |
| Status | the state chip (icon and word; striped for waiting), plus "Kicked back" when one is open | `display_status`, `open_kickback` |
| Assignees | up to 3 avatars, "+N" and first names; support is marked in the tooltip; "Unassigned" when nobody | `assignees`, `supporting_ids` |
| Planned dates | "Aug 15, 2026 – Oct 23, 2026"; an end date that's passed on an unfinished milestone shows in the error colour with "Overdue" | `start_date`, `end_date`, `status` |
| Effort (logged / estimate) ⓘ | "118h / 264h"; "114h estimate" when nothing is logged; "Nh logged" without an estimate; "+0.5h over estimate" in the warning colour | `logged_hours`, `estimated_hours` |
| Approvals (manager variant) | "N pending" (warning, clock icon) or "—" | `GET /approvals?project=<id>`, counted per milestone |
| Your hours (employee variant) | your logged hours on it, or "—" | your profile's `milestones[].logged_hours` |
| More | a chevron that opens the panel, and "⋯" for managers | — |

- **Effort's ⓘ:** "Logged counts pending and approved hours of everyone on the milestone." Employees already see this total today.
- **Sorting:**
  - Milestone: by name;
  - Status: in Part C's order (Completed, Ready for review, In progress, Not started, Waiting, Blocked);
  - Planned dates: by start date.
- **A row** opens the panel, by click or by Enter on the focused row.
- **"⋯"** (`milestone.manage`): Edit details, Assign people, Dependencies, the status moves `statusActions` allows (e.g. "Mark completed", "Send back"), Open discussion, Archive milestone. Each opens today's dialog.
- **Footer:**
  - "7 milestones · Select a row to view details, discussion and history.";
  - on the right, ⓘ "Effort shows logged / estimated hours. Status does not imply hours are approved."

**Timeline view:**
- The shipped `Timeline` under the toolbar.
- Heading: "Planned schedule", then "Jul 15 – Dec 27, 2026 · Bars show planned dates, colours show current status."
- **From `lg` up**, the name column also shows the status chip and a Dependency column ("After Discovery"), as drawn. Below `lg` they stay in the tooltip, as today.
- The legend is as shipped. Footer: ⓘ "Select a milestone to inspect dependencies, approvals and history."
- Clicking a row or bar opens the panel (`onOpen`). Search and the status filter apply here too.

**Side panel:**
- **Opening a milestone:**
  - On desktop the list narrows to #, Milestone and Status (with its pending chip), and the panel opens on the right.
  - `?milestone=<id>` opens it on load (today's deep link).
- **Panel header:**
  - the name (H2) and its state chip;
  - Edit (managers), "⋯" (the same menu) and Close;
  - under them: the description, then three facts: a calendar icon with "Aug 15, 2026 – Oct 23, 2026 · After Discovery", a people icon with the assignees, and a clock icon with "118h logged / 264h estimated" (plus "· You: 24h" for an assignee).

**Panel tabs** (`?panel=`; Details by default):

| Tab | Content | Endpoints | Who |
|---|---|---|---|
| Details | objective, completion criteria, required skills, priority, difficulty, dependencies with their states, assignees (support marked), the open kickback, and the viewer's actions: status moves (`statusActions`), Claim (pull projects), Kick back, Resolve kickback, Start timer (when loggable today) | `GET /milestones/{id}` and the list item | everyone who can see it; actions by today's rules |
| Approvals (count) | pending entries by person and week (below) | `GET /approvals?milestone=<id>` | `approvals.view` (managers, admins, delegates); "Nothing waiting" at 0 |
| Discussion | the milestone's thread and a compose box | `GET`/`POST /milestones/{id}/discussion`, `/conversations/{id}/messages` | participants. On a `404`, a manager or admin sees **Start a discussion**; anyone else reads "No discussion yet. Your manager can start one." |
| Work log | progress updates, newest first; **Post an update** (text, optional percent) | `GET`/`POST /milestones/{id}/updates` | read: everyone; post: assignees, the manager and admins |
| History | kickbacks and events | `GET /milestones/{id}/history` | everyone who can see it |
| Notes | append-only notes; **Add a note** | `GET`/`POST /milestones/{id}/notes` | read: everyone; post: the manager or an assignee |

**Approvals tab:**
- **Heading:** "7 entries · 58h awaiting approval", then a warning line: "Milestone completion does not approve time entries."
- **Groups:** one collapsible group per person and week, oldest week first.
  - Header: "Gia Rossi · Week of Oct 5, 2026 · 4 entries · 34h", with a select-all checkbox.
  - Delegated groups add "Delegated from <manager>".
- **Columns:**
  - a checkbox;
  - Date and Hours;
  - **Source:** a Manual, Tracked or Mixed chip, with a tooltip such as "6h of 8h from a timer" (§7.2);
  - **Work note:** the note, or the day's progress update after "Update:";
  - **Flags:** short chips whose tooltip is the flag's message.
- **Flag labels:**

  | Code | Label |
  |---|---|
  | `SAME_HOURS_DAILY` | Repeated hours |
  | `LONG_DAY` | Long day |
  | `CLOSED_MILESTONE` | After completion |
  | `BACKDATED` | Backdated |
  | `OVER_PLAN` | Over plan |
  | `NO_ACTIVITY` | No activity |
  | `NO_PROOF` | No proof of work |

  `warn` flags use the warning colour, `info` ones neutral.
- **Sticky footer:**
  - "Select entries to review", or "N selected · Nh";
  - **View budget impact:**
    - one entry selected: today's `BreakdownPanel` for it;
    - several: each entry's `request_cost` and the total, from `GET /time-entries/{id}/breakdown`, up to 20 at a time;
  - **Request changes** (outlined): asks for one reason (today's reject rules), then calls `POST /time-entries/{id}/reject` for each selected entry;
  - **Approve Nh** (contained): one `POST /approvals/approve-week` per person-week in the selection, each with that week's selected entries and their `expected_hours`.
  - The buttons stay disabled until something is selected.
- **Results:**
  - A toast, e.g. "Approved 34h for Gia Rossi".
  - A stale or already-decided entry (`409`/`400`) shows the server's message in the panel and refreshes the list. Other person-weeks' results stand.
  - The demo admin may approve (the allowed list), so nothing here is demo-disabled.
- The server never lists your own entries, so you can't select them.

**Employee variant of the panel:**
- tabs Details, Discussion, Work log, History and Notes, with no Approvals;
- no Edit and no "⋯";
- their own actions are in Details.

**States:**
- skeleton rows while loading;
- a project without milestones: "No milestones yet", with Add milestone for managers, or "Your manager hasn't planned any milestones yet." for others;
- no filter match: "No milestones match" with Clear;
- a panel whose milestone vanished (archived meanwhile, `404`) closes, with the toast "That milestone is no longer available."

### 4.5 Team

Mockup: `Projects - Team.png`.

- **Summary card:** a people icon, "5 team members", "On this project · 115h planned per week" (the sum of `planned_hours_per_week`), and **Add member** for managers (today's dialog with the 40 h check).
- **Search:** "Search team members…" (name, job title, skill).

**Table** (by last name, as today):

| Column | Shows | Source |
|---|---|---|
| Person | avatar, name (a profile link when allowed), job title | `GET /projects/{id}/members` `user` |
| Skills | skill chips | `user.skills` |
| Planned / week | "30h" | `planned_hours_per_week` |
| Actions | **Message** (today's `MessageButton`) when the person is in your contacts and isn't you; "⋯" for managers: Edit planned hours, Remove from project | `/messages/contacts` |

- **Remove from project** (error colour) confirms first: "Remove <name> from <project>? They're also taken off its milestones."
- **Footer:** ⓘ "Planned hours are project allocations, not hours already worked." On the right, "As of <date>".
- **Employees:** the same table, read-only, with a "You" tag on their row and Message as their contacts allow. No Add member and no "⋯".
- **Executives:** read-only, with Message.
- **Empty:** "Nobody on this project yet", with Add member for managers.

### 4.6 Budget

Mockup: `Projects - Budget.png`.

- **KPI strip:**
  - Budget;
  - Approved spend;
  - Available budget: in the error colour, reading "over budget", when negative;
  - Forecast at completion: in the warning colour when above the budget.
  - Source: `GET /projects/{id}/summary`.
- **"Spend and forecast":**
  - subtitle "8.7% approved spend · 24.5% forecast";
  - a legend: Approved spend (the bar) and Forecast at completion (the marker);
  - today's `BulletChart` (the budget as track, approved spend as bar, the forecast as marker; a compact-money axis);
  - **Print / PDF** (today's `PrintButton`);
  - a banner for people who can decide hours: "62h awaiting approval · Not yet included in spend." with **Review pending hours →** (`/timesheets?project=<id>`);
  - the caption "Forecast projects the last 4 weeks of approved spending to the project end date."
- **"Cost by milestone"**, with **Export CSV**:
  - columns Milestone, Approved hours, Pending hours, Approved cost, Share of project budget, and a Total row;
  - Part C's bars sit in the Approved cost cell, scaled to the most expensive milestone (D11), with the caption "Bars compare the milestones; the percent is each one's share of the budget.";
  - footer: "Displayed costs are rounded; totals use underlying values. Approved spend uses the rate saved at approval. Pending entries remain uncosted until approved." On the right, "As of <date>".
  - Source: `GET /projects/{id}/milestone-costs`.
- **Employees:**
  - The same dollars as today: the summary and the cost per milestone already reach them.
  - The two hours columns are hidden; the API sends `null` when `hours_visible` is false.
  - The pending-hours banner is hidden.
- **Executives:** as managers, without the banner.
- **Never** shows a rate (the API never sends one here).

### 4.7 Hours

Mockup: `Projects - Hours.png`.

**Week bar:**
- ‹, "Oct 12 – 18, 2026" with a calendar icon that opens a date picker, ›, and a "This week" link;
- on the right, "Project hours · This week" (or "· Week of Oct 5"), with "As of <date>" under it;
- the week is in the URL (`?week=YYYY-MM-DD`).

**Manager variant** (`project.manage`, as today):
- **KPI strip:** Planned, Logged (ⓘ "Logged means pending + approved. Rejected hours excluded."), Approved, and Pending (warning colour above 0).
- **Table:**
  - Person: avatar, name and job title. When logged is above planned, "Nh above project plan" shows under it in the warning colour, and the row is tinted;
  - Planned / week, Logged, Approved;
  - Pending (warning colour above 0);
  - Review: **View entries** (`/timesheets?project=<id>&user=<uid>`) when the person has pending hours, otherwise "—";
  - a Total row.
- **Banner** when anything is pending: "28h awaiting approval this week · Pending hours do not contribute to approved project spend.", with **Review this week's entries →**.
- **Footer:** ⓘ "Planned hours are weekly allocations. This is not a measure of productivity."
- **Source:** `GET /allocations?week=` (today's), and the member list for job titles.

**Employee variant, "Your hours":**
- **KPI strip:** your Planned (`planned_hours_per_week`), Logged, Approved and Pending on this project.
- **Table:** one row per milestone you logged on that week, with Logged, Approved, Pending and Needs revision, plus **Open my timesheet** (`/timesheet?week=`).
- **Source:** `GET /time-entries?week=` (your own, filtered to this project) and the member list.

**Executives:** today's message stays: "Team hours are private. Only the project's manager and admins see everyone's hours."

**Empty:** "No hours this week", "Hours appear as the team logs them."

### 4.8 Who sees what on a project

| | Manager of it, admin | Delegate approver | Executive | Employee on it |
|---|---|---|---|---|
| Edit project, Add milestone, "⋯" menus, Add member | ✓ | — | — | — |
| Pending entries: Needs attention, Approvals column and tab, banners | ✓ | ✓ (the entries the server gives them) | — | — |
| Team this week; the team Hours table | ✓ | — | — | — |
| Budget, approved spend, forecast, cost per milestone | ✓ | ✓ | ✓ | ✓ (as today) |
| Hours per milestone on the Budget tab | ✓ | — | ✓ | — |
| Your part; Your hours | — | — | — | ✓ |

### 4.9 Structure

- **Rewritten:** `features/projects/ProjectsPage.jsx`, `OverviewTab.jsx`, `TeamTab.jsx`, `BudgetTab.jsx` and `HoursTab.jsx`.
- **New in `features/projects/`:** `ProjectHeader.jsx`.
- **New in `features/milestones/`:** `MilestonesTab.jsx` (summary, toolbar, List and Timeline), `MilestoneList.jsx`, `MilestonePanel.jsx`, `panel/DetailsTab.jsx` and `panel/ApprovalsTab.jsx`.
- **Reused:** `WorkLog`, `MilestoneNotes`, `MilestoneHistory`, `KickbackPanel`, `MilestoneDialog`, `KickbackDialog`, `Timeline`, `MilestoneStatusBar` and `MilestoneCostTable`.
- **New shared:** `components/SidePanel.jsx`, `KpiStrip.jsx`, `FilterBar.jsx` and `DataTable.jsx`.
- **Retired** once nothing uses them: `MilestonesWithHours.jsx`, and the card body of today's `MilestonesTab.jsx`.

## 5. Phase 3: employee screens

### 5.1 My week (`/` for employees)

Mockup: `My Week (Employee).png`. It merges the now-and-next spec, whose rules all hold.

**Header:**
- "My week", "Hello, Eli. Your work and hours in one place.";
- on the right, the week picker: ‹, "Oct 12 – 18, 2026", ›, and **This week**. It's named "Week shown in This week's hours" and changes only that card (§7.5). It offers no week after the current one.

Today's `TimerLimitBanner` (unsubmitted timer hours) stays above the columns.

**Left column** (about 2/3). Every section collapses, is expanded by default, and remembers its state in `overwatch.myweek.sections` (the now-and-next keys). Empty groups are hidden. In this order:

1. **"Your focus" is the Now & Next card:**
   - **Subtitle:** counts, e.g. "1 overdue · 1 with your manager".
   - **Now:** a highlighted inner card, with a red left edge when overdue. It shows:
     - the milestone name and project link;
     - "Due Oct 5, 2026 · 10 days overdue" in the error colour, or "Due <date>";
     - "Critical priority" or "High priority" with a flag icon;
     - the difficulty ("Hard difficulty"), the percent done when known, and the state chip;
     - buttons **View milestone** (its project panel), **Discuss** (only when `GET /milestones/{id}/discussion` returns one), and **Start timer** (when loggable today).
     - The fallbacks are the spec's: "Nothing in progress" and "Start <name> next".
   - **Next:** the first Up next item, with "Ready to start", "Starts <date>" or "Waiting on <names>". The fallbacks are "Nothing else assigned yet" and "See what might come your way".
   - **Heads-up:** a third row, under the now-and-next spec's rule.
2. **"In progress (N)":** the spec's group.
3. **"Upcoming (N)"** is the spec's Up next. Rows show:
   - the name and project link;
   - a calendar icon with "Due <date>";
   - the state chip and the Up next label;
   - a chevron.
4. **"With your manager (N)":** ready-for-review rows, each with "Submitted for review. Your manager completes the milestone."
5. **"Might come your way (N)":** the spec's `coming_up` rows, its intro line and its "Prediction" chip.
6. **"Completed · N":**
   - a green check, the name, the project link, "Planned due <date>" and a chevron;
   - newest end date first;
   - expanded by default, like every section (§10.3).
7. **"Available to claim · N":** today's claim section under the mockup's name, still stored as the `claim` key. Empty: "No unassigned milestones available right now."

A row's chevron opens the milestone's panel on its project (`/projects/<pid>?tab=milestones&milestone=<id>`).

**Right column** (about 1/3):
1. **"This week's hours"**, titled "Hours · week of Oct 5" for an earlier week:
   - "Pending + approved";
   - **"19.75h logged"** "/ 40h weekly reference";
   - the shipped `WeekMeter`: the bar, a "30h planned" marker and the 0h–40h scale, in the alert colour past 40;
   - Planned and Logged as two figures;
   - **Open my timesheet** (primary, full width), to `/timesheet?week=<shown week>`;
   - the caption "Logged hours include pending and approved entries.";
   - past 40: "5h over 40h (sent to your manager as overtime)".
2. **"Your manager":** today's `YourManagerCard`: avatar, name, "Delivery Manager · Technology", and **Message Morgan**.

**Data:**
- `GET /users/{me}/profile`: `milestones`, `coming_up`, `user.manager` and `this_week`;
- `GET /users/{me}/profile?week=&sections=this_week` for another week;
- the claimable milestones as today.

**Phones** stack in this order: Your focus, This week's hours, the groups, Available to claim, Your manager.

**States:**
- a skeleton per card while loading;
- `ErrorAlert` with Retry on an error;
- nothing assigned and nothing coming: today's empty state inside Your focus.

### 5.2 My timesheet (`/timesheet`)

Mockup: `My Timesheet.png`, with Part A and the Month spec.

**Header:**
- "My timesheet", "Review your week. Submit with confidence.";
- today's **Submit N changes**, disabled while nothing has changed or an error stands. It replaces the mockup's "Review & resubmit".
- There's no "Saved…" text and no autosave (D9).

**Totals card:**
- **"19.75 h counted of 40 h"**, a bar and "49%". `data-testid="week-total"` stays.
- Three dots: "15.75 h Approved", "4 h Pending", "8 h Needs revision".
- ⓘ "Rejected hours are excluded from counted totals."
- Today's over-40 warning stays.
- **Source:** the week's `totals` (logged and approved) and its rejected entries' hours.

**Week card:**
- ‹, "Oct 12 – 18, 2026", ›, **This week**, and the **Day | Week | Month** toggle (today's, remembered).
- **Week view (the mockup):**
  - a Milestone column; Mon to Sun with their dates; today's column highlighted and marked "Today"; weekends dimmed; and a Counted column;
  - a project row (folder icon and name), then that project's milestone rows with their inputs;
  - under each saved cell, a status line: a dot and "Approved", "Pending" or "Needs revision", plus "Overtime" when `over_40`;
  - cells with timer hours show today's lock (`LockedCell`); closed rows are greyed out, as today;
  - a "Daily total (counted)" row and the legend (Approved, Pending, Needs revision).
- **Day view:** as shipped, using the same status words.
- **Month view:** the owner's hours-first Month view (mockup `My timesheet - Month (v2).png`). It is specified in the calendar spec's Revision 2 and built before this phase. The owner's notes on it:
  - remove the repeated milestone ribbons;
  - make daily totals and approval states easier to scan (one chip per line with an icon and a status word: Approved, Pending, Needs revision, Not submitted);
  - keep rejected hours visible but excluded from totals;
  - put locked-entry actions in a side panel (selected-day panel: each entry's project, hours, timer-linked, source and status; **Request a change** for timer-locked hours, **Edit in Day view** for typed hours);
  - show milestone deadlines as small date markers ("📅 2 milestone deadlines"), listed in the panel under "Milestone dates";
  - colours mean approval status only. Milestone state stays on the project timeline.
- **Under the card,** when any hours were rejected: "27.75 h entered · 8 h excluded until resubmitted."

**Entry details panel** (`SidePanel`, `?entry=<milestone>:<date>`):
- It opens from a saved cell's status line (a button named e.g. "Details for Schema Mapping, Wed Oct 14") or from a Day view row's **Details**.
- **Content:**
  - the date, the milestone and the status chip;
  - Hours;
  - Work note (10–500 characters, with a counter);
  - **Manager feedback:** the rejection reason, error-tinted, only for a rejected entry;
  - Source: Manual, Tracked or Mixed, with "Nh from a timer" (read-only);
  - locked timer hours offer **Request a change** (today's flow).
- **Button:**
  - a rejected entry: **Save & resubmit**. It sends this cell alone in one `PUT /time-entries`. Unchanged values resubmit it, as today.
  - any other entry: **Done**. The edits join the week's unsaved changes, which Submit sends.
- Editing approved hours warns: "Changing approved hours sends them back for approval."

**Unsaved typing** (D9):
- It's kept in `sessionStorage` under `overwatch.timesheet.unsaved.<userId>.<week>`, wrapped in try/catch.
- Reloading the tab restores it, with the notice "Unsaved changes restored. Submit to send them."
- Submit and sign-out clear it. Nothing is sent without Submit.

**Phones:**
- the totals stack;
- the Week grid scrolls inside its own card with the Milestone column fixed, so the page itself never scrolls sideways;
- the panel is full screen.

### 5.3 My history (`/people/:me/profile`)

Mockup: `My History.png`.

**Header:**
- "My history", "Your work record, including completed milestones.";
- **Open my timesheet**, on your own profile when you keep a timesheet.

**Left column (profile card):**
- a 64 px avatar, the name, the job title, and "Employee · Technology" (role · department);
- **Skills:** today's `SkillsCard`, editable for anyone with `can_edit_skills`;
- **Your manager:** avatar, name, "Delivery Manager · Technology", **Message <first name>**;
- **Employment details:**
  - a lock icon, collapsed by default, with the line "Annual salary and other employment details";
  - it shows the salary when the profile carries one (the person themselves and admins); it's hidden for anyone else.

**Right column:**
- **"Week of Oct 12, 2026":**
  - Logged this week, "Pending and approved";
  - Planned this week;
  - Overtime this week, "Above 40h".
  - Source: `this_week`.
- **"All time summary":** Total hours logged and Total hours approved, each "All time". Source: `all_time`.
- **Tabs "Projects N" and "Milestones N":**
  - **Milestones:** "Search milestones…" and "All projects". Columns: Milestone; Project (a link when `can_open`); Status; Planned dates; Hours logged; Hours approved.
  - **Projects:** Project (a link when `can_open`); Status; Planned / week ("Left the team" when `on_team` is false); Hours logged; Hours approved.
- **Footer:** a lock icon and "Read-only history. Edit eligible hours in My timesheet."

**Archived work (D8):**
- **Employees:** none. The server leaves it out, so there's no "Include archived" and no "Archived" chip.
- **Admins and executives viewing anyone, and managers viewing their own profile:** an **Include archived** checkbox (off by default) appears when the data holds archived items. Their rows carry today's "Archived", "Project archived" and "Project completed" chips.

**Phones:** the profile card comes first; the tables become stacked rows.

## 6. Phase 4: manager and admin screens

### 6.1 Timesheets (`/timesheets`)

Mockup: `Timesheet - Approval (Manager).png`.

**Header:**
- "Timesheets", with the subtitle "Review submitted hours before they reach the budget." for managers and admins; executives keep "Pay periods admins have submitted to HR.";
- on the right, the Live now line ("No running timers" / "2 timers running"), which opens today's `LiveTimersCard` in a side panel.

**Tabs** (`?tab=` as today):
- "To review N" (managers and admins);
- "Change requests N" (managers and admins): today's `ChangeRequests` list, moved into a tab;
- "Approved";
- "HR submission" (admins) or "HR submissions" (executives).

Alert links still filter with `?user=&project=&milestone=`; each filter shows as a removable chip.

**To review:**
- **Summary bar:**
  - "9 entries · 4 person-weeks · 63h awaiting approval";
  - "All projects": the projects in the queue;
  - **Only flagged:** keeps whole person-weeks that have a flag;
  - **Export CSV:** today's columns.
- **Left list, "Submitted weeks":**
  - sorted "Oldest first" or "Newest first" (by week, then name);
  - each person-week is a card: avatar, name, the week range, "4 entries · 34h", the source ("Manual", "Tracked" or "Mixed", §7.2), and a warning chip "4 entries flagged" when flagged;
  - "Delegated from <name>" and "Changed after HR submission" chips when they apply;
  - the selected card is highlighted and kept in `?pw=<userId>:<week start>`. The first card is selected by default on desktop.
- **Right, the selected person-week** (a full-screen sheet on phones):
  - avatar, name, "Week of Oct 5 – 11, 2026", and "Apollo Data Migration / Build: frontend" (or "3 milestones on 2 projects");
  - **KPIs:** Submitted (hours), Tracked (% of hours from timers) and Manual (the rest);
  - **Flag banner** when flagged: "Review flags before approving: 4 entries exceed the project plan and repeat the same daily hours." and, under it, "Flags are review prompts, not proof of wrongdoing.";
  - **Entries table:**
    - columns: a checkbox; Date (sortable); Hours; Work note (quoted, or "Update: …"); Source; Review flags (e.g. "Over plan · Repeated hours"); and an expand chevron;
    - a Milestone column appears when the week spans more than one milestone;
    - **Expanded, "Entry details":** the full note, the day's progress update, the overtime label, any "Changed after HR submission" note, and **View work log** (the milestone's panel, Work log tab).
  - **"Budget impact":** "These entries may impact the project budget." with **View breakdown** (today's `BreakdownPanel`, per project when there are several).
  - **Footer:**
    - ⓘ "You can select individual entries using the checkboxes for partial decisions.";
    - **Request changes** (outlined), captioned "Requires a reason": it rejects the selected entries, or all of them when none are selected, after a reason dialog;
    - **Approve 34h** (contained), captioned "Approves all 4 entries in this selected person-week" or "Approves 2 selected entries": `POST /approvals/approve-week` with those entries.
  - After a decision the list refreshes, the next person-week is selected, and a toast confirms.
- **Empty:** "Nothing waiting for approval", "New hours from your team show up here." With Only flagged on: "No red flags".

**Approved and HR tabs:** content unchanged; shell styling only. For the demo admin, HR submit stays disabled through `DemoLock`, as today.

### 6.2 Dashboard (`/` for managers and executives)

Mockup: `Dashboard.png`.

**Header:**
- "Hello, Morgan", "Here's what needs your attention today.";
- executives get the title "Organisation dashboard" and a "Read-only view" chip;
- top right, the Live now line, e.g. "No running timers · Updated just now", opening the Live now panel;
- **All departments** (today's `?department=`);
- **Export report**, a menu: Print / PDF, Email this report (both today's).

**Health banner** (full width):
- Nothing to report (success style): "All visible projects on track". Otherwise (warning style): "N projects need attention".
- Then the counts: "0 overdue milestones · 0 past-due projects · 0 budget alerts", and **View health details →** (`/projects?at_risk=true`).
- **Sources:** `dashboard.milestones.overdue`; projects whose `at_risk_reasons` include `PAST_DUE`; and those that include `BUDGET_BURN` (§7.1).

**Cards** (desktop: about 2/3 and 1/3):
- **"Needs your attention"** (managers):
  - "8 time entries awaiting approval" as the headline;
  - the backlog line from `/insights/smart` (`approval_backlog`), shown as "5 have waited more than 3 days · oldest 15 days";
  - **Review approvals →** (`/timesheets`);
  - then up to 5 rows:
    - missing timesheets from `/timesheet-reminders`: "Chloe Park missing last week's timesheet · Week of Oct 5" with **View timesheets →** (`/allocation?week=`);
    - people insights from `/insights/smart`: rejections ("Eli Employee · 2 rejected entries in the last 30 days" with **View profile →**), over-allocation and rebalancing.
  - Empty: "Nothing needs you right now."
  - Executives get the insight rows only.
- **"Team this week"** (Q3, Q5):
  - Name, Planned and Logged for the 5 people with the most logged hours (`/allocations`);
  - a line for the largest overrun: "Gia: 14h above weekly plan";
  - "No one above 40 logged hours", or "N people above 40 logged hours" (`over_allocated`);
  - **View allocation →**.
- **"Projects"** (Q1, Q4):
  - tabs Active N, Planned N, Completed N and On hold N (`status_counts`);
  - a table: Project, Status, Progress, Budget used, Due, chevron;
  - under it, the deliverables: overdue milestones and those due in the next 14 days (name, project, due). With none: "No milestones due in the next 14 days · View timelines for the full schedule." and **View project timelines →**.
- **"Recent activity":**
  - the 3 newest items from `/activity?limit=3`: avatar, the sentence with its links, the project, and the relative time;
  - **View all activity →**: admins and executives go to `/audit`. Managers can't open the Audit log, so for them it opens a side panel with 20 items from `/activity`.
- **"Budget outlook"** (Q7):
  - a legend: Approved spend, Forecast at completion;
  - per project: Project (a link), Budget, a bar with the forecast marker, Approved, and "Forecast at completion (pct)";
  - the caption "Forecast at completion uses the last 4 weeks of approved spending.";
  - source: `dashboard.budgets`.
- **"Project timelines"** (Q6): the visible active projects, each with **Timeline →** (`/projects/<id>?tab=milestones&view=timeline`).
- **Executives** also get "Portfolio status" (today's `ProjectStatusCard`) at the top of the right column.

**Phones**, one column: the banner, Needs your attention, Projects, Team this week, Budget outlook, Recent activity, Project timelines.

### 6.3 Control centre (`/` for admins)

Mockup: `Control Centre.png`.

**Header:**
- "Control centre", "Thursday, October 15, 2026 · Organisation overview";
- the Live now line, **All departments** and **Export report**, as on the Dashboard.

**KPI strip** (each tile is a link):

| Tile | Value | Source | Goes to |
|---|---|---|---|
| Active projects | count | `status_counts.active` | `/projects?status=active` |
| Project at risk | count | projects with any `at_risk_reasons` | `/projects?at_risk=true` |
| Pending entries | count | `dashboard.pending_approvals` | `/timesheets` |
| Missing timesheets | count, "Week of Oct 5" | `/timesheet-reminders` (§7.4) | `/allocation?week=` |

**"Needs your attention"** ("Items that need your decision or action."). Each row has an icon, a linked title, a detail line and a button:
- per past-due project: "Atlas Customer Portal is past due", "Ended Oct 9, 2026; 1 of 4 milestones complete." **Open project**;
- "9 time entries need review" with the backlog line. **Review approvals**;
- "2 missing timesheets", "Chloe Park and Finn Walsh · Week of Oct 5, 2026." **View timesheets**;
- "N overdue milestones" with the first names (Q4). **View projects**;
- "N project requests waiting". **Review requests**;
- empty: "Nothing needs you right now."

**"Portfolio status":** a stacked bar and a legend with counts (Planned, Active, On hold, Completed), then Archived, from `/projects/status-counts`.

**"Projects"** ("Key projects and delivery status."):
- up to 6 active and on-hold projects, risky ones first, then by due date;
- columns: Project, with a risk icon and its label beside the name, and a **Timeline** icon link (Q6); Status (the real status chip); Progress; Budget used; Due (with an "Overdue" chip);
- **View all projects →**.

**"Team capacity"** ("Logged hours this week."):
- a success line "No one is above 40 logged hours this week.", or the warning "N people above 40 logged hours";
- the 5 people with the most logged hours;
- **View allocation →**.

**"Budget outlook"** ("Approved spend and forecast at completion."): per project, a linked name, a bar with the forecast marker, "$28,896 approved / $28,896 forecast" and "$40,000 budget".

**"Recent activity":** 3 items and **View activity →** (`/audit`).

**Bottom strip:** today's `ControlCentre` tiles, restyled: People ("Active accounts"), Departments, Open requests ("Waiting for a decision") and Archive ("Restorable items"), each linking to its page.

The separate "Organisation dashboard" under today's control centre is removed. The cards above answer Q1–Q7. For the demo admin, nothing here is blocked.

### 6.4 People (`/people`)

Mockup: `People.png`.

- **Header:** "People", "Manage accounts, roles and skills."; **Export CSV**; **New account** (today's wizard, inside `DemoLock`).
- **Demo notice:** "Demo access · Account creation and editing are unavailable in this session."
- **Filter bar:**
  - "Search by name, email or username";
  - **Role:** All roles, Admin, Manager, Employee, Executive;
  - **Include archived:** today's Archived;
  - **Columns:** a menu adding Email, Salary, Department and Manager. All are off by default; the choice is remembered in `overwatch.people.columns`.
  - Removable chips for `?department=` and `?skill=`, which the Departments and Skills pages link to (§7.6).
- **Table:** Person (avatar, name, username); Role chip; Job title; Skills chips; a chevron, which shows "View details" on hover and focus. The row opens `/people/:id`.
- **Footer:** "8 shown" and ⓘ "Email and salary are under Columns."

### 6.5 Departments (`/departments`)

Mockup: `Departments.png`.

- **Demo notice:** "Demo access · Adding, renaming and archiving departments is disabled."
- **Header:** "Departments", "Organise people and projects across your workspace."; **New department** (`DemoLock`).
- **Filter:** "Search departments…"; on the right, "3 departments".
- **Table:**
  - Name: a building icon, the name, and an "Archived" chip when archived;
  - People: the count and **View people →** (`/people?department=<id>`);
  - Projects: the count and **View projects →** (`/projects?department=<id>`);
  - Actions: "⋯" with Rename and Archive or Restore. In the demo the "⋯" button is disabled, with the tooltip.
- **Footer:** "Open a department's people or projects to explore its records." and the date.

### 6.6 Skills (`/skills`)

Mockup: `Skills.png`.

- **Demo notice:** "Demo access · Adding, renaming and archiving skills is disabled."
- **Header:** "Skills", "Match people's skills to milestone requirements."; **New skill** (`DemoLock`).
- **Filter:** "Search skills…"; on the right, "10 skills".
- **Table:**
  - Skill, with an "Archived" chip when archived;
  - People with skill: a number linking to `/people?skill=<id>`;
  - Milestones requiring skill: a plain number;
  - Actions: "⋯" with Rename and Archive or Restore (`DemoLock`). This replaces the mockup's chevron, to match Departments.
- **Footer:** "Counts describe usage, not availability or staffing capacity."

### 6.7 Archive (`/archive`)

Mockups: `Archive.png` (a normal admin), `Archive (Admin demo version).png` (the demo admin).

- **Header:** "Archive", "Browse archived records and restore eligible items."; **Export CSV**.
- **Demo notice** (it can be hidden for the session): "Demo access · Only milestone restoration is available in this session."
- **Filter:** "Search archived records…"; chips "All N", "People N" (admins and executives), "Projects N" and "Milestones N".
- **Table:**
  - Name: with the username for people, the project for milestones;
  - Record type: an icon and Person, Project or Milestone, with a lock icon when the demo blocks it;
  - Archived: date and time;
  - Archived by: a name link, or "Not recorded";
  - Restore:
    - a button when `can_restore`;
    - for the demo admin, people and projects show it disabled with the tooltip (D5), so it isn't hidden as in the demo mockup;
    - a manager's project rows show no button, with the tooltip "Only an admin can restore a project".
- **Row → "Archived record" panel:**
  - a type chip, the name (H2), and the project link or the username;
  - Archived and Archived by;
  - **Restore <type>** (primary; same rules);
  - "Review the record before restoring. Restoration is recorded in the audit log.";
  - **View audit log**, for admins and executives, to `/audit?entity_id=<id>` (§7.3).
- **Footer:** "10 archived records".
- **Executives** never get Restore. **Managers** see their own projects and milestones only, as today.

### 6.8 Audit log (`/audit`)

Mockup: `Audit log.png`.

- **Header:** "Audit log", "A read-only history of changes across your workspace."; a lock with "Entries cannot be edited or deleted"; **Export CSV**.
- **Filters:**
  - Actor, Action and Record type;
  - From and To (date pickers);
  - **Include sign-ins:** today's "Show sign-ins" (`?signins=1`);
  - an `?entity_id=` chip when arriving from Archive.
- **List:**
  - a day heading, "Today · Oct 15, 2026", with "50 entries on this page";
  - on the right, "Times shown in <time zone>", the browser's zone;
  - rows: Time; Actor (avatar and name); Event (the action's icon from `auditLook.js`, a short title, and the sentence); Record (the object's name and its project link).
  - A row opens the details panel.
- **Paging:** "50 entries per page" (25, 50 or 100), Previous and Next.
- **Event titles** come from a map in `auditLook.js`, e.g. "Created a conversation", "Completed a milestone", "Moved to ready for review", "Approved a time-entry edit". Unknown actions are humanized.
- **"Event details" panel:**
  - the action chip, the record's name (H2) and its project link;
  - **Actor** and **When** ("October 15, 2026 · 6:04 PM");
  - **"Changes":** a Field / Before / After table from `changes_view` (§7.3), with "Not recorded" where the entry kept no before value;
  - one line saying what the event records ("This event records a milestone status change.");
  - **Open project** or **Open record**;
  - **"Technical details"** (collapsed): record identifiers, the request ID and the raw JSON, as today;
  - a footer lock: "Original audit entry is preserved."
- **Executives:** the same; the server strips salaries and rates.

### 6.9 Puppy

Mockup: `Puppy.png`.

- **Panel:** a popover from the top bar's Puppy; a full-screen sheet on phones.
- **Panel header:** Puppy's face, "Puppy", a "Rule-based" chip, "Hi, Moataz.", and Close.
- **Tabs:** "Summary", "Actions" (today's "Do it"), "Ask".
- **Summary:**
  - **"Personal actions":** today's "What needs you". Empty: a success box "No personal actions waiting." and **Open messages**.
  - **"Project watchlist N"**, "Alerts across the projects you can see.": cards with a severity icon (error, warning or info), the title, the project, a detail line, a state chip (e.g. "Overdue") and a link (**View project**, **View profile**). Source: today's Puppy summary.
- **Footer:**
  - **"What Puppy can see"**, an expander with "Uses rules and data you're allowed to view. No AI service.";
  - **Sound settings**, which opens today's settings inside the panel (replacing the Sound tab);
  - the date.
- **Unchanged:** alerts, sounds, Ask and the Create users chat.

## 7. API additions

Each is additive. Nothing returns money or rates to anyone who can't see them today.

### 7.1 Project risk (phase 2)

**One meaning of "at risk":** the app's existing rule (LOGIC_WALKTHROUGH §6, `at_risk_reasons`: `OVERDUE_MILESTONE`, `PAST_DUE`, `BUDGET_BURN`). No second rule is added.

**The Risk column and chips** show the first reason in words:
- `PAST_DUE`: "Past due", plus "N days overdue" under the due date (from `predicted_end_date` and the New York date);
- `BUDGET_BURN`: "Budget ahead of progress";
- `OVERDUE_MILESTONE`: "Overdue milestone".
- A project with more than one reason lists all of them in the chip's tooltip and accessible name. No reason means "—".

**`GET /projects` gains:**
- **`sort`:** `name` (default), `status`, `manager`, `progress`, `budget_used`, `due` or `risk`.
- **`dir`:** `asc` (default) or `desc`.
  - Anything else is `400 VALIDATION_ERROR` with `{sort: "invalid_choice"}` or `{dir: "invalid_choice"}`.
  - Sorting happens before paging, with ties broken by name.
  - The status order is planned, active, on_hold, completed.
  - The risk order is `PAST_DUE`, then `BUDGET_BURN`, then `OVERDUE_MILESTONE`, then none.
- **`counts`** in the response, next to `items` and `total`, over every live project the caller can see, whatever the filters:

  ```json
  {"items": [], "total": 6, "counts": {"total": 6, "active": 3, "at_risk": 2}}
  ```

  `at_risk` uses the same rule as `at_risk=true`.

**Roles:** everyone who can list projects; scope as today.

### 7.2 Entry source and tracked share (no API change)

This already exists, from migration 014:
- Every entry in `GET /time-entries` (the week), in `GET /time-entries/calendar` and in each `GET /approvals` item's `entry` carries `tracked_hours` and `source`.
- `source` comes from `entry_source()` in `app/rules/time_tracking.py`:
  - `tracked` when `tracked_hours ≥ hours`;
  - `manual` when it's 0;
  - `mixed` otherwise.
- `tracked_hours` comes from timer records: a stopped timer's hours taken into the entry at Submit, capped by later hand edits (`tracked_after_edit`).
- `/timesheets/approved` rows already carry `tracked_hours`.

**The person-week share** is computed in the browser from the entries listed for that person-week, using today's `shareText`:
- `tracked % = round(Σ tracked_hours ÷ Σ hours × 100)`; Manual % = 100 − tracked %.
- The label is "Tracked" at 100%, "Manual" at 0%, and "Mixed" in between.

It's used on the Timesheets cards and KPIs, and on the milestone panel's Approvals groups.

### 7.3 Audit changes (phase 4)

**What's stored today:**
- Every audit row holds `changes = {before, after}` as JSON, with secrets dropped.
- **Both sides, per field:** `update` (milestone, project, user, department, skill), `complete`, `status_change`, `update_member`, `edit` (time entry), `approve` and `reject`, `set_skills`, `resolve_kickback`, `finalize_plan`.
- **Only `after`:** creates, `set_assignees` and `set_dependencies`.
- **Nothing:** `archive`, `restore`, `add_note` and sign-ins.
- Values are raw IDs and codes.
- That's enough for a Field / Before / After table on updates, but not on archive and restore or on assignee and dependency changes, and the IDs aren't readable.

**Add, for writes from now on** (old rows aren't backfilled):
- `archive`: `before {"is_archived": false}`, `after {"is_archived": true}`; `restore`: the reverse. This covers projects, milestones, users, departments and skills.
- `set_assignees` adds `before {"user_ids": [...]}`; `set_dependencies` adds `before {"predecessor_ids": [...]}`.

**Add, on reads:** each `GET /audit-log` item gains `changes_view`:

```json
"changes_view": [{"field": "status", "label": "Status", "before": "ready_for_review", "after": "completed",
                  "before_text": "Ready for review", "after_text": "Completed", "recorded": true}]
```
- **Which fields:** one item per key whose value differs between `before` and `after`, as the screen's `changedFields` does today. They come in a fixed order per record type, then alphabetically.
- **`before_text` and `after_text`** resolve the raw values:
  - status and other enum codes to their labels;
  - `manager_id`, `user_id`, `user_ids` and `delegate_approver_id` to names;
  - `department_id`, `skill_ids` and `predecessor_ids` to names;
  - booleans to "Yes" or "No";
  - an ID that doesn't resolve to "Unknown".
- **A create** has `before` null and `before_text` "—".
- **An update-like entry with no `before`** has `recorded: false` and `before_text` "Not recorded".
- **Executives:** the existing removal of `salary` and `hourly_rate` applies to `changes_view` too.

**New filter:** `GET /audit-log?entity_id=<uuid>`, which is `400 VALIDATION_ERROR` for a bad ID. Archive's **View audit log** uses it.

**Roles:** admins and executives, as today.

### 7.4 Missing timesheets count (no API change)

- `GET /timesheet-reminders` already answers it, for admins and managers:
  - the same scope as `/dashboard`;
  - the same rule as the Friday reminder (`keeps_timesheet`);
  - with `department`.
- The Control centre's KPI is `people.length`, with the hint "Week of <week_start>", or "This week" when `due` is true.
- Executives get `403` and don't see the Control centre.

### 7.5 My week's week picker (phase 3)

- `GET /users/{id}/profile?week=YYYY-MM-DD` already returns `this_week` for the week containing that date.
- **New `sections=this_week`:** it returns only `{"user": {"id": "…"}, "this_week": {"week_start", "logged", "overtime", "planned"}}`. It skips the history, `milestones` and `coming_up`, so stepping through weeks stays cheap.
- Any other `sections` value is `400 VALIDATION_ERROR` with `{sections: "invalid_choice"}`.
- The permissions are the profile's: someone you can't see is `404`.

### 7.6 People filters (phase 4)

- `GET /users` gains `department=<id>` and `skill=<id>`. Both are optional; a malformed ID is `400`. An archived department or skill still filters.
- Same roles and fields as `/users` today.
- Departments' **View people** and Skills' **People with skill** use them.

## 8. Accessibility, phones, dark mode (every phase)

**Accessibility:**
- **Structure:** one Main navigation, the Breadcrumb navigation and `main`; one H1 per page; one H2 per card.
- **Clickable rows** contain a real link or button with the record's name. The row click only widens the target.
- **Tabs** (page and panel) use tab roles with `aria-controls`.
- **Sortable headers** carry `aria-sort`. Stacked rows keep their labels.
- **Side panels:** focus moves in on open and back on close; Esc closes; phones get a modal sheet with `aria-modal`.
- **Status is never colour alone:** chips, risk, flags and cell statuses all pair an icon with a word.
- **Charts** keep Part C's text alternatives; progress bars carry `aria-valuetext`.
- **The demo countdown** speaks once, at 1:00.
- **Touch targets** are at least 44 px.
- **Reduced motion** is respected (`useCalmMotion`).

**Phones** (under `md`, 900 px):
- **At 375 px there's no horizontal page scroll.** A test checks `document.documentElement.scrollWidth <= 375` on every new page.
- The sidebar is a drawer; search is an icon; nested pages get a back link.
- Side panels are full-screen sheets.
- Tables become stacked rows: the main field first, actions in a "⋯".
- KPI strips use 2 columns.
- The Timeline uses its stacked layout. The week grid scrolls inside its own card with a fixed first column.
- Two-column layouts stack in the order each section gives.

**Dark mode:**
- Every colour comes from the theme: the palette, `STATUS` and `chartColors.js`. Components hold no hex values.
- Tinted cards (Needs attention, banners, the selected row) use palette colours with alpha, with their own dark values.
- Each phase renders its new pages in the dark theme in a smoke test, and retakes one dark screenshot.

## 9. Testing (per phase)

**Every phase:**
- **Frontend:** Vitest and Testing Library, querying by role and label only.
- **Backend:** unit and integration tests for every new field and parameter.
- **End to end:** the touched journeys updated, on desktop Chrome and the iPhone 13 profile.
- **Done means:** the full suites green; TESTING.md counts updated; docs updated (README tour, USER_STORIES, LOGIC_WALKTHROUGH, API.md, DEMO_SCRIPT); screenshots retaken at 1440×900 (light), plus one dark and one at 375 px.

**Phase 1 (shell):**
- the nav for each of the four roles: group headings, items, "Tracks own hours" adding My timesheet, and badge names;
- the user chip opens the account menu; Collapse and `[` keep working;
- breadcrumbs per the 3.4 table: root text, links, `aria-current`;
- the demo pill: only for `is_public_demo`, its label, its popover, the single announcement at 1:00, no page banner, and a `DemoLock` tooltip on a blocked action;
- the shell at 375 px with no overflow.
- **End to end:** no change; the three journeys run.
- **Screenshots:** `dashboard.png`, `my-week.png`, `control-centre.png`.

**Phase 2 (project page):**
- **Backend:** the Risk column's words for each existing reason and for several reasons; `at_risk=true` unchanged; each `sort` key in both directions across pages; `counts` ignoring filters; an employee's scope.
- **Projects list:** the KPI strip; filters in the URL; sorting (`aria-sort` and the request parameters); risk text and tooltip; the employee variant without New project or the manager filter; stacked rows at phone width.
- **Header:** the same on every tab; Edit only for `project.manage`; Archive in "⋯" for admins.
- **Overview:** the manager variant; the employee variant (no pending entries, no Team this week, the Your part figures); executives.
- **Milestones:**
  - the columns, search, the status filter, and the List | Timeline toggle being remembered;
  - a row opening the panel, the `?milestone=` deep link, Esc and the focus return;
  - the panel tabs per role (no Approvals for employees);
  - Approvals: the grouping, selecting, Approve sending one approve-week per person-week, Request changes requiring a reason, and a stale error shown;
  - the "⋯" items per permission.
- **Team:** Message following the contacts; "⋯" only for managers; the remove confirmation.
- **Budget:** employees without the hours columns and the pending banner; the relative bars.
- **Hours:** the manager table and its links; the employee's "Your hours"; the executive's private message.
- **Retargeted:** `projects.test.jsx`, `milestones.test.jsx`, `workflow.test.jsx`, `delegate.test.jsx`, `hours.test.jsx`.
- **End to end:** the milestones journey moves to the row and panel. The manager uses Add milestone; Eli moves it from the panel's Details tab; the manager completes it from "⋯". The overtime journey's budget check reads the new Budget tab.
- **Screenshots:** `milestones.png` and `budget.png`, plus the new `projects.png`, `project-overview.png` and `milestone-panel.png`.

**Phase 3 (employee screens):**
- **Backend:** `sections=this_week`, including a bad value and someone else's profile.
- **My week:**
  - the now-and-next frontend tests pass under the new headings ("Your focus", "Upcoming", "Available to claim");
  - the groups, and the collapsed state being remembered;
  - the week picker: the `?week` request, the card's title, and no week after the current one.
- **My timesheet:**
  - the header totals (Approved, Pending, Needs revision) and the cell status words;
  - Entry details: feedback only on rejected entries; Save & resubmit sending a one-cell `PUT`; Done keeping the edits;
  - `sessionStorage` restoring and clearing;
  - Day | Week | Month still present;
  - no `PUT` without Submit.
- **My history:** no Include archived for an employee, but present for an admin viewing them; the tabs; Employment details collapsed; the salary only for the person themselves and admins.
- **End to end:** onboarding lands on the new My week with the Your manager card; the overtime journey checks the header totals before Submit.
- **Screenshots:** `my-week.png`, `timesheet-month.png`, plus the new `my-timesheet.png` and `my-history.png`.

**Phase 4 (manager and admin screens):**
- **Backend:** the new audit writes (archive, restore, assignees, dependencies); `changes_view` (a status change, a rename, assignees resolved to names, a create, an old entry without `before`, the executive's salary strip); `entity_id`; and the `department` and `skill` user filters.
- **Timesheets:** the person-week sort and selection; the tracked % KPIs; the flag labels; a partial approve; Request changes needing a reason; the Change requests tab; the Live now panel.
- **Dashboard:** each card's data; managers versus executives; every Q1–Q7 card present; a manager's View all activity opening the panel, not `/audit`.
- **Control centre:** the KPIs and their links; the attention rows; Portfolio status; no organisation dashboard below.
- **People:** the Columns menu being remembered; the department and skill chips; the demo notice and a disabled New account.
- **Departments and Skills:** the links, and "⋯" disabled with its tooltip in the demo.
- **Archive:** the chips; the panel; the restore rules per role and in the demo; the View audit log link.
- **Audit log:** the filters; the Changes table; "Not recorded"; the page size.
- **Puppy:** the renamed tabs; Sound settings in the footer.
- **End to end:** the overtime journey's manager step uses the new Timesheets page (select the person-week, View breakdown, Approve); onboarding's admin step starts from New account.
- **Screenshots:** `timesheets-review.png`, `dashboard.png`, `control-centre.png`, `audit.png` and `puppy.png`, plus the new `people.png` and `archive.png`.

## 10. Decisions on the draft's open questions (16 Oct)

1. **"At risk" keeps one meaning:** the existing rule (§7.1). The Risk column shows its reasons in words. No 15-point rule is added. That rule was a suggestion in the brief, not the owner's request, and two rules would show two different at-risk counts.
2. **Manager filter:** today's permission stays. Only admins and executives get "All managers" (`projects.filterByManager`).
3. **My week's Completed group:** expanded by default and remembered once collapsed, like every other section (the now-and-next spec).
