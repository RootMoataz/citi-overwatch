import { Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useId, useState } from 'react'
import LogTimeActions from '../timer/LogTimeActions.jsx'
import ManualHoursButton from '../timer/ManualHoursButton.jsx'
import { inWindow } from '../timer/manualHours.js'
import { NOTE_MAX, NOTE_MIN, isProofNote } from '../timer/timerClock.js'
import HoursField from './HoursField.jsx'
import LockedCell from './LockedCell.jsx'
import { ManualActions, ManualBox } from './ManualCell.jsx'
import { CellStatus } from './EntryStatus.jsx'
import { entryParam } from './useEntryPanelUrl.js'
import { DAY_CAP, key, num, tooLow } from './useTimesheetWeek.js'
import SupportingChip from '../../components/SupportingChip.jsx'
import { formatDayFull, formatDayLabel, formatHours, nyTodayIso } from '../../lib/format.js'

const LIST_SX = { listStyle: 'none', m: 0, p: 0, '& > li + li': { borderTop: 1, borderColor: 'divider' } }
const COMPLETED = 'Milestone completed — hours logged after it was completed are flagged for review'

/** One milestone on the open day: hours, a work note that is always there, and the saved entry's status with Details.
 * closed: why nothing can be changed (project closed or on hold), or null. A completed milestone stays editable. */
