import { describe, expect, test } from 'vitest'
import { relativeTime } from './relativeTime.js'

describe('relativeTime', () => {
  const now = new Date('2026-10-14T15:00:00Z')
  const ago = (ms) => new Date(now.getTime() - ms).toISOString()
  test('reads like a person would say it', () => {
    expect(relativeTime(ago(10 * 1000), now)).toBe('just now')
    expect(relativeTime(ago(2 * 60 * 1000), now)).toBe('2 min ago')
    expect(relativeTime(ago(3 * 3600 * 1000), now)).toBe('3 h ago')
    expect(relativeTime(ago(26 * 3600 * 1000), now)).toBe('yesterday')
    expect(relativeTime(ago(4 * 86400 * 1000), now)).toBe('4 days ago')
    expect(relativeTime('2026-09-01T12:00:00Z', now)).toBe('Sep 1, 2026')
    expect(relativeTime('nonsense', now)).toBe('')
  })
})
