import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../api/client.js'
import { useSaveWeek, useWeek } from '../../api/queries.js'
import { isProofNote } from '../timer/timerClock.js'
import { addDays } from '../../lib/format.js'
import { readUnsaved, writeUnsaved } from './unsavedStore.js'
import { weekFigures } from './weekFigures.js'

export const DAY_CAP = 24
export const MIN_HOURS = 0.25
export const key = (milestoneId, date) => `${milestoneId}|${date}`
export const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v))
export const tooLow = (v) => num(v) > 0 && num(v) < MIN_HOURS
const without = (obj, drop) => Object.fromEntries(Object.entries(obj).filter(([k]) => !drop(k)))
const only = (obj, keep) => without(obj, (k) => !keep(k))
const COUNTED = ['pending', 'approved']   // the statuses the server counts toward a day and a week

/** A save failure with one cell taken out of the cells it names (that cell was saved since); null once none is left.
 * A failure that names no cells is kept as it is. */
function withoutCell(failure, cellKey) {
  const cells = failure?.details?.cells
  if (!Array.isArray(cells)) return failure
  const left = cells.filter((c) => key(c.milestone_id, c.work_date) !== cellKey)
  if (left.length === cells.length) return failure
  if (!left.length) return null
  return new ApiError({ status: failure.status, code: failure.code, message: failure.message,
    details: { ...failure.details, cells: left }, requestId: failure.requestId })
}

// On hold pauses logging; completed closes it. The server refuses changes on both (409 PROJECT_NOT_OPEN).
const CLOSED = { on_hold: 'Project on hold — logging paused', completed: 'Project completed — logging closed' }
export const closedLabel = (row) => (row.open === false || CLOSED[row.project?.status]
  ? CLOSED[row.project?.status] ?? 'Logging closed on this project' : null)

/**
 * One week of a person's timesheet: the saved sheet, what is being typed, and everything derived from both.
 * userId: whose typing this is. With it, unsaved typing is kept in this tab (unsavedStore.js) and restored after a reload;
 * `restored` says a restore brought back cells that are still unsaved changes, and `dismissRestored()` hides that notice.
 */
