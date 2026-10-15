import EditNote from '@mui/icons-material/EditNoteOutlined'
import {
  Box, Button, Chip, IconButton, Paper, Popover, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import SourceChip from '../timer/SourceChip.jsx'
import TimerButton from '../timer/TimerButton.jsx'
import { NOTE_MAX, NOTE_MIN, isProofNote } from '../timer/timerClock.js'
import LockedCell from './LockedCell.jsx'
import { DAY_CAP, key, num, tooLow } from './useTimesheetWeek.js'
import { STATUS, statusColor } from '../../app/theme.js'
import SupportingChip from '../../components/SupportingChip.jsx'
import { formatDate, formatDayLabel, formatHours } from '../../lib/format.js'

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

/** The week as a table: one row per milestone, one column per shown day, with a daily-total row.
 * state: the useTimesheetWeek result. days: the columns to show. onRequest(cell): a locked cell asks for a change. */
export default function WeekGrid({ state, days, thisWeek, onRequest }) {
  const { groups, overDays, dayTotal, total } = state
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label={`Timesheet for the week of ${formatDate(state.allDays[0])}`}>
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
            <GroupRows key={g.project.id} group={g} days={days} state={state} thisWeek={thisWeek} onRequest={onRequest} />
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
  )
}

function GroupRows({ group, days, state, thisWeek, onRequest }) {
  const { allDays, valueOf, entries, locks, overDays, noteOf, attention, timerNeedsNote, isDraft, setHours, setNote, closedLabel } = state
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
              const label = `${r.milestone.name}, ${formatDayLabel(d)}`
              return (
                <TableCell key={d} align="center" sx={{ verticalAlign: 'top' }}>
                  {locks[k] ? (
                    <LockedCell lock={locks[k]} label={label} closed={Boolean(closed)}
                      onRequest={() => onRequest({ milestoneId: r.milestone.id, date: d, hours: locks[k].hours, label })} />
                  ) : <TextField value={value} onChange={(e) => setHours(k, cleanHours(e.target.value))} disabled={Boolean(closed)}
                    onKeyDown={(e) => { if (!allowedKey(e)) e.preventDefault() }}
                    onPaste={(e) => {
                      e.preventDefault()
                      const text = e.clipboardData.getData('text').trim()
                      if (CLEAN_PASTE.test(text)) setHours(k, text)
                    }}
                    error={num(value) > DAY_CAP || (num(value) > 0 && overDays.includes(d)) || (isDraft(k) && tooLow(value))}
                    slotProps={{ htmlInput: { inputMode: 'decimal', pattern: '[0-9]{0,2}([.][0-9]{0,2})?',
                      'aria-label': `${r.milestone.name}, ${formatDayLabel(d)}`, style: { textAlign: 'center' } } }}
                    sx={{ width: 76 }} />}
                  {num(value) > 0 || entries[k] ? (
                    <Stack direction="row" sx={{ justifyContent: 'center', alignItems: 'center', mt: 0.25, gap: 0.5 }}>
                      <NoteButton cellLabel={`${r.milestone.name}, ${formatDayLabel(d)}`} note={noteOf(k)} disabled={Boolean(closed)}
                        attention={!closed && attention(k)} onChange={(v) => setNote(k, v)} />
                      {!closed && timerNeedsNote(k) ? (
                        <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 600 }}>Add a note</Typography>
                      ) : null}
                    </Stack>
                  ) : null}
                  <CellStatus entry={entries[k]} cellLabel={`${r.milestone.name}, ${formatDayLabel(d)}`}
                    resubmitting={isDraft(k)} closed={Boolean(closed)} onResubmit={() => setHours(k, String(entries[k].hours))} />
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
