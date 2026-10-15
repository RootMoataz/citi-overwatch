import { describe, expect, test } from 'vitest'
import { users } from '../../test/render.jsx'
import { buildSummary, humanizeType, weekPhrase } from './summary.js'

const TODAY = '2026-10-15' // a Thursday; this week starts Mon 12 Oct
const note = (id, type, extra = {}) => ({ id, type, week_start: null, payload: {}, subject_user: { id: 'u-x', name: 'Someone' },
  message: `${type} message`, created_at: '2026-10-15T09:00:00Z', ...extra })
const pending = (userId, workDate) => ({ entry: { id: `${userId}-${workDate}`, work_date: workDate }, user: { id: userId } })
const texts = (items) => items.map((i) => i.text)

describe('weekPhrase', () => {
  test('says this week, last week, or the week of a date', () => {
    expect(weekPhrase('2026-10-12', TODAY)).toBe('this week')
    expect(weekPhrase('2026-10-05', TODAY)).toBe('last week')
    expect(weekPhrase('2026-09-28', TODAY)).toBe('the week of Sep 28, 2026')
  })
})

describe('summary sentences', () => {
  test('an employee hears about their empty timesheet, rejected hours and unread messages, in plain sentences', () => {
    const items = buildSummary({
      user: users.employee, today: TODAY, unreadMessages: 2,
      notifications: [
        note('n1', 'TIMESHEET_EMPTY', { week_start: '2026-10-12' }),
        note('n2', 'ENTRY_REJECTED', { week_start: '2026-10-05' }),
        note('n3', 'MESSAGE_RECEIVED', { payload: { conversation_id: 'c1', name: 'Morgan Manager' } }),
      ],
      // Not an approver: pending hours are not their business, even if handed in.
      approvals: [pending('u-a', '2026-10-12')],
    })
    expect(texts(items)).toEqual([
      'Your timesheet for this week is empty',
      '1 of your time entries was rejected',
      '2 unread messages from Morgan',
    ])
    expect(items.map((i) => i.to)).toEqual(['/timesheet?week=2026-10-12', '/timesheet?week=2026-10-05', '/messages/c1'])
  })

  test('a manager hears how many timesheets wait for approval (one per person per week), overtime and missing hours', () => {
    const items = buildSummary({
      user: users.manager, today: TODAY,
      approvals: [pending('u-a', '2026-10-12'), pending('u-a', '2026-10-13'), pending('u-b', '2026-10-12'),
        pending('u-a', '2026-10-06')],
      notifications: [
        note('o1', 'OVER_40H', { week_start: '2026-10-12', subject_user: { id: 'u-eli', name: 'Eli Employee' } }),
      ],
      missing: { week_start: '2026-10-05', due: false, people: [{ id: 'p1' }, { id: 'p2' }] },
    })
    expect(texts(items)).toEqual([
      '3 timesheets are waiting for your approval',
      'Eli Employee went over 40 hours this week',
      "2 of your people haven't logged hours for last week",
    ])
    expect(items[0].to).toBe('/approvals')
    expect(items[1].to).toBe('/approvals?user=u-eli')
  })

  test('singular and plural read naturally', () => {
    const one = buildSummary({ user: users.manager, today: TODAY, approvals: [pending('u-a', '2026-10-12')],
      missing: { week_start: '2026-10-12', due: true, people: [{ id: 'p1' }] } })
    expect(texts(one)).toEqual(['1 timesheet is waiting for your approval',
      "1 person on your team hasn't logged hours for this week"])
    const many = buildSummary({ user: users.manager, today: TODAY, notifications: [
      note('o1', 'OVER_40H', { week_start: '2026-10-12', subject_user: { id: 'a', name: 'A A' } }),
      note('o2', 'OVER_40H', { week_start: '2026-10-12', subject_user: { id: 'b', name: 'B B' } }),
      note('r1', 'ENTRY_REJECTED', { week_start: '2026-10-12' }), note('r2', 'ENTRY_REJECTED', { week_start: '2026-10-05' }),
    ] })
    expect(texts(many)).toEqual(['2 of your time entries were rejected', '2 people went over 40 hours'])
  })

  test('an executive never hears about approvals or missing timesheets', () => {
    const items = buildSummary({ user: users.executive, today: TODAY, approvals: [pending('u-a', '2026-10-12')],
      missing: { week_start: '2026-10-12', due: true, people: [{ id: 'p1' }] } })
    expect(items).toEqual([])
  })

  test('messages name up to two senders, then say how many more', () => {
    const msg = (id, name) => note(id, 'MESSAGE_RECEIVED', { payload: { conversation_id: id, name } })
    expect(texts(buildSummary({ user: users.admin, today: TODAY, unreadMessages: 5,
      notifications: [msg('c1', 'Morgan Manager'), msg('c2', 'Ava Admin')] })))
      .toEqual(['5 unread messages from Morgan and Ava'])
    const three = buildSummary({ user: users.admin, today: TODAY, unreadMessages: 4,
      notifications: [msg('c1', 'Morgan Manager'), msg('c2', 'Ava Admin'), msg('c3', 'Eli Employee'), msg('c4', 'Eli Employee')] })
    expect(texts(three)).toEqual(['4 unread messages from Morgan, Ava and 1 more'])
    expect(three[0].to).toBe('/messages')
    // Unread messages whose alerts were already cleared still count.
    expect(texts(buildSummary({ user: users.admin, today: TODAY, unreadMessages: 1 }))).toEqual(['1 unread message'])
  })

  test('support, claims and delegation each get a sentence', () => {
    const items = buildSummary({ user: users.manager, today: TODAY, notifications: [
      note('s1', 'SUPPORT_ASSIGNED', { payload: { milestone: { name: 'API' }, project: { id: 'p1', name: 'Apollo' } } }),
      note('s2', 'SUPPORT_ROUTED', { message: 'Eli Employee was auto-routed to support API' ,
        payload: { project: { id: 'p1' } } }),
      note('c1', 'MILESTONE_CLAIMED', { payload: { project: { id: 'p1' } } }),
      note('c2', 'MILESTONE_CLAIMED', { payload: { project: { id: 'p2' } } }),
      note('d1', 'DELEGATE_ASSIGNED', { payload: { project: { id: 'p1', name: 'Apollo' } } }),
    ] })
    expect(texts(items)).toEqual([
      'You were added as support on API (Apollo)',
      'Eli Employee was auto-routed to support API',
      '2 milestones were claimed by your team',
      "You're the delegate approver for Apollo",
    ])
    expect(items[0].to).toBe('/projects/p1?tab=milestones')
  })

  test('unknown notification types (added later) get a generic sentence instead of breaking', () => {
    const items = buildSummary({ user: users.employee, today: TODAY, notifications: [
      note('k1', 'KICKBACK_RAISED', { message: 'Morgan sent API back to you', payload: { project: { id: 'p9' } } }),
      note('p1', 'PLAN_FINALIZED', { message: '' }), note('p2', 'PLAN_FINALIZED', { message: '' }),
      note('h1', 'HR_SUBMISSION', { message: undefined, payload: null }),
    ] })
    expect(texts(items)).toEqual([
      'Morgan sent API back to you',
      '2 new plan finalized notifications',
      'You have a new hr submission notification',
    ])
    expect(items.map((i) => i.to)).toEqual(['/projects/p9', null, null])
  })

  test('nothing waiting means an empty summary', () => {
    expect(buildSummary({ user: users.employee, today: TODAY })).toEqual([])
  })

  test('humanizeType turns a type code into words', () => {
    expect(humanizeType('PLAN_FINALIZED')).toBe('plan finalized')
    expect(humanizeType(undefined)).toBe('new')
  })
})
