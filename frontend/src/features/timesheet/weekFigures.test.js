import { describe, expect, test } from 'vitest'
import { weekFigures } from './weekFigures.js'

const e = (date, hours, status) => ({ milestone_id: 'm1', work_date: date, hours, status })
/** A grid cell as useTimesheetWeek hands it over: its saved entry, what it adds to the week, whether it counts and
 * whether it holds an unsaved change. A saved, unedited cell adds its saved hours unless they were rejected. */
const saved = (entry) => ({ entry, hours: entry.status === 'rejected' ? 0 : entry.hours, counts: entry.status !== 'rejected', edited: false })
// The mockup's week: Mon 0.25, Tue 7.75 and Fri 7.75 approved; Thu 4 pending; Wed 8 rejected.
const week = {
  mon: saved(e('2026-10-12', 0.25, 'approved')),
  tue: saved(e('2026-10-13', 7.75, 'approved')),
  wed: saved(e('2026-10-14', 8, 'rejected')),
  thu: saved(e('2026-10-15', 4, 'pending')),
  fri: saved(e('2026-10-16', 7.75, 'approved')),
  sat: { entry: undefined, hours: 0, counts: false, edited: false },
}
const cells = (changes = {}) => Object.values({ ...week, ...changes })

describe('weekFigures', () => {
  test("the mockup's week", () => {
    expect(weekFigures(cells())).toEqual({ counted: 19.75, approved: 15.75, pending: 4, needsRevision: 8, entered: 27.75, unlisted: 0 })
  })

  test('typing 2h on an empty cell counts it as pending', () => {
    const f = weekFigures(cells({ sat: { entry: undefined, hours: 2, counts: true, edited: true } }))
    expect(f).toMatchObject({ counted: 21.75, pending: 6, approved: 15.75, needsRevision: 8 })
  })

  test('re-typing the rejected 8 moves it from needs revision to pending', () => {
    const f = weekFigures(cells({ wed: { ...week.wed, hours: 8, counts: true, edited: true } }))
    expect(f).toMatchObject({ counted: 27.75, pending: 12, needsRevision: 0, entered: 27.75 })
  })

  test('editing an approved cell moves its hours from approved to pending', () => {
    const f = weekFigures(cells({ tue: { ...week.tue, edited: true } }))
    expect(f).toMatchObject({ approved: 8, pending: 11.75 })
  })

  test('a rejected cell holding a timer draft counts once, as pending, and is no longer needing revision', () => {
    const f = weekFigures(cells({ wed: { ...week.wed, hours: 8.5, counts: true, edited: true } }))
    expect(f).toMatchObject({ counted: 28.25, pending: 12.5, needsRevision: 0, entered: 28.25 })
  })

  test("saved hours on rows the sheet no longer lists count toward the week; rejected ones don't", () => {
    const unlisted = [e('2026-10-13', 3, 'approved'), e('2026-10-14', 2, 'pending'), e('2026-10-15', 5, 'rejected')]
    expect(weekFigures(cells(), unlisted)).toEqual({ counted: 24.75, approved: 18.75, pending: 6, needsRevision: 8,
      entered: 32.75, unlisted: 5 })
  })

  test('Pending is never negative, and nothing at all is all zeros', () => {
    expect(weekFigures([{ entry: e('2026-10-13', 7.75, 'approved'), hours: 7.75, counts: true, edited: false }]).pending).toBe(0)
    expect(weekFigures([])).toEqual({ counted: 0, approved: 0, pending: 0, needsRevision: 0, entered: 0, unlisted: 0 })
  })
})
