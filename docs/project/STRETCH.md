# Stretch Backlog

These items come from the repo's [full-stack guide](../full-stack.md) and the project owner's goals. They aren't required by the workshop email. We pick them up only after every item in [REQUIREMENTS.md](./REQUIREMENTS.md) is done.

**Effort:** S = under 2 hours, M = half a day, L = a day or more.

**Value:** how much it helps the rubric score or makes the app stand out.

## Candidates

| # | Item | Source | Effort | Value | Notes |
|---|---|---|---|---|---|
| 1 | Token refresh (silent renewal before expiry) | Guide, auth checklist | S | High | Token expiry itself is in the minimum |
| 2 | Progressive web app (installable, cached shell) | Guide, frontend checklist | S | Medium | `vite-plugin-pwa` |
| 3 | Live auto-refresh of dashboard data | Email ("real-time visibility") | S | High | Polling plus refresh on tab focus. Could move to minimum |
| 4 | Dark mode toggle | Owner, UI quality | S | Medium | Free with a well-built MUI theme |
| 5 | Dependency graph view (visual chain) | Email Q6 | M | High | Minimum is a list view of the chain |
| 6 | Gantt or timeline view of deliverables | Owner, UI | M | High | Strong visual for "delivery timelines" |
| 7 | CSV export of list views | Owner | S | Medium | Stakeholder reporting |
| 8 | Audit log (who changed what) | Object Structure V2 doc | M | Medium | Admin-only view |
| 9 | Soft delete and restore | Object Structure V2 doc | M | Low | Real deletes are in the minimum |
| 10 | Coverage targets: 80% backend, 80% frontend, 90% API and errors | Guide, test coverage goals | M | High | Minimum is good coverage of critical logic |
| 11 | End-to-end tests for every critical path | Guide, test coverage goals | M | High | Minimum is one main journey |
| 12 | Load test (Artillery) with results | Guide, performance testing | S | Medium | |
| 13 | Full WCAG 2.1 AA accessibility audit | Guide, frontend checklist | M | Medium | Minimum is basic accessibility |
| 14 | AI feature, e.g. "summarize project risk" | Guide, frontend checklist | M | Medium | Needs an LLM API key and cost approval |
| 15 | Async tasks via SQS (e.g. scheduled at-risk recalculation) | Guide, backend checklist | M | Low | |
| 16 | Monitoring dashboard (CloudWatch metrics and alarms) | Guide, backend attributes | M | Low | Minimum is structured logs |
| 17 | Email or in-app notifications for at-risk projects | Owner | M | Medium | |

## Decision rule

When the minimum is complete, pick the remaining items with the best value for their effort. Ties go to items a grader will see in the demo.
