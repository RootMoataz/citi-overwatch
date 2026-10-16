// Unsaved timesheet typing kept in this tab (sessionStorage): the key, what a read keeps, and storage that fails.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { UNSAVED_PREFIX, clearAllUnsaved, readUnsaved, unsavedKey, writeUnsaved } from './unsavedStore.js'

const WEEK = '2026-10-12'
const KEY = 'overwatch.timesheet.unsaved.u-emp.2026-10-12'
const NOTE = 'Mapped customer records and validated source fields.'

afterEach(() => { vi.restoreAllMocks() })

/** Makes one sessionStorage method throw, as a full or blocked store does; localStorage keeps working. */
function breakSession(method) {
  const real = Storage.prototype[method]
  return vi.spyOn(Storage.prototype, method).mockImplementation(function broken(...args) {
    if (this === window.sessionStorage) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    return real.apply(this, args)
  })
}

describe('unsavedKey', () => {
  test('is the prefix, the user id and the week', () => {
    expect(UNSAVED_PREFIX).toBe('overwatch.timesheet.unsaved.')
    expect(unsavedKey('u-emp', WEEK)).toBe(KEY)
  })
})

describe('readUnsaved and writeUnsaved', () => {
  test('a round trip gives back the hours and notes as typed', () => {
    const typed = { drafts: { 'm1|2026-10-13': '9', 'm2|2026-10-18': '', 'm2|2026-10-12': '7.' }, notes: { 'm1|2026-10-13': NOTE } }
    writeUnsaved('u-emp', WEEK, typed)
    expect(JSON.parse(sessionStorage.getItem(KEY))).toEqual(typed)
    expect(readUnsaved('u-emp', WEEK)).toEqual(typed)
  })

  test("another user's or another week's typing is under another key", () => {
    writeUnsaved('u-emp', WEEK, { drafts: { 'm1|2026-10-13': '9' }, notes: {} })
    expect(readUnsaved('u-other', WEEK)).toBeNull()
    expect(readUnsaved('u-emp', '2026-10-05')).toBeNull()
  })

  test('writing nothing removes the key', () => {
    writeUnsaved('u-emp', WEEK, { drafts: { 'm1|2026-10-13': '9' }, notes: {} })
    writeUnsaved('u-emp', WEEK, { drafts: {}, notes: {} })
    expect(sessionStorage.getItem(KEY)).toBeNull()
    writeUnsaved('u-emp', WEEK, { drafts: { 'm1|2026-10-13': '9' }, notes: {} })
    writeUnsaved('u-emp', WEEK, {})
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  test('nothing stored gives null', () => {
    expect(readUnsaved('u-emp', WEEK)).toBeNull()
  })

  test.each([['garbage JSON', '{"drafts": {'], ['null', 'null'], ['an array', '[]'], ['a string', '"9"'], ['a number', '42']])(
    '%s gives null', (_, raw) => {
      sessionStorage.setItem(KEY, raw)
      expect(readUnsaved('u-emp', WEEK)).toBeNull()
    })

  test('a key for another week, a malformed key, "1e1" hours and a 501-character note are dropped', () => {
    sessionStorage.setItem(KEY, JSON.stringify({
      drafts: {
        'm1|2026-10-13': '9', // kept
        'm2|2026-10-18': '7.25', // kept: Sunday is in the week
        'm1|2026-10-19': '8', // the next week
        'm1|2026-10-11': '8', // the week before
        'm1-2026-10-14': '8', // no separator
        'm1|2026-10-14|x': '8', // more than one
        '|2026-10-14': '8', // no milestone
        'm1|Oct 14': '8', // not an ISO date
        'm2|2026-10-15': '1e1', // not hours
        'm2|2026-10-16': '123', // more than two digits
        'm2|2026-10-17': 9, // a number, not typed text
      },
      notes: {
        'm1|2026-10-13': NOTE, // kept
        'm2|2026-10-13': 'x'.repeat(500), // kept: exactly the limit
        'm2|2026-10-14': 'x'.repeat(501),
        'm1|2026-10-20': NOTE, // another week
        'm2|2026-10-15': 12,
      },
    }))
    expect(readUnsaved('u-emp', WEEK)).toEqual({
      drafts: { 'm1|2026-10-13': '9', 'm2|2026-10-18': '7.25' },
      notes: { 'm1|2026-10-13': NOTE, 'm2|2026-10-13': 'x'.repeat(500) },
    })
  })

  test('drafts or notes that are not objects read as empty', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ drafts: ['9'], notes: 'Mapped the address tables' }))
    expect(readUnsaved('u-emp', WEEK)).toEqual({ drafts: {}, notes: {} })
  })

  test('setItem throwing does not throw', () => {
    breakSession('setItem')
    expect(() => writeUnsaved('u-emp', WEEK, { drafts: { 'm1|2026-10-13': '9' }, notes: {} })).not.toThrow()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  test('getItem and removeItem throwing do not throw either', () => {
    breakSession('getItem')
    breakSession('removeItem')
    expect(readUnsaved('u-emp', WEEK)).toBeNull()
    expect(() => writeUnsaved('u-emp', WEEK, {})).not.toThrow()
    expect(() => clearAllUnsaved()).not.toThrow()
  })
})

describe('clearAllUnsaved', () => {
  test('removes every unsaved key and leaves an unrelated acme-scout:demo-welcomed:x key alone', () => {
    writeUnsaved('u-emp', WEEK, { drafts: { 'm1|2026-10-13': '9' }, notes: {} })
    writeUnsaved('u-emp', '2026-10-05', { drafts: { 'm1|2026-10-06': '4' }, notes: {} })
    writeUnsaved('u-other', WEEK, { drafts: {}, notes: { 'm1|2026-10-13': NOTE } })
    sessionStorage.setItem('acme-scout:demo-welcomed:x', '1')
    sessionStorage.setItem('x.overwatch.timesheet.unsaved.u-emp.2026-10-12', 'kept')
    localStorage.setItem('overwatch.timesheet.view', 'week')
    clearAllUnsaved()
    expect(Object.keys(sessionStorage).sort()).toEqual(['acme-scout:demo-welcomed:x', 'x.overwatch.timesheet.unsaved.u-emp.2026-10-12'])
    expect(localStorage.getItem('overwatch.timesheet.view')).toBe('week')
  })
})
