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
    expect(items[0].to).toBe('/timesheets')
    expect(items[1].to).toBe('/timesheets?user=u-eli')
  })

  test('approvers hear how many waiting entries have red flags; employees never do', () => {
    const flagged = (userId, workDate) => ({ ...pending(userId, workDate), flagged: true })
    const approvals = [flagged('u-a', '2026-10-12'), flagged('u-a', '2026-10-13'), pending('u-b', '2026-10-12')]
    const items = buildSummary({ user: users.manager, today: TODAY, approvals })
    expect(texts(items)).toEqual(['2 timesheets are waiting for your approval',
      '2 entries have red flags worth a second look'])
    expect(items[1].to).toBe('/timesheets')
    expect(texts(buildSummary({ user: users.manager, today: TODAY, approvals: [flagged('u-a', '2026-10-12')] })))
      .toContain('1 entry has red flags worth a second look')
    expect(texts(buildSummary({ user: users.employee, today: TODAY, approvals }))).toEqual([])
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
      note('k1', 'SOMETHING_NEW', { message: 'Morgan sent API back to you', payload: { project: { id: 'p9' } } }),
      note('p1', 'BUDGET_ALERT', { message: '' }), note('p2', 'BUDGET_ALERT', { message: '' }),
      note('h1', 'HR_SUBMISSION', { message: undefined, payload: null }),
    ] })
    expect(texts(items)).toEqual([
      'Morgan sent API back to you',
      '2 new budget alert notifications',
      'You have a new hr submission notification',
    ])
    expect(items.map((i) => i.to)).toEqual(['/projects/p9', null, null])
  })

  test('milestone workflow and planning alerts read as sentences that open the milestone', () => {
    const ms = { project: { id: 'p1', name: 'Apollo' }, milestone: { id: 'm1', name: 'Cutover' } }
    const items = buildSummary({ user: users.employee, today: TODAY, notifications: [
      note('a1', 'AUTO_ASSIGNED', { message: 'You were auto-assigned to Cutover (Apollo)', payload: ms }),
      note('k1', 'KICKBACK_RAISED', { message: 'Ana kicked back Schema Mapping', payload: ms }),
      note('k2', 'KICKBACK_RESOLVED', { message: '', payload: ms }), note('k3', 'KICKBACK_RESOLVED', { message: '', payload: ms }),
      note('u1', 'MILESTONE_UPDATE', { message: 'Eli posted an update on Schema Mapping', payload: ms }),
      note('n1', 'NO_QUALIFIED_PERSON', { message: 'Nobody free has the skills for Cutover', payload: ms }),
      note('r1', 'AUTO_ROUTED', { message: 'Cutover went to Ben Okafor', payload: ms }),
      note('f1', 'PLAN_FINALIZED', { message: 'Beacon plan finalized: the first milestone is Discovery', payload: ms }),
    ] })
    expect(texts(items)).toEqual([
      'You were auto-assigned to Cutover (Apollo)',
      'Cutover went to Ben Okafor',
      'Nobody free has the skills for Cutover',
      'Ana kicked back Schema Mapping',
      '2 of your kickbacks were resolved',
      'Eli posted an update on Schema Mapping',
      'Beacon plan finalized: the first milestone is Discovery',
    ])
    expect(items[0].to).toBe('/projects/p1?tab=milestones&milestone=m1')
    expect(items[4].to).toBe('/')
  })

  test('nothing waiting means an empty summary', () => {
    expect(buildSummary({ user: users.employee, today: TODAY })).toEqual([])
  })

  test('humanizeType turns a type code into words', () => {
    expect(humanizeType('PLAN_FINALIZED')).toBe('plan finalized')
    expect(humanizeType(undefined)).toBe('new')
  })
})