function DayRow({ state, row, day, closed, showProject, showTimer, showManual, onRequest, onOpenEntry }) {
  const { valueOf, noteOf, locks, entries, overDays, attention, isDraft, isManual, setHours, setNote } = state
  const k = key(row.milestone.id, day)
  const value = valueOf(k)
  const label = `${row.milestone.name}, ${formatDayLabel(day)}`
  const note = noteOf(k)
  const short = note.trim().length > 0 && !isProofNote(note)
  const completed = row.milestone.status === 'completed'
  const manual = isManual(k)
  const needed = !closed && attention(k)
  // A note is saved with hours; on a row with neither hours nor an entry it just waits.
  const waiting = note.trim().length > 0 && num(value) <= 0 && !entries[k]
  const hint = short ? `At least ${NOTE_MIN} characters` : waiting ? 'Add hours to save this note'
    : needed ? `Needed: ${NOTE_MIN}-${NOTE_MAX} characters, or post a progress update that day` : `${NOTE_MIN}-${NOTE_MAX} characters`
  return (
    <Box component="li" data-attention={needed || undefined} aria-disabled={closed ? true : undefined}
      sx={{ display: 'grid', gap: 2, alignItems: 'start', p: 2,
        // The middle column fits Hours and, under it, one left-aligned row: "● Pending  Overtime  Manual  Details" (from lg
        // on one line; between md and lg Details may take a second).
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 220px minmax(0, 2fr)', lg: 'minmax(0, 1fr) 260px minmax(0, 2fr)' },
        ...(closed ? { bgcolor: 'action.hover', color: 'text.disabled' } : null),
        ...(needed ? { bgcolor: (t) => alpha(t.palette.warning.main, 0.06), boxShadow: (t) => `inset 3px 0 0 ${t.palette.warning.main}` } : null) }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>
          {row.milestone.name}
          {row.role === 'supporting' ? <SupportingChip /> : null}
        </Typography>
        {showProject ? <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{row.project.name}</Typography> : null}
        {closed || completed ? <Typography variant="caption" sx={{ display: 'block' }}>{closed ?? COMPLETED}</Typography> : null}
        {showTimer ? <Box sx={{ mt: 0.75 }}><LogTimeActions milestone={row.milestone} project={row.project} /></Box> : null}
        {showManual && !locks[k] && !entries[k] && num(value) <= 0 ? (
          <Box sx={{ mt: 0.75 }}><ManualHoursButton milestone={row.milestone} project={row.project} day={day} /></Box>
        ) : null}
      </Box>
      <Box>
        {manual ? <ManualBox entry={entries[k]} label={label} /> : locks[k] ? (
          <LockedCell lock={locks[k]} label={label} closed={Boolean(closed)}
            onRequest={() => onRequest({ milestoneId: row.milestone.id, date: day, hours: locks[k].hours, label })} />
        ) : <HoursField value={value} label={label} caption="Hours" onChange={(v) => setHours(k, v)} disabled={Boolean(closed)}
          error={num(value) > DAY_CAP || (num(value) > 0 && overDays.includes(day)) || (isDraft(k) && tooLow(value))} />}
        <CellStatus entry={entries[k]} cellLabel={label} resubmitting={isDraft(k)} closed={Boolean(closed)}
          onResubmit={() => setHours(k, String(entries[k].hours))}
          after={(
            <>
              {manual ? <ManualActions entry={entries[k]} row={row} label={label} closed={Boolean(closed)} /> : null}
              <Button size="small" onClick={() => onOpenEntry(row.milestone.id, day)} aria-label={`Details for ${label}`}
                data-entry-details={entryParam(row.milestone.id, day)} sx={{ minWidth: 44, minHeight: 44, px: 0.5 }}>
                Details
              </Button>
            </>
          )} />
      </Box>
      <TextField label="Work note" multiline minRows={2} fullWidth size="small" value={note} disabled={Boolean(closed)}
        onChange={(e) => setNote(k, e.target.value.slice(0, NOTE_MAX))}
        onBlur={() => { if (!manual && note !== note.trim()) setNote(k, note.trim()) }}
        error={!manual && short} helperText={manual ? `${note.trim().length}/${NOTE_MAX}` : `${hint} · ${note.trim().length}/${NOTE_MAX}`}
        slotProps={{ htmlInput: { 'aria-label': `Work note, ${row.milestone.name}`, maxLength: NOTE_MAX, readOnly: manual || undefined },
          formHelperText: { sx: needed && !short ? { color: 'warning.main' } : undefined } }} />
    </Box>
  )
}

/** One day of the week: a row per milestone to log on, the closed ones tucked behind a button.
 * state: the useTimesheetWeek result. day: the open day. onRequest(cell): a locked cell asks for a change.
 * onOpenEntry(milestoneId, date): a row's Details opens Entry details for its saved entry that day. */
export default function DayView({ state, day, thisWeek, onRequest, onOpenEntry }) {
  const { groups, dayTotal, overDays, closedLabel, changed, attention, entries } = state
  const [showClosed, setShowClosed] = useState(false)
  // Completed milestones are tucked away with the closed ones, but only a closed or on-hold project locks them.
  const tucked = (r) => closedLabel(r) || r.milestone.status === 'completed'
  // An editable row that holds a change, a flag or a rejection stays in view while the closed ones are hidden, so
  // nothing out of sight can block Submit. Once they are shown every closed row sits in its section, so typing never moves a row.
  const pinned = (r) => {
    const k = key(r.milestone.id, day)
    return !closedLabel(r) && (changed.includes(k) || attention(k) || entries[k]?.status === 'rejected')
  }
  const above = (r) => !tucked(r) || (!showClosed && pinned(r))
  const openGroups = groups.map((g) => ({ ...g, rows: g.rows.filter(above) })).filter((g) => g.rows.length)
  const closedRows = groups.flatMap((g) => g.rows.filter((r) => !above(r)))
  const grouped = openGroups.length > 1
  const over = overDays.includes(day)
  const headingId = useId()
  const list = (rows, showProject) => (
    <Box component="ul" sx={LIST_SX}>
      {rows.map((r) => {
        const closed = closedLabel(r)
        return <DayRow key={r.milestone.id} state={state} row={r} day={day} closed={closed} showProject={showProject}
          showTimer={thisWeek && day === nyTodayIso() && !closed && r.milestone.status !== 'completed'}
          showManual={day < nyTodayIso() && inWindow(day, nyTodayIso()) && !closed && r.milestone.status !== 'completed'} onRequest={onRequest}
          onOpenEntry={onOpenEntry} />
      })}
    </Box>
  )
  return (
    <Paper variant="outlined" component="section" aria-labelledby={headingId}>
      <Stack direction="row" sx={{ p: 2, gap: 2, alignItems: 'baseline', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
        <Typography id={headingId} variant="h3" component="h3">{formatDayFull(day)}</Typography>
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
