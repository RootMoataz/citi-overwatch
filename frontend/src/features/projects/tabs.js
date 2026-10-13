import BudgetTab from './BudgetTab.jsx'
import OverviewTab from './OverviewTab.jsx'
import TeamTab from './TeamTab.jsx'

// Order matters: it's the tab order. Milestones and Hours tabs are added in Tasks 17 and 18.
export const PROJECT_TABS = [
  { value: 'overview', label: 'Overview', Component: OverviewTab },
  { value: 'team', label: 'Team', Component: TeamTab },
  { value: 'budget', label: 'Budget', Component: BudgetTab },
]
