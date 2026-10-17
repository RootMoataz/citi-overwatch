import { describe, expect, test } from 'vitest'
import {
  comingLabel, dueLine, focusSummary, groupMilestones, isOverdue, nowAndNext, skillsSentence, upNextLabel, urgentFirst,
} from './myWork.js'

const TODAY = '2026-10-15'
let n = 0
const ms = (name, o = {}) => ({
  id: `m${++n}`, name, role: 'owner', status: 'in_progress', display_status: 'in_progress', priority: 'medium',
  start_date: '2026-10-01', end_date: '2026-10-30', waiting_on: [], is_archived: false,
  project: { is_archived: false }, ...o,
})

const fixture = [
  ms('Low late', { priority: 'low', end_date: '2026-10-05' }),
  ms('Critical later', { priority: 'critical', end_date: '2026-10-31' }),
  ms('High sooner', { priority: 'high', end_date: '2026-10-20' }),
  ms('High later', { priority: 'high', end_date: '2026-10-25' }),
  ms('Blocked', { status: 'blocked', display_status: 'blocked', priority: 'medium', end_date: '2026-11-01' }),
  ms('Waiting but in progress', {
    display_status: 'waiting', priority: 'low', end_date: '2026-11-10', waiting_on: [{ id: 'x', name: 'Discovery' }],
  }),
  ms('Waiting up', {
    status: 'not_started', display_status: 'waiting', start_date: '2026-10-10',
    waiting_on: [{ id: 'x', name: 'Discovery' }, { id: 'y', name: 'Schema Mapping' }],
  }),
  ms('Future up', { status: 'not_started', display_status: 'not_started', start_date: '2026-10-21' }),
  ms('Ready b', { status: 'not_started', display_status: 'not_started', start_date: '2026-10-12' }),
  ms('Ready a', { status: 'not_started', display_status: 'not_started', start_date: '2026-10-12' }),
  ms('In review', { status: 'ready_for_review', display_status: 'ready_for_review', end_date: '2026-10-18' }),
  ms('Done old', { status: 'completed', end_date: '2026-09-01' }),
  ms('Done new', { status: 'completed', end_date: '2026-10-10' }),
  ms('No role', { role: null }),
  ms('Archived', { is_archived: true }),
  ms('Project archived', { project: { is_archived: true } }),
]
const names = (list) => list.map((m) => m.name)

describe('groupMilestones', () => {
  const g = groupMilestones(fixture, TODAY)
  test('In progress: overdue first, then priority, then end date', () => {
    expect(names(g.inProgress)).toEqual([
      'Low late', 'Critical later', 'High sooner', 'High later', 'Blocked', 'Waiting but in progress',
    ])
  })
  test('an in_progress milestone shown as waiting stays in In progress', () => {
    expect(names(g.inProgress)).toContain('Waiting but in progress')
  })
  test('Up next: ready, then future starts, then waiting; ties by name', () => {
    expect(names(g.upNext)).toEqual(['Ready a', 'Ready b', 'Future up', 'Waiting up'])
  })
  test('with your manager by end date; completed newest first', () => {
    expect(names(g.review)).toEqual(['In review'])
    expect(names(g.done)).toEqual(['Done new', 'Done old'])
  })
  test('role-less and archived items are left out', () => {
    const all = names([...g.inProgress, ...g.upNext, ...g.review, ...g.done])
    expect(all).not.toContain('No role')
    expect(all).not.toContain('Archived')
    expect(all).not.toContain('Project archived')
  })
})

