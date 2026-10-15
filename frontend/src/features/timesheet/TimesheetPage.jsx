import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import EditNote from '@mui/icons-material/EditNoteOutlined'
import {
  Alert, AlertTitle, Box, Button, Chip, FormControlLabel, IconButton, Paper, Popover, Skeleton, Stack, Switch, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useMemo, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useSearchParams } from 'react-router-dom'
import { useSaveWeek, useWeek } from '../../api/queries.js'
import SourceChip from '../timer/SourceChip.jsx'
import TimerButton from '../timer/TimerButton.jsx'
import { NOTE_MAX, NOTE_MIN, isProofNote } from '../timer/timerClock.js'
import { STATUS, statusColor } from '../../app/theme.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import SupportingChip from '../../components/SupportingChip.jsx'
import { addDays, formatDate, formatDayLabel, formatHours, mondayOf } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'

const CAP = 40
const DAY_CAP = 24
const MIN_HOURS = 0.25
const key = (milestoneId, date) => `${milestoneId}|${date}`
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v))
const tooLow = (v) => num(v) > 0 && num(v) < MIN_HOURS
// Hours are plain numbers: digits and one point, at most 2 digits either side, so "-", "+" and "e" never get in.
// Typed and pasted text both arrive through onChange, so both are cleaned here.
const cleanHours = (raw) => {
  const [whole, ...rest] = String(raw).replace(/[^\d.]/g, '').split('.')
  return rest.length ? `${whole.slice(0, 2)}.${rest.join('').slice(0, 2)}` : whole.slice(0, 2)
}
// A paste is taken only when it is already a clean value; anything else ("-3", "1e1", "7.5h") is refused whole
// rather than half-cleaned into a different number.
const CLEAN_PASTE = /^\d{1,2}(\.\d{1,2})?$/
// Keys that could start a negative, an exponent or a letter never reach the cell.
const allowedKey = (e) => e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1 || /[\d.]/.test(e.key)

// On hold pauses logging; completed closes it. The server refuses changes on both (409 PROJECT_NOT_OPEN).
const CLOSED = { on_hold: 'Project on hold — logging paused', completed: 'Project completed — logging closed' }
const closedLabel = (row) => (row.open === false || CLOSED[row.project?.status]
  ? CLOSED[row.project?.status] ?? 'Logging closed on this project' : null)

/** The work note of one cell: an icon that shows whether there is one, opening a small editor.
 * attention: this cell needs a note (the server asked for proof, or a timer saved hours without one). */
function NoteButton({ cellLabel, note, onChange, attention, disabled }) {
  const [anchor, setAnchor] = useState(null)
  const [text, setText] = useState(note)
  const has = Boolean(note.trim())
  const tooShort = text.trim().length > 0 && !isProofNote(text)
  const hint = has ? `Note: ${note}` : attention ? 'Add a work note' : 'Add a work note (or post a progress update that day)'
  return (
    <>
      <Tooltip title={hint}>
        <span>
          <IconButton size="small" aria-label={`${has ? 'Edit' : 'Add'} work note, ${cellLabel}`} disabled={disabled}
            onClick={(e) => { setText(note); setAnchor(e.currentTarget) }}
            color={attention ? 'warning' : has ? 'primary' : 'default'} data-attention={attention || undefined}
            sx={{ p: 0.25, ...(attention ? { bgcolor: (t) => alpha(t.palette.warning.main, 0.16) } : null) }}>
            <EditNote fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Stack sx={{ p: 2, gap: 1.5, width: 300 }}>
          <Typography variant="subtitle2" component="p">{cellLabel}</Typography>
          <TextField label="What did you work on?" multiline minRows={3} autoFocus value={text}
            onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX))} error={tooShort}
            helperText={tooShort ? `At least ${NOTE_MIN} characters`
              : `${text.trim().length}/${NOTE_MAX} · ${NOTE_MIN}-${NOTE_MAX} characters, or post a progress update that day`}
            slotProps={{ htmlInput: { maxLength: NOTE_MAX } }} />
          <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
            <Button onClick={() => setAnchor(null)}>Cancel</Button>
            <Button variant="contained" disabled={tooShort} onClick={() => { onChange(text.trim()); setAnchor(null) }}>Done</Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  )
}

