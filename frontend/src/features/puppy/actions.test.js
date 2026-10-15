import { describe, expect, test } from 'vitest'
import { users } from '../../test/render.jsx'
import { DESTRUCTIVE, buildActions } from './actions.js'

const TODAY = '2026-10-15'
const base = {
  today: TODAY, unread: 5, mode: 'light',
  projects: [{ id: 'p1', name: 'Apollo', at_risk_reasons: [] }, { id: 'p2', name: 'Atlas', at_risk_reasons: ['PAST_DUE'] }],
  contacts: [{ id: 'u-x', name: 'Pat Project', relation: 'Manages Apollo' }, { id: 'u-mgr', name: 'Morgan Manager', relation: 'Your manager' }],
  approvals: [{ entry: { id: 'e1', work_date: '2026-10-12' }, user: { id: 'u-a' } }],
}
const ids = (user, extra = {}) => buildActions({ user, ...base, ...extra }).map((a) => a.id)

describe('do-it-for-me actions', () => {
  test('each role gets only what it may do', () => {
    expect(ids(users.employee)).toEqual(['mark-read', 'open-timesheet', 'message-manager', 'open-at-risk', 'theme', 'sound'])
    // Managers and admins keep a timesheet only when "Tracks own hours" is on for them.
    expect(ids(users.manager)).toEqual(['mark-read', 'open-approvals', 'open-at-risk', 'email-report', 'theme', 'sound'])
    expect(ids(users.admin)).toEqual(['mark-read', 'open-approvals', 'open-at-risk', 'email-report', 'theme', 'sound'])
    expect(ids({ ...users.manager, tracks_own_hours: true }))
      .toEqual(['mark-read', 'open-timesheet', 'open-approvals', 'open-at-risk', 'email-report', 'theme', 'sound'])
    expect(buildActions({ user: users.manager, ...base }).find((a) => a.id === 'open-approvals').to).toBe('/timesheets')
    // Executives are read-only: no timesheet, no approvals.
    expect(ids(users.executive)).toEqual(['mark-read', 'open-at-risk', 'email-report', 'theme', 'sound'])
  })

  test('nothing destructive or money-affecting is ever offered, for any role', () => {
    for (const user of Object.values(users)) {
      for (const action of buildActions({ user, ...base })) {
        expect(DESTRUCTIVE.some((word) => `${action.id} ${action.label} ${action.confirm}`.toLowerCase().includes(word))).toBe(false)
      }
    }
  })

  test('every action says exactly what will happen before it happens', () => {
    const byId = Object.fromEntries(buildActions({ user: users.employee, ...base }).map((a) => [a.id, a]))
    expect(byId['mark-read'].confirm).toBe('Puppy will mark 5 notifications as read.')
    expect(byId['open-timesheet']).toMatchObject({ to: '/timesheet?week=2026-10-12',
      confirm: 'Puppy will open your timesheet for the week of Oct 12, 2026.' })
    expect(byId['message-manager']).toMatchObject({ to: '/messages?to=u-mgr', label: 'Message Morgan',
      confirm: 'Puppy will start a new message to Morgan Manager. You write it and press Send.' })
    expect(byId['open-at-risk']).toMatchObject({ to: '/projects/p2', confirm: 'Puppy will open Atlas, which is at risk: Past due date.' })
    expect(byId.theme).toMatchObject({ label: 'Switch to the dark theme', mode: 'dark' })
    const manager = Object.fromEntries(buildActions({ user: users.manager, ...base }).map((a) => [a.id, a]))
    expect(manager['open-approvals'].confirm).toBe('Puppy will open Timesheets with 1 pending entry. Approving stays your decision.')
    expect(manager['email-report']).toMatchObject({ to: '/?report=email',
      confirm: 'Puppy will open Email this report on your dashboard with Send to me on. You press Send.' })
  })

  test('actions with nothing to act on are left out', () => {
    const none = { unread: 0, projects: [{ id: 'p1', name: 'Apollo', at_risk_reasons: [] }], contacts: [], approvals: [] }
    expect(ids(users.employee, none)).toEqual(['open-timesheet', 'theme', 'sound'])
    expect(ids(users.manager, none)).toEqual(['open-approvals', 'email-report', 'theme', 'sound'])
    expect(buildActions({ user: users.employee, ...base, mode: 'dark' }).find((a) => a.id === 'theme').mode).toBe('light')
  })
})
