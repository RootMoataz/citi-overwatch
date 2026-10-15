import { describe, expect, test } from 'vitest'
import { applyOrder, buildColumns, cardWarnings, moveCard, toOrderItems } from './board.js'

const m = (id, column, sequence, extra = {}) => ({
  id, name: id.toUpperCase(), plan_column: column, sequence, start_date: '2026-02-01', end_date: '2026-03-01',
  assignees: [{ id: 'u1', name: 'Eli Employee' }], predecessors: [], ...extra,
})
const project = { start_date: '2026-01-01', predicted_end_date: '2026-12-31' }

describe('buildColumns', () => {
  test('groups cards by column in sequence order, ties by end date then name', () => {
    const cols = buildColumns([m('c', 'scheduled', 2), m('a', 'scheduled', 1), m('b', 'backlog', 1),
      m('d', 'scheduled', 2, { end_date: '2026-02-15' }), m('e', 'ready', 1)])
    expect(cols).toEqual({ backlog: ['b'], ready: ['e'], scheduled: ['a', 'd', 'c'] })
  })

  test('a milestone without a planning column counts as scheduled', () => {
    expect(buildColumns([{ id: 'x', name: 'X', end_date: '2026-01-01' }])).toEqual({ backlog: [], ready: [], scheduled: ['x'] })
  })
})

describe('moveCard', () => {
  const cols = { backlog: ['a', 'b'], ready: [], scheduled: ['c', 'd'] }

  test('moves a card to another column at an index, leaving the input alone', () => {
    expect(moveCard(cols, 'b', 'scheduled', 1)).toEqual({ backlog: ['a'], ready: [], scheduled: ['c', 'b', 'd'] })
    expect(cols.backlog).toEqual(['a', 'b'])
  })

  test('reorders inside a column and clamps the index', () => {
    expect(moveCard(cols, 'c', 'scheduled', 5)).toEqual({ ...cols, scheduled: ['d', 'c'] })
    expect(moveCard(cols, 'b', 'backlog', 0)).toEqual({ ...cols, backlog: ['b', 'a'] })
    expect(moveCard(cols, 'a', 'ready')).toEqual({ backlog: ['b'], ready: ['a'], scheduled: ['c', 'd'] })
  })
})

test('toOrderItems numbers each column from 1', () => {
  expect(toOrderItems({ backlog: ['a'], ready: [], scheduled: ['c', 'b'] })).toEqual([
    { milestone_id: 'a', plan_column: 'backlog', sequence: 1 },
    { milestone_id: 'c', plan_column: 'scheduled', sequence: 1 },
    { milestone_id: 'b', plan_column: 'scheduled', sequence: 2 },
  ])
})

test('applyOrder writes the new places onto the milestones', () => {
  const list = [m('a', 'backlog', 1), m('b', 'scheduled', 1)]
  const next = applyOrder(list, [{ milestone_id: 'a', plan_column: 'scheduled', sequence: 2 }])
  expect(next.map((x) => [x.id, x.plan_column, x.sequence])).toEqual([['a', 'scheduled', 2], ['b', 'scheduled', 1]])
  expect(list[0].plan_column).toBe('backlog')
})

describe('cardWarnings', () => {
  const names = { a: 'Design', b: 'Build' }

  test('a scheduled, staffed card inside the project dates has no warnings', () => {
    const cols = { backlog: [], ready: [], scheduled: ['a', 'b'] }
    expect(cardWarnings(m('b', 'scheduled', 2, { predecessors: ['a'] }), { project, columns: cols, names })).toEqual([])
  })

  test('flags nobody assigned, dates outside the project and dependencies out of order', () => {
    const cols = { backlog: [], ready: [], scheduled: ['b', 'a'] }
    const card = m('b', 'scheduled', 1, { assignees: [], start_date: '2025-12-01', predecessors: ['a'] })
    expect(cardWarnings(card, { project, columns: cols, names })).toEqual([
      'Nobody assigned yet', 'Dates fall outside the project (Jan 1, 2026 – Dec 31, 2026)',
      'Scheduled before Design, which it depends on'])
  })

  test('a scheduled card waiting on an unscheduled one says so', () => {
    const cols = { backlog: ['a'], ready: [], scheduled: ['b'] }
    expect(cardWarnings(m('b', 'scheduled', 1, { predecessors: ['a'] }), { project, columns: cols, names }))
      .toEqual(['Depends on Design, which is not scheduled yet'])
  })
})
