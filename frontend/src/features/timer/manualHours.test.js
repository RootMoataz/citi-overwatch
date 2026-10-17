import { describe, expect, test } from 'vitest'
import { DETAILS_MAX, DETAILS_MIN, REASONS, WINDOW_DAYS, dayOptions, detailsProblem, hoursProblem, inWindow, noteProblem } from './manualHours.js'

const HOURS = 'Between 0.25 and 24 hours'
const QUARTERS = 'Use quarter hours: .25, .5 or .75'

describe('the manual hours rules', () => {
  test('the five reasons mirror the backend', () => {
    expect(REASONS).toEqual([['forgot_timer', 'Forgot to start the timer'], ['away_from_computer', 'Worked away from the computer'],
      ['meeting_or_call', 'Meeting or call'], ['timer_problem', 'Timer problem'], ['other', 'Other']])
    expect([WINDOW_DAYS, DETAILS_MIN, DETAILS_MAX]).toEqual([7, 10, 500])
  })

  test('dayOptions lists today and the 7 days before, labelled', () => {
    const options = dayOptions('2026-10-15')
    expect(options).toHaveLength(8)
    expect(options.map((o) => o.label)).toEqual(['Today, Thu 15 Oct', 'Yesterday, Wed 14 Oct', 'Tue 13 Oct', 'Mon 12 Oct',
      'Sun 11 Oct', 'Sat 10 Oct', 'Fri 9 Oct', 'Thu 8 Oct'])
    expect(options.map((o) => o.value)).toEqual(['2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-11',
      '2026-10-10', '2026-10-09', '2026-10-08'])
  })

  test('inWindow: today and the 7 days before, nothing else', () => {
    expect(inWindow('2026-10-08', '2026-10-15')).toBe(true)
    expect(inWindow('2026-10-15', '2026-10-15')).toBe(true)
    expect(inWindow('2026-10-07', '2026-10-15')).toBe(false)
    expect(inWindow('2026-10-16', '2026-10-15')).toBe(false)
  })

  test('hoursProblem accepts quarter hours from 0.25 to 24', () => {
    for (const ok of ['2.5', '2.50', '0.25', '24', '12.75', '0.5', '.5', '.25', '.75']) expect(hoursProblem(ok), ok).toBeNull()
  })

  test('hoursProblem refuses anything outside the range or the format', () => {
    for (const bad of ['', '0.2', '24.25', '1e1', '2,5', '25', '0', '100', 'abc', ' ']) {
      expect(hoursProblem(bad), JSON.stringify(bad)).toBe(HOURS)
    }
  })

  test('hoursProblem asks for quarter hours', () => {
    for (const bad of ['2.1', '0.3', '1.55', '3.33', '1.234', '2.125', '0.251', '12.3456']) expect(hoursProblem(bad), bad).toBe(QUARTERS)
  })

  test('detailsProblem: Other needs 10 trimmed characters, the other reasons need nothing', () => {
    const message = 'Say what happened (at least 10 characters)'
    expect(detailsProblem('other', '   ')).toBe(message)
    expect(detailsProblem('other', 'Short')).toBe(message)
    expect(detailsProblem('other', ' 123456789 ')).toBe(message)
    expect(detailsProblem('other', '1234567890')).toBeNull()
    expect(detailsProblem('forgot_timer', '')).toBeNull()
    expect(detailsProblem('meeting_or_call', 'x')).toBeNull()
  })

  test('noteProblem needs 10 trimmed characters', () => {
    expect(noteProblem('          ')).toBe('At least 10 characters')
    expect(noteProblem('')).toBe('At least 10 characters')
    expect(noteProblem('123456789')).toBe('At least 10 characters')
    expect(noteProblem('Mapped the address fields')).toBeNull()
  })
})
