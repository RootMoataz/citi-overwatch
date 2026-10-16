# Timesheet month calendar

Date: 2026-10-15. Status: approved in chat; awaiting review of this written spec.

## Why

During the review of Part C, the owner asked for a Gregorian calendar with the milestones and hours filled in, on the employee's timesheet. They chose a month grid, from four kinds of calendar offered:
- a month grid;
- a month timesheet matrix;
- a heatmap;
- an agenda list.

They also chose to make it view-only: clicking a day opens the Day view to edit it.

**Success:** an employee opens Timesheets → Month and, without clicking anything, sees:
- which milestones they were on during the month, with their dates and due days;
- how many hours they logged each day, and on what;
- which hours are approved, pending, rejected or still a timer draft;
- which days are missing hours or went over the limits.

One click on a day takes them to that day in the Day view to fix it.

## Scope

- The employee's own timesheet page (`/timesheet`) gets a third view: **Day | Week | Month**.
- Built after Part C of the timesheet and projects redesign, before its Part B. It ships on its own: tests green, docs updated, pushed to `overwatch`, deployed, smoke-tested live.

**Not changing:**
- how hours are entered and saved;
- every timesheet rule:
  - proof of work;
  - the 24 h/day stop;
  - the 40 h warning and overtime;
  - timer locks and change requests;
  - closed or on-hold gating;
  - approvals;
- permissions;
- the Day and Week views;
- the managers' Timesheets pages.

**Not in scope:**
- editing hours in the month grid;
- a project calendar or a manager's team calendar;
- public holidays;
- a year view or heatmap;
- export.

## API: one new read-only route

`GET /time-entries/calendar?month=YYYY-MM&user=`

**`month`:**
- Optional. It defaults to the current month, using the same server "today" as a week does.
- Anything that isn't a real `YYYY-MM` month is `400 VALIDATION_ERROR` with `{month: "invalid_month"}`.

**`user` and permissions:** exactly as for `GET /time-entries`:
- You can always read your own.
- A manager reads someone else's only for the projects they manage.
- An admin reads anyone's.
- Anyone else gets `403 FORBIDDEN`.
- An unknown user is `404`.

**Range:** the grid the screen draws. It runs from the Monday on or before the 1st to the Sunday on or after the last day of the month. That's 4 to 6 whole weeks.

**Response:**

```
{
  "month": "2026-10",
  "range": {"start": "2026-09-28", "end": "2026-11-01"},
  "user": {"id": "...", "name": "Eli Employee"},
  "milestones": [{
    "id", "name", "start_date", "end_date",
    "status", "display_status", "progress_percent",
    "project": {"id", "name", "status"},
    "role"
  }],
  "entries": [{"id", "milestone_id", "work_date", "hours", "status", "over_40", "label"}],
  "drafts": [{"milestone_id", "work_date", "hours"}]
}
```

