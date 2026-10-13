import MilestonesTab from '../milestones/MilestonesTab.jsx'
import BudgetTab from './BudgetTab.jsx'
import OverviewTab from './OverviewTab.jsx'
import TeamTab from './TeamTab.jsx'

// Order matters: it's the tab order. The Hours tab is added in Task 18.
export const PROJECT_TABS = [
  { value: 'overview', label: 'Overview', Component: OverviewTab },
  { value: 'milestones', label: 'Milestones', Component: MilestonesTab },
  { value: 'team', label: 'Team', Component: TeamTab },
  { value: 'budget', label: 'Budget', Component: BudgetTab },
]
