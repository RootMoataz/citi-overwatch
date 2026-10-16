import { describe, expect, test } from 'vitest'
import { nyTodayIso } from './format.js'
import { dueLine, orderedRisks, primaryRisk, RISK_ORDER, riskSentence } from './risk.js'

describe('risk order', () => {
  test('matches the backend order', () => {
    expect(RISK_ORDER).toEqual(['PAST_DUE', 'BUDGET_BURN', 'OVERDUE_MILESTONE', 'BLOCKED_MILESTONE'])
  })

  test('the first reason is the most severe, not the first in the array', () => {
    expect(primaryRisk(['OVERDUE_MILESTONE', 'PAST_DUE'])).toBe('PAST_DUE')
    expect(orderedRisks(['BLOCKED_MILESTONE', 'OVERDUE_MILESTONE', 'BUDGET_BURN']))
      .toEqual(['BUDGET_BURN', 'OVERDUE_MILESTONE', 'BLOCKED_MILESTONE'])
  })

  test('no reasons means none', () => {
    expect(primaryRisk([])).toBeNull()
    expect(primaryRisk(undefined)).toBeNull()
    expect(orderedRisks(null)).toEqual([])
  })
})

describe('riskSentence', () => {
  test('past due says how long ago it ended', () => {
    expect(riskSentence('PAST_DUE', { predicted_end_date: '2026-10-12' }, '2026-10-15'))
      .toBe("Ended Oct 12, 2026, 3 days ago, and isn't completed.")
    expect(riskSentence('PAST_DUE', { predicted_end_date: '2026-10-14' }, '2026-10-15'))
      .toBe("Ended Oct 14, 2026, 1 day ago, and isn't completed.")
  })

  test('past due never reads "0 days ago": a project ending today says so', () => {
    expect(riskSentence('PAST_DUE', { predicted_end_date: '2026-10-15' }, '2026-10-15'))
      .toBe("Ended today and isn't completed.")
    expect(riskSentence('PAST_DUE', { predicted_end_date: '2026-10-16' }, '2026-10-15'))
      .toBe("Ended today and isn't completed.")
  })

  test('budget burn uses whole percents and the difference of the two shown numbers', () => {
    expect(riskSentence('BUDGET_BURN', { budget_pct: 81.2, progress_pct: 61.9 }))
      .toBe('81% of the budget used against 62% progress: 19 points ahead.')
  })

  test('the other two reasons use the existing labels', () => {
    expect(riskSentence('OVERDUE_MILESTONE', {})).toBe('Overdue milestone')
    expect(riskSentence('BLOCKED_MILESTONE', {})).toBe('Kicked back – needs review')
  })
})

describe('dueLine', () => {
  const active = (end) => ({ status: 'active', predicted_end_date: end })

  test('days left, due today and overdue', () => {
    expect(dueLine(active('2026-10-23'), '2026-10-15')).toEqual({ text: '8 days left', overdue: false })
    expect(dueLine(active('2026-10-16'), '2026-10-15')).toEqual({ text: '1 day left', overdue: false })
    expect(dueLine(active('2026-10-15'), '2026-10-15')).toEqual({ text: 'Due today', overdue: false })
    expect(dueLine(active('2026-10-12'), '2026-10-15')).toEqual({ text: '3 days overdue', overdue: true })
  })

  test('nothing for a completed project', () => {
    expect(dueLine({ status: 'completed', predicted_end_date: '2026-10-12' }, '2026-10-15')).toBeNull()
  })

  test('late evening in New York, after the UTC date rolled over, still reads Due today', () => {
    const today = nyTodayIso(new Date('2026-10-16T02:00:00Z'))
    expect(today).toBe('2026-10-15')
    expect(dueLine(active('2026-10-15'), today)).toEqual({ text: 'Due today', overdue: false })
  })
})
