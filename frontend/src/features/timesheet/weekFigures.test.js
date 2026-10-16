import { describe, expect, test } from 'vitest'
import { weekFigures } from './weekFigures.js'

const e = (date, hours, status) => ({ milestone_id: 'm1', work_date: date, hours, status })
const k = (date) => `m1|${date}`
// The mockup's week: Mon 0.25, Tue 7.75 and Fri 7.75 approved; Thu 4 pending; Wed 8 rejected.
const entries = {
  [k('2026-10-12')]: e('2026-10-12', 0.25, 'approved'),
  [k('2026-10-13')]: e('2026-10-13', 7.75, 'approved'),
  [k('2026-10-14')]: e('2026-10-14', 8, 'rejected'),
  [k('2026-10-15')]: e('2026-10-15', 4, 'pending'),
  [k('2026-10-16')]: e('2026-10-16', 7.75, 'approved'),
}
const base = { entries, changed: [], isDraft: () => false, total: 19.75 }

describe('weekFigures', () => {
  test("the mockup's week", () => {
    expect(weekFigures(base)).toEqual({ counted: 19.75, approved: 15.75, pending: 4, needsRevision: 8, entered: 27.75 })
  })

  test('typing 2h on an empty cell counts it as pending', () => {
    const typed = k('2026-10-17')
    const f = weekFigures({ ...base, total: 21.75, changed: [typed], isDraft: (x) => x === typed })
    expect(f).toMatchObject({ counted: 21.75, pending: 6, approved: 15.75, needsRevision: 8 })
  })

  test('re-typing the rejected 8 moves it from needs revision to pending', () => {
    const rej = k('2026-10-14')
    const f = weekFigures({ ...base, total: 27.75, changed: [rej], isDraft: (x) => x === rej })
    expect(f).toMatchObject({ counted: 27.75, pending: 12, needsRevision: 0, entered: 27.75 })
  })

  test('editing an approved cell moves its hours from approved to pending', () => {
    const tue = k('2026-10-13')
    const f = weekFigures({ ...base, changed: [tue], isDraft: (x) => x === tue })
    expect(f).toMatchObject({ approved: 8, pending: 11.75 })
  })
})
