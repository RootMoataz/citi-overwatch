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
| Start/Stop timer | Stores a timer row; 7.5+ minutes become a draft in Eli's timesheet cell (not submitted) | Yes (drafts sit there until Submit) |
| Eli's **Submit** with a timer draft | Submits the draft as pending, Tracked hours | Yes (it adds hours to Eli's day) |
| Morgan's **Stop timer** in Live now | Stops Eli's timer, posts a message in their thread, adds a draft | Yes |
| **Approve** Eli's change request | Sets that cell to the requested hours (pending) | **No, one-shot** (Eli can ask again on another timer cell) |
| Submit without a note | Refused (`400 PROOF_REQUIRED`); nothing saved | Yes |
| Kick back Hypercare (optional) | Hypercare becomes Blocked; Apollo becomes at risk | Yes: Morgan presses **Put back in the queue** |
| Message Morgan | Adds a message to the thread | Yes |
| **Approve week** for Gia (week of 12 Oct) | Approves 3 entries; budget consumed rises | **No, one-shot** |
| **Complete** Schema Mapping | Completes it; Ben Okafor becomes primary on Cutover | **No, one-shot** (**Reopen** doesn't undo Ben's assignment) |
| **Finalize plan** on Beacon | Checklist only; finalizing is disabled while checks fail | Yes (don't move cards) |
| **Email this report** | Sends one email through EmailJS (free plan: 200 a month) | Yes |
| Ctrl+K, Puppy, executive, admin tour | Nothing | Yes |
| Create the instructors' accounts with Puppy (real admin) | Creates accounts and sends one real email each | **No, one-shot** (each email and username works once) |

Rehearse only the READ and repeatable steps. Save the one-shot steps for the real run.

**Before you start (about 10 minutes ahead):** the live feed needs a timer that is really running, and the seed never
starts one (it would tick from the seed's time). Open a **second browser or a private window**, sign in there as
**Employee** and press **Start** on *Schema Mapping*. Leave that window open: it is "Eli at his desk". Eli already
has 8h on Schema Mapping today, so his timer shows the **8h day** warning at once and passes 125% (10h) after two
hours, which is when Morgan's bell gets "Eli's timer on Schema Mapping is at 10h today — over the 8h daily limit".

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
3. **Your manager (READ).** Under **This week**, the **Your manager** card shows Morgan's photo, title and
   department and a **Message Morgan** button. Say: "One press to message your manager." (Same card on your own
   profile.)
4. **Timer: start → stop → pre-filled, locked row → Submit (WRITE, repeatable).** The timer started in the other
   window is running: the header chip ticks and turns amber, and a banner says "You've reached your 8h for today on
   this timer". Press the chip; the **Stop your timer?** dialog says "Stopping now adds 0.25h to Thursday's cell on
   your timesheet. It isn't submitted until you press Submit there." Add a note (**What did you work on?**) and press
   **Stop timer**. The toast: "Added 0.25h to Thursday's cell — open your timesheet to submit." Open **My
   timesheet**; it opens on today in the **Day view**, with the week strip above one row per milestone. The *Schema
   Mapping* row shows saved + timer hours with a timer mark, "from timer, not submitted yet", and the banner "You have
   0.25h of timer time not submitted yet — press Submit to send it." Hover the hours: "Timer hours can't be edited —
   request a change". Press **Submit**. Say: "Stopping a timer never submits hours. The employee still submits them,
   with proof of work, and can't type over them. To fix them they press **Request a change**, which goes to the
   manager." (Stopped under 7.5 minutes, nothing is added and the toast says so.) Then press
   **Start** again in the other window so Morgan has a live timer to watch.
5. **Proof of work (WRITE attempt, refused, repeatable).** Open **My timesheet** and press **Wed** in the week strip.
   Change the *Schema Mapping* hours from 8 to 7 and press **Submit 1 change**. The page shows **Add a work note
   before saving** and lists the row, with a link to the day. Say: "New or changed hours need a 10 to 500 character
   note, or a progress update that day. Old hours aren't checked." Put the 8 back. Nothing was saved.
6. **Kick back (optional: WRITE, repeatable, changes live data).** On Apollo's **Milestones** tab, press
   **Kick back** on *Hypercare*. Pick a category under **What's wrong?**, write a reason in **Explain** (10+
   characters) and press **Kick back**. Hypercare becomes Blocked and Apollo becomes at risk ("Kicked back – needs
   review"). This makes the manager's Ctrl+K step return Apollo. Undo it as Morgan with **Put back in the queue**.
7. **Messages (WRITE, repeatable).** Open **Messages**. Open the thread with Morgan Manager (it has one unread
   message) and send a short reply. Say: "Employees can message their manager, their project managers and other
   employees, but not admins or executives. The server enforces that."
8. **Puppy (READ).** Click the dog next to the bell (**Puppy assistant**). Show **Summary** ("What needs you"),
   then **Sound** and press ▶ (**Preview Puppy bark**). Say: "Puppy follows rules from your data. No AI service is
   involved, and nothing you type leaves the browser."

**If something goes wrong:** if **Start** is disabled, another timer is running; stop it first. If the stop adds
nothing, the timer ran under 7.5 minutes: show the seeded Saturday 10 Oct row (2h, Tracked, "Change requested") in
last week's timesheet instead (**Previous week**, then **Sat** in the strip). If
the proof-of-work error doesn't appear, the hours weren't changed; type a different number. If the kickback dialog
refuses, the reason is under 10 characters. Skip anything that stalls; Puppy is the strongest closer.

## 3. Manager: Morgan (2:00–4:30)

Sign out, click **Manager**.

1. **Dashboard (READ).** Approvals waiting and **Live now** sit on top. Live now shows Eli's timer ticking every
   second with "8h today" and a **Warning: 8h day** chip (**Over: 8h day** past 125%). In **Risk**, Morgan's projects show **Nothing at risk**
   (or Apollo with "Kicked back – needs review" if Eli kicked back Hypercare). **Smart insights** ("Rule-based
   suggestions from your live data") shows "Approvals are piling up" with a **Medium Severity** chip: 6 entries
   waiting more than 3 days, the oldest 14 days. In **Budget used per project**, each bullet shows budget as the
   track, consumed as the bar and the forecast as the marker. Click **Apollo Data Migration** to open its Budget
   tab (8.4% used at 23.1% progress), then go back.
2. **Stop Eli's timer with a message (WRITE, repeatable).** In Live now press **Stop timer** on Eli's row, write
   "Please stop here and join the 3pm review call" (10+ characters) and press **Stop timer and send**. In Eli's window:
   the bell shows "Morgan stopped your timer on Schema Mapping: …", **Messages** has "⏹ Stopped your timer on Schema
   Mapping (…): …" in their thread, and the time so far is a locked draft in today's row. Say: "Managers see who is
   timing work right now, get one alert when a timer passes 125% of a limit, and can stop it with a reason the
   employee actually reads."
3. **Change requests (WRITE, one-shot).** Open **Timesheets**. **Change requests** lists Eli's request on Saturday
   10 Oct's *Schema Mapping*: "2h → 1.5h" and his reason. Press **Approve**, add a comment and press **Approve
   change**. Eli's cell becomes 1.5h, pending approval like any hours, and he is told. (Reject keeps the cell and sends
   the comment instead.)
4. **Timesheets → To review (READ).** Still on **Timesheets**. Turn on **Only flagged**. Gia Rossi has two weeks:
   - Week of Mon 5 Oct: 4 × 8.5h on *Build: frontend*, flagged **Same hours daily** and **Over plan**,
     "Tracked 0% · Manual 100%".
   - Week of Mon 12 Oct: 24h, flagged **Over plan**, "Tracked 83% · Manual 17%", with work notes beside each entry.

   Say: "Red flags inform the approver. They never block."
5. **Approve week (WRITE, one-shot).** On Gia's week of 12 Oct, press **Approve week**. Approved hours move to
   **Approved**, and Apollo's consumed budget rises. Leave the week of 5 Oct for later demos.
6. **Complete and auto-route (WRITE, one-shot).** Open **Projects → Apollo Data Migration → Milestones**. *Cutover*
   (Critical, Hard) has **Nobody assigned** and waits on *Schema Mapping*. On *Schema Mapping* (Ready for review,
   Eli, Ben, Ana), press **Complete**. Confetti fires and the toast reads "Completed. Auto-assigned Ben Okafor to
   Cutover". Say: "Cutover needs Backend Development or DevOps. Ben has both, so he matched the most required skills.
   He also fits under his 40-hour plan."
7. **Planning board (READ).** Open **Projects → Beacon Mobile App**. The **Plan** tab is a Kanban board: Backlog →
   Ready → Scheduled. Press **Finalize plan**. The dialog "Finalize the plan for Beacon Mobile App?" lists six checks;
   two fail (cards left in Ready and Backlog; scheduled milestones with nobody assigned), so finalizing stays
   disabled. Close it. Don't drag cards: moves are saved.
8. **Email this report (WRITE, repeatable).** Back on the dashboard, press **Email this report**. Untick
   **Send to me** (Morgan's address is a demo address). The field then reads **Recipient email**: type your own
   address and press **Send**. A per-recipient result appears ("Sent to …"). Say: "The report is built in the
   browser and sent through EmailJS, because the Lambda has no internet route."
9. **Ctrl+K (READ).** Press Ctrl+K and type "at-risk projects in Technology". The palette shows the interpreted chip
   *Projects · At risk · Technology*. Press Enter. The list shows Apollo if Eli kicked back Hypercare; otherwise
   it's empty, which is the right answer for Morgan's projects.

**If something goes wrong:**

- Live now says "Nobody is running a timer right now": the other window's timer was stopped or ran past midnight.
  Press **Start** there again; the card refreshes within 30 seconds (or reload).
- **Change requests** is missing: the seeded request was decided already. As Eli, press **Request a change** on any
  locked (timer) row to make a new one.
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

## 5b. Admin: create the instructors' accounts with Puppy (optional, about 1 minute)

**WRITE, one-shot.** This creates real accounts on the live site and emails each person. Sign in with one of the
private admin logins (`admin.demo2`, `admin.demo3` or `admin.demo4`; passwords are held by the owner, never shown on
screen). **Not** `demo.admin`: there Puppy answers "Creating accounts is disabled in the public demo." (worth showing
first if there's time).

Before the talk, have the instructors' full names and email addresses ready in a note, one line each, in the same
order. Each account sends one real email through EmailJS (free plan: 200 a month, shared with **Email this report**),
and an address or username can only be used once, so a rehearsal with the real addresses spends them: rehearse
locally (`admin.demo` / `Demo123!` on `localhost`, where each row ends "Saved to the local outbox (not sent)"
instead of "Emailed ✓") or with throwaway addresses.

1. Click the dog (**Puppy assistant**) → **Ask** tab, type `create accounts for the instructors` and press Enter.
   (Or **Do it → Create user accounts**.) Say: "Puppy is still rule-based. It asks, I answer, and nothing is
   created until I say yes."
2. Puppy: "What are the names of the people to add? You can paste several, separated by commas or new lines."
   Paste the names, one per line, for example:

   ```
   Ana Instructor
   Ben Instructor
   Cara Instructor
   ```

   If someone has only one name, Puppy asks "What's Cara's last name?". Point at the username chips
   ("Ana Instructor → ana.instructor"); clicking one changes it.
3. Puppy: "What are their email addresses? In the same order, please." Paste the emails in the same order. To show
   the checking, paste one too few first: "I got 2 emails for 3 people — who's missing?" with the pairing table.
4. For each person ("Person 1 of 3 · Ana Instructor · …"): "What role should Ana Instructor have?" → click
   **Executive** (read-only, sees everything except salaries) or **Manager**. Then "Department for Ana
   Instructor?" → **Skip**. For the second person click **Use the same for everyone left**.
5. The summary table appears with "I'll create these 3 accounts with randomly generated temporary passwords that
   meet the security rules, and email each person their sign-in details. They'll choose their own password at first
   sign-in. Is that okay?" Say: "Every row is still editable. The server is the guard: same endpoint, validation,
   password policy and audit log as the People page." Click **Yes, create and email**.
6. Each row goes Creating… → Created ✓ → Emailed ✓, then: "Done! 3 accounts created, 3 emails sent. They'll be asked
   to choose a password when they first sign in." Say: "The passwords never appeared on screen."

**If something goes wrong:** a row that says "Failed: That email is already taken" means that address already has an
account; click **Edit** on the row, fix it, then **Retry failed**. "Email failed" means EmailJS refused (quota or
network): click **Show passwords once**, hand them over yourself, tick **I've saved it** for each, or later use
**Reset password** on the person's page. If the site is slow, show `docs/images/puppy.png` and move on.

## 6. Close (6:30–7:00)

Say:

> "Architecture in one sentence: a React app on S3 and one Python Lambda behind the same CloudFront address,
> talking to Aurora PostgreSQL, with business rules as pure, tested functions.
>
> Security: guards fail closed, so an unreviewed route is refused for the demo admin and read-only for executives;
> salaries are stripped from every executive response; photos are rebuilt from checked pixels by a pure-Python PNG
> sanitiser, so nothing uploaded is served as-is.
>
> Tests: 1,173 backend tests (97% coverage at the last full run), 928 frontend component tests, and 6 end-to-end runs on desktop and
> iPhone; the frontend and end-to-end suites all passed on 16 October.
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
instead). A test walks all 66 write routes and fails if one is in neither list.

**Data model highlights?** 31 tables over 15 migrations (plus `schema_migrations`). UUID keys. `numeric` money.
Nothing is deleted, only archived. The hourly rate (salary ÷ 2,080) is frozen on each entry when it's approved.
One open kickback per milestone and one running timer per person are enforced by partial unique indexes. HR
submissions keep a frozen copy of each payroll CSV.

**Testing strategy?** Test-first. Business rules are pure functions with exhaustive edge cases (387 unit tests).
786 integration tests run against a real PostgreSQL 17, because mocks hide SQL bugs. 928 component tests use Vitest
and MSW, where an unhandled request fails the test. 6 Playwright runs cover 3 journeys on desktop Chrome and iPhone
13 (these and the component tests all passed on 16 October). Two fail-closed tests walk every write route for the executive and demo-admin guards.

**Don't know?** "Good question. Let me show you where that lives." Open `LOGIC_WALKTHROUGH.md` or `DECISIONS.md`.
