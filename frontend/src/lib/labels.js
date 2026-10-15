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
  BLOCKED_MILESTONE: 'Kicked back – needs review',
}

/** Why an assignee kicked a milestone back. */
export const KICKBACK_CATEGORY = {
  blocker: 'Blocker', technical_issue: 'Technical issue', unclear_requirement: 'Unclear requirement', other: 'Other',
}
export const KICKBACK_REASON = { min: 10, max: 2000 }

/** Milestone difficulty; project progress weighs completed milestones easy 1, medium 2, hard 3. */
export const DIFFICULTY = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
export const PROGRESS_WEIGHTING = 'Harder milestones count more toward progress: easy 1, medium 2, hard 3.'

/** Milestone priority: how urgent it is, separate from difficulty and never part of progress. Low to Critical. */
export const PRIORITY = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
export const PRIORITY_HELP = 'How urgent this is. Separate from difficulty, which weights progress.'
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
/** For sorting, most urgent first: critical 0 … low 3; a missing priority counts as medium. */
export const priorityRank = (priority) => PRIORITY_RANK[priority] ?? PRIORITY_RANK.medium

/** Push: the manager assigns milestones. Pull: team members claim ready, unassigned milestones themselves. */
export const WORK_MODE = {
  push: { label: 'Push', help: 'The manager assigns people to milestones' },
  pull: { label: 'Pull', help: 'Team members claim milestones that are ready to start and have nobody on them' },
}

/** Hours already sent to HR that changed since: payroll needs them again (an admin re-sends them). */
export const HR_CHANGED = 'Changed after HR submission — re-send'
/** What an HR submission is, since there's no HR system to send to: a record and a payroll CSV. */
export const HR_SUBMITTED = 'Submitted to HR (export ready)'
