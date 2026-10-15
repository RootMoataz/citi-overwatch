# Stretch Backlog

These items come from the repo's [full-stack guide](../full-stack.md) and the project owner's goals. They aren't required by the workshop email. We pick them up only after every item in [REQUIREMENTS.md](./REQUIREMENTS.md) is done.

**Effort:** S = under 2 hours, M = half a day, L = a day or more.

**Value:** how much it helps the rubric score or makes the app stand out.

## Candidates

| # | Item | Source | Effort | Value | Notes | Status |
|---|---|---|---|---|---|---|
| 1 | Token refresh (silent renewal before expiry) | Guide, auth checklist | S | High | Token expiry itself is in the minimum | Done (`POST /auth/refresh`) |
| 2 | Progressive web app (installable, cached shell) | Guide, frontend checklist | S | Medium | `vite-plugin-pwa` | Not built |
| 3 | Live auto-refresh of dashboard data | Email ("real-time visibility") | S | High | Polling plus refresh on tab focus. Could move to minimum | Done (polling and refresh on tab focus) |
| 4 | Dark mode toggle | Owner, UI quality | S | Medium | Free with a well-built MUI theme | Done |
| 5 | Dependency graph view (visual chain) | Email Q6 | M | High | Minimum is a list view of the chain | Partly: the timeline shows "after …" chains and automatic blocked status; no graph view |
| 6 | Gantt or timeline view of deliverables | Owner, UI | M | High | Strong visual for "delivery timelines" | Done (each project's timeline) |
| 7 | CSV export of list views | Owner | S | Medium | Stakeholder reporting | Done (CSV export, plus print/PDF) |
| 8 | Audit log (who changed what) | Object Structure V2 doc | M | Medium | Admin-only view | Done (audit log and per-record timeline) |
| 9 | Soft delete and restore | Object Structure V2 doc | M | Low | Real deletes are in the minimum | Done (archive and restore; nothing is hard-deleted) |
| 10 | Coverage targets: 80% backend, 80% frontend, 90% API and errors | Guide, test coverage goals | M | High | Minimum is good coverage of critical logic | Backend done (97%); see [TESTING.md](./TESTING.md) |
| 11 | End-to-end tests for every critical path | Guide, test coverage goals | M | High | Minimum is one main journey | Partly: 3 journeys on desktop and mobile |
| 12 | Load test (Artillery) with results | Guide, performance testing | S | Medium | | Not done |
| 13 | Full WCAG 2.1 AA accessibility audit | Guide, frontend checklist | M | Medium | Minimum is basic accessibility | Not done (tests query by role and label; no audit) |
| 14 | AI feature, e.g. "summarize project risk" | Guide, frontend checklist | M | Medium | Needs an LLM API key and cost approval | Not built (Puppy is rule-based, no AI service) |
| 15 | Async tasks via SQS (e.g. scheduled at-risk recalculation) | Guide, backend checklist | M | Low | | Not built |
| 16 | Monitoring dashboard (CloudWatch metrics and alarms) | Guide, backend attributes | M | Low | Minimum is structured logs | Not built |
| 17 | Email or in-app notifications for at-risk projects | Owner | M | Medium | | In-app done (bell alerts); email waits on SES access |
| 18 | Kanban pull board for milestones | Owner, after the build | L | High | See [Kanban pull board](#kanban-pull-board) | Partly: pull mode, claiming and the planning board; see below |

## Decision rule

When the minimum is complete, pick the remaining items with the best value for their effort. Ties go to items a grader will see in the demo.

## Kanban pull board

Today, work is **pushed**: a manager assigns people to milestones, and the 40-hour planned cap stops anyone being overloaded. Dependencies already form a graph, so a milestone is blocked only by its own predecessors and independent work can run in parallel. This design lets people **pull** that work themselves.

**Status (15 Oct):** partly built. Pull mode per project (`work_mode`), claiming (`POST /milestones/{id}/claim`, [LOGIC_WALKTHROUGH §11](LOGIC_WALKTHROUGH.md#11-pull-mode-claiming-a-milestone)) and the planning board ([§25](LOGIC_WALKTHROUGH.md#25-the-planning-board-and-finalizing-a-plan)) are live. Not built: `/unclaim`, the WIP limit, `max_claimers`, auto-assign and the stale-card alert.

### Cards and columns

- **Cards:** one card per milestone, using what already exists. Smaller tasks inside a milestone can come later, together with sub-milestones.
- **Columns:** Blocked → Ready → In progress → Ready for review → Completed.
  - Blocked and Ready are both *not started*, split by whether every predecessor is completed.
  - They're computed, never stored, so nothing new goes into the database.
- **Getting into Ready:** automatic as soon as every predecessor is completed. The project's manager sets the order of the Ready column.

### Claiming work

- **Pull by default.** A project team member claims a Ready card, which assigns them and moves it to In progress. Only team members can claim, the same rule as assigning today.
- **People per card:** up to a maximum the manager sets (default 1). Milestones already allow several assignees.
- **WIP limit:** a maximum of In-progress cards per person, set per project. A claim above it is refused.
- **Unclaiming:** allowed while a card is In progress.
  - Hours already logged stay on record, but no new hours can be logged on that card.
  - The card goes back to Ready if nobody else is on it.
  - It's audited.
- **Auto-assign (optional, per project, off by default):** when a card becomes Ready, it goes to the people who did its predecessor, if they're under their WIP limit. Otherwise it goes to the team member with the most spare planned hours.

### Alerts

- When a card becomes Ready, team members under their WIP limit get one bell alert.
- A Ready card unclaimed for 3 working days is marked "waiting 3 days", and the project's manager gets one alert.
  - A daily EventBridge schedule runs this check through a direct invoke, like the existing `{"op": ...}` operations.
  - It's an infra change, so it needs the instructors' approval.

### Boards and access

- **Project board:** a tab on each project. Admins see every project; managers and employees see the projects they're on.
- **My board:** your own cards across all your projects.
- **No company-wide board,** to keep the current visibility rules.
- Permissions are unchanged:
  - Employees move only their own cards, up to *Ready for review*.
  - Completing a card, sending it back or reopening it stays with the manager or an admin.
  - Only managers and admins can set the order, the WIP limit, the maximum per card and auto-assign.

### Moving cards

- **Dragging** a card calls the existing status endpoints, so the server checks the same rules as today. A move that isn't allowed snaps back and shows the reason.
- **Keyboard and screen readers:** every card also has a "Move to…" menu. This keeps the rule that every action works from the keyboard ([USER_STORIES X2](USER_STORIES.md#x2-usable-without-a-mouse-or-perfect-vision-r)).
- **Phones:** tabs switch between columns, and cards move with the same menu.

### Metrics

- **Cycle time:** average days from claim to completed.
- **Time waiting:** days a card spent in Ready.
- Both are computed from the audit log.

### What it would take (about 1–2 days)

- **Backend:**
  - `POST /milestones/{id}/claim` and `/unclaim`, checking team membership, the WIP limit and the maximum per card
  - project settings: `wip_limit`, `max_claimers`, `auto_assign`, and the Ready order
  - an auto-assign hook that runs when a milestone completes
  - the daily stale-card check
- **Frontend:** the board tab, the My board page, drag and drop, and the "Move to…" menu.
- **Tests:** the claim and unclaim rules, the WIP limit, auto-assign when a milestone completes, and the stale-card alert.
