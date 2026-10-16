# Employee "now and next"

Date: 2026-10-15. Status: approved by the owner with two additions (urgent, closely matching milestones first; every My week section collapsible, expanded by default), folded in below.

## Why

The owner wants an employee to know, at a glance, **what to work on now and what comes next**. Today "My milestones" on My week is one flat list (overdue first, then priority and due date).

The owner asked for:
- categories with expand/collapse ("Completed", "In progress", …);
- milestones archived by a manager or admin to be invisible to the employee;
- a heads-up on milestones that may come to them.

On "coming up", the owner chose two things:
- "assigned + likely": milestones already assigned to them that haven't started;
- a prediction of unowned milestones that auto-routing would likely give them, based on their skills.

**Success:** an employee opens My week, and within a few seconds knows:
- their current milestone and when it's due;
- what they start next (or what it waits on);
- what may be routed to them soon.

They never see archived work.

## Scope

- The employee's home, My week (`/`). Its "My milestones" section is replaced, and a "Now & Next" card is added.
- `GET /users/{id}/profile` gains fields, and its archive rule changes for employees.
- Employee reads of milestones never return archived ones.
- Built after the timesheet month calendar. It ships on its own: tests green, docs updated, pushed to `overwatch`, deployed, smoke-tested live.

**Not changing:**
- how auto-routing assigns work;
- the "Milestones you can claim" section;
- the This week and Your manager cards;
- managers', admins' and executives' screens;
- timesheet rules.

## API

### `GET /users/{id}/profile`

