# Demo script: ACME Scout (Moataz Hikal Project)

A timed click-through of the live site, about 7 minutes plus a 2-minute Q&A crib. It uses the live data as it stood on
15 October 2026 (checked through the API that morning). Labels in **bold** are the exact button, tab and field texts
from the code.

- **Live site:** https://d3ucnz03j0sngl.cloudfront.net
- **Demo logins:** the sign-in page's **Try the demo** buttons (**Employee**, **Manager**, **Executive**, **Admin**).
  All use the published password `Demo123!`. Never show or type a private admin password.

| Account | Person | Lands on |
|---|---|---|
| `employee.demo` | Eli Employee | **My week** |
| `manager.demo` | Morgan Manager | Dashboard (approvals on top) |
| `executive.demo` | Moataz Hikal, Executive Sponsor | Organisation dashboard, **Read-only view** |
| `demo.admin` | Dana Demo-Admin (public, 5-minute session) | **Control centre** |

## Live-data legend

Each step is marked:

- **READ** changes nothing. Repeat freely.
- **WRITE, repeatable** changes live data, but can be undone or run again.
- **WRITE, one-shot** changes live data for good. After it runs once, the next run of this script looks different.

| Step | Effect | Repeatable? |
|---|---|---|
| Start/Stop timer under 7.5 minutes | Stores a timer row; logs no hours | Yes |
| Save week without a note | Refused (`400 PROOF_REQUIRED`); nothing saved | Yes |
| Kick back Hypercare (optional) | Hypercare becomes Blocked; Apollo becomes at risk | Yes: Morgan presses **Put back in the queue** |
| Message Morgan | Adds a message to the thread | Yes |
| **Approve week** for Gia (week of 12 Oct) | Approves 3 entries; budget consumed rises | **No, one-shot** |
| **Complete** Schema Mapping | Completes it; Ben Okafor becomes primary on Cutover | **No, one-shot** (**Reopen** doesn't undo Ben's assignment) |
| **Finalize plan** on Beacon | Checklist only; finalizing is disabled while checks fail | Yes (don't move cards) |
| **Email this report** | Sends one email through EmailJS (free plan: 200 a month) | Yes |
| Ctrl+K, Puppy, executive, admin tour | Nothing | Yes |

Rehearse only the READ and repeatable steps. Save the one-shot steps for the real run.

---

## 1. Opening (0:00–0:30)

Say:

> "ACME runs projects across Technology, Operations and Risk & Compliance. Status, risk, people, hours and budget
> live in different places, so problems show up late. ACME Scout puts them in one place and answers the brief's
> seven questions on one live dashboard. Our line is: *See every project, person and dollar — before it slips.*"

Show the sign-in page: the brand panel and slogan on the left, the four **Try the demo** buttons on the right. Say
that each one signs in to a public demo account with sample data.

**If something goes wrong:** if the site is slow, wait for the cold start (about 1.6 s). If it doesn't load, open
`docs/images/login.png` and continue from the README screenshots.

## 2. Employee: Eli (0:30–2:00)

Click **Employee**.

1. **My week (READ).** Point at "31.75h of 40h" with the logged and planned bars, then Eli's milestones, overdue
   first:
   - *Build* (Atlas): **Overdue**, In progress, **Critical Priority**, **Hard Difficulty**.
   - *Schema Mapping* (Apollo): Ready for review, **High Priority**, **Medium Difficulty**.
   - *Hypercare* (Apollo): Not started, **Easy Difficulty** (the default Medium priority chip is hidden).

   Say: "Priority is how urgent. Difficulty is how much the milestone weighs in progress. They're separate, and
   each is written in words."
2. **Estimates (READ).** Open **Projects → Apollo Data Migration → Milestones**. *Schema Mapping* reads
   "Est. 383h · …" and "306.75h logged · 80% of estimate". The line turns amber above 90% and red above 100%.
3. **Timer (WRITE, repeatable).** Back on **My week**, press **Start** on *Schema Mapping*. The button turns into a
   running clock, and a timer chip appears in the header. Press the clock; the **Stop your timer?** dialog has an
   optional **What did you work on?** note. Press **Stop timer**. Stopped under 7.5 minutes, it logs nothing and says
   "Timer stopped after less than 7.5 minutes, so nothing was logged". Say: "Timer hours are rounded to the nearest
   quarter hour and marked Tracked."
4. **Proof of work (WRITE attempt, refused, repeatable).** Open **My timesheet**. Change today's *Schema Mapping*
   cell from 8 to 7 and press **Save week**. The page shows **Add a work note before saving** and lists the cell.
   Say: "New or changed hours need a 10 to 500 character note, or a progress update that day. Old hours aren't
   checked." Put the 8 back. Nothing was saved.
5. **Kick back (optional: WRITE, repeatable, changes live data).** On Apollo's **Milestones** tab, press
   **Kick back** on *Hypercare*. Pick a category under **What's wrong?**, write a reason in **Explain** (10+
   characters) and press **Kick back**. Hypercare becomes Blocked and Apollo becomes at risk ("Kicked back – needs
   review"). This makes the manager's Ctrl+K step return Apollo. Undo it as Morgan with **Put back in the queue**.
6. **Messages (WRITE, repeatable).** Open **Messages**. Open the thread with Morgan Manager (it has one unread
   message) and send a short reply. Say: "Employees can message their manager, their project managers and other
   employees, but not admins or executives. The server enforces that."
7. **Puppy (READ).** Click the dog next to the bell (**Puppy assistant**). Show **Summary** ("What needs you"),
   then **Sound** and press ▶ (**Preview Puppy bark**). Say: "Puppy follows rules from your data. No AI service is
   involved, and nothing you type leaves the browser."

**If something goes wrong:** if **Start** is disabled, another timer is running; stop it first. If
the proof-of-work error doesn't appear, the cell wasn't changed; type a different number. If the kickback dialog
refuses, the reason is under 10 characters. Skip anything that stalls; Puppy is the strongest closer.

## 3. Manager: Morgan (2:00–4:30)

Sign out, click **Manager**.

1. **Dashboard (READ).** Approvals waiting sit on top. In **Risk**, Morgan's projects show **Nothing at risk**
   (or Apollo with "Kicked back – needs review" if Eli kicked back Hypercare). **Smart insights** ("Rule-based
   suggestions from your live data") shows "Approvals are piling up" with a **Medium Severity** chip: 5 entries
   waiting more than 3 days, the oldest 14 days. In **Budget used per project**, each bullet shows budget as the
   track, consumed as the bar and the forecast as the marker. Click **Apollo Data Migration** to open its Budget
   tab (8.4% used at 23.1% progress), then go back.
2. **Timesheets → To review (READ).** Open **Timesheets**. Turn on **Only flagged**. Gia Rossi has two weeks:
   - Week of Mon 5 Oct: 4 × 8.5h on *Build: frontend*, flagged **Same hours daily** and **Over plan**,
     "Tracked 0% · Manual 100%".
   - Week of Mon 12 Oct: 24h, flagged **Over plan**, "Tracked 83% · Manual 17%", with work notes beside each entry.

   Say: "Red flags inform the approver. They never block."
3. **Approve week (WRITE, one-shot).** On Gia's week of 12 Oct, press **Approve week**. Approved hours move to
   **Approved**, and Apollo's consumed budget rises. Leave the week of 5 Oct for later demos.
4. **Complete and auto-route (WRITE, one-shot).** Open **Projects → Apollo Data Migration → Milestones**. *Cutover*
   (Critical, Hard) has **Nobody assigned** and waits on *Schema Mapping*. On *Schema Mapping* (Ready for review,
   Eli, Ben, Ana), press **Complete**. Confetti fires and the toast reads "Completed. Auto-assigned Ben Okafor to
   Cutover". Say: "Cutover needs Backend Development or DevOps. Ben has both, so he matched the most required skills.
   He also fits under his 40-hour plan."
5. **Planning board (READ).** Open **Projects → Beacon Mobile App**. The **Plan** tab is a Kanban board: Backlog →
   Ready → Scheduled. Press **Finalize plan**. The dialog "Finalize the plan for Beacon Mobile App?" lists six checks;
   two fail (cards left in Ready and Backlog; scheduled milestones with nobody assigned), so finalizing stays
   disabled. Close it. Don't drag cards: moves are saved.
6. **Email this report (WRITE, repeatable).** Back on the dashboard, press **Email this report**. Untick
   **Send to me** (Morgan's address is a demo address). The field then reads **Recipient email**: type your own
   address and press **Send**. A per-recipient result appears ("Sent to …"). Say: "The report is built in the
   browser and sent through EmailJS, because the Lambda has no internet route."
7. **Ctrl+K (READ).** Press Ctrl+K and type "at-risk projects in Technology". The palette shows the interpreted chip
   *Projects · At risk · Technology*. Press Enter. The list shows Apollo if Eli kicked back Hypercare; otherwise
   it's empty, which is the right answer for Morgan's projects.

**If something goes wrong:**

- Gia's weeks are missing from **To review**: someone approved them already. Show a remaining flagged week, or the
  `timesheets-review.png` screenshot.
- *Schema Mapping* is already Completed: someone ran this step. Show *Cutover* with Ben as primary, then open its
  **History** to show the readable "auto-assigned" audit line.
- **Email this report** says email isn't set up, or a send fails: use the **Print / PDF** button beside it and move on.
- The palette list is empty: say so and switch to "budget of Apollo", which opens Apollo's Budget tab.

## 4. Executive: Moataz Hikal (4:30–5:30)

Sign out, click **Executive**.

1. **Organisation dashboard (READ).** Point at the **Read-only view** chip and the **Projects by status** donut:
   1 planned, 2 active, 1 on hold and 1 completed (archived projects are counted on their own). The risk list shows *Atlas Customer Portal*
   (Operations): overdue milestone and past due. Smart insights lead with two **High Severity** items: "Critical
   milestone Build is overdue" and "High-priority milestone Launch is overdue".
2. **Audit log (READ).** Open **Audit log**: entries grouped by day, written as sentences, with before → after
   changes. If you ran the manager steps, today shows Morgan's approval and the auto-assignment.
3. **HR submissions (READ).** Open **Timesheets → HR submissions**: the list of pay-period submissions, read-only.
   Say: "The executive sees everything, edits nothing, and no response ever carries a salary or hourly rate. The
   router enforces that for every write route, including ones added later."

**If something goes wrong:** if a page is empty, the executive's scope is everything, so it's a data or network
problem; show `executive.png` and `audit.png`.

## 5. Admin demo (5:30–6:30)

Sign out, click **Admin**. Sign in right before this section: the session lasts 5 minutes.

1. Close the **Welcome to the public demo admin** dialog (**Got it**). Point at the banner: "Demo admin — for
   demonstration only. You'll be signed out in 4:5x."
2. **Control centre (READ).** Admin shortcut tiles above the organisation dashboard.
3. **Locked buttons (READ).** Open **People** or **Departments**: edit, archive and create buttons are disabled with
   the tooltip "Disabled in the public demo". Say: "The server refuses them with `403 DEMO_RESTRICTED`; the screen
   only explains it."
4. **HR tab (READ).** Open **Timesheets → HR submission**: pay periods, totals, past submissions and the payroll
   CSV. Submitting is disabled for the demo admin.
5. **Skills (READ).** Open **Skills**: the catalogue that drives auto-routing. Changes are disabled in the demo.
6. Say: "The real admin logins are private and unrestricted. This public one can approve hours and edit projects,
   but anything touching credentials, people, departments, skills or HR is refused. A new write route is refused
   until someone decides, and a test fails until they do."

**If something goes wrong:** "Your 5-minute demo session has ended." means the clock ran out; sign in again with
**Admin**. "Too many demo sign-ins from your network" means 20 sign-ins in a minute; wait a minute and show
`control-centre.png`.

## 6. Close (6:30–7:00)

Say:

> "Architecture in one sentence: a React app on S3 and one Python Lambda behind the same CloudFront address,
> talking to Aurora PostgreSQL, with business rules as pure, tested functions.
>
> Security: guards fail closed, so an unreviewed route is refused for the demo admin and read-only for executives;
> salaries are stripped from every executive response; photos are rebuilt from checked pixels by a pure-Python PNG
> sanitiser, so nothing uploaded is served as-is.
>
> Tests: 1,041 backend tests at 98% coverage, 716 frontend component tests, and 6 end-to-end runs on desktop and
> iPhone.
>
> Next: server-side email needs an SES endpoint, which is waiting on the instructors, and the GitHub repository gets
> renamed to ACME Scout after this presentation."

---

## Q&A crib (2 minutes)

**Why rule-based, not AI?** The Lambda has no internet route, so no AI service is reachable. Rules are predictable,
testable and explainable. Insights are pure server functions; Puppy and the palette run in the browser on data the
user already sees.

**Why EmailJS?** The Lambda has no internet route and its pre-made IAM role has no SES permission; we can't change
either. The admin's browser relays welcome, reset and report emails through one fixed EmailJS template. Forgotten-
password codes are never relayed, because they'd pass through the requester's browser. The proper fix is an SES VPC
endpoint plus `ses:SendEmail`, which needs the instructors.

**How does auto-routing decide?** On **Ready for review**, the assignee is added as Supporting on the most urgent
in-progress milestone on their projects that they have a required skill for. On **Complete**, the people freed may
become primary on the next ready milestone: every predecessor completed, no primary yet. Urgency is overdue first,
then priority, then workflow order, end date and name. The person is the one with the most required skills, then
the lowest load. They must fit their 40-hour plan. Two completions at once are made safe by a row lock and a re-check.

**How do red flags avoid false positives on old data?** Two ways. `BACKDATED` and `NO_ACTIVITY` only judge entries
created after a go-live time (`app_settings.hour_flags_live_since`), because seeded history has no sign-in trail.
Proof of work only applies to new or changed hours; unchanged old hours are grandfathered. Flags never block; the
approver decides.

**How is the public demo safe?** `demo.admin` gets a server-enforced 5-minute session that refreshing can't extend.
A denylist plus an allowlist means any write route not reviewed yet is refused. Anything with `password`,
`credential` or an `hr` path segment is refused by name. It never locks out (20 sign-ins a minute per address
instead). A test walks all 62 write routes and fails if one is in neither list.

**Data model highlights?** 29 tables over 14 migrations (plus `schema_migrations`). UUID keys. `numeric` money.
Nothing is deleted, only archived. The hourly rate (salary ÷ 2,080) is frozen on each entry when it's approved.
One open kickback per milestone and one running timer per person are enforced by partial unique indexes. HR
submissions keep a frozen copy of each payroll CSV.

**Testing strategy?** Test-first. Business rules are pure functions with exhaustive edge cases (349 unit tests).
692 integration tests run against a real PostgreSQL 17, because mocks hide SQL bugs. 716 component tests use Vitest
and MSW, where an unhandled request fails the test. 6 Playwright runs cover 3 journeys on desktop Chrome and iPhone
13. Two fail-closed tests walk every write route for the executive and demo-admin guards.

**Don't know?** "Good question. Let me show you where that lives." Open `LOGIC_WALKTHROUGH.md` or `DECISIONS.md`.
