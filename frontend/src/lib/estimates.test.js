import { describe, expect, test } from 'vitest'
import { effortText, estimateTone, projectEffort, timeFrameLine, usageLine } from './estimates.js'

const m = (overrides = {}) => ({ estimated_hours: 120, duration_days: 30, working_days: 22, logged_hours: 0,
  estimate_used_pct: 0, ...overrides })

describe('estimates', () => {
  test('time frame line shows the estimate and the days', () => {
    expect(timeFrameLine(m())).toBe('Est. 120h · 30 days (22 working days)')
    expect(timeFrameLine(m({ estimated_hours: null, duration_days: 1, working_days: 1 }))).toBe('1 day (1 working day)')
    expect(timeFrameLine({})).toBe('')
  })

  test('usage line appears once hours are logged, with a word for amber and red', () => {
    expect(usageLine(m())).toBeNull()
    expect(usageLine(m({ logged_hours: 86, estimate_used_pct: 71.7 }))).toEqual({ text: '86h logged · 72% of estimate', tone: 'ok' })
    expect(usageLine(m({ logged_hours: 110, estimate_used_pct: 91.7 }))).toEqual(
      { text: '110h logged · 92% of estimate · nearly used', tone: 'warning' })
    expect(usageLine(m({ logged_hours: 130, estimate_used_pct: 108.3 }))).toEqual(
      { text: '130h logged · 108% of estimate · over estimate', tone: 'alert' })
    expect(usageLine(m({ logged_hours: 5, estimated_hours: null, estimate_used_pct: null }))).toEqual({ text: '5h logged', tone: 'ok' })
  })

  test('effort text: logged / estimate, the estimate alone, logged alone, or a dash; and what is over', () => {
    expect(effortText({ logged_hours: 118, estimated_hours: 264 })).toEqual({ text: '118h / 264h', over: null })
    expect(effortText({ logged_hours: 0, estimated_hours: 114 })).toEqual({ text: '114h estimate', over: null })
    expect(effortText({ logged_hours: '7.5', estimated_hours: null })).toEqual({ text: '7.5h logged', over: null })
    expect(effortText({ logged_hours: 0, estimated_hours: null })).toEqual({ text: '—', over: null })
    expect(effortText({ logged_hours: 100.5, estimated_hours: 100 })).toEqual({ text: '100.5h / 100h', over: '+0.5h over estimate' })
    expect(effortText({ logged_hours: 100.3, estimated_hours: 100.1 }).over).toBe('+0.2h over estimate')   // no float noise
    expect(effortText({ logged_hours: 100, estimated_hours: 100 }).over).toBeNull()
  })

  test('tones switch above 90% and above 100%', () => {
    expect([90, 90.1, 100, 100.1, null].map(estimateTone)).toEqual(['ok', 'warning', 'warning', 'alert', 'ok'])
  })

  test('project effort tile', () => {
    expect(projectEffort({ total_estimated_hours: 640, duration_days: 120, estimate_used_pct: 52 })).toEqual(
      { value: '640h', hint: 'over 120 days · 52% used', tone: 'ok' })
    expect(projectEffort({ total_estimated_hours: null, duration_days: 120 })).toEqual(
      { value: '—', hint: 'No estimates yet · 120 days', tone: 'ok' })
  })
})
