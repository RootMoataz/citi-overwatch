import { afterEach, describe, expect, test, vi } from 'vitest'
import { users } from '../../test/render.jsx'
import { TIPS_KEY, buildTips, dismissTip, readDismissed } from './tips.js'

const TODAY = '2026-10-15'
const empty = { id: 'n1', type: 'TIMESHEET_EMPTY', week_start: '2026-10-12', payload: {}, subject_user: { id: 'u-emp' } }
const old = (id, day) => ({ entry: { id, work_date: day }, user: { id: 'u-a' } })
const critical = (id, end, extra = {}) => ({ id, name: `M${id}`, project_id: 'p1', priority: 'critical', status: 'in_progress',
  end_date: end, ...extra })

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('proactive tips', () => {
  test('an empty timesheet this week offers to open it', () => {
    expect(buildTips({ user: users.employee, today: TODAY, notifications: [empty] })).toEqual([
      { id: 'timesheet-empty:2026-10-12', text: 'Your timesheet for this week is empty — want me to open it?',
        action: { label: 'Open it', to: '/timesheet?week=2026-10-12' } },
    ])
  })

  test('approvers hear about entries waiting over 3 days; employees never do', () => {
    const approvals = [old('a', '2026-10-05'), old('b', '2026-10-12'), old('c', '2026-10-14'), old('d', '2026-10-11')]
    expect(buildTips({ user: users.manager, today: TODAY, approvals })).toEqual([
      { id: 'approvals-old:2026-10-15', text: '3 entries logged 3+ days ago are still waiting — open Timesheets?',
        strong: 'still waiting', action: { label: 'Open Timesheets', to: '/timesheets' } },
    ])
    expect(buildTips({ user: users.employee, today: TODAY, approvals })).toEqual([])
    expect(buildTips({ user: users.executive, today: TODAY, approvals })).toEqual([])
  })

  test('critical milestones due within 3 days, soonest first', () => {
    const milestones = [critical('1', '2026-10-18'), critical('2', '2026-10-15'), critical('3', '2026-10-16'),
      critical('4', '2026-10-19'), critical('5', '2026-10-17', { status: 'completed' }), critical('6', '2026-10-16', { priority: 'high' })]
    expect(buildTips({ user: users.manager, today: TODAY, milestones }).map((t) => t.text)).toEqual([
      'M2 is critical and due today', 'M3 is critical and due tomorrow', 'M1 is critical and due in 3 days'])
  })

  test('the waiting entries and a critical milestone (with "due today") are marked to show in bold', () => {
    const tips = buildTips({ user: users.manager, today: TODAY, approvals: [old('a', '2026-10-05')],
      milestones: [critical('2', '2026-10-15'), critical('3', '2026-10-16')] })
    // `strong`: the part of `text` the panel shows in bold.
    expect(tips.map((t) => [t.text, t.strong ?? null])).toEqual([
      ['1 entry logged 3+ days ago is still waiting — open Timesheets?', 'still waiting'],
      ['M2 is critical and due today', 'critical and due today'],
      ['M3 is critical and due tomorrow', 'critical'],
    ])
  })

  test('never more than 3, and dismissed tips stay gone', () => {
    const args = { user: { ...users.manager, tracks_own_hours: true }, today: TODAY, notifications: [empty],
      approvals: [old('a', '2026-10-01')],
      milestones: [critical('1', '2026-10-15'), critical('2', '2026-10-16')] }
    expect(buildTips(args).map((t) => t.id)).toEqual(['timesheet-empty:2026-10-12', 'approvals-old:2026-10-15', 'critical-due:1'])
    expect(buildTips({ ...args, dismissed: ['approvals-old:2026-10-15'] }).map((t) => t.id))
      .toEqual(['timesheet-empty:2026-10-12', 'critical-due:1', 'critical-due:2'])
  })

  test('dismissals are remembered in this browser, and blocked storage never throws', () => {
    expect(readDismissed()).toEqual([])
    dismissTip('a')
    dismissTip('b')
    dismissTip('a')
    expect(readDismissed()).toEqual(['a', 'b'])
    expect(JSON.parse(window.localStorage.getItem(TIPS_KEY))).toEqual(['a', 'b'])
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readDismissed()).toEqual([])
    expect(() => dismissTip('c')).not.toThrow()
  })
})
