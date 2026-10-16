import { describe, expect, it } from 'vitest'
import { dayLines, gridWeeks, monthOf, shiftMonth } from './monthLayout'

const flat = (weeks) => weeks.flat()
const consecutive = (dates) =>
  dates.every((d, i) => i === 0 || Date.parse(d) - Date.parse(dates[i - 1]) === 86400000)

describe('gridWeeks', () => {
  it('gives 5 Monday-first weeks for October 2026', () => {
    const weeks = gridWeeks({ start: '2026-09-28', end: '2026-11-01' })
    expect(weeks).toHaveLength(5)
    expect(weeks[0][0]).toBe('2026-09-28')
    expect(weeks[4][6]).toBe('2026-11-01')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('gives 4 weeks for February 2027, which starts on a Monday and ends on a Sunday', () => {
    const weeks = gridWeeks({ start: '2027-02-01', end: '2027-02-28' })
    expect(weeks).toHaveLength(4)
    expect(weeks[0][0]).toBe('2027-02-01')
    expect(weeks[3][6]).toBe('2027-02-28')
    expect(consecutive(flat(weeks))).toBe(true)
  })

  it('gives 6 weeks for August 2026', () => {
    const weeks = gridWeeks({ start: '2026-07-27', end: '2026-09-06' })
    expect(weeks).toHaveLength(6)
  })

  it.each([
    ['2026-10-26', '2026-11-08'],
    ['2026-03-02', '2026-03-15'],
  ])('has no repeat or gap across a clock change (%s)', (start, end) => {
    const dates = flat(gridWeeks({ start, end }))
    expect(dates).toHaveLength(14)
    expect(new Set(dates).size).toBe(14)
    expect(dates[0]).toBe(start)
    expect(dates[13]).toBe(end)
    expect(consecutive(dates)).toBe(true)
  })
})

describe('month helpers', () => {
  it('shifts across year ends', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
  it('reads the month of a date', () => {
    expect(monthOf('2026-10-14')).toBe('2026-10')
  })
})

describe('dayLines', () => {
  it('totals pending and approved only and keeps kinds', () => {
    const day = '2026-10-14'
    const map = dayLines(
      [
        { milestone_id: 1, work_date: day, hours: 6, status: 'approved' },
        { milestone_id: 2, work_date: day, hours: 2, status: 'pending' },
        { milestone_id: 3, work_date: day, hours: 3, status: 'rejected' },
      ],
      [{ milestone_id: 4, work_date: day, hours: 1.5 }],
    )
    const { total, lines } = map.get(day)
    expect(total).toBe(8)
    expect(lines.map((l) => l.kind)).toEqual(['approved', 'pending', 'rejected', 'draft'])
    expect(lines.map((l) => l.milestone_id)).toEqual([1, 2, 3, 4])
    // A saved line keeps its entry for the day panel; a timer draft has none.
    expect(lines[2].entry).toMatchObject({ milestone_id: 3, status: 'rejected' })
    expect(lines[3].entry).toBeUndefined()
  })

  it('orders a day by the milestones list, saved before a timer draft for the same milestone', () => {
    const day = '2026-10-14'
    const milestones = [{ id: 'b' }, { id: 'a' }, { id: 'c' }]
    const { lines } = dayLines(
      [
        { milestone_id: 'a', work_date: day, hours: 1, status: 'pending' },
        { milestone_id: 'b', work_date: day, hours: 2, status: 'approved' },
        { milestone_id: 'x', work_date: day, hours: 4, status: 'pending' },
      ],
      [{ milestone_id: 'b', work_date: day, hours: 3 }, { milestone_id: 'c', work_date: day, hours: 5 }],
      milestones,
    ).get(day)
    expect(lines.map((l) => `${l.milestone_id}:${l.kind}`)).toEqual(['b:approved', 'b:draft', 'a:pending', 'c:draft', 'x:pending'])
  })
})
