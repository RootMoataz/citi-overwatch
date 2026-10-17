// Pure helpers that group a person's milestones for My week. `today` is a New York ISO date.
import { daysBetween, formatDate, plural } from '../../lib/format.js'
import { priorityRank } from '../../lib/labels.js'

const byName = (a, b) => String(a.name).localeCompare(String(b.name))
const byEnd = (a, b) => String(a.end_date).localeCompare(String(b.end_date))
const byStart = (a, b) => String(a.start_date).localeCompare(String(b.start_date))

export const isOverdue = (m, today) => m.status !== 'completed' && Boolean(m.end_date) && m.end_date < today

export const isWaiting = (m) => (m.waiting_on ?? []).length > 0
// No start date means nothing to wait for: it can start now.
const startsLater = (m, today) => Boolean(m.start_date) && m.start_date > today
const isReady = (m, today) => !isWaiting(m) && !startsLater(m, today)

/** Up next order: ready first, then future starts, then waiting. */
const upNextTier = (m, today) => (isWaiting(m) ? 2 : isReady(m, today) ? 0 : 1)

/** Most urgent first: overdue, then priority, then the soonest end date, then name. In progress and the claim list use it. */
export const urgentFirst = (today) => (a, b) =>
  Number(isOverdue(b, today)) - Number(isOverdue(a, today))
  || priorityRank(a.priority) - priorityRank(b.priority) || byEnd(a, b) || byName(a, b)

/** Groups use the stored `status` (not `display_status`, which would drop waiting work from every group). */
export function groupMilestones(milestones, today) {
  const mine = (milestones ?? []).filter((m) => m.role != null && !m.is_archived && !m.project?.is_archived)
  const of = (status) => mine.filter((m) => (Array.isArray(status) ? status.includes(m.status) : m.status === status))
  return {
    inProgress: of(['in_progress', 'blocked']).sort(urgentFirst(today)),
    upNext: of('not_started').sort((a, b) =>
      upNextTier(a, today) - upNextTier(b, today) || byStart(a, b) || byName(a, b)),
    review: of('ready_for_review').sort((a, b) => byEnd(a, b) || byName(a, b)),
    done: of('completed').sort((a, b) => byEnd(b, a) || byName(a, b)),
  }
}

const waitingNames = (m) => (m.waiting_on ?? []).map((w) => (typeof w === 'string' ? w : w.name))

export function upNextLabel(m, today) {
  if (isWaiting(m)) return `Waiting on ${waitingNames(m).join(', ')}`
  if (startsLater(m, today)) return `Starts ${formatDate(m.start_date)}`
  return 'Ready to start'
}

/** A prediction's readiness: "Ready now", or "After <the predecessors still open>". */
export const comingLabel = (item) => (item.ready ? 'Ready now' : `After ${waitingNames({ waiting_on: item.after }).join(', ')}`)

export function nowAndNext(groups, comingUp, today) {
  const now = groups.inProgress[0] ?? null
  const next = groups.upNext[0] ?? null
  const startNext = now ? null : groups.upNext.find((m) => isReady(m, today)) ?? null
  const first = comingUp?.[0]
  const priority = first?.milestone?.priority ?? first?.priority
  const urgent = first && (first.milestone?.end_date < today || priority === 'critical' || priority === 'high')
  return { now, next, startNext, headsUp: urgent ? first : null }
}

/** "1 overdue": the person's own open work (In progress and Upcoming, the rows that show a due line) past its end date;
 * '' when there is none. Work handed to the manager is theirs to complete, so it never counts. */
export function focusOverdue(groups, today) {
  const overdue = [...groups.inProgress, ...groups.upNext].filter((m) => isOverdue(m, today)).length
  return overdue ? `${overdue} overdue` : ''
}

/** "1 overdue · 1 with your manager": the overdue count (focusOverdue), then the work with the manager. */
export function focusSummary(groups, today) {
  return [focusOverdue(groups, today), groups.review.length ? `${groups.review.length} with your manager` : '']
    .filter(Boolean).join(' · ')
}

/** "10 days overdue" once the milestone is past its end date and unfinished, else null: the bold part of its due line. */
export function lateWords(m, today) {
  return isOverdue(m, today) ? `${plural(daysBetween(m.end_date, today), 'day')} overdue` : null
}

export function dueLine(m, today) {
  const due = `Due ${formatDate(m.end_date)}`
  const late = lateWords(m, today)
  if (!late) return { text: due, overdue: false }
  return { text: `${due} · ${late}`, overdue: true }
}

export function skillsSentence(names) {
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
  return `Needs ${list}, which you have`
}
