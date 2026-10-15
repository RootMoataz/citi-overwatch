import { describe, expect, test } from 'vitest'
import { criteriaLines, kickbackReasonError, parsePercent, statusToast } from './workflow.js'

describe('workflow helpers', () => {
  test('percent: empty is not given, whole numbers 0..100 only', () => {
    expect(parsePercent('')).toEqual({ value: null })
    expect(parsePercent(' 0 ')).toEqual({ value: 0 })
    expect(parsePercent('100')).toEqual({ value: 100 })
    for (const bad of ['101', '-1', '4.5', 'ten', '1000']) expect(parsePercent(bad).error).toBeTruthy()
  })

  test('criteria are one per line, blanks dropped', () => {
    expect(criteriaLines(' a \n\n b\n')).toEqual(['a', 'b'])
    expect(criteriaLines(null)).toEqual([])
  })

  test('kickback reasons need 10 to 2000 characters', () => {
    expect(kickbackReasonError('too short')).toMatch(/at least 10/)
    expect(kickbackReasonError('  long enough now  ')).toBeNull()
    expect(kickbackReasonError('x'.repeat(2001))).toMatch(/under 2000/)
  })

  test('the status toast names auto-assignments, support routing or nobody free', () => {
    expect(statusToast({ routed_to: { milestone: { name: 'Build' }, project: { name: 'Atlas' } } }))
      .toBe("Status updated. You're now supporting Build (Atlas)")
    expect(statusToast({ auto_assigned: [{ user: { name: 'Ben Okafor' }, milestone: { name: 'Cutover' } }] }))
      .toBe('Completed. Auto-assigned Ben Okafor to Cutover')
    expect(statusToast({ auto_assigned: [], unfilled: [{ milestone: { name: 'Testing' } }] }))
      .toBe('Completed. Nobody qualified was free for Testing')
    expect(statusToast({})).toBe('Status updated')
  })
})
