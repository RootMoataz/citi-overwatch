import Folder from '@mui/icons-material/FolderOutlined'
import EditNote from '@mui/icons-material/EditNoteOutlined'
import {
  Box, Button, IconButton, Popover, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import TimerButton from '../timer/TimerButton.jsx'
import { NOTE_MAX, NOTE_MIN, isProofNote } from '../timer/timerClock.js'
import { CellStatus, StatusDot } from './EntryStatus.jsx'
import HoursField from './HoursField.jsx'
import LockedCell from './LockedCell.jsx'
import { DAY_CAP, key, num, tooLow } from './useTimesheetWeek.js'
import SupportingChip from '../../components/SupportingChip.jsx'
import { KIND, KINDS } from './monthText.js'
import { formatDate, formatDayLabel, formatHours, nyTodayIso } from '../../lib/format.js'

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

// The first column stays put when the grid scrolls inside its card on a phone.
const STICKY = { position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper' }
const PROJECT_TINT = { backgroundImage: (t) => `linear-gradient(${alpha(t.palette.primary.main, 0.06)}, ${alpha(t.palette.primary.main, 0.06)})` }
const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())
/** Today's column is tinted; weekend columns are dimmed. */
const dayTint = (d, today) => (d === today ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) }
  : isWeekend(d) ? { bgcolor: (t) => alpha(t.palette.text.primary, 0.03) } : null)

/** The week as a table: one row per milestone, one column per shown day, with a daily-total row.
 * state: the useTimesheetWeek result. days: the columns to show. onRequest(cell): a locked cell asks for a change. */
export default function WeekGrid({ state, days, thisWeek, onRequest }) {
  const { groups, overDays, dayTotal, total } = state
  const today = thisWeek ? nyTodayIso() : null
  return (
    <>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label={`Timesheet for the week of ${formatDate(state.week)}`}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...STICKY, minWidth: 140 }}>Milestone</TableCell>
              {days.map((d) => {
                const [weekday, ...date] = formatDayLabel(d).split(' ')
                return (
                  <TableCell key={d} align="center" data-today={d === today || undefined} data-weekend={isWeekend(d) || undefined}
                    sx={[{ minWidth: 84, color: overDays.includes(d) ? 'error.main' : isWeekend(d) ? 'text.secondary' : undefined },
                      dayTint(d, today)]}>
                    <Box component="span" sx={{ display: 'block', fontWeight: 600 }}>{weekday}</Box>
                    <Box component="span" sx={{ display: 'block', fontWeight: 400 }}>{date.join(' ')}</Box>
                    {d === today ? (
                      <Typography variant="caption" component="span" sx={{ display: 'block', color: 'primary.main', fontWeight: 700 }}>Today</Typography>
                    ) : null}
                  </TableCell>
                )
              })}
              <TableCell align="right">Counted</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((g) => (
              <GroupRows key={g.project.id} group={g} days={days} today={today} state={state} thisWeek={thisWeek} onRequest={onRequest} />
            ))}
            <TableRow sx={{ '& td, & th': { fontWeight: 700 } }}>
              <TableCell component="th" scope="row" sx={STICKY}>Daily total (counted)</TableCell>
              {days.map((d) => {
                const over = overDays.includes(d)
                return (
                  <TableCell key={d} align="center" data-testid={`day-total-${d}`} data-over={over}
                    sx={[{ color: over ? 'error.main' : undefined }, dayTint(d, today)]}>{formatHours(dayTotal(d))}</TableCell>
                )
              })}
              <TableCell align="right">{formatHours(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
      <Box component="ul" aria-label="Legend" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, listStyle: 'none', m: 0, mt: 1.5, p: 0 }}>
        {KINDS.filter((k) => k !== 'draft').map((k) => (
          <Box component="li" key={k} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, typography: 'caption', color: 'text.secondary' }}>
            <StatusDot kind={k} />{KIND[k].legend}
          </Box>
        ))}
      </Box>
    </>
  )
}

function GroupRows({ group, days, today, state, thisWeek, onRequest }) {
  const { rowTotal, valueOf, entries, locks, overDays, noteOf, attention, timerNeedsNote, isDraft, setHours, setNote, closedLabel } = state
  return (
    <>
      <TableRow>
        <TableCell component="th" scope="row" sx={{ ...STICKY, ...PROJECT_TINT, fontWeight: 700 }}>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Folder aria-hidden="true" fontSize="small" />{group.project.name}
          </Box>
        </TableCell>
        <TableCell colSpan={days.length + 1} sx={PROJECT_TINT} />
      </TableRow>
      {group.rows.map((r) => {
        const closed = closedLabel(r)
        return (
          <TableRow key={r.milestone.id} aria-disabled={closed ? true : undefined}
            sx={closed ? { bgcolor: 'action.hover', '& th, & td': { color: 'text.disabled' } } : undefined}>
            <TableCell component="th" scope="row" sx={STICKY}>
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
                <TableCell key={d} align="center" sx={[{ verticalAlign: 'top' }, dayTint(d, today)]}>
                  {locks[k] ? (
                    <LockedCell lock={locks[k]} label={label} closed={Boolean(closed)}
                      onRequest={() => onRequest({ milestoneId: r.milestone.id, date: d, hours: locks[k].hours, label })} />
                  ) : <HoursField value={value} label={label} onChange={(v) => setHours(k, v)} disabled={Boolean(closed)}
                    error={num(value) > DAY_CAP || (num(value) > 0 && overDays.includes(d)) || (isDraft(k) && tooLow(value))} />}
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
            <TableCell align="right">{formatHours(rowTotal(r.milestone.id))}</TableCell>
          </TableRow>
        )
      })}
    </>
  )
}
