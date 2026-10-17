// Puppy's summary: the unread notifications (and a few things the app already knows) turned into plain sentences,
// each with the page to open. Fixed rules, no AI. Pure, so every sentence is tested.
//
// buildSummary({ user, today, notifications, unreadMessages, approvals, missing, unsubmitted, timerWarnings, live,
//               changeRequests }) → [{ id, text, to, strong? }]
//   strong          the part of `text` the panel shows in bold, when it has one: waiting on someone ("waiting for your
//                   approval"), a limit passed ("over 40 hours"), hours sent back ("rejected") or a kickback
//   notifications   the unread list from GET /notifications
//   unreadMessages  the unread message count from GET /messages/unread-count
//   approvals       pending hours from GET /approvals (approvers only), cut down by privacy.pickApproval
//   missing         GET /timesheet-reminders: {week_start, people} (managers and admins only)
//   unsubmitted     the viewer's timer hours not submitted yet (GET /timers/current), per cell
//   timerWarnings   limits the viewer's running timer has reached right now ({milestone, message})
//   live            running timers the viewer oversees (GET /timers/live: managers, admins, executives)
//   changeRequests  change requests on timer hours waiting for the viewer (GET /time-edit-requests: approvers)
// Types Puppy doesn't know yet (new ones are being added) get a generic sentence, never an error.
import { formatDate } from '../../lib/format.js'
import { can } from '../../lib/permissions.js'

const DAY_MS = 86400000

