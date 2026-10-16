import { useWeek } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { nyMondayIso } from '../../lib/format.js'
import { can } from '../../lib/permissions.js'

/** Milestones the person can log on today, from this week's timesheet rows (the server's rules: assigned, inside the
 * dates, project open), as a Set of ids. Empty for anyone who keeps no timesheet. */
export function useLoggable() {
  const { user } = useSession()
  const enabled = can(user, 'timer.use')
  const week = useWeek(nyMondayIso(), undefined, enabled)
  if (!enabled) return new Set()
  return new Set((week.data?.rows ?? []).filter((r) => r.open !== false).map((r) => String(r.milestone.id)))
}
