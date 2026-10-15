# Timesheet and projects redesign

Date: 2026-10-15. Status: approved in chat; awaiting review of this written spec.

## Why

The owner's feedback after the presentation:

- The employee timesheet is hard to use. Today it's a 7-column grid with an input, a note icon, a status line and sometimes a timer button in every cell.
- Employees find the project and milestone views confusing. Today a project has up to six tabs, and its milestones are long cards with many chips, buttons and panels. Employees can't see their own impact on the project.
- The projects area as a whole doesn't feel organized.

**Success:** an employee can log a day's hours in one pass without opening popovers. They can open a project and understand in a few seconds where it stands, what's next and what their part is. Managers and admins keep every tool they have today.

## Scope

- **Part A:** the employee timesheet (`/timesheet`).
- **Part B:** the projects list (`/projects`) and the project page (`/projects/:id`).
- **Built in that order.** Each part ships on its own: tests green, docs updated, pushed to `overwatch`, deployed, smoke-tested live.

**Not changing:**
- business rules: proof of work, the 24 h/day stop, the 40 h warning and overtime, timer locks and change requests, closed or on-hold gating, approvals;
- the managers' Timesheets "To review" page;
- the API, except one field (Part B);
- permissions.

**Already handled separately:** the Start-timer bug on completed milestones. That fix makes the server refuse to start a timer on one, and hides the button.

## Part A: one day at a time

### Layout

1. **Week bar**
   - previous/next week arrows and a This week button, as today;
   - a strip of 7 day buttons (Mon–Sun), each showing that day's total;
   - a day turns red over the day cap, and the selected day is highlighted;
   - the week total `22h / 40h` (`data-testid="week-total"` is kept) and the existing overtime warning.
2. **Day panel** (the selected day). It opens on today for the current week, otherwise on Monday. The selected day is kept in the URL (`?week=…&day=…`).
   - **Heading:** the full date and that day's total.
   - **One row per milestone** the employee can log on, grouped under the project name when there's more than one project.
   - Each row has:
     - the milestone and project name, and a Supporting chip when it applies;
     - an hours input with today's input rules (digits, 2 decimals, under 0.25 is flagged, over the cap blocked);
     - a note text field, always visible (10–500 characters), with a counter. It is marked "needed" when the row has new or changed hours and no note or same-day progress update, using the existing `wantsNote` / `PROOF_REQUIRED` logic;
     - the saved entry's status: Pending, Pending (overtime …), Approved, or Rejected with its reason and a Resubmit button;
     - timer hours: shown read-only as "4h from timer", locked, with **Request a change**. This is the existing `LockedCell` behaviour;
     - a **Start** button only when the day is today and the milestone isn't completed.
   - Milestones that are completed, or in a closed or on-hold project, are hidden behind a "Show N closed milestones" line. They expand read-only.
3. **Submit button** in the page header: "Submit N changes".
   - It sends every changed cell of the week, on any day, in one `PUT` as today's Save week does.
   - Switching days keeps unsaved edits.
   - It's disabled while nothing has changed or a validation error stands.
   - Errors for cells on other days list the day and offer a link to jump to it.

### Week grid toggle

A **Day / Week** toggle sits next to the week bar. Week shows the current grid, unchanged, for people who prefer it. The choice is remembered per browser, in `localStorage` under `overwatch.timesheet.view`, wrapped in try/catch. Day is the default.

### Structure

The logic `TimesheetPage.jsx` holds today (values, drafts, notes, locks, totals, changed cells, save) moves into a `useTimesheetWeek(week)` hook. The page then renders `<DayView>` or `<WeekGrid>` from the same state. The current grid code becomes `WeekGrid.jsx` with no behaviour change. `NoteButton`, `CellStatus` and `LockedCell` are reused.

### Tests

- The existing `timesheet.test.jsx` and `timesheetRules.test.jsx` keep passing against the Week grid, which becomes an explicit toggle in their setup where needed.
- New day-view tests cover:
  - the default day;
  - the day totals in the strip;
  - typing hours plus a note and submitting one `PUT`;
  - an edit on another day being kept and submitted;
  - the required note blocking the save;
  - locked timer hours with Request a change;
  - completed milestones hidden with no Start button;
  - the day cap error;
  - the rejected entry with Resubmit;
  - the toggle being remembered.
