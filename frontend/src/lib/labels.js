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