- **`milestones`:** two kinds, each listed once.
  - **Assigned:** the milestones the person is assigned to that overlap the range.
  - **Logged:** any other milestone the person has entries on inside the range, with `role: null`, so every entry has a name to show.
  - **Fields:**
    - `display_status` uses the existing rule (`waiting` while a predecessor isn't completed; `blocked` is a kickback).
    - `progress_percent` comes from the latest progress update that gave one, as on the milestones list.
  - **Order:** by start date, then name, case-insensitive.
- **`entries`:** the person's entries in the range, every status, with the same `label` and `over_40` as the week view.
- **`drafts`:** timer hours stopped but not submitted yet, as in the week view.
- **Excluded:** archived projects and archived milestones, and their entries. The week view does the same.
- **Hourly rates:** never included. They aren't needed.

## Screen

### Toggle and URL

- **Toggle:** `Day | Week | Month`. The choice is remembered under the existing `overwatch.timesheet.view` key, which now also accepts `'month'`. Every read and write of the key stays in try/catch.
- **URL:** the month view keeps its month in the URL as `?month=2026-10`. Without one, it opens on the month of the selected day, or of today for the current week.
- **Month header:**
  - previous and next month arrows;
  - a **This month** button;
  - the month's name ("October 2026");
  - the month's logged total, counting only pending and approved hours, as the 40 h rule does: "112h logged in October".

### The grid (desktop and tablet, `sm` and up)

**Layout:**
- 7 columns, Monday to Sunday, one row per week of the range.
- Days outside the month are faded. Today has a ring. Saturdays and Sundays are lightly shaded.

**Milestone bars:** across the top of each week row, Google Calendar style.
- **Span:** a milestone is drawn from its start to its end day, cut at the week's edges.
- **Lanes:** each week row has up to **3 lanes**.
  - Bars go in the first lane they fit, in the order of the list: start date, then name.
  - A milestone that doesn't fit is counted in a **"+N more"** button on that week row. It opens a popover listing the hidden milestones: name, dates, state.
- **Colour:** each bar uses its state's colour, from the same `STATUS`/`statusColor` and `stateStripes.js` as the milestone timeline. Waiting and blocked are striped.
- **Due mark:** a bar that ends inside the row carries a small **due** mark on its last day. An unfinished milestone past its end date shows **⚠ Overdue**, as an icon plus a word.
- **Bar label:** the milestone name. A bar on the person's own assignment has no extra tag, because the whole calendar is theirs.
- **Clicking a bar:** opens the milestone on its project, using the existing link `/projects/<project>?tab=milestones&milestone=<id>`.

**Day box:** under the bars, each day box shows:
- **Header:** the date number.
- **Total:** the day's total of pending and approved hours.
  - The total is red with "over 24h" when it passes the day cap.
  - Days of a week past 40 h carry the overtime mark the week view uses (`over_40`).
- **One line per milestone with hours that day:** the name, ellipsised, and the hours ("Schema Mapping 6h"), styled by status:
  - **approved:** solid;
  - **pending:** outlined;
  - **rejected:** red, struck-through hours, and the word "rejected" in the accessible name;
  - **timer draft (not submitted):** dashed, "from timer".
- **Overflow:** more than 3 lines collapse into "+N more" inside the box.
- **Empty days:** a past working day in the month (Mon–Fri, before today) with no hours shows a quiet "No hours". Weekends and future days show nothing.

**A legend under the grid:** approved, pending, rejected, timer draft, due and overdue.

**Clicking a day box** switches to the Day view on that day (`?week=<its Monday>&day=<date>`).
- Unsaved edits in another week go through the existing "discard your changes?" question.
- The month view itself never edits anything.
- Unsaved edits in the current week stay in memory while the month view is open, and the existing leave warning still applies.

### Phones (`xs`)

- **Grid:** the same 7-column grid, but each box holds only the date number, the day's total, and up to 3 dots: one per milestone with hours that day, coloured by state. There are no bars.
- **Tapping a day:** selects it, and a panel under the grid shows:
  - the full date and total;
  - the milestones active that day, with state and due/overdue marks;
  - each milestone's hours with status;
  - an **Open this day** button that goes to the Day view.
- **Default selection:** today, if it's in the month, otherwise the 1st.

### Accessibility

**Grid structure:** the grid is a table labelled by the month's name ("October 2026"). The column headers are the weekday names.

**Each day is a button.** Its accessible name lists, in this order:
- the date ("Wed 14 Oct");
- the total ("8 hours");
- each milestone's hours and status ("Schema Mapping 6 hours approved, Build: frontend 2 hours pending");
- any due or overdue mark ("due: Build: frontend").

So a screen-reader user hears everything a sighted user sees.

**Other controls:**
- **Bars:** links named `"<name>, <start> to <end>, <state>"`.
- **"+N more":** buttons named `"<N> more milestones this week"`.

**Visuals:** colour is never the only signal. Every status also has a style and a word in its name.

### Loading and errors

- **Loading:** a skeleton grid.
- **Errors:** the app's usual `ErrorAlert` with a retry.
- **Empty month:** a month with no milestones and no hours still draws the grid, with "Nothing assigned to you this month".

## Code shape

- **Backend:** `get_month` in `backend/v1/app/features/time/service.py`, next to `get_week`.
  - It reuses the week's helpers: entry view, drafts, overtime and the permission filter.
  - It reuses the milestones' `display_status` and progress logic, without copying them.
  - The route goes in `routes.py`.
- **Frontend:**
  - `useCalendarMonth(month)` in `frontend/src/api/queries.js`.
  - `frontend/src/features/timesheet/monthLayout.js`: pure functions for the weeks of the range and the bar lanes per week, with "+N more". These are tested on their own.
  - `MonthView.jsx`: the grid, the day boxes and the phone panel.
  - `TimesheetPage.jsx`: the toggle, the URL and the switch to the Day view.

## Testing

**Backend** (unit + integration). All of these must be covered:
- own month;
- a manager's view filtered to their projects;
- an employee asking for someone else (403);
- an unknown user (404);
- a bad month (400);
- the range of a month starting on Monday, and of one starting on Sunday;
- a 6-week month;
- a milestone overlapping the range edge;
- a milestone that isn't assigned but has entries (`role: null`);
- archived items left out;
- drafts;
- `display_status` waiting;
- no hourly rate in the response.

**Frontend:**
- **`monthLayout.js`:**
  - weeks for 4-, 5- and 6-week months;
  - lanes and "+N more";
  - a bar cut at week edges;
  - a bar starting before and ending after the range.
- **`MonthView`:**
  - day totals;
  - lines and their status styles and names;
  - over 24h;
  - due and overdue;
  - legend;
  - month navigation and This month;
  - clicking a day opens the Day view on that day;
  - clicking a bar links to the milestone;
  - the remembered view;
  - the empty month;
  - the phone panel: tap, then Open this day.

**End-to-end:** the employee journey switches to Month, finds a logged day's hours, opens that day, and lands in the Day view on it.

**Docs:**
- README's Timesheets section;
- `docs/project/API.md` (the new route);
- `docs/project/LOGIC_WALKTHROUGH.md` (a short "Month view" section);
- `docs/project/USER_STORIES.md`;
- test counts in README, TESTING and DEMO_SCRIPT;
- a new screenshot, `docs/images/timesheet-month.png`, at 1440×900.

## Revision 2 (16 Oct 2026): hours-first Month view

The owner's mockup (`My timesheet - Month (v2).png`, kept in the git-ignored `.superpowers/redesign/`) and notes asked to:
- remove the repeated milestone ribbons;
- make daily totals and approval states easier to scan;
- keep rejected hours visible but excluded from totals;
- put locked-entry actions in a side panel;
- show milestone deadlines as small date markers.

Approved in chat on 16 Oct. This revision replaces the bars, the "+N more milestones" button and the click-to-open behaviour above. Everything else above still holds, including the route, the URL, the toggle and the totals rule.

### Grid
- **Milestone bars are gone.** The Month view no longer shows milestone state. Colours mean approval status only. Milestone state stays on the project's timeline.
- **Day box:**
  - the date and the day's total, formatted as hours: pending and approved count, rejected and timer drafts don't;
  - an en dash "–" when the day has nothing.
- **One chip per line**, each with an icon and a status word:
  - **approved:** ✓ icon, green, "<name> <h>";
  - **pending:** clock icon, amber, a second line "Pending";
  - **rejected:** ! icon, red, a second line "Needs revision", hours struck through;
  - **timer draft:** timer icon, neutral and dashed, a second line "Not submitted".
- **More than 3 lines** become "+N more".
- **Markers:**
  - "⚠ Over 40h" on a day holding an `over_40` entry;
  - "📅 1 milestone deadline" / "📅 N milestone deadlines" on a day where an assigned, not-completed milestone ends.
- **Today:** the date sits in a filled circle and the box has a ring. Days outside the month are faded. Weekends are lightly shaded.
- **Clicking a day selects it.** It no longer jumps to the Day view. The selected day has a highlighted border and background, and it is kept in the URL as `?month=YYYY-MM&day=YYYY-MM-DD`. The default selection is today if it's in the month, otherwise the 1st.

### Selected-day panel
- **Placement:** on the right on desktop (`md` and up), under the grid on tablets and phones.
- **Heading:** the full date, plus a "Today" chip when it applies.
- **Summary line:** for example "4h pending", "8h · 6h approved, 2h pending", or "No hours".
- **One card per line:**
  - the milestone name and an approval chip ("Approved", "Pending approval", "Needs revision", "Not submitted");
  - "Project: <name>";
  - Hours, shown read-only;
  - "Timer-linked entry: Yes/No";
  - Source: Manual when `tracked_hours` is 0, Tracked when it is at least the hours, Mixed otherwise;
  - for a rejected entry, the manager's reason.
- **Actions on a card:**
  - **Timer-linked (locked) cells:** a 🔒 on Hours, the line "Timer hours are locked; your manager approves any change", and **Request a change**, which opens the existing request dialog. While a request waits, the button reads "Change requested" and is disabled.
  - **Any other line:** **Edit in Day view**, which opens the Day view on that date and goes through the existing discard question.
- **"Milestone dates":** the deadlines that fall on that day ("<name> · Due Oct 23", plus "Overdue" when unfinished and past), and a **View milestones** link to the milestone.
- **Rules unchanged:** only timer hours are locked; typed hours stay editable in the Day view.

### Header and legend
- **Header:** "<total>h logged in <Month>", with the sub-line "Pending + approved · Rejected hours excluded."
- **Legend:** Approved, Pending, Needs revision, Not submitted, then "Milestone dates appear separately from time-entry status."

### API (additive)
`GET /time-entries/calendar` gains `locks`, with the week view's exact shape: `[{milestone_id, work_date, hours, draft_hours, tracked_hours, request}]`. These are the cells holding timer hours or drafts in the grid's range, with any pending change request. Entries already carry `tracked_hours` and `rejection_reason`.

### Accessibility
- The day button's accessible name keeps the earlier format, with the new status words and markers.
- The panel is a region labelled by its date heading.
- A status is never shown by colour alone: every chip has an icon and a word.
