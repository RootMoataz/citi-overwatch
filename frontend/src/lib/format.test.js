import { describe, expect, test } from 'vitest'
import { daysBetween, formatDateRange, formatLongDate, formatWeekRange, nyTodayIso } from './format.js'

describe('New York dates', () => {
  test('nyTodayIso reads the New York calendar, not UTC', () => {
    expect(nyTodayIso(new Date('2026-10-16T02:00:00Z'))).toBe('2026-10-15')
    expect(nyTodayIso(new Date('2026-10-16T14:00:00Z'))).toBe('2026-10-16')
  })
  test('formatLongDate spells the month out', () => {
    expect(formatLongDate('2026-10-15')).toBe('October 15, 2026')
  })
  test('daysBetween counts whole days, signed', () => {
    expect(daysBetween('2026-10-12', '2026-10-15')).toBe(3)
    expect(daysBetween('2026-10-15', '2026-10-12')).toBe(-3)
    expect(daysBetween('2026-10-15', '2026-10-15')).toBe(0)
  })
  test('formatWeekRange names the Monday-to-Sunday week', () => {
    expect(formatWeekRange('2026-10-12')).toBe('Oct 12 – 18, 2026')
    expect(formatWeekRange('2026-09-28')).toBe('Sep 28 – Oct 4, 2026')
    expect(formatWeekRange('2026-12-28')).toBe('Dec 28, 2026 – Jan 3, 2027')
  })
  test('formatDateRange omits the first year only within a year', () => {
    expect(formatDateRange('2026-07-15', '2026-12-27')).toBe('Jul 15 – Dec 27, 2026')
    expect(formatDateRange('2025-12-01', '2026-03-03')).toBe('Dec 1, 2025 – Mar 3, 2026')
  })
})
