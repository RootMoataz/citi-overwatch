import { describe, expect, test } from 'vitest'
import { daysBetween, formatDateRange, formatDayFull, formatDayLong, formatLongDate, formatWeekRange, mondayOfIso, nyMondayIso, nyTodayIso, plural } from './format.js'

describe('New York dates', () => {
  test('nyTodayIso reads the New York calendar, not UTC', () => {
    expect(nyTodayIso(new Date('2026-10-16T02:00:00Z'))).toBe('2026-10-15')
    expect(nyTodayIso(new Date('2026-10-16T14:00:00Z'))).toBe('2026-10-16')
  })
  test('nyMondayIso is the Monday of the New York week', () => {
    expect(nyMondayIso(new Date('2026-10-19T02:00:00Z'))).toBe('2026-10-12')
    expect(nyMondayIso(new Date('2026-10-15T16:00:00Z'))).toBe('2026-10-12')
  })
  test('formatLongDate spells the month out', () => {
    expect(formatLongDate('2026-10-15')).toBe('October 15, 2026')
  })
  test('formatDayLong reads weekday, month, day and year, as Entry details shows its date', () => {
    expect(formatDayLong('2026-10-14')).toBe('Wed, Oct 14, 2026')
    expect(formatDayLong('2026-11-01')).toBe('Sun, Nov 1, 2026')   // the day the clocks change
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

describe('shared wording and weeks', () => {
  test('plural counts with the word, one or many (an "s" unless a plural is given)', () => {
    expect(plural(1, 'day')).toBe('1 day')
    expect(plural(3, 'day')).toBe('3 days')
    expect(plural(0, 'entry', 'entries')).toBe('0 entries')
    expect(plural(1, 'person', 'people')).toBe('1 person')
    expect(plural(-2, 'point')).toBe('-2 points')
  })

  test('mondayOfIso gives the Monday of an ISO day without timezone shifts', () => {
    expect(mondayOfIso('2026-10-14')).toBe('2026-10-12')
    expect(mondayOfIso('2026-10-12')).toBe('2026-10-12')
    expect(mondayOfIso('2026-10-18')).toBe('2026-10-12')   // Sunday ends the week
    expect(mondayOfIso('2026-11-02')).toBe('2026-11-02')   // the Monday after the clocks change
  })
})

describe('formatDayFull', () => {
  test('the long day in US order, like every other date in the app', () => {
    expect(formatDayFull('2026-10-16')).toBe('Friday, October 16, 2026')
    expect(formatDayFull('2026-01-05')).toBe('Monday, January 5, 2026')
  })
})
