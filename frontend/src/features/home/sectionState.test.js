import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SECTION_KEYS, useCollapsedSections } from './sectionState.js'

const KEY = 'overwatch.myweek.sections'

describe('useCollapsedSections', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  test('lists the nine keys', () => {
    expect(SECTION_KEYS).toEqual(['nowNext', 'inProgress', 'upNext', 'review', 'coming', 'done', 'claim', 'week', 'manager'])
  })

  test('keys start open; toggle closes and reopens; open() opens a closed key', () => {
    const { result } = renderHook(() => useCollapsedSections())
    expect(result.current.isOpen('done')).toBe(true)
    act(() => result.current.toggle('done'))
    expect(result.current.isOpen('done')).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ done: true })
    act(() => result.current.toggle('done'))
    expect(result.current.isOpen('done')).toBe(true)
    act(() => result.current.toggle('coming'))
    expect(result.current.isOpen('coming')).toBe(false)
    act(() => result.current.open('coming'))
    expect(result.current.isOpen('coming')).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({})
  })

  test('the state survives a remount', () => {
    const first = renderHook(() => useCollapsedSections())
    act(() => first.result.current.toggle('done'))
    first.unmount()
    const second = renderHook(() => useCollapsedSections())
    expect(second.result.current.isOpen('done')).toBe(false)
    expect(second.result.current.isOpen('claim')).toBe(true)
  })

  test('garbage JSON means everything is open', () => {
    localStorage.setItem(KEY, '{not json')
    const { result } = renderHook(() => useCollapsedSections())
    expect(SECTION_KEYS.every((k) => result.current.isOpen(k))).toBe(true)
    localStorage.setItem(KEY, '[1,2]')
    expect(renderHook(() => useCollapsedSections()).result.current.isOpen('done')).toBe(true)
  })

  test('a blocked store still toggles in memory', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useCollapsedSections())
    expect(result.current.isOpen('done')).toBe(true)
    act(() => result.current.toggle('done'))
    expect(result.current.isOpen('done')).toBe(false)
  })
})
