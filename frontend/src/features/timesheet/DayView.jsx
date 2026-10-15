import { Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import TimerButton from '../timer/TimerButton.jsx'
import { NOTE_MAX, NOTE_MIN, isProofNote } from '../timer/timerClock.js'
import HoursField from './HoursField.jsx'
import LockedCell from './LockedCell.jsx'
import { CellStatus } from './WeekGrid.jsx'
import { DAY_CAP, key, num, tooLow } from './useTimesheetWeek.js'
import SupportingChip from '../../components/SupportingChip.jsx'
import { formatDayFull, formatDayLabel, formatHours, todayIso } from '../../lib/format.js'

const LIST_SX = { listStyle: 'none', m: 0, p: 0, '& > li + li': { borderTop: 1, borderColor: 'divider' } }
const COMPLETED = 'Milestone completed — logging closed'

/** One milestone on the open day: hours, a work note that is always there, and the saved entry's status. */
function DayRow({ state, row, day, closed, showProject, showTimer, onRequest }) {
  const { valueOf, noteOf, locks, entries, overDays, attention, isDraft, setHours, setNote } = state
  const k = key(row.milestone.id, day)
  const value = valueOf(k)
  const label = `${row.milestone.name}, ${formatDayLabel(day)}`
  const note = noteOf(k)
  const short = note.trim().length > 0 && !isProofNote(note)
  const needed = !closed && attention(k)
  const hint = short ? `At least ${NOTE_MIN} characters`
    : needed ? `Needed: ${NOTE_MIN}-${NOTE_MAX} characters, or post a progress update that day` : `${NOTE_MIN}-${NOTE_MAX} characters`
  return (
    <Box component="li" data-attention={needed || undefined} aria-disabled={closed ? true : undefined}
      sx={{ display: 'grid', gap: 2, alignItems: 'start', p: 2,
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 110px minmax(0, 2fr)' },
        ...(closed ? { bgcolor: 'action.hover', color: 'text.disabled' } : null),
        ...(needed ? { bgcolor: (t) => alpha(t.palette.warning.main, 0.06), boxShadow: (t) => `inset 3px 0 0 ${t.palette.warning.main}` } : null) }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>
          {row.milestone.name}
          {row.role === 'supporting' ? <SupportingChip /> : null}
        </Typography>
        {showProject ? <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{row.project.name}</Typography> : null}
        {closed ? <Typography variant="caption" sx={{ display: 'block' }}>{closed}</Typography> : null}
        {showTimer ? <Box sx={{ mt: 0.75 }}><TimerButton milestone={row.milestone} /></Box> : null}
      </Box>
      <Box>
        {locks[k] ? (
          <LockedCell lock={locks[k]} label={label} closed={Boolean(closed)}
            onRequest={() => onRequest({ milestoneId: row.milestone.id, date: day, hours: locks[k].hours, label })} />
        ) : <HoursField value={value} label={label} onChange={(v) => setHours(k, v)} disabled={Boolean(closed)}
          error={num(value) > DAY_CAP || (num(value) > 0 && overDays.includes(day)) || (isDraft(k) && tooLow(value))} />}
        <CellStatus entry={entries[k]} cellLabel={label} resubmitting={isDraft(k)} closed={Boolean(closed)} inlineReason
          onResubmit={() => setHours(k, String(entries[k].hours))} />
      </Box>
      <TextField label="Work note" multiline minRows={2} fullWidth size="small" value={note} disabled={Boolean(closed)}
        onChange={(e) => setNote(k, e.target.value.slice(0, NOTE_MAX))}
        onBlur={() => { if (note !== note.trim()) setNote(k, note.trim()) }}
        error={short} helperText={`${hint} · ${note.trim().length}/${NOTE_MAX}`}
        slotProps={{ htmlInput: { 'aria-label': `Work note, ${row.milestone.name}`, maxLength: NOTE_MAX },
          formHelperText: { sx: needed && !short ? { color: 'warning.main' } : undefined } }} />
    </Box>
  )
}

/** One day of the week: a row per milestone to log on, the closed ones tucked behind a button.
 * state: the useTimesheetWeek result. day: the open day. onRequest(cell): a locked cell asks for a change. */
export default function DayView({ state, day, thisWeek, onRequest }) {
  const { groups, dayTotal, overDays, closedLabel } = state
  const [showClosed, setShowClosed] = useState(false)
  const closedReason = (r) => closedLabel(r) ?? (r.milestone.status === 'completed' ? COMPLETED : null)
  const openGroups = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => !closedReason(r)) })).filter((g) => g.rows.length)
  const closedRows = groups.flatMap((g) => g.rows.filter((r) => closedReason(r)))
  const grouped = openGroups.length > 1
  const over = overDays.includes(day)
  const list = (rows, showProject) => (
    <Box component="ul" sx={LIST_SX}>
      {rows.map((r) => {
        const closed = closedReason(r)
        return <DayRow key={r.milestone.id} state={state} row={r} day={day} closed={closed} showProject={showProject}
          showTimer={thisWeek && day === todayIso() && !closed} onRequest={onRequest} />
      })}
    </Box>
  )
  return (
    <Paper variant="outlined">
      <Stack direction="row" sx={{ p: 2, gap: 2, alignItems: 'baseline', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h2" component="h2">{formatDayFull(day)}</Typography>
        <Typography data-testid={`day-total-${day}`} data-over={over} variant="h3" component="p"
          sx={{ color: over ? 'error.main' : 'text.primary' }}>{formatHours(dayTotal(day))}</Typography>
      </Stack>
      {openGroups.length ? openGroups.map((g) => (
        <Box key={g.project.id}>
          {grouped ? (
            <Typography variant="subtitle2" component="h3"
              sx={{ px: 2, py: 1, fontWeight: 700, bgcolor: (t) => alpha(t.palette.primary.main, 0.06) }}>{g.project.name}</Typography>
          ) : null}
          {list(g.rows, !grouped)}
        </Box>
      )) : <Typography sx={{ p: 2, color: 'text.secondary' }}>No open milestones to log on this week.</Typography>}
      {closedRows.length ? (
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
          <Button size="small" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)} sx={{ m: 1 }}>
            {showClosed ? 'Hide' : 'Show'} {closedRows.length} closed milestone{closedRows.length === 1 ? '' : 's'}
          </Button>
          {showClosed ? list(closedRows, true) : null}
        </Box>
      ) : null}
    </Paper>
  )
}