**Changes for each item of `milestones`.** Three fields are added:
- `display_status`: the existing rule (`waiting` while a non-archived predecessor isn't completed; `blocked` is a kickback);
- `waiting_on`: `[{id, name}]`, the non-archived predecessors that aren't completed, ordered by name; empty when none;
- `progress_percent`: from the latest progress update that gave one, or `null`.

**New `coming_up`.** It is filled only when you read **your own** profile; reading anyone else's gives `[]`.
- Each item is `{milestone: {id, name, start_date, end_date, priority}, project: {id, name}, ready, after: [{id, name}], skills: [names], match: {have, need}, is_new}`.
  - `skills` are the milestone's required skills you have, sorted by name.
  - `match` counts them: `have` is how many of its required skills you have, and `need` is how many it lists.
  - `is_new` is `true` when the milestone was created in the last 7 days.
- **Which milestones.** The same rule auto-routing uses after a completion (`ready_for_routing` / `person_fits` in `app/rules/routing.py`), minus the "predecessors done" condition. A milestone counts when:
  - it is `not_started`, not archived, and nobody is its primary assignee;
  - its project is `active`, in push mode, and not archived;
  - you're on the project's team with room under your 40 h planned-hours limit, the same capacity check routing uses;
  - you aren't on the milestone already;
  - it lists **at least one required skill and you have at least one of them**.
- **Left out on purpose:**
  - Milestones with no required skills. Anyone on the team could get those, so they aren't "coming to you".
  - Pull-mode projects. There you claim work, and the ready ones are already in "Milestones you can claim".
- **`ready`:** `true` when every non-archived predecessor is completed (routing could pick it now). Otherwise `after` lists the predecessors that aren't completed, ordered by name.
- **Order and limit.** A milestone that is more urgent and closer to your skills comes first. The owner asked for this so that a new, urgent milestone that suits the person rises to the top.
  - The order is:
    1. overdue first;
    2. then priority (critical, high, medium, low);
    3. then closeness to your skills: the share of its required skills you have (`have / need`, higher first), then `have` (higher first);
    4. then the planned workflow order (routing's `next_milestone_order_key`).
  - At most 5 items are returned, after ordering.

**Archive rule (changed).**
- Today a person's own profile lists their archived projects and milestones ("own past work, read-only").
- From now on, that applies only to managers reading their own profile.
- For an **employee**, archived projects, archived milestones and milestones of archived projects are left out of every part of the profile:
  - the history;
  - `projects`;
  - `milestones`;
  - `coming_up`.
- Admins and executives still see everything. Managers viewing someone else still see live work only.

### Employees never read archived milestones

For a signed-in employee, an archived milestone, or any milestone of an archived project, is `404 NOT_FOUND` on:
- `GET /milestones/{id}`;
- its `notes`, `updates` and `history`;
- every write route.

It is also left out of `GET /projects/{id}/milestones`.

The calendar and the timesheet already leave them out. The plan audits each read an employee can make, and fixes any that still returns archived milestones. Managers, admins and executives keep today's behaviour.

## Screen: My week

### Now & Next card

The first card in the right-hand column, above "My milestones", with two rows.

**Now:** the most urgent milestone in progress. The order is overdue first, then priority, then soonest due. The row shows:
- the name (linked to the milestone);
- the project;
- `due <date>`;
- the percent done when known;
- **⚠ Overdue** when it applies;
- the existing **Start timer** button when the milestone is loggable today.

With nothing in progress, the row reads "Nothing in progress". When an assigned milestone is ready to start, it adds "Start <name> next" as a link to it.

**Next:** the first item of "Up next" (see below), with one of:
- "Ready to start";
- "Starts <date>";
- "Waiting on <names>".

With nothing up next, it reads "Nothing else assigned yet". When `coming_up` isn't empty, it adds "See what might come your way", which opens that group and scrolls to it.

**Heads-up:** a third row, shown only when the first `coming_up` item is overdue or has **critical** or **high** priority. It reads "Heads-up: <name> (<Priority> priority) may come your way", plus "New" when `is_new` is true. It links to that row in "Might come your way".

### My milestones: collapsible groups

Each group has a header button with the group name and its count, e.g. "In progress (1)". The button carries `aria-expanded` and `aria-controls`. Empty groups are hidden.

| Group | Contents | Order |
|---|---|---|
| **In progress** | assigned, `display_status` `in_progress` or `blocked` (kicked back, with its chip) | overdue, priority, end date |
| **Up next** | assigned, `not_started` | ready to start (not waiting, start date today or earlier) first, then starts in the future (by start date), then waiting (by start date) |
| **With your manager** | assigned, `ready_for_review` | end date |
| **Might come your way** | `coming_up` | as returned (urgency and closeness) |
| **Completed** | assigned, `completed` | newest end date first |

### Every My week section collapses (owner's request)

- **Which sections:** every section on My week has a header button that collapses and expands it:
  - This week;
  - Your manager;
  - Now & Next;
  - My milestones;
  - each group inside My milestones;
  - Milestones you can claim.
- **Defaults:** every section and group is **expanded by default**. It collapses only when the person clicks its header.
- **Remembered state:** each section stays the way the person leaves it. The state is kept in localStorage under `overwatch.myweek.sections`, as JSON of the collapsed ones only, such as `{"done": true, "claim": true}`. Every read and write is in try/catch, and a blocked store means everything starts expanded.
- **Header button:** carries `aria-expanded` and `aria-controls`. A collapsed section keeps its header and count visible.
- **Shared component:** this is built into `features/dashboard/Section.jsx` as an optional `collapsible` mode. The dashboard's sections stay exactly as they are.
- **Rows** keep today's look: name, project link, due date, the status, priority and difficulty chips, "Supporting", and the timer button. Additions by group:
  - **Up next:** "Ready to start", "Starts <date>" or "Waiting on <names>".
  - **In progress:** "<P>% done".
- **"Might come your way" rows:**
  - the name and project;
  - "Needs <skill>, which you have" ("Needs <a> and <b>, which you have" for several skills);
  - "Ready now" or "After <names>";
  - the priority chip;
  - "New" when `is_new` is true;
  - a "Prediction" chip.

  The group starts with one line: "When the milestone before one of these is completed, auto-routing picks someone on the team with the right skills. It's a likely pick, not a promise."
- **Nothing assigned and nothing coming:** the existing empty state stays.

### Accessibility and phones

- **Headings:** groups are headings with a button inside.
- **Count:** the count is part of the button's name, e.g. "Up next, 2 milestones".
- **Phones:** the card and the groups stack. Rows already wrap on `xs`.

## Testing

**Backend:**
- **Profile fields:** `display_status`, `waiting_on` and `progress_percent` on profile milestones.
- **`coming_up`:**
  - ready and not-ready items, with `after`;
  - skill match required;
  - no-skill milestones left out;
  - pull projects left out;
  - a milestone you're already on left out;
  - an inactive or archived project left out;
  - no room under 40 h left out;
  - the order:
    - overdue, then priority, then closeness to your skills, then planned order;
    - a new high-priority milestone that matches all your listed skills comes before an older medium one;
  - `match` and `is_new` (created 6 days ago is new, 8 days ago isn't);
  - the 5-item limit is applied after ordering;
  - empty for someone else's profile.
- **Archive rule:**
  - an employee's own profile leaves out archived projects and milestones;
  - a manager's own profile still lists them;
  - an admin sees them.
- **Archived milestones for employees:**
  - `GET /milestones/{id}` and its notes, updates and history are 404 for an employee when the milestone or its project is archived;
  - the same reads still work for the project's manager;
  - `GET /projects/{id}/milestones` leaves them out for an employee.

**Frontend:**
- **Now & Next:**
  - picks the right Now (overdue first) and Next;
  - the "Nothing in progress" and "Nothing else assigned yet" fallbacks;
  - "See what might come your way" opens that group.
- **Heads-up:** shown for a critical, high or overdue first prediction, with "New"; hidden for a medium one.
- **Groups:** contents, order, counts; empty groups are hidden.
- **Collapsible sections:**
  - every section and group starts expanded;
  - collapsing one hides its content but keeps its header and count;
  - the state is remembered across a reload;
  - a blocked localStorage starts everything expanded;
  - the dashboard's sections are unchanged.
- **Up next labels:** ready, future start, and waiting on names.
- **Might come your way:**
  - the skill wording for one and for two skills;
  - "Ready now" and "After …";
  - the "Prediction" chip.
- **Rows and the timer:** the timer button appears only on loggable milestones, as today.

**End-to-end:** the employee journey's My week step checks the Now & Next card, then opens and closes Completed.

**Docs:**
- README (My week);
- `docs/project/API.md` (the profile fields, `coming_up`, the archive rule);
- `docs/project/LOGIC_WALKTHROUGH.md` (a short "Now and next" section with the prediction rule);
- `docs/project/USER_STORIES.md`;
- the test counts;
- a retaken `docs/images/` screenshot of My week, at 1440×900.
