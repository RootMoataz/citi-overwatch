import { describe, expect, test } from 'vitest'
import { users } from '../../test/render.jsx'
import { askPuppy } from './ask.js'
import { buildActions } from './actions.js'
import { HELP } from './help.js'
import { SENSITIVE_KEYS, puppyView, redact, redactText } from './privacy.js'
import { buildSummary } from './summary.js'
import { buildTips } from './tips.js'

// Every sensitive value carries a marker; none may reach anything Puppy says or shows.
const MARK = 'LEAK'
const secrets = () => ({ salary: `${MARK}-salary`, hourly_rate: `${MARK}-rate`, temp_password: `${MARK}-temp`,
  code: `${MARK}-code`, email: `${MARK}@acme.example`, body: `${MARK}-body`, phone: `${MARK}-phone`,
  changes: { salary: `${MARK}-audit` }, cost: `${MARK}-cost`, password: `${MARK}-password` })

const TODAY = '2026-10-15'
const raw = () => ({
  notifications: [
    { id: 'n1', type: 'MESSAGE_RECEIVED', week_start: null, created_at: '2026-10-15T09:00:00Z', message: 'Morgan sent you a message',
      subject_user: { id: 'u-mgr', name: 'Morgan Manager', ...secrets() },
      payload: { conversation_id: 'c1', name: 'Morgan Manager', subject: `${MARK}-subject`, ...secrets() }, ...secrets() },
    { id: 'n2', type: 'ENTRY_REJECTED', week_start: '2026-10-12', created_at: '2026-10-15T09:00:00Z',
      message: 'Your 8h was rejected', subject_user: { id: 'u-emp', name: 'Eli' }, payload: { hours: 8, ...secrets() } },
    { id: 'n3', type: 'HR_SUBMISSION', week_start: null, created_at: '2026-10-15T09:00:00Z',
      message: `New hire form from ${MARK}x@acme.example, temporary password ${MARK}temp, code 482913`,
      subject_user: { id: 'u-x', name: 'Someone' }, payload: { project: { id: 'p1', name: 'Apollo', ...secrets() }, ...secrets() } },
    { id: 'n4', type: 'OVER_40H', week_start: '2026-10-12', created_at: '2026-10-15T09:00:00Z', message: 'Eli passed 40h',
      subject_user: { id: 'u-emp', name: 'Eli Employee', ...secrets() }, payload: { week_total: 45, ...secrets() } },
    { id: 'n5', type: 'TIMESHEET_EMPTY', week_start: '2026-10-12', created_at: '2026-10-15T09:00:00Z', message: 'Empty',
      subject_user: { id: 'u-emp', name: 'Eli' }, payload: { week_start: '2026-10-12', ...secrets() } },
  ],
  insights: [{ id: 'i1', severity: 'high', title: 'Budget burn', detail: `Ask ${MARK}y@acme.example`, link: { to: 'project', id: 'p1' },
    ...secrets() }],
  approvals: [{ entry: { id: 'e1', work_date: '2026-10-05', hourly_rate: `${MARK}-rate`, note: `${MARK}-note` },
    user: { id: 'u-a', name: 'Ann', ...secrets() }, ...secrets() }],
  missing: { week_start: '2026-10-12', people: [{ id: 'p1', name: 'Ann', ...secrets() }] },
  projects: [{ id: 'p1', name: 'Atlas', status: 'active', at_risk_reasons: ['PAST_DUE'], budget: 1, ...secrets() }],
  milestones: [{ id: 'm1', name: 'Cutover', project_id: 'p1', priority: 'critical', status: 'in_progress', end_date: '2026-10-17',
    ...secrets() }],
  contacts: [{ id: 'u-mgr', name: 'Morgan Manager', ...secrets() }],
})

describe('pickApproval', () => {
  test('keeps only whether an entry is flagged, never the flag text, note or hours', () => {
    const view = puppyView({ approvals: [
      { entry: { id: 'e1', work_date: '2026-10-12', hours: 9, note: 'secret note' }, user: { id: 'u-a', name: 'Ann' },
        flags: [{ code: 'LONG_DAY', severity: 'warn', message: '11h logged on Mon 12 Oct' }],
        progress_update: { body: 'secret update' } },
      { entry: { id: 'e2', work_date: '2026-10-13' }, user: { id: 'u-a' }, flags: [] }] })
    expect(view.approvals).toEqual([
      { entry: { id: 'e1', work_date: '2026-10-12' }, user: { id: 'u-a' }, flagged: true },
      { entry: { id: 'e2', work_date: '2026-10-13' }, user: { id: 'u-a' }, flagged: false }])
  })
})

describe('redact', () => {
  test('drops every sensitive key at any depth', () => {
    const out = redact({ a: 1, salary: 2, nested: { hourly_rate: 3, list: [{ email: 'x', keep: 'y' }] } })
    expect(out).toEqual({ a: 1, nested: { list: [{ keep: 'y' }] } })
    for (const key of ['salary', 'hourly_rate', 'temp_password', 'code', 'email', 'body']) expect(SENSITIVE_KEYS).toContain(key)
  })

  test('masks email addresses and one-time codes in free text', () => {
    expect(redactText('Write to eli@acme.example, code 482913')).toBe('Write to [hidden], code [hidden]')
    expect(redactText('Temporary password: Xy7!kq')).toBe('Temporary password: [hidden]')
    expect(redactText('3 timesheets wait')).toBe('3 timesheets wait')
  })
})

describe.each(Object.keys(users))('nothing sensitive reaches Puppy for the %s', (role) => {
  const user = users[role]
  const view = puppyView(raw())

  test('the view keeps only allow-listed fields', () => {
    expect(JSON.stringify(view)).not.toContain(MARK)
    expect(JSON.stringify(view)).not.toContain('482913')
  })

  test('summary, tips, actions, help and answers never say a sensitive value', () => {
    const said = [
      buildSummary({ user, today: TODAY, notifications: view.notifications, unreadMessages: 1, approvals: view.approvals,
        missing: view.missing }),
      buildTips({ user, today: TODAY, notifications: view.notifications, approvals: view.approvals, milestones: view.milestones }),
      buildActions({ user, today: TODAY, unread: view.notifications.length, projects: view.projects, contacts: view.contacts,
        approvals: view.approvals }),
      HELP,
      ...["what's Eli's salary?", 'why is Atlas at risk?', 'what is my hourly rate', 'give me the reset code',
        "what's Morgan's email address", 'how is progress calculated?'].map((q) => askPuppy(q, { user, projects: view.projects,
        people: [], departments: [] })),
    ]
    const text = JSON.stringify(said)
    expect(text).not.toContain(MARK)
    expect(text).not.toContain('482913')
  })
})
