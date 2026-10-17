import { useWeek } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { nyMondayIso, nyTodayIso } from '../../lib/format.js'
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

/** Milestones whose entry for today is a manual request, as a Set of ids: the timer waits on those (the server
 * refuses a timer where manual hours sit). Reads the same cached week as useLoggable, so it adds no request. */
export function useManualToday() {
  const { user } = useSession()
  const enabled = can(user, 'timer.use')
  const week = useWeek(nyMondayIso(), undefined, enabled)
  if (!enabled) return new Set()
  const today = nyTodayIso()
  return new Set((week.data?.entries ?? []).filter((e) => e.work_date === today && e.manual)
    .map((e) => String(e.milestone_id)))
}
