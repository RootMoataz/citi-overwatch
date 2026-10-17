import Lock from '@mui/icons-material/LockOutlined'
import { Alert, Box, Button, Chip, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useId, useRef, useState } from 'react'
import { NOTE_MAX, NOTE_MIN, isProofNote } from '../timer/timerClock.js'
import Critical from '../../components/Critical.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatDayLabel, formatDayLong, formatHours } from '../../lib/format.js'
import { EntryStatusChip, entryKind } from './EntryStatus.jsx'
import HoursField from './HoursField.jsx'
import { LOCK_HINT } from './LockedCell.jsx'
import { kindColor, kindText, sourceOf } from './monthText.js'
import { DAY_CAP, num, tooLow } from './useTimesheetWeek.js'

const APPROVED_WARNING = 'Changing approved hours sends them back for approval.'
const SECTION = { mt: 2.5 }
const READ_ONLY = { '& .MuiInputBase-root': { bgcolor: 'action.hover' } }

/** A timer-locked cell's hours: read-only with a lock, and Request a change (or the request waiting for the manager). */
function LockedHours({ lock, closed, onRequest }) {
  const hintId = useId()
  return (
    <Stack sx={{ gap: 1, alignItems: 'flex-start' }}>
      <TextField label="Hours" value={String(lock.hours)} sx={[{ width: 120 }, READ_ONLY]}
        slotProps={{ input: { readOnly: true, endAdornment: (
          <InputAdornment position="end"><Lock aria-hidden sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment>
        ) }, htmlInput: { 'aria-describedby': hintId } }} />
      <Typography id={hintId} variant="caption" sx={{ color: 'text.secondary' }}>{LOCK_HINT}</Typography>
      {lock.request ? (
        <Typography variant="body2" sx={{ color: (t) => kindText('pending', t), overflowWrap: 'anywhere' }}>
          <Critical>{`Change requested: ${formatHours(lock.request.requested_hours)}`}</Critical>
        </Typography>
      ) : !closed ? (
        <Button variant="outlined" onClick={onRequest} sx={{ minHeight: 44 }}>Request a change</Button>
      ) : null}
    </Stack>
  )
}

/**
 * Entry details: one saved cell of the week, inside `SidePanel title="Entry details"`. Its fields write the week's typed
 * hours and notes (the same as the grid's), so Done, Close and Esc keep any edit as an unsaved change for Submit. A
 * rejected entry on an open row offers Save & resubmit instead, which sends this cell alone and closes the panel.
 * state: the useTimesheetWeek result. cellKey: "<milestoneId>|<date>". onRequest(cell): a locked cell asks for a change.
 */
export default function EntryPanel({ state, cellKey, onRequest, onClose }) {
  const { entries, locks, rows, valueOf, noteOf, setHours, setNote, changed, overDays, isDraft, closedLabel, saveCell, savingCell,
    saving, savedOthers } = state
  const feedbackId = useId()
  const [error, setError] = useState(null)
  // The panel shows one cell (the page keys it by cell): a resubmit that ends after another entry was opened is
  // done for a panel no longer on screen, and must not close the one that is.
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => { shown.current = false }
  }, [])
  const [milestoneId, date] = cellKey.split('|')
  const entry = entries[cellKey]
  const row = rows.find((r) => String(r.milestone.id) === milestoneId)
  if (!entry || !row) return null

  const closed = closedLabel(row)
  const lock = locks[cellKey]
  const kind = entryKind(entry)
  const name = row.milestone.name
  const value = valueOf(cellKey)
  const note = noteOf(cellKey)
  const shortNote = note.trim().length > 0 && !isProofNote(note)
  const tracked = num(entry.tracked_hours)
  const resubmittable = entry.status === 'rejected' && !closed
  // The day as this panel's own save would send it. Save & resubmit sends this cell alone, so the server adds it to the
  // day's saved hours on other cells (unsaved typing elsewhere doesn't count). Done leaves it for Submit, which sends
  // all the week's typing: the week's overDays.
  const dayOver = resubmittable && num(value) > 0 && savedOthers(date, cellKey) + num(value) > DAY_CAP
  const over = num(value) > DAY_CAP || (resubmittable ? dayOver : num(value) > 0 && overDays.includes(date))
  const invalid = num(value) <= 0 || num(value) > DAY_CAP || dayOver || tooLow(value) || shortNote

  const resubmit = async () => {
    setError(null)
    try {
      await saveCell(cellKey)
      if (shown.current) onClose()
    } catch (err) { if (shown.current) setError(err) }
  }

  return (
    <Box>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{formatDayLong(date)}</Typography>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
        <Typography component="h3" variant="h3" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{name}</Typography>
        <EntryStatusChip kind={kind} />
        {entry.edited_after_decision ? <Chip size="small" variant="outlined" label="Edited" /> : null}
        {entry.over_40 ? <Chip size="small" variant="outlined" label={<Critical>Overtime</Critical>} /> : null}
      </Stack>
      {closed ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{closed}</Typography> : null}

      <Box sx={SECTION}>
        {lock ? (
          <LockedHours lock={lock} closed={Boolean(closed)}
            onRequest={() => onRequest({ milestoneId, date, hours: lock.hours, label: `${name}, ${formatDayLabel(date)}` })} />
        ) : (
          <HoursField value={value} label="Hours" caption="Hours" onChange={(v) => setHours(cellKey, v)} disabled={Boolean(closed)}
            error={over || (isDraft(cellKey) && tooLow(value))} />
        )}
      </Box>

      <TextField label="Work note" multiline minRows={3} fullWidth value={note} disabled={Boolean(closed)} sx={SECTION}
        onChange={(e) => setNote(cellKey, e.target.value.slice(0, NOTE_MAX))}
        onBlur={() => { if (note !== note.trim()) setNote(cellKey, note.trim()) }}
        error={shortNote}
        helperText={`${shortNote ? `At least ${NOTE_MIN} characters` : `${NOTE_MIN}-${NOTE_MAX} characters`} · ${note.trim().length}/${NOTE_MAX}`}
        slotProps={{ htmlInput: { maxLength: NOTE_MAX } }} />

      {entry.status === 'rejected' ? (
        <Box role="group" aria-labelledby={feedbackId} sx={{ ...SECTION, px: 2, py: 1.5, borderRadius: 1, border: 1,
          borderColor: (t) => alpha(kindColor('rejected', t), 0.35), bgcolor: (t) => alpha(kindColor('rejected', t), 0.08) }}>
          <Typography id={feedbackId} variant="subtitle2" component="p" sx={{ fontWeight: 700, color: (t) => kindText('rejected', t) }}>
            Manager feedback
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{entry.rejection_reason}</Typography>
        </Box>
      ) : null}

      <TextField label="Source" value={sourceOf({ kind, entry, hours: entry.hours })} fullWidth sx={[SECTION, READ_ONLY]}
        helperText={tracked > 0 ? `${formatHours(tracked)} from a timer` : undefined}
        slotProps={{ input: { readOnly: true } }} />

      {entry.status === 'approved' && changed.includes(cellKey) ? (
        <Alert severity="warning" sx={SECTION}>{APPROVED_WARNING}</Alert>
      ) : null}
      <ErrorAlert error={error} sx={SECTION} />

      {resubmittable ? (
        <Button variant="contained" fullWidth onClick={resubmit} disabled={savingCell || saving || invalid} sx={{ ...SECTION, minHeight: 44 }}>
          Save &amp; resubmit
        </Button>
      ) : (
        <Button variant="outlined" fullWidth onClick={onClose} sx={{ ...SECTION, minHeight: 44 }}>Done</Button>
      )}
    </Box>
  )
}