- `timerWorkflow.test.jsx` is updated where it targets grid cells.
- The overtime end-to-end journey moves to the day view: day by day, hours and a note per day, then Submit.

## Part B: projects area

### Projects list (`/projects`)

- **Controls:** a search box and status chips (Active, At risk, Planned, On hold, Completed, All; default Active). A **More filters** button holds department, manager and Archived (admins and executives), which are today's filters.
- **Groups:** cards in **My projects** (where I'm the manager, delegate or a member) and then **Other projects** (managers, admins and executives only).
- **Each card:**
  - name;
  - status chip, or an At risk badge with its reasons in a tooltip;
  - progress bar with percent;
  - due date (predicted end);
  - team avatars (`team`) and the manager.
  - The whole card links to the project.
- **Table toggle** (admins, managers, executives): today's table, its pagination and the CSV export, unchanged. The view choice is remembered per browser.
- **Unchanged:** New project and request buttons, loading and empty states, and errors.

### Project page (`/projects/:id`)

**Employees (and anyone without manage rights) get one page and no tabs:**

1. **Header and health strip:**
   - name, status and at-risk badge;
   - progress bar (difficulty-weighted percent);
   - predicted end, and budget used percent.
2. **"Your part" line**, for project members only, for example: *Your part: 2 of 5 milestones · 38h logged · 24% of the project's progress.*
   - **Milestones:** the share of non-archived milestones where I'm an assignee.
   - **Progress share:** the difficulty weight of my completed milestones as a percent of the total weight. It uses the same weights as the project progress. On a shared milestone, the weight is split equally among its assignees.
   - **Hours:** my approved plus pending hours on the project. This is the one backend addition: `my_hours` in `GET /projects/{id}/summary`. It's computed for the caller only and never exposes other people's hours or rates.
3. **Milestones**, an ordered list in planning sequence, then by start date. Each row shows:
   - a state icon: ✓ completed, ● in progress, ◐ ready for review, ○ up next, ⛔ waiting on *X* (blocked);
   - name and people avatars, with "You" highlighted;
   - due date, and its priority only when it's High;
   - my milestones also show their main action inline, using the existing `statusActions`, claim and kick back rules.
   - **Clicking a row** opens a side panel (a bottom sheet on phones) with the full current card content: details, actions, work log, notes, history, kick back and discuss. The `?milestone=` deep link opens it.
   - **Timeline:** the timeline chart moves into a collapsible section, closed by default.
4. **Team:** avatars with names, the manager first. A **Details** expander holds the description, department, work mode and delegate.

**Managers (of this project), delegates and admins:**
- That page becomes their **Overview** tab.
- **Plan:** shown while planning or when finalized, as today.
- **Budget & hours:** today's Budget and Hours tabs merged into one tab with two sections.
- **Team:** today's Team tab, where they manage members.
- Add milestone and the edit/archive actions are available on the Overview list and in the side panel.

**Executives:** the Overview page read-only, plus Budget & hours, as today's read-only access.

### Structure

- New `ProjectOverview.jsx`, which replaces `OverviewTab` and the milestones listing.
- `MilestoneRow.jsx`, plus a `MilestonePanel.jsx` built from the current `MilestoneCard` body.
- `ProjectCard.jsx`, plus the list's view toggle.
- `tabs.js` changes to the new tab set, with the old `?tab=milestones`, `?tab=budget` and `?tab=hours` URLs redirecting to the new tabs.
- `MilestonesTab.jsx` is retired once nothing uses it.

### Tests

**Updated:** `projects.test.jsx`, `milestones.test.jsx`, `workflow.test.jsx`, `delegate.test.jsx` and `hours.test.jsx`, retargeted to the new layout. The behaviours they check stay the same.

**New tests:**
- the card groups and status chips;
- the table toggle;
- the employee page having no tabs;
- the "Your part" figures, including the shared-milestone split;
- opening and closing the side panel, and the deep link;
- the manager tab set;
- the old tab URLs redirecting;
- a backend integration test for `my_hours`, covering own hours only and the role scope.

The milestones end-to-end journey moves to the row and panel.

## Docs, both parts

- README feature tour screenshots and captions.
- USER_STORIES: timesheet and project stories.
- LOGIC_WALKTHROUGH, where it describes these screens.
- API.md: `my_hours`.
- TESTING.md: counts and journeys.
- DEMO_SCRIPT steps that click the old tabs or grid.
