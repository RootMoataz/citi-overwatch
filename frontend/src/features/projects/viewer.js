import { can } from '../../lib/permissions.js'

/**
 * What this viewer is on this project; every tab decides with these and never with role checks of its own.
 * `lead`: may manage it (its manager or an admin) and sees team data. `manage`: lead on a project that isn't
 * archived, so the edit actions. `decides`: may approve hours (the server still lists only the entries they can
 * decide). `executive`: read-only. `mine`: neither lead nor executive, so "Your part" and "Your hours".
 */
export function projectView(user, project) {
  const lead = can(user, 'project.manage', { managerId: project?.manager?.id })
  const executive = user?.role === 'executive'
  return {
    lead,
    manage: lead && !project?.is_archived,
    decides: can(user, 'approvals.view'),
    executive,
    mine: !lead && !executive,
  }
}
