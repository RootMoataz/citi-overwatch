/** Roles as people read them, in the order the role pickers offer them. */
export const ROLE_LABEL = { employee: 'Employee', manager: 'Manager', admin: 'Admin', executive: 'Executive' }
export const ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))
/** What each role means, for the people who assign them. */
export const ROLE_HELP = {
  employee: 'Logs hours on assigned milestones',
  manager: 'Runs projects and approves their hours',
  admin: 'Manages people, projects and settings',
  executive: 'Read-only view of every project, workload and the audit log; never sees salaries',
}

export const RISK_LABELS = {
  OVERDUE_MILESTONE: 'Overdue milestone',
  PAST_DUE: 'Past due date',
  BUDGET_BURN: 'Budget burning faster than progress',
}

/** Milestone difficulty; project progress weighs completed milestones easy 1, medium 2, hard 3. */
export const DIFFICULTY = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
export const PROGRESS_WEIGHTING = 'Harder milestones count more toward progress: easy 1, medium 2, hard 3.'

/** Push: the manager assigns milestones. Pull: team members claim ready, unassigned milestones themselves. */
export const WORK_MODE = {
  push: { label: 'Push', help: 'The manager assigns people to milestones' },
  pull: { label: 'Pull', help: 'Team members claim milestones that are ready to start and have nobody on them' },
}
