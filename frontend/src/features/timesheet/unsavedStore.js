// Unsaved timesheet typing kept in this browser tab (spec D9 and §5.2): sessionStorage, one key per person and week.
// Nothing here sends hours; only Submit or Save & resubmit does. Every access is wrapped: a full, blocked or missing
// store just means the typing lives in memory until the page closes.
import { addDays } from '../../lib/format.js'
import { NOTE_MAX } from '../timer/timerClock.js'

export const UNSAVED_PREFIX = 'overwatch.timesheet.unsaved.'

/** 'overwatch.timesheet.unsaved.<userId>.<week>' */
export const unsavedKey = (userId, week) => `${UNSAVED_PREFIX}${userId}.${week}`

const CELL = /^[^|]+\|(\d{4}-\d{2}-\d{2})$/
// What an hours cell can hold as typed (HoursField's rule): up to 2 digits, a point and up to 2 more.
const HOURS = /^\d{0,2}(\.\d{0,2})?$/
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const keep = (obj, ok) => (isObject(obj) ? Object.fromEntries(Object.entries(obj).filter(([k, v]) => ok(k, v))) : {})

/**
 * The typing stored for a person's week, as `{ drafts, notes }` keyed '<milestoneId>|<date>', or null when there is none
 * or it can't be read. Only cells of that week survive, with hours as typed text and notes of at most NOTE_MAX characters.
 */
export function readUnsaved(userId, week) {
  try {
    const raw = window.sessionStorage.getItem(unsavedKey(userId, week))
    if (raw === null) return null
    const data = JSON.parse(raw)
    if (!isObject(data)) return null
    const days = new Set(Array.from({ length: 7 }, (_, i) => addDays(week, i)))
    const inWeek = (k) => days.has(CELL.exec(k)?.[1])
    return {
      drafts: keep(data.drafts, (k, v) => inWeek(k) && typeof v === 'string' && HOURS.test(v)),
      notes: keep(data.notes, (k, v) => inWeek(k) && typeof v === 'string' && v.length <= NOTE_MAX),
    }
  } catch { return null }
}

/** Stores a person's typing for a week; with no hours and no notes the key is removed. */
export function writeUnsaved(userId, week, { drafts = {}, notes = {} } = {}) {
  try {
    const k = unsavedKey(userId, week)
    if (Object.keys(drafts).length || Object.keys(notes).length) window.sessionStorage.setItem(k, JSON.stringify({ drafts, notes }))
    else window.sessionStorage.removeItem(k)
  } catch { /* full or blocked: the typing stays in memory */ }
}

/** Removes every key under UNSAVED_PREFIX in this tab (a sign-out), and nothing else. */
export function clearAllUnsaved() {
  try {
    const store = window.sessionStorage
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k) => k?.startsWith(UNSAVED_PREFIX))
    keys.forEach((k) => store.removeItem(k))
  } catch { /* blocked: what is stored can't be reached */ }
}
