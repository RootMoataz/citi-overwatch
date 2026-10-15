// What Puppy can do for the viewer. Every action is shown first with a sentence saying exactly what will happen, and
// runs only after Confirm, through Scout's normal pages and APIs as the viewer (so the server's role checks and the
// audit log apply as usual). Puppy never approves, rejects, archives, deletes or changes roles or money: for those it
// only opens the right page, and the decision stays with the person.
import { RISK_LABELS } from '../../lib/labels.js'
import { formatDate } from '../../lib/format.js'
import { can } from '../../lib/permissions.js'

/** Words no Puppy action may contain (checked by a test for every role). */
export const DESTRUCTIVE = ['reject', 'archive', 'delete', 'restore', 'remove', 'approve all', 'bulk', 'change role', 'salary']

export const REPORT_ROLES = ['admin', 'manager', 'executive']

function mondayOfIso(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0]

/**
 * ({user, today, unread, mode, projects, contacts, approvals}) → [{id, label, confirm, to?, mode?}]
 *   unread     unread notifications count       projects   the viewer's own project list (allow-listed)
 *   contacts   GET /messages/contacts items     approvals  the viewer's approvals queue (approvers only)
 */
export function buildActions({ user, today, unread = 0, mode = 'light', projects = [], contacts = [], approvals = [] } = {}) {
  if (!user) return []
  const out = []
  if (unread > 0) {
    out.push({ id: 'mark-read', label: 'Mark all notifications read',
      confirm: `Puppy will mark ${unread} ${unread === 1 ? 'notification' : 'notifications'} as read.` })
  }
  if (can(user, 'timesheet.use')) {
    const week = mondayOfIso(today)
    out.push({ id: 'open-timesheet', label: "Open this week's timesheet", to: `/timesheet?week=${week}`,
      confirm: `Puppy will open your timesheet for the week of ${formatDate(week)}.` })
  }
  if (user.role === 'employee') {
    const manager = contacts.find((c) => c?.relation === 'Your manager') ?? contacts[0]
    if (manager?.id) {
      out.push({ id: 'message-manager', label: `Message ${firstName(manager.name)}`, to: `/messages?to=${manager.id}`,
        confirm: `Puppy will start a new message to ${manager.name}. You write it and press Send.` })
    }
  }
  if (can(user, 'approvals.view')) {
    const n = approvals.length
    out.push({ id: 'open-approvals', label: 'Open pending approvals', to: '/timesheets',
      confirm: n ? `Puppy will open Timesheets with ${n} pending ${n === 1 ? 'entry' : 'entries'}. Approving stays your decision.`
        : 'Puppy will open Timesheets. Approving stays your decision.' })
  }
  const risky = [...projects].filter((p) => p.at_risk_reasons?.length)
    .sort((a, b) => b.at_risk_reasons.length - a.at_risk_reasons.length)[0]
  if (risky) {
    const reasons = risky.at_risk_reasons.map((r) => RISK_LABELS[r] ?? r).join(', ')
    out.push({ id: 'open-at-risk', label: `Open ${risky.name} (at risk)`, to: `/projects/${risky.id}`,
      confirm: `Puppy will open ${risky.name}, which is at risk: ${reasons}.` })
  }
  if (REPORT_ROLES.includes(user.role)) {
    out.push({ id: 'email-report', label: 'Email this report to me', to: '/?report=email',
      confirm: 'Puppy will open Email this report on your dashboard with Send to me on. You press Send.' })
  }
  const next = mode === 'dark' ? 'light' : 'dark'
  out.push({ id: 'theme', label: `Switch to the ${next} theme`, mode: next, confirm: `Puppy will switch Scout to the ${next} theme.` })
  out.push({ id: 'sound', label: 'Change the alert sound', confirm: "Puppy will open its sound settings. Nothing changes until you pick one." })
  return out
}
