// Pending entries by person and week: how Timesheets' To review and the milestone panel's Approvals tab group them.
// A person-week is also what the server approves in one step (POST /approvals/approve-week, all or nothing).
import { mondayOf } from './format.js'

/** "2026-10-14" → "2026-10-12" (its Monday), without timezone shifts. */
const weekOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return mondayOf(new Date(y, m - 1, d))
}

/**
 * Approval items (`GET /approvals`) as [{ key, user, week, items }]: oldest week first, people in the order the server
 * sorted them, and each group's items in the order they came.
 */
export function groupByPersonWeek(items) {
  const groups = new Map()
  for (const item of items) {
    const week = weekOf(item.entry.work_date)
    const key = `${item.user.id}|${week}`
    if (!groups.has(key)) groups.set(key, { key, user: item.user, week, items: [] })
    groups.get(key).items.push(item)
  }
  return [...groups.values()].sort((a, b) => a.week.localeCompare(b.week))
}