describe('timer sentences', () => {
  const liveTimer = (name, level, kind = 'daily') => ({ id: name, person: { id: name, name }, milestone: { id: 'm1', name: 'Schema Mapping' },
    level, limits: [{ kind, level }] })

  test('an employee hears about timer hours not submitted yet and a timer at its limit', () => {
    const items = buildSummary({ user: users.employee, today: TODAY,
      unsubmitted: [{ work_date: '2026-10-13', week_start: '2026-10-12', milestone: { id: 'm1', name: 'Schema Mapping' }, hours: 1.5 }],
      timerWarnings: [{ kind: 'daily', message: "You've reached your 8h for today on this timer", milestone: { name: 'Schema Mapping' } }] })
    expect(texts(items)).toEqual([
      "You've reached your 8h for today on this timer (timer on Schema Mapping)",
      "Your timer hours for Tuesday aren't submitted yet",
    ])
    expect(items[1].to).toBe('/timesheet?week=2026-10-12')
    const several = buildSummary({ user: users.employee, today: TODAY, unsubmitted: [
      { work_date: '2026-10-12', week_start: '2026-10-12' }, { work_date: '2026-10-13', week_start: '2026-10-12' }] })
    expect(texts(several)).toEqual(["Your timer hours for 2 days aren't submitted yet"])
  })

  test('a manager hears who runs a timer, who is past a limit, and the change requests waiting', () => {
    const items = buildSummary({ user: users.manager, today: TODAY,
      live: [liveTimer('Eli Employee', 'over'), liveTimer('Ada Lovelace', 'ok')],
      changeRequests: [{ id: 'r1', user: { id: 'u-emp', name: 'Eli Employee' } }] })
    expect(texts(items)).toEqual([
      '1 change request on timer hours is waiting',
      '2 people are running timers now',
      "Eli's timer is over the daily limit",
    ])
    expect(items.map((i) => i.to)).toEqual(['/timesheets#change-requests', '/timesheets', '/timesheets'])
    const two = buildSummary({ user: users.manager, today: TODAY,
      live: [liveTimer('Eli Employee', 'warning', 'milestone'), liveTimer('Ada Lovelace', 'over')] })
    expect(texts(two)).toEqual(['2 people are running timers now', '2 timers are at or over their limits'])
    const one = buildSummary({ user: users.manager, today: TODAY, live: [liveTimer('Eli Employee', 'warning', 'milestone')] })
    expect(texts(one)).toEqual(['1 person is running a timer now', "Eli's timer is at its estimate"])
  })

  test('employees never hear about other people\'s timers; executives hear who runs one', () => {
    const live = [liveTimer('Eli Employee', 'ok')]
    expect(buildSummary({ user: users.employee, today: TODAY, live, changeRequests: [{ id: 'r1' }] })).toEqual([])
    expect(texts(buildSummary({ user: users.executive, today: TODAY, live }))).toEqual(['1 person is running a timer now'])
  })

  test('a remote stop and decided change requests, without the message itself', () => {
    const items = buildSummary({ user: users.employee, today: TODAY, notifications: [
      note('s1', 'TIMER_STOPPED_BY_MANAGER', { week_start: '2026-10-12', message: 'Morgan stopped your timer on Schema Mapping: secret',
        payload: { by: { id: 'u-mgr', name: 'Morgan Manager' }, milestone: { id: 'm1', name: 'Schema Mapping' } } }),
      note('a1', 'TIME_EDIT_APPROVED', { week_start: '2026-10-12', payload: { milestone: { id: 'm1', name: 'Schema Mapping' } } }),
      note('r1', 'TIME_EDIT_REJECTED', { week_start: '2026-10-12', payload: { milestone: { id: 'm2', name: 'Build' } } }),
      note('o1', 'TIMER_OVER_LIMIT'), note('q1', 'TIME_EDIT_REQUESTED')] })
    expect(texts(items)).toEqual([
      'Morgan stopped your timer on Schema Mapping',
      'Your change to Schema Mapping was approved',
      'Your change to Build was declined',
    ])
    expect(JSON.stringify(items)).not.toContain('secret')
  })
})
