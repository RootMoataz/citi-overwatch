import MilestonesWithHours from '../milestones/MilestonesWithHours.jsx'
import PlanTab from '../planning/PlanTab.jsx'
import BudgetTab from './BudgetTab.jsx'
import HoursTab from './HoursTab.jsx'
import OverviewTab from './OverviewTab.jsx'
import TeamTab from './TeamTab.jsx'

/** The project is in its planning phase: Planned, with the plan not finalized yet. */
export const isPlanning = (project) => project.status === 'planned' && !project.plan_finalized_at

// Order matters: it's the tab order. `shown` (optional) decides whether a project has the tab.
export const PROJECT_TABS = [
  { value: 'plan', label: 'Plan', Component: PlanTab,
    shown: (p) => isPlanning(p) || Boolean(p.plan_finalized_at) },
  { value: 'overview', label: 'Overview', Component: OverviewTab },
  { value: 'milestones', label: 'Milestones', Component: MilestonesWithHours },
  { value: 'team', label: 'Team', Component: TeamTab },
  { value: 'budget', label: 'Budget', Component: BudgetTab },
  { value: 'hours', label: 'Hours', Component: HoursTab },
]

/** The project's tabs, and the one to open when the URL names none (or one it doesn't have): the Plan tab while
 * planning, otherwise the Overview. */
export function projectTabs(project, requested) {
  const tabs = PROJECT_TABS.filter((t) => !t.shown || t.shown(project))
  const fallback = isPlanning(project) ? 'plan' : 'overview'
  return { tabs, current: tabs.some((t) => t.value === requested) ? requested : fallback }
}
