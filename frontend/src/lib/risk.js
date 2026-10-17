// Why a project is at risk, in order of severity. The order is the backend's (`RISK_ORDER`), so the Risk column,
// the health chip and `sort=risk` all agree on "the first reason".
import { daysBetween, formatDate, plural } from './format.js'
import { RISK_LABELS } from './labels.js'

export const RISK_ORDER = ['PAST_DUE', 'BUDGET_BURN', 'OVERDUE_MILESTONE', 'BLOCKED_MILESTONE']

/** The reasons, most severe first; codes this app doesn't know come last, in their given order. */
export function orderedRisks(reasons) {
  const list = Array.isArray(reasons) ? reasons : []
  const rank = (code) => (RISK_ORDER.includes(code) ? RISK_ORDER.indexOf(code) : RISK_ORDER.length)
  return list.map((code, i) => ({ code, i })).sort((a, b) => rank(a.code) - rank(b.code) || a.i - b.i).map((x) => x.code)
}

export const primaryRisk = (reasons) => orderedRisks(reasons)[0] ?? null

/** One sentence for the tooltip. `today` is the New York date (YYYY-MM-DD). */
export function riskSentence(code, project, today) {
  if (code === 'PAST_DUE') {
    const ago = daysBetween(project.predicted_end_date, today)
    // The server counts from the New York date too, so this shouldn't happen; if it does, never "0 days ago".
    if (!(ago > 0)) return "Ended today and isn't completed."
    return `Ended ${formatDate(project.predicted_end_date)}, ${plural(ago, 'day')} ago, and isn't completed.`
  }
  if (code === 'BUDGET_BURN') {
    const used = Math.round(Number(project.budget_pct ?? 0))
    const progress = Math.round(Number(project.progress_pct ?? 0))
    return `${used}% of the budget used against ${progress}% progress: ${plural(used - progress, 'point')} ahead.`
  }
  return RISK_LABELS[code] ?? code
}

export const DUE_TODAY = 'Due today'

/** "8 days left", "Due today" or "3 days overdue" (overdue: true); null once the project is completed. */
export function dueLine(project, today) {
  if (project.status === 'completed' || !project.predicted_end_date) return null
  const left = daysBetween(today, project.predicted_end_date)
  if (left > 0) return { text: `${plural(left, 'day')} left`, overdue: false }
  if (left === 0) return { text: DUE_TODAY, overdue: false }
  return { text: `${plural(-left, 'day')} overdue`, overdue: true }
}
