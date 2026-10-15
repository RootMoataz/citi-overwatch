import { useMemo, useState } from 'react'
import { useSaveWeek, useWeek } from '../../api/queries.js'
import { isProofNote } from '../timer/timerClock.js'
import { addDays } from '../../lib/format.js'

export const DAY_CAP = 24
export const MIN_HOURS = 0.25
export const key = (milestoneId, date) => `${milestoneId}|${date}`
export const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v))
export const tooLow = (v) => num(v) > 0 && num(v) < MIN_HOURS

// On hold pauses logging; completed closes it. The server refuses changes on both (409 PROJECT_NOT_OPEN).
const CLOSED = { on_hold: 'Project on hold — logging paused', completed: 'Project completed — logging closed' }
const closedLabel = (row) => (row.open === false || CLOSED[row.project?.status]
  ? CLOSED[row.project?.status] ?? 'Logging closed on this project' : null)

/** One week of a person's timesheet: the saved sheet, what is being typed, and everything derived from both. */
export function useTimesheetWeek(week) {
  const sheet = useWeek(week)
  const save = useSaveWeek()
  const [drafts, setDrafts] = useState({})
  const [notes, setNotes] = useState({})
  const [failure, setFailure] = useState(null)

  const allDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const entries = useMemo(() => Object.fromEntries((sheet.data?.entries ?? []).map((e) => [key(e.milestone_id, e.work_date), e])), [sheet.data])
  // Cells holding timer hours are locked at saved hours + unsubmitted timer hours (the server refuses anything else).
  const locks = useMemo(() => Object.fromEntries((sheet.data?.locks ?? []).map((l) => [key(l.milestone_id, l.work_date), l])), [sheet.data])
  const timerNotes = useMemo(() => Object.fromEntries((sheet.data?.drafts ?? []).map((d) => [key(d.milestone_id, d.work_date), d.note])), [sheet.data])
  const valueOf = (k) => (locks[k] ? String(locks[k].hours) : k in drafts ? drafts[k] : entries[k] ? String(entries[k].hours) : '')
  const hasDraft = (k) => Number(locks[k]?.draft_hours ?? 0) > 0
  const isDraft = (k) => k in drafts
  const countsToward = (k) => (hasDraft(k) || k in drafts ? true : entries[k] && entries[k].status !== 'rejected')

  const rows = sheet.data?.rows ?? []
  const closedKeys = new Set(rows.filter((r) => closedLabel(r)).flatMap((r) => allDays.map((d) => key(r.milestone.id, d))))
  const cellKeys = rows.flatMap((r) => allDays.map((d) => key(r.milestone.id, d)))
  const total = cellKeys.reduce((s, k) => s + (countsToward(k) ? num(valueOf(k)) : 0), 0)
  // A day counts the same hours as the server: pending and approved entries plus whatever is being typed.
  const dayTotal = (d) => rows.reduce((s, r) => s + (countsToward(key(r.milestone.id, d)) ? num(valueOf(key(r.milestone.id, d))) : 0), 0)
  const overDays = allDays.filter((d) => dayTotal(d) > DAY_CAP)
  const tooMany = cellKeys.some((k) => num(valueOf(k)) > DAY_CAP) || overDays.length > 0
  const tooFewKeys = cellKeys.filter((k) => k in drafts && tooLow(drafts[k]))
  const tooFew = tooFewKeys.length > 0
  // A stop's note pre-fills a cell that has none.
  const noteOf = (k) => (k in notes ? notes[k] : entries[k]?.note || (hasDraft(k) ? timerNotes[k] ?? '' : ''))
  // A locked cell changes only by its timer draft, or by resubmitting it unchanged after a rejection.
  const hoursChanged = (k) => hasDraft(k) || (Boolean(locks[k]) && k in drafts && entries[k]?.status === 'rejected')
    || (!locks[k] && k in drafts && (num(drafts[k]) !== num(entries[k]?.hours ?? 0)
    || (!entries[k] && drafts[k] !== '') || (entries[k]?.status === 'rejected' && num(drafts[k]) > 0)))
  const noteChanged = (k) => k in notes && notes[k] !== (entries[k]?.note ?? '')
  // A note alone on an empty cell has nothing to save; it goes with the hours once they're typed.
  const changed = [...new Set([...Object.keys(drafts), ...Object.keys(notes),
    ...Object.keys(locks).filter((k) => hasDraft(k) && rows.some((r) => k.startsWith(`${r.milestone.id}|`)) && !closedKeys.has(k))])]
    .filter((k) => (hoursChanged(k) || noteChanged(k)) && (entries[k] || num(valueOf(k)) > 0))
  // Cells the server said need proof of work (PROOF_REQUIRED), until a note is added to them.
  const proofCells = new Set(failure?.code === 'PROOF_REQUIRED'
    ? (failure.details?.cells ?? []).map((c) => key(c.milestone_id, c.work_date)) : [])
  // New or changed hours with no work note yet: the server asks for one unless a progress update that day covers it.
  const wantsNote = (k) => num(valueOf(k)) > 0 && (hoursChanged(k) || noteChanged(k)) && !isProofNote(noteOf(k))
  const timerNeedsNote = (k) => Boolean(entries[k]?.needs_note) && !isProofNote(noteOf(k))
  const attention = (k) => (proofCells.has(k) && !isProofNote(noteOf(k))) || timerNeedsNote(k) || wantsNote(k)

  const setHours = (k, v) => setDrafts((d) => ({ ...d, [k]: v }))
  const setNote = (k, v) => setNotes((n) => ({ ...n, [k]: v }))
  // Drops everything typed and any save failure (when the person moves to another week).
  const discard = () => { setDrafts({}); setNotes({}); setFailure(null) }

  const onSave = async () => {
    setFailure(null)
    const body = { week, entries: changed.map((k) => {
      const [milestoneId, date] = k.split('|')
      const note = k in notes ? notes[k] : hasDraft(k) && !entries[k]?.note && timerNotes[k] ? timerNotes[k] : undefined
      return { milestone_id: milestoneId, work_date: date, hours: num(valueOf(k)), ...(note !== undefined ? { note } : {}) }
    }) }
    if (!body.entries.length) return
    try {
      await save.mutateAsync(body)
      setDrafts({})
      setNotes({})
    } catch (err) { setFailure(err) }
  }
  const nameOf = (milestoneId) => rows.find((r) => String(r.milestone.id) === String(milestoneId))?.milestone.name ?? 'A milestone'

  const groups = rows.reduce((acc, r) => {
    const g = acc.find((x) => x.project.id === r.project.id)
    if (g) g.rows.push(r)
    else acc.push({ project: r.project, rows: [r] })
    return acc
  }, [])

  return {
    week, sheet, rows, groups, allDays, entries, locks,
    valueOf, noteOf, hasDraft, isDraft, attention, timerNeedsNote, dayTotal,
    total, overDays, tooMany, tooFew, tooFewKeys, changed,
    failure, setFailure, setHours, setNote, onSave, saving: save.isPending, discard,
    nameOf, closedLabel,
  }
}
