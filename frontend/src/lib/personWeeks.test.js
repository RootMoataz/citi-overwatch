import { describe, expect, test } from 'vitest'
import { groupByPersonWeek } from './personWeeks.js'

const gia = { id: 'u-gia', name: 'Gia Rossi' }
const ben = { id: 'u-ben', name: 'Ben Osei' }
const item = (id, user, workDate) => ({ entry: { id, work_date: workDate, hours: 8 }, user })

describe('groupByPersonWeek', () => {
  test('groups pending items by person and Monday week, oldest week first, people in the server order', () => {
    const groups = groupByPersonWeek([
      item('a', ben, '2026-10-14'), item('b', gia, '2026-10-12'), item('c', gia, '2026-10-06'),
      item('d', ben, '2026-10-18'), item('e', gia, '2026-10-11'),
    ])
    expect(groups.map((g) => [g.key, g.user.name, g.week, g.items.map((i) => i.entry.id)])).toEqual([
      ['u-gia|2026-10-05', 'Gia Rossi', '2026-10-05', ['c', 'e']],
      ['u-ben|2026-10-12', 'Ben Osei', '2026-10-12', ['a', 'd']],   // Sunday the 18th still belongs to the week of the 12th
      ['u-gia|2026-10-12', 'Gia Rossi', '2026-10-12', ['b']],
    ])
  })

  test('nothing in, nothing out', () => {
    expect(groupByPersonWeek([])).toEqual([])
  })
})
