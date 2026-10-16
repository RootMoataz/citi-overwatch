import { describe, expect, test } from 'vitest'
import { isOverdue } from './milestoneOrder.js'

describe('isOverdue', () => {
  // `today` is the New York date, as the list and the Overview pass it.
  test('an unfinished milestone is overdue once its end date has passed, not on the day itself', () => {
    expect(isOverdue({ status: 'in_progress', end_date: '2026-10-14' }, '2026-10-15')).toBe(true)
    expect(isOverdue({ status: 'not_started', end_date: '2026-10-15' }, '2026-10-15')).toBe(false)
    expect(isOverdue({ status: 'blocked', end_date: '2026-10-14T00:00:00Z' }, '2026-10-15')).toBe(true)
  })

  test('a completed milestone is never overdue', () => {
    expect(isOverdue({ status: 'completed', end_date: '2026-01-01' }, '2026-10-15')).toBe(false)
  })
})