describe('labels', () => {
  const g = groupMilestones(fixture, TODAY)
  test('isOverdue', () => {
    expect(isOverdue({ status: 'in_progress', end_date: '2026-10-14' }, TODAY)).toBe(true)
    expect(isOverdue({ status: 'completed', end_date: '2026-10-14' }, TODAY)).toBe(false)
    expect(isOverdue({ status: 'in_progress', end_date: TODAY }, TODAY)).toBe(false)
  })
  test('upNextLabel has three branches', () => {
    const by = (name) => g.upNext.find((m) => m.name === name)
    expect(upNextLabel(by('Waiting up'), TODAY)).toBe('Waiting on Discovery, Schema Mapping')
    expect(upNextLabel(by('Future up'), TODAY)).toBe('Starts Oct 21, 2026')
    expect(upNextLabel(by('Ready a'), TODAY)).toBe('Ready to start')
  })
  test('dueLine: the words, whether overdue, and the critical part to show in bold', () => {
    expect(dueLine({ status: 'in_progress', end_date: '2026-10-05' }, TODAY))
      .toEqual({ text: 'Due Oct 5, 2026 · 10 days overdue', overdue: true, critical: '10 days overdue' })
    expect(dueLine({ status: 'in_progress', end_date: '2026-10-14' }, TODAY))
      .toEqual({ text: 'Due Oct 14, 2026 · 1 day overdue', overdue: true, critical: '1 day overdue' })
    // Due today: the whole line is the critical detail (the "Due today" of the bold rule), in the usual colour.
    expect(dueLine({ status: 'in_progress', end_date: '2026-10-15' }, TODAY))
      .toEqual({ text: 'Due Oct 15, 2026', overdue: false, critical: 'Due Oct 15, 2026' })
    expect(dueLine({ status: 'in_progress', end_date: '2026-10-20' }, TODAY))
      .toEqual({ text: 'Due Oct 20, 2026', overdue: false, critical: null })
  })
  test('comingLabel: Ready now, or After the predecessors still open', () => {
    expect(comingLabel({ ready: true, after: [] })).toBe('Ready now')
    expect(comingLabel({ ready: false, after: [{ id: 'a', name: 'Discovery' }, { id: 'b', name: 'Schema Mapping' }] }))
      .toBe('After Discovery, Schema Mapping')
  })
  test('urgentFirst: overdue, then priority, then end date, then name', () => {
    const list = [ms('Low late', { priority: 'low', end_date: '2026-10-05' }), ms('B high', { priority: 'high' }),
      ms('A high', { priority: 'high' }), ms('Critical', { priority: 'critical', end_date: '2026-12-01' }),
      ms('High soon', { priority: 'high', end_date: '2026-10-20' })]
    expect(names([...list].sort(urgentFirst(TODAY)))).toEqual(['Low late', 'Critical', 'High soon', 'A high', 'B high'])
  })
  test('skillsSentence', () => {
    expect(skillsSentence(['SQL'])).toBe('Needs SQL, which you have')
    expect(skillsSentence(['SQL', 'Python'])).toBe('Needs SQL and Python, which you have')
    expect(skillsSentence(['SQL', 'Python', 'Go'])).toBe('Needs SQL, Python and Go, which you have')
  })
})

describe('a milestone with no start date', () => {
  const undated = ms('Undated', { status: 'not_started', display_status: 'not_started', start_date: null })
  test('is ready to start: labelled so, in the ready tier, and the one to start next', () => {
    expect(upNextLabel(undated, TODAY)).toBe('Ready to start')
    const g = groupMilestones([ms('Later', { status: 'not_started', display_status: 'not_started', start_date: '2026-10-21' }), undated], TODAY)
    expect(names(g.upNext)).toEqual(['Undated', 'Later'])
    expect(nowAndNext({ ...g, inProgress: [] }, [], TODAY).startNext.name).toBe('Undated')
  })
})

describe('nowAndNext', () => {
  const g = groupMilestones(fixture, TODAY)
  const empty = { inProgress: [], upNext: [], review: [], done: [] }
  test('with in-progress work', () => {
    const r = nowAndNext(g, [], TODAY)
    expect(r.now.name).toBe('Low late')
    expect(r.next.name).toBe('Ready a')
    expect(r.startNext).toBeNull()
    expect(r.headsUp).toBeNull()
  })
  test('without in-progress work, startNext is the first ready item', () => {
    const r = nowAndNext({ ...g, inProgress: [] }, [], TODAY)
    expect(r.now).toBeNull()
    expect(r.startNext.name).toBe('Ready a')
    const waitingOnly = nowAndNext({ ...empty, upNext: [g.upNext[3]] }, [], TODAY)
    expect(waitingOnly.startNext).toBeNull()
    expect(waitingOnly.next.name).toBe('Waiting up')
  })
  test('headsUp for high, critical and overdue low; none for medium', () => {
    const c = (priority, end = '2026-11-30') => [{ milestone: { name: 'X', priority, end_date: end } }]
    expect(nowAndNext(empty, c('high'), TODAY).headsUp).not.toBeNull()
    expect(nowAndNext(empty, c('critical'), TODAY).headsUp).not.toBeNull()
    expect(nowAndNext(empty, c('low', '2026-10-01'), TODAY).headsUp).not.toBeNull()
    expect(nowAndNext(empty, c('medium'), TODAY).headsUp).toBeNull()
    expect(nowAndNext(empty, [], TODAY).headsUp).toBeNull()
  })
})

describe('focusSummary', () => {
  const base = { inProgress: [], upNext: [], review: [], done: [] }
  test('joins the non-zero parts', () => {
    const late = ms('late', { end_date: '2026-10-01' })
    const review = ms('r', { status: 'ready_for_review' })
    expect(focusSummary({ ...base, inProgress: [late], review: [review] }, TODAY)).toBe('1 overdue · 1 with your manager')
    expect(focusSummary({ ...base, inProgress: [late] }, TODAY)).toBe('1 overdue')
    expect(focusSummary(base, TODAY)).toBe('')
  })
  test("counts overdue in progress and upcoming work; work with the manager isn't the person's to finish, so it isn't", () => {
    const late = (s) => ms('l', { status: s, end_date: '2026-10-01' })
    expect(focusSummary({
      inProgress: [late('in_progress')], upNext: [late('not_started')], review: [late('ready_for_review')], done: [],
    }, TODAY)).toBe('2 overdue · 1 with your manager')
    expect(focusSummary({ ...base, review: [late('ready_for_review')] }, TODAY)).toBe('1 with your manager')
  })
})
