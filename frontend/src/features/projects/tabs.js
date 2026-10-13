import MilestonesWithHours from '../milestones/MilestonesWithHours.jsx'
import BudgetTab from './BudgetTab.jsx'
import HoursTab from './HoursTab.jsx'
import OverviewTab from './OverviewTab.jsx'
import TeamTab from './TeamTab.jsx'

// Order matters: it's the tab order.
export const PROJECT_TABS = [
  { value: 'overview', label: 'Overview', Component: OverviewTab },
  { value: 'milestones', label: 'Milestones', Component: MilestonesWithHours },
  { value: 'team', label: 'Team', Component: TeamTab },
  { value: 'budget', label: 'Budget', Component: BudgetTab },
  { value: 'hours', label: 'Hours', Component: HoursTab },
]
