// Puppy's proactive tips: at most three short nudges built from data the viewer already has, each with one button,
// each dismissible. Dismissals are kept per browser (ids carry the week or day, so next week's tip shows again).
import { can } from '../../lib/permissions.js'
import { weekPhrase } from './summary.js'

export const TIPS_KEY = 'overwatch.puppy.dismissedTips'
const MAX_TIPS = 3
const MAX_REMEMBERED = 100
const DAY_MS = 86400000

const daysBetween = (from, to) => Math.round((Date.parse(String(to).slice(0, 10)) - Date.parse(String(from).slice(0, 10))) / DAY_MS)

export function readDismissed() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(TIPS_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function dismissTip(id) {
  const known = readDismissed()
  const next = known.includes(id) ? known : [...known, id].slice(-MAX_REMEMBERED)
  try {
    window.localStorage.setItem(TIPS_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: the tip stays hidden until the page is closed.
  }
  return next
}

function dueText(days) {
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  return `due in ${days} days`
}

/** ({user, today, notifications, approvals, milestones, dismissed}) → up to 3 [{id, text, action: {label, to}}]. */
export function buildTips({ user, today, notifications = [], approvals = [], milestones = [], dismissed = [] } = {}) {
  if (!user) return []
  const tips = []
  const empty = notifications.filter((n) => n.type === 'TIMESHEET_EMPTY' && n.week_start).sort((a, b) =>
    String(b.week_start).localeCompare(String(a.week_start)))[0]
  if (empty && can(user, 'timesheet.use')) {
    tips.push({ id: `timesheet-empty:${empty.week_start}`,
      text: `Your timesheet for ${weekPhrase(empty.week_start, today)} is empty — want me to open it?`,
      action: { label: 'Open it', to: `/timesheet?week=${empty.week_start}` } })
  }
  if (can(user, 'approvals.view')) {
    const waiting = approvals.filter((a) => a.entry?.work_date && daysBetween(a.entry.work_date, today) >= 3).length
    if (waiting) {
      tips.push({ id: `approvals-old:${today}`,
        text: `${waiting} ${waiting === 1 ? 'entry' : 'entries'} logged 3+ days ago ${waiting === 1 ? 'is' : 'are'} still waiting — open Approvals?`,
        action: { label: 'Open Approvals', to: '/approvals' } })
    }
  }
  milestones
    .filter((m) => m.priority === 'critical' && m.status !== 'completed' && m.end_date)
    .map((m) => ({ m, days: daysBetween(today, m.end_date) }))
    .filter(({ days }) => days >= 0 && days <= 3)
    .sort((a, b) => a.days - b.days || String(a.m.name).localeCompare(String(b.m.name)))
    .forEach(({ m, days }) => tips.push({ id: `critical-due:${m.id}`, text: `${m.name} is critical and ${dueText(days)}`,
      action: { label: 'Open milestones', to: `/projects/${m.project_id}?tab=milestones` } }))
  const hidden = new Set(dismissed)
  return tips.filter((t) => !hidden.has(t.id)).slice(0, MAX_TIPS)
}