/** Monday (YYYY-MM-DD) of the week holding the date `iso` (YYYY-MM-DD). */
function mondayOfIso(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

/** "this week", "last week" or "the week of Sep 28, 2026", seen from `today`. */
export function weekPhrase(weekStart, today) {
  const week = mondayOfIso(weekStart)
  const current = mondayOfIso(today)
  if (week === current) return 'this week'
  if (Date.parse(current) - Date.parse(week) === 7 * DAY_MS) return 'last week'
  return `the week of ${formatDate(week)}`
}

/** "PLAN_FINALIZED" → "plan finalized". */
export const humanizeType = (type) => (type ? String(type).toLowerCase().replace(/_+/g, ' ').trim() : 'new')

const plural = (count, one, many) => (count === 1 ? one : many)
const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'someone'
const latest = (items, field = 'week_start') => items.map((n) => n[field]).filter(Boolean).sort().at(-1)
const projectOf = (n) => n.payload?.project ?? null

function namesPhrase(names) {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

function approvalsSentence(approvals) {
  const timesheets = new Set(approvals.map((a) => `${a.user?.id}:${mondayOfIso(a.entry?.work_date ?? '')}`)).size
  if (!timesheets) return null
  return { id: 'approvals', to: '/timesheets', strong: 'waiting for your approval',
    text: `${timesheets} ${plural(timesheets, 'timesheet is', 'timesheets are')} waiting for your approval` }
}

/** "3 entries have red flags": pending entries the server flagged for a second look (approvers only). */
function flagsSentence(approvals) {
  const n = approvals.filter((a) => a?.flagged).length
  if (!n) return null
  return { id: 'approval-flags', to: '/timesheets',
    text: `${n} ${plural(n, 'entry has', 'entries have')} red flags worth a second look` }
}

function emptyTimesheet(items, today) {
  const week = latest(items)
  if (items.length > 1) {
    return { id: 'TIMESHEET_EMPTY', to: `/timesheet?week=${week}`, text: `${items.length} of your weekly timesheets are empty` }
  }
  return { id: 'TIMESHEET_EMPTY', to: week ? `/timesheet?week=${week}` : '/timesheet',
    text: `Your timesheet for ${week ? weekPhrase(week, today) : 'this week'} is empty` }
}

function rejected(items) {
  const week = latest(items)
  return { id: 'ENTRY_REJECTED', to: week ? `/timesheet?week=${week}` : '/timesheet', strong: 'rejected',
    text: `${items.length} of your time ${plural(items.length, 'entries was', 'entries were')} rejected` }
}

function messages(items, unread) {
  const count = unread || items.length
  if (!count) return null
  const names = [...new Set(items.map((n) => firstName(n.payload?.name ?? n.subject_user?.name)))]
  const conversations = [...new Set(items.map((n) => n.payload?.conversation_id).filter(Boolean))]
  const noun = `${count} unread ${plural(count, 'message', 'messages')}`
  return { id: 'MESSAGE_RECEIVED', to: conversations.length === 1 ? `/messages/${conversations[0]}` : '/messages',
    text: names.length ? `${noun} from ${namesPhrase(names)}` : noun }
}

function overtime(items, today) {
  const people = new Map(items.map((n) => [String(n.subject_user?.id), n]))
  if (people.size === 1) {
    const [n] = people.values()
    const when = n.week_start ? weekPhrase(n.week_start, today) : 'this week'
    return { id: 'OVER_40H', to: `/timesheets?user=${n.subject_user?.id}`, strong: 'over 40 hours',
      text: `${n.subject_user?.name ?? 'Someone'} went over 40 hours ${when.startsWith('the week') ? `in ${when}` : when}` }
  }
  return { id: 'OVER_40H', to: '/timesheets', strong: 'over 40 hours', text: `${people.size} people went over 40 hours` }
}

function missingSentence(missing, today) {
  const count = missing?.people?.length ?? 0
  if (!count) return null
  const who = count === 1 ? "1 person on your team hasn't" : `${count} of your people haven't`
  return { id: 'missing', to: '/', text: `${who} logged hours for ${weekPhrase(missing.week_start, today)}` }
}

/** "Your timer hours for Tuesday aren't submitted yet" (or for N days): they wait in the timesheet as drafts. */
function unsubmittedSentence(cells) {
  const days = [...new Set(cells.map((c) => c.work_date).filter(Boolean))].sort()
  if (!days.length) return null
  const to = `/timesheet?week=${cells.find((c) => c.work_date === days[0])?.week_start ?? mondayOfIso(days[0])}`
  return { id: 'timer-unsubmitted', to,
    text: days.length === 1 ? `Your timer hours for ${weekdayOf(days[0])} aren't submitted yet`
      : `Your timer hours for ${days.length} days aren't submitted yet` }
}

/** The viewer's own running timer at a limit: the warning the banner shows. */
function timerWarningSentence(warnings) {
  if (!warnings.length) return null
  const w = warnings[0]
  return { id: 'timer-limit', to: '/timesheet', strong: w.message,
    text: `${w.message} (timer on ${w.milestone?.name ?? 'a milestone'})` }
}

const LIMIT_PHRASE = { daily: 'the daily limit', milestone: 'its estimate', weekly: 'the weekly limit' }

/** Managers: who's running a timer now, and whose timer is past a limit. */
function liveSentences(live) {
  if (!live.length) return []
  const out = [{ id: 'timers-live', to: '/timesheets',
    text: `${live.length} ${plural(live.length, 'person is', 'people are')} running ${plural(live.length, 'a timer', 'timers')} now` }]
  const past = live.filter((t) => t.level === 'warning' || t.level === 'over')
  if (past.length === 1) {
    const t = past[0]
    const kind = (t.limits ?? []).find((l) => l.level === t.level)?.kind ?? 'daily'
    const limit = `${t.level === 'over' ? 'over' : 'at'} ${LIMIT_PHRASE[kind]}`
    out.push({ id: 'timers-over', to: '/timesheets', strong: limit, text: `${firstName(t.person?.name)}'s timer is ${limit}` })
  } else if (past.length > 1) {
    out.push({ id: 'timers-over', to: '/timesheets', strong: 'at or over their limits',
      text: `${past.length} timers are at or over their limits` })
  }
  return out
}

function changeRequestsSentence(requests) {
  const n = requests.length
  if (!n) return null
  const waiting = `${plural(n, 'is', 'are')} waiting`
  return { id: 'change-requests', to: '/timesheets#change-requests', strong: waiting,
    text: `${n} change ${plural(n, 'request', 'requests')} on timer hours ${waiting}` }
}

/** "Morgan stopped your timer on Schema Mapping" (never the message itself: that's in Messages). */
function stoppedByManager(items) {
  const n = items[0]
  const week = n.week_start ?? n.payload?.week_start
  if (items.length > 1) {
    return { id: 'TIMER_STOPPED_BY_MANAGER', to: '/messages', text: `Your timer was stopped ${items.length} times by your manager` }
  }
  return { id: 'TIMER_STOPPED_BY_MANAGER', to: week ? `/timesheet?week=${week}` : '/timesheet',
    text: `${firstName(n.payload?.by?.name ?? n.subject_user?.name)} stopped your timer on ${n.payload?.milestone?.name ?? 'a milestone'}` }
}

function editDecided(type, approved) {
  return (items) => {
    const n = items[0]
    const week = n.week_start ?? n.payload?.week_start
    const what = items.length === 1 ? `Your change to ${n.payload?.milestone?.name ?? 'your hours'} was`
      : `${items.length} of your changes were`
    return { id: type, to: week ? `/timesheet?week=${week}` : '/timesheet', text: `${what} ${approved ? 'approved' : 'declined'}` }
  }
}

/** "2026-10-13" → "Tuesday". */
function weekdayOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

function support(items) {
  if (items.length === 1) {
    const p = items[0].payload ?? {}
    const project = projectOf(items[0])
    return { id: 'SUPPORT_ASSIGNED', to: project ? `/projects/${project.id}?tab=milestones` : '/',
      text: `You were added as support on ${p.milestone?.name ?? 'a milestone'}${project?.name ? ` (${project.name})` : ''}` }
  }
  return { id: 'SUPPORT_ASSIGNED', to: '/', text: `You were added as support on ${items.length} milestones` }
}

/** One sentence for a group: the server's own message when there's one, a counted sentence for several. */
const single = (id, items, many) => {
  const project = projectOf(items[0])
  const to = items.length === 1 && project ? `/projects/${project.id}?tab=milestones` : '/'
  return { id, to, text: items.length === 1 && items[0].message ? items[0].message : many(items.length) }
}

function delegate(items) {
  const project = projectOf(items[0])
  if (items.length === 1) {
    return { id: 'DELEGATE_ASSIGNED', to: project ? `/timesheets?project=${project.id}` : '/timesheets',
      text: `You're the delegate approver for ${project?.name ?? 'a project'}` }
  }
  return { id: 'DELEGATE_ASSIGNED', to: '/timesheets', text: `You're a delegate approver on ${items.length} projects` }
}

/** The milestone an alert is about, on its project's Milestones tab (as the bell links it). */
const milestoneTo = (n) => {
  const project = projectOf(n)
  const milestone = n.payload?.milestone
  if (!project?.id) return '/'
  return milestone?.id ? `/projects/${project.id}?tab=milestones&milestone=${milestone.id}` : `/projects/${project.id}?tab=milestones`
}

/** Milestone workflow and planning alerts: the server's sentence for one, a counted sentence for several. `strong`: the
 * counted sentence's bold words (the server's own sentence is shown as it comes). */
const workflow = (id, many, strong) => (items) => {
  const own = items.length === 1 && items[0].message
  return { id, to: items.length === 1 ? milestoneTo(items[0]) : '/', text: own ? items[0].message : many(items.length),
    ...(strong && !own ? { strong } : {}) }
}

const WORKFLOW = [
  ['AUTO_ASSIGNED', (n) => `You were auto-assigned to ${n} milestones`],
  ['AUTO_ROUTED', (n) => `${n} milestones were auto-assigned on your projects`],
  ['NO_QUALIFIED_PERSON', (n) => `${n} milestones are ready but nobody free has the skills`],
  ['KICKBACK_RAISED', (n) => `${n} milestones were kicked back to you for review`, 'kicked back'],
  ['KICKBACK_RESOLVED', (n) => `${n} of your kickbacks were resolved`],
  ['MILESTONE_UPDATE', (n) => `${n} new progress updates on your milestones`],
  ['PLAN_FINALIZED', (n) => `${n} project plans were finalized`],
]

function unknown(type, items) {
  const project = projectOf(items[0])
  const to = items.length === 1 && project?.id ? `/projects/${project.id}` : null
  const label = humanizeType(type)
  if (items.length > 1) return { id: type, to, text: `${items.length} new ${label} notifications` }
  return { id: type, to, text: items[0].message || `You have a new ${label} notification` }
}

// TIME_EDIT_REQUESTED and TIMER_OVER_LIMIT are told from the change requests and the live feed instead.
const KNOWN = new Set(['TIMESHEET_EMPTY', 'ENTRY_REJECTED', 'MESSAGE_RECEIVED', 'OVER_40H', 'SUPPORT_ASSIGNED',
  'SUPPORT_ROUTED', 'MILESTONE_CLAIMED', 'DELEGATE_ASSIGNED', 'TIMER_STOPPED_BY_MANAGER', 'TIME_EDIT_APPROVED',
  'TIME_EDIT_REJECTED', 'TIME_EDIT_REQUESTED', 'TIMER_OVER_LIMIT', ...WORKFLOW.map(([type]) => type)])

export function buildSummary({ user, today = new Date().toISOString().slice(0, 10), notifications = [], unreadMessages = 0,
  approvals = [], missing = null, unsubmitted = [], timerWarnings = [], live = [], changeRequests = [] } = {}) {
  const byType = new Map()
  for (const n of notifications ?? []) {
    if (!byType.has(n.type)) byType.set(n.type, [])
    byType.get(n.type).push(n)
  }
  const of = (type) => byType.get(type) ?? []
  const when = (items, make) => (items.length ? make(items) : null)
  const manages = user?.role === 'manager' || user?.role === 'admin'

  const sentences = [
    can(user, 'timer.use') ? timerWarningSentence(timerWarnings ?? []) : null,
    can(user, 'timer.use') ? unsubmittedSentence(unsubmitted ?? []) : null,
    can(user, 'approvals.view') ? changeRequestsSentence(changeRequests ?? []) : null,
    ...(can(user, 'timesheets.view') ? liveSentences(live ?? []) : []),
    can(user, 'approvals.view') ? approvalsSentence(approvals ?? []) : null,
    can(user, 'approvals.view') ? flagsSentence(approvals ?? []) : null,
    when(of('TIMESHEET_EMPTY'), (items) => emptyTimesheet(items, today)),
    when(of('ENTRY_REJECTED'), rejected),
    messages(of('MESSAGE_RECEIVED'), unreadMessages),
    when(of('OVER_40H'), (items) => overtime(items, today)),
    manages ? missingSentence(missing, today) : null,
    when(of('SUPPORT_ASSIGNED'), support),
    when(of('SUPPORT_ROUTED'), (items) => single('SUPPORT_ROUTED', items,
      (count) => `${count} people were auto-routed to support work`)),
    when(of('MILESTONE_CLAIMED'), (items) => single('MILESTONE_CLAIMED', items,
      (count) => `${count} milestones were claimed by your team`)),
    when(of('DELEGATE_ASSIGNED'), delegate),
    when(of('TIMER_STOPPED_BY_MANAGER'), stoppedByManager),
    when(of('TIME_EDIT_APPROVED'), editDecided('TIME_EDIT_APPROVED', true)),
    when(of('TIME_EDIT_REJECTED'), editDecided('TIME_EDIT_REJECTED', false)),
    ...WORKFLOW.map(([type, many, strong]) => when(of(type), workflow(type, many, strong))),
    ...[...byType].filter(([type]) => !KNOWN.has(type)).map(([type, items]) => unknown(type, items)),
  ]
  return sentences.filter(Boolean)
}
