// Pending entries by person and week: how Timesheets' To review and the milestone panel's Approvals tab group them.
// A person-week is also what the server approves in one step (POST /approvals/approve-week, all or nothing).
import { mondayOfIso } from './format.js'

/** The hours of approval items (`GET /approvals`) added up: what "<N>h awaiting approval" counts. */
export const pendingHoursOf = (items) => (items ?? []).reduce((sum, item) => sum + Number(item?.entry?.hours ?? 0), 0)

/**
 * Approval items (`GET /approvals`) as [{ key, user, week, items }]: oldest week first, people in the order the server
 * sorted them, and each group's items in the order they came.
 */
export function groupByPersonWeek(items) {
  const groups = new Map()
  for (const item of items) {
    const week = mondayOfIso(item.entry.work_date)
    const key = `${item.user.id}|${week}`
    if (!groups.has(key)) groups.set(key, { key, user: item.user, week, items: [] })
    groups.get(key).items.push(item)
  }
  return [...groups.values()].sort((a, b) => a.week.localeCompare(b.week))
}