export function useTimesheetWeek(week, { userId } = {}) {
  const sheet = useWeek(week)
  const save = useSaveWeek()
  const saveOne = useSaveWeek()
  const [drafts, setDrafts] = useState({})
  const [notes, setNotes] = useState({})
  const [failure, setFailure] = useState(null)
  // Typing kept in this tab: the '<userId>.<week>'s whose stored typing was checked, and the cells the last restore brought back.
  const [kept, setKept] = useState({ checked: [], id: null, cells: [] })

  const allDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const inWeek = (k) => allDays.includes(k.split('|')[1])
  const entries = useMemo(() => Object.fromEntries((sheet.data?.entries ?? []).map((e) => [key(e.milestone_id, e.work_date), e])), [sheet.data])
  // Cells holding timer hours are locked at saved hours + unsubmitted timer hours (the server refuses anything else).
  const locks = useMemo(() => Object.fromEntries((sheet.data?.locks ?? []).map((l) => [key(l.milestone_id, l.work_date), l])), [sheet.data])
  const timerNotes = useMemo(() => Object.fromEntries((sheet.data?.drafts ?? []).map((d) => [key(d.milestone_id, d.work_date), d.note])), [sheet.data])
  const valueOf = (k) => (locks[k] ? String(locks[k].hours) : k in drafts ? drafts[k] : entries[k] ? String(entries[k].hours) : '')
  const hasDraft = (k) => Number(locks[k]?.draft_hours ?? 0) > 0
  const isDraft = (k) => k in drafts

  const rows = sheet.data?.rows ?? []
  // While the previous week's sheet is on show (placeholder data, this week's still loading), its rows aren't this
  // week's: nothing typed on them counts or can be sent until this week's own rows are in.
  const loading = !sheet.data || sheet.isPlaceholderData

  // Restore runs once per week, when the sheet holds that week's own data (never the previous week's, shown while this one
  // loads) and nothing is typed in it yet. Only cells of rows still listed and open come back; their values are taken as
  // typed, since `changed` already ignores one equal to the saved hours. Done while rendering, so no frame shows the week
  // without its typing and the mirror below never sees the week before its check.
  const storeId = userId ? `${userId}.${week}` : null
  const checked = storeId !== null && kept.checked.includes(storeId)
  if (storeId && !checked && sheet.data && !sheet.isPlaceholderData) {
    const typed = Object.keys(drafts).some(inWeek) || Object.keys(notes).some(inWeek)
    const stored = typed ? null : readUnsaved(userId, week)
    const open = (k) => {
      const row = rows.find((r) => String(r.milestone.id) === k.split('|')[0])
      return Boolean(row) && !closedLabel(row)
    }
    const back = { drafts: only(stored?.drafts ?? {}, open), notes: only(stored?.notes ?? {}, open) }
    if (Object.keys(back.drafts).length) setDrafts((d) => ({ ...d, ...back.drafts }))
    if (Object.keys(back.notes).length) setNotes((n) => ({ ...n, ...back.notes }))
    setKept((s) => (s.checked.includes(storeId) ? s : { checked: [...s.checked, storeId], id: storeId,
      cells: [...new Set([...Object.keys(back.drafts), ...Object.keys(back.notes)])] }))
  }
  // The mirror: this week's typed hours and notes go to storage after every change, once its check has run. Hours are
  // never sent from here; only Submit and Save & resubmit send them, and what they sent leaves memory and so storage.
  useEffect(() => {
    if (!checked) return
    const mine = (k) => allDays.includes(k.split('|')[1])
    writeUnsaved(userId, week, { drafts: only(drafts, mine), notes: only(notes, mine) })
  }, [checked, userId, week, allDays, drafts, notes])

  const closedKeys = new Set(rows.filter((r) => closedLabel(r)).flatMap((r) => allDays.map((d) => key(r.milestone.id, d))))
  const cellKeys = rows.flatMap((r) => allDays.map((d) => key(r.milestone.id, d)))
  // The cells Submit may send: this week's, on rows the sheet lists as open, and none while the week loads. Typing on
  // a row unassigned or put on hold since (a refetch, or a restore from cached data) stays in memory, but it neither
  // counts nor goes out.
  const openKeys = new Set(loading ? [] : cellKeys.filter((k) => !closedKeys.has(k)))
  const typed = (k) => k in drafts && openKeys.has(k)
  // What a cell adds to the totals, as the server counts it: its pending or approved hours, a timer draft, or the hours
  // typed into it; rejected hours are left out unless re-typed.
  const countsToward = (k) => hasDraft(k) || typed(k) || Boolean(entries[k] && entries[k].status !== 'rejected')
  const cellHours = (k) => (!countsToward(k) ? 0 : locks[k] ? num(locks[k].hours) : typed(k) ? num(drafts[k]) : num(entries[k]?.hours))
  const total = cellKeys.reduce((s, k) => s + cellHours(k), 0)
  // A day, and a row, count the same way.
  const dayTotal = (d) => rows.reduce((s, r) => s + cellHours(key(r.milestone.id, d)), 0)
  const rowTotal = (milestoneId) => allDays.reduce((s, d) => s + cellHours(key(milestoneId, d)), 0)
  const overDays = allDays.filter((d) => dayTotal(d) > DAY_CAP)
  const tooMany = cellKeys.some((k) => cellHours(k) > DAY_CAP) || overDays.length > 0
  const tooFewKeys = cellKeys.filter((k) => typed(k) && tooLow(drafts[k]))
  const tooFew = tooFewKeys.length > 0
  // The server's day rule for one cell saved on its own (Save & resubmit): this week's saved pending and approved hours
  // that day on every other cell, unlisted rows included, plus the hours sent.
  const savedOthers = (date, except) => Object.entries(entries)
    .filter(([k, e]) => k !== except && e.work_date === date && COUNTED.includes(e.status))
    .reduce((s, [, e]) => s + num(e.hours), 0)
  // A stop's note pre-fills a cell that has none.
  const noteOf = (k) => (k in notes ? notes[k] : entries[k]?.note || (hasDraft(k) ? timerNotes[k] ?? '' : ''))
  // A locked cell changes only by its timer draft, or by resubmitting it unchanged after a rejection.
  const hoursChanged = (k) => hasDraft(k) || (Boolean(locks[k]) && k in drafts && entries[k]?.status === 'rejected')
    || (!locks[k] && k in drafts && (num(drafts[k]) !== num(entries[k]?.hours ?? 0)
    || (!entries[k] && drafts[k] !== '') || (entries[k]?.status === 'rejected' && num(drafts[k]) > 0)))
  const noteChanged = (k) => k in notes && notes[k] !== (entries[k]?.note ?? '')
  // A note alone on an empty cell has nothing to save; it goes with the hours once they're typed.
  // Only this week's cells count: edits made in another week stay in memory until the person is back in that week.
  // And only the cells Submit may send (openKeys): Submit never sends a cell the sheet doesn't list as open.
  const wouldChange = (k) => (hoursChanged(k) || noteChanged(k)) && (entries[k] || num(valueOf(k)) > 0)
  const changed = [...new Set([...Object.keys(drafts), ...Object.keys(notes), ...Object.keys(locks).filter(hasDraft)])]
    .filter((k) => openKeys.has(k))
    .filter(wouldChange)
  // Typing this week that Submit won't send: its row was closed or unassigned after it was typed.
  const heldBack = loading ? [] : [...new Set([...Object.keys(drafts), ...Object.keys(notes)])]
    .filter((k) => inWeek(k) && !openKeys.has(k))
    .filter(wouldChange)
  // Cells the server said need proof of work (PROOF_REQUIRED), until a note is added to them.
  const proofCells = new Set(failure?.code === 'PROOF_REQUIRED'
    ? (failure.details?.cells ?? []).map((c) => key(c.milestone_id, c.work_date)) : [])
  // New or changed hours with no work note yet: the server asks for one unless a progress update that day covers it.
  const wantsNote = (k) => num(valueOf(k)) > 0 && (hoursChanged(k) || noteChanged(k)) && !isProofNote(noteOf(k))
  const timerNeedsNote = (k) => Boolean(entries[k]?.needs_note) && !isProofNote(noteOf(k))
  const attention = (k) => (proofCells.has(k) && !isProofNote(noteOf(k))) || timerNeedsNote(k) || wantsNote(k)

  const setHours = (k, v) => setDrafts((d) => ({ ...d, [k]: v }))
  const setNote = (k, v) => setNotes((n) => ({ ...n, [k]: v }))
  // Drops what was typed in this week, its stored copy and any save failure (when the person moves to another week). A week
  // left before its own data came in was never checked, so what it has stored stays for when the person is back.
  const discard = () => {
    setDrafts((d) => without(d, inWeek))
    setNotes((n) => without(n, inWeek))
    setFailure(null)
    setKept((s) => ({ ...s, cells: [] }))
    if (checked) writeUnsaved(userId, week, {})
  }

  // One cell as the PUT sends it: its hours, and its note when one was typed (or a timer draft's note fills an empty one).
  const cellBody = (k) => {
    const [milestoneId, date] = k.split('|')
    const note = k in notes ? notes[k] : hasDraft(k) && !entries[k]?.note && timerNotes[k] ? timerNotes[k] : undefined
    return { milestone_id: milestoneId, work_date: date, hours: num(valueOf(k)), ...(note !== undefined ? { note } : {}) }
  }
  // Only what was sent is cleared: a note on a row with no hours has nothing to save yet and stays.
  const clearSent = (sent) => {
    setDrafts((d) => without(d, (k) => sent.has(k)))
    setNotes((n) => without(n, (k) => sent.has(k)))
    setKept((s) => ({ ...s, cells: s.cells.filter((k) => !sent.has(k)) }))
  }

  const onSave = async () => {
    setFailure(null)
    const sent = new Set(changed)
    const body = { week, entries: changed.map(cellBody) }
    if (!body.entries.length) return
    try {
      await save.mutateAsync(body)
      clearSent(sent)
    } catch (err) { setFailure(err) }
  }
  // Entry details' Save & resubmit: one PUT with this cell alone. Every other cell's typing stays unsaved. A failure
  // rejects with the API error for the panel to show; the week's `failure` (Submit's) is left as it is.
  // Once it's saved, a Submit failure that named that cell no longer applies to it.
  const saveCell = async (k) => {
    await saveOne.mutateAsync({ week, entries: [cellBody(k)] })
    clearSent(new Set([k]))
    setFailure((f) => withoutCell(f, k))
  }
  // The restore notice: a restore of this week brought back cells that are still unsaved changes.
  const restored = kept.id === storeId && kept.cells.some((k) => changed.includes(k))
  const dismissRestored = () => setKept((s) => ({ ...s, cells: [] }))
  const nameOf = (milestoneId) => rows.find((r) => String(r.milestone.id) === String(milestoneId))?.milestone.name ?? 'A milestone'

  // The Week totals card: the grid's cells, plus saved hours this week on rows the sheet no longer lists.
  const edited = new Set(changed)
  const listed = new Set(cellKeys)
  const figures = weekFigures(
    cellKeys.map((k) => ({ hours: cellHours(k), counts: countsToward(k), entry: entries[k], edited: edited.has(k) })),
    Object.entries(entries).filter(([k]) => inWeek(k) && !listed.has(k)).map(([, e]) => e))

  const groups = rows.reduce((acc, r) => {
    const g = acc.find((x) => x.project.id === r.project.id)
    if (g) g.rows.push(r)
    else acc.push({ project: r.project, rows: [r] })
    return acc
  }, [])

  return {
    week, sheet, loading, rows, groups, allDays, entries, locks,
    valueOf, noteOf, hasDraft, isDraft, attention, timerNeedsNote, dayTotal, rowTotal, savedOthers,
    total, figures, overDays, tooMany, tooFew, tooFewKeys, changed, heldBack,
    failure, setFailure, setHours, setNote, onSave, saving: save.isPending, saveCell, savingCell: saveOne.isPending, discard,
    restored, dismissRestored, nameOf, closedLabel,
  }
}