function CellStatus({ entry, cellLabel, onResubmit, resubmitting, closed }) {
  if (!entry) return null
  const meta = STATUS[entry.status] ?? STATUS.pending
  const label = (
    <Typography variant="caption" sx={{ display: 'block', color: (t) => statusColor(meta, t), lineHeight: 1.2, mt: 0.5 }}>{entry.label}</Typography>
  )
  return (
    <>
      {entry.status === 'rejected' && entry.rejection_reason
        ? <Tooltip title={`Rejected: ${entry.rejection_reason}`}><span>{label}</span></Tooltip> : label}
      {entry.edited_after_decision ? <Chip size="small" label="Edited" variant="outlined" sx={{ mt: 0.5, height: 18 }} /> : null}
      <SourceChip source={entry.source} hours={entry.hours} trackedHours={entry.tracked_hours} sx={{ mt: 0.5 }} />
      {entry.status === 'rejected' && !resubmitting && !closed ? (
        <Button size="small" onClick={onResubmit} aria-label={`Resubmit ${cellLabel}`} sx={{ mt: 0.25, minWidth: 0, px: 0.5 }}>
          Resubmit
        </Button>
      ) : null}
    </>
  )
}

export default function TimesheetPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [params, setParams] = useSearchParams()
  const week = params.get('week') ?? mondayOf(new Date())
  const [showWeekend, setShowWeekend] = useState(false)
  const sheet = useWeek(week)
  const save = useSaveWeek()
  const [drafts, setDrafts] = useState({})
  const [notes, setNotes] = useState({})
  const [failure, setFailure] = useState(null)

  const allDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const days = desktop || showWeekend ? allDays : allDays.slice(0, 5)
  const entries = useMemo(() => Object.fromEntries((sheet.data?.entries ?? []).map((e) => [key(e.milestone_id, e.work_date), e])), [sheet.data])
  const valueOf = (k) => (k in drafts ? drafts[k] : entries[k] ? String(entries[k].hours) : '')
  const countsToward = (k) => (k in drafts ? true : entries[k] && entries[k].status !== 'rejected')

  const rows = sheet.data?.rows ?? []
  const cellKeys = rows.flatMap((r) => allDays.map((d) => key(r.milestone.id, d)))
  const total = cellKeys.reduce((s, k) => s + (countsToward(k) ? num(valueOf(k)) : 0), 0)
  // A day counts the same hours as the server: pending and approved entries plus whatever is being typed.
  const dayTotal = (d) => rows.reduce((s, r) => s + (countsToward(key(r.milestone.id, d)) ? num(valueOf(key(r.milestone.id, d))) : 0), 0)
  const overDays = allDays.filter((d) => dayTotal(d) > DAY_CAP)
  const tooMany = cellKeys.some((k) => num(valueOf(k)) > DAY_CAP) || overDays.length > 0
  const tooFew = cellKeys.some((k) => k in drafts && tooLow(drafts[k]))
  const noteOf = (k) => (k in notes ? notes[k] : entries[k]?.note ?? '')
  const hoursChanged = (k) => k in drafts && (num(drafts[k]) !== num(entries[k]?.hours ?? 0) || (!entries[k] && drafts[k] !== '')
    || (entries[k]?.status === 'rejected' && num(drafts[k]) > 0))
  const noteChanged = (k) => k in notes && notes[k] !== (entries[k]?.note ?? '')
  // A note alone on an empty cell has nothing to save; it goes with the hours once they're typed.
  const changed = [...new Set([...Object.keys(drafts), ...Object.keys(notes)])]
    .filter((k) => (hoursChanged(k) || noteChanged(k)) && (entries[k] || num(valueOf(k)) > 0))
  // Cells the server said need proof of work (PROOF_REQUIRED), until a note is added to them.
  const proofCells = new Set(failure?.code === 'PROOF_REQUIRED'
    ? (failure.details?.cells ?? []).map((c) => key(c.milestone_id, c.work_date)) : [])
  // New or changed hours with no work note yet: the server asks for one unless a progress update that day covers it.
  const wantsNote = (k) => num(valueOf(k)) > 0 && (hoursChanged(k) || noteChanged(k)) && !isProofNote(noteOf(k))
  const timerNeedsNote = (k) => Boolean(entries[k]?.needs_note) && !isProofNote(noteOf(k))
  const attention = (k) => (proofCells.has(k) && !isProofNote(noteOf(k))) || timerNeedsNote(k) || wantsNote(k)

  const goTo = (target) => { setDrafts({}); setNotes({}); setFailure(null); setParams({ week: target }, { replace: true }) }

  const onSave = async () => {
    setFailure(null)
    const body = { week, entries: changed.map((k) => {
      const [milestoneId, date] = k.split('|')
      return { milestone_id: milestoneId, work_date: date, hours: num(valueOf(k)), ...(k in notes ? { note: notes[k] } : {}) }
    }) }
    if (!body.entries.length) return
    try {
      await save.mutateAsync(body)
      setDrafts({})
      setNotes({})
    } catch (err) { setFailure(err) }
  }
  const nameOf = (milestoneId) => rows.find((r) => String(r.milestone.id) === String(milestoneId))?.milestone.name ?? 'A milestone'
  const thisWeek = week === mondayOf(new Date())

  const groups = rows.reduce((acc, r) => {
    const g = acc.find((x) => x.project.id === r.project.id)
    if (g) g.rows.push(r)
    else acc.push({ project: r.project, rows: [r] })
    return acc
  }, [])

  return (
    <>
      <PageHeader title="My timesheet" subtitle="Log hours per day on the milestones you're assigned to. Every entry goes to the project manager for approval."
        actions={<Button variant="contained" onClick={onSave} disabled={!changed.length || tooMany || tooFew || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save week'}</Button>} />
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'center' }, mb: 2 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <IconButton aria-label="Previous week" onClick={() => goTo(addDays(week, -7))}><ChevronLeft /></IconButton>
          <Typography variant="subtitle1" component="p">Week of {formatDate(week)}</Typography>
          <IconButton aria-label="Next week" onClick={() => goTo(addDays(week, 7))}><ChevronRight /></IconButton>
          <Button size="small" onClick={() => goTo(mondayOf(new Date()))}>This week</Button>
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        <Typography data-testid="week-total" data-over={total > CAP} variant="h3" component="p"
          sx={{ color: total > CAP ? 'warning.main' : 'text.primary' }}>
          {formatHours(total)} / {CAP}h
        </Typography>
        {!desktop ? <FormControlLabel control={<Switch checked={showWeekend} onChange={(e) => setShowWeekend(e.target.checked)} />} label="Weekend" /> : null}
      </Stack>
      {total > CAP ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This week is {formatHours(total)} — {formatHours(total - CAP)} over {CAP}h. Hours above {CAP} are sent to your manager as an overtime request.
        </Alert>
      ) : null}
      {overDays.map((d) => (
        <Alert key={d} severity="error" sx={{ mb: 1 }}>
          <Box component="span" sx={{ fontWeight: 700 }}>More than {DAY_CAP}h on {formatDayLabel(d)}</Box>
          <Box component="span" sx={{ display: 'block' }}>
            That day adds up to {formatHours(dayTotal(d))} across your milestones. Lower it to save.
          </Box>
        </Alert>
      ))}
      {tooMany && !overDays.length ? <Alert severity="error" sx={{ mb: 2 }}>A cell can't hold more than {DAY_CAP} hours.</Alert> : null}
      {tooFew ? <Alert severity="error" sx={{ mb: 2 }}>Log at least {MIN_HOURS} hours, or leave the cell empty.</Alert> : null}
      {failure?.code === 'PROOF_REQUIRED' ? (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          <AlertTitle>Add a work note before saving</AlertTitle>
          Each new or changed day needs a note ({NOTE_MIN}-{NOTE_MAX} characters) or a progress update you posted on that
          milestone that day. Missing for:
          <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
            {(failure.details?.cells ?? []).map((c) => (
              <li key={key(c.milestone_id, c.work_date)}>
                {nameOf(c.milestone_id)}, {formatDayLabel(c.work_date)}{c.reason === 'note_too_short' ? ' (note too short)' : ''}
              </li>
            ))}
          </Box>
          Use the highlighted note icon under each of those cells.
        </Alert>
      ) : (
        <ErrorAlert error={failure ?? sheet.error} title={failure ? "Couldn't save your week" : undefined}
          onRetry={failure ? undefined : () => sheet.refetch()} sx={{ mb: 2 }} />
      )}
      {sheet.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
      {!sheet.isLoading && !sheet.error && rows.length === 0 ? (
        <EmptyState title="You're not assigned to any milestones this week"
          description="Your project manager assigns you to milestones; they'll show up here as rows." />
      ) : null}
      {rows.length ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label={`Timesheet for the week of ${formatDate(week)}`}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 160 }}>Milestone</TableCell>
                {days.map((d) => (
                  <TableCell key={d} align="center" sx={{ minWidth: 84, color: overDays.includes(d) ? 'error.main' : undefined }}>
                    {formatDayLabel(d)}
                  </TableCell>
                ))}
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((g) => (
                <GroupRows key={g.project.id} group={g} days={days} allDays={allDays} valueOf={valueOf} entries={entries} isDraft={(k) => k in drafts}
                  overDays={overDays} noteOf={noteOf} attention={attention} timerNeedsNote={timerNeedsNote} thisWeek={thisWeek}
                  onNote={(k, v) => setNotes((n) => ({ ...n, [k]: v }))}
                  onChange={(k, v) => setDrafts((d) => ({ ...d, [k]: v }))} />
              ))}
              <TableRow sx={{ '& td, & th': { fontWeight: 700 } }}>
                <TableCell component="th" scope="row">Daily total</TableCell>
                {days.map((d) => {
                  const over = overDays.includes(d)
                  return (
                    <TableCell key={d} align="center" data-testid={`day-total-${d}`} data-over={over}
                      sx={{ color: over ? 'error.main' : undefined }}>{formatHours(dayTotal(d))}</TableCell>
                  )
                })}
                <TableCell align="right">{formatHours(total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </>
  )
}

function GroupRows({ group, days, allDays, valueOf, entries, onChange, isDraft, overDays, noteOf, attention, timerNeedsNote,
  onNote, thisWeek }) {
  return (
    <>
      <TableRow>
        <TableCell colSpan={days.length + 2} sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.06), fontWeight: 700 }}>
          {group.project.name}
        </TableCell>
      </TableRow>
      {group.rows.map((r) => {
        const rowTotal = allDays.reduce((s, d) => s + num(valueOf(key(r.milestone.id, d))), 0)
        const closed = closedLabel(r)
        return (
          <TableRow key={r.milestone.id} aria-disabled={closed ? true : undefined}
            sx={closed ? { bgcolor: 'action.hover', '& th, & td': { color: 'text.disabled' } } : undefined}>
            <TableCell component="th" scope="row">
              {r.milestone.name}
              {r.role === 'supporting' ? <SupportingChip /> : null}
              {closed ? (
                <Tooltip title={`${closed}. Hours already logged stay visible but can't be changed.`}>
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{closed}</Typography>
                </Tooltip>
              ) : null}
              {thisWeek && !closed ? <Box sx={{ mt: 0.75 }}><TimerButton milestone={r.milestone} /></Box> : null}
            </TableCell>
            {days.map((d) => {
              const k = key(r.milestone.id, d)
              const value = valueOf(k)
              return (
                <TableCell key={d} align="center" sx={{ verticalAlign: 'top' }}>
                  <TextField value={value} onChange={(e) => onChange(k, cleanHours(e.target.value))} disabled={Boolean(closed)}
                    onKeyDown={(e) => { if (!allowedKey(e)) e.preventDefault() }}
                    onPaste={(e) => {
                      e.preventDefault()
                      const text = e.clipboardData.getData('text').trim()
                      if (CLEAN_PASTE.test(text)) onChange(k, text)
                    }}
                    error={num(value) > DAY_CAP || (num(value) > 0 && overDays.includes(d)) || (isDraft(k) && tooLow(value))}
                    slotProps={{ htmlInput: { inputMode: 'decimal', pattern: '[0-9]{0,2}([.][0-9]{0,2})?',
                      'aria-label': `${r.milestone.name}, ${formatDayLabel(d)}`, style: { textAlign: 'center' } } }}
                    sx={{ width: 76 }} />
                  {num(value) > 0 || entries[k] ? (
                    <Stack direction="row" sx={{ justifyContent: 'center', alignItems: 'center', mt: 0.25, gap: 0.5 }}>
                      <NoteButton cellLabel={`${r.milestone.name}, ${formatDayLabel(d)}`} note={noteOf(k)} disabled={Boolean(closed)}
                        attention={!closed && attention(k)} onChange={(v) => onNote(k, v)} />
                      {!closed && timerNeedsNote(k) ? (
                        <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 600 }}>Add a note</Typography>
                      ) : null}
                    </Stack>
                  ) : null}
                  <CellStatus entry={entries[k]} cellLabel={`${r.milestone.name}, ${formatDayLabel(d)}`}
                    resubmitting={isDraft(k)} closed={Boolean(closed)} onResubmit={() => onChange(k, String(entries[k].hours))} />
                </TableCell>
              )
            })}
            <TableCell align="right">{formatHours(rowTotal)}</TableCell>
          </TableRow>
        )
      })}
    </>
  )
}
