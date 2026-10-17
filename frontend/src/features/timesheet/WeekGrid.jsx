import Folder from '@mui/icons-material/FolderOutlined'
import EditNote from '@mui/icons-material/EditNoteOutlined'
import {
  Box, Button, IconButton, Popover, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useMediaQuery } from 'react-responsive'
import { useState } from 'react'
import ScrollHint from '../../components/ScrollHint.jsx'
import { thinScrollbar } from '../../components/thinScrollbar.js'
import LogTimeActions from '../timer/LogTimeActions.jsx'
import { NOTE_MAX, NOTE_MIN, isProofNote } from '../timer/timerClock.js'
import { StatusDot, StatusLine } from './EntryStatus.jsx'
import HoursField from './HoursField.jsx'
import LockedCell from './LockedCell.jsx'
import ManualCell from './ManualCell.jsx'
import { entryParam } from './useEntryPanelUrl.js'
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
            sx={{ p: 0.25, minWidth: { xs: 44, md: 0 }, minHeight: { xs: 44, md: 0 },
              ...(attention ? { bgcolor: (t) => alpha(t.palette.warning.main, 0.16) } : null) }}>
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

// The first column stays put when the grid scrolls inside its card on a phone. It is opaque, so the days slide under it;
// a tinted row lays its tint over it as a background image, so the fixed cell matches the rest of the row.
const STICKY = { position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper' }
const tint = (colour) => ({ backgroundImage: (t) => `linear-gradient(${colour(t)}, ${colour(t)})` })
const PROJECT_TINT = tint((t) => alpha(t.palette.primary.main, 0.06))
const CLOSED_TINT = tint((t) => t.palette.action.hover)
// The fixed Milestone header wears the theme's header tint like the day headers beside it (opaque, as the days slide under).
const HEAD_TINT = tint((t) => t.components?.MuiTableCell?.styleOverrides?.head?.backgroundColor ?? t.palette.background.paper)
// Its width is capped, a long name wrapping (breaking a long word if it must), so it never fills the card and covers
// the day cells (140 px from sm, the cell's 16 px padding each side included, so 108 px of name). The name stays whole in the cell, and is the row header's name.
// On a phone (below sm) it is 104 px with 8 px of padding a side (88 px of name) and its buttons wrap to two lines, so
// about 3 day columns of 60 px show beside it in the 294 px card; from sm it is 140 px as before.
const FIRST_COLUMN = 140
const NAME_WIDTH = FIRST_COLUMN - 32
const PHONE_COLUMN = 104
const PHONE_NAME_WIDTH = PHONE_COLUMN - 16
const PHONE_QUERY = { maxWidth: 599 }
const NAME = (t) => ({ display: 'block', maxWidth: PHONE_NAME_WIDTH, overflowWrap: 'anywhere',
  [t.breakpoints.up('sm')]: { maxWidth: 200 }, [t.breakpoints.up('md')]: { maxWidth: 280 } })
const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())
/** Today's column is tinted; weekend columns are dimmed. */
const dayTint = (d, today) => (d === today ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) }
  : isWeekend(d) ? { bgcolor: (t) => alpha(t.palette.text.primary, 0.06) } : null)
// A day column is compact on a phone, and beside an open Entry details panel (`narrow`): narrow padding and a narrower
// input, so more days show beside the Milestone column (at 1440 with the sidebar open, all seven and Counted).
const dayCell = (narrow) => ({ px: narrow ? 0.5 : { xs: 0.5, sm: 2 } })
// Beside the panel the first and last columns pad 8 px a side too (the name keeps its 108 px at least).
const edgeCell = (narrow) => (narrow ? { px: 1 } : { px: { xs: 1, sm: 2 } })

/** The week as a table: one row per milestone, one column per shown day, with a daily-total row.
 * state: the useTimesheetWeek result. days: the columns to show. onRequest(cell): a locked cell asks for a change.
 * onOpenEntry(milestoneId, date): a saved cell's status line opens Entry details, where its Edited and Overtime chips,
 * source, manager feedback and Save & resubmit live. */
export default function WeekGrid({ state, days, thisWeek, onRequest, onOpenEntry, narrow = false }) {
  const phone = useMediaQuery(PHONE_QUERY)
  const daySx = dayCell(narrow)
  const edgeSx = edgeCell(narrow)
  const { groups, overDays, dayTotal, total } = state
  const today = thisWeek ? nyTodayIso() : null
  return (
    <>
      {/* Beside an open Entry details panel (or on a phone) the days run past the card's edge: the edge fades and a thin
          scrollbar stays drawn, so it's clear they continue. No fade on the left, where the Milestone column stays. */}
      <ScrollHint left={false}>
        {(ref, onScroll) => (
      <TableContainer ref={ref} onScroll={onScroll} sx={[{ overflowX: 'auto' }, thinScrollbar]}>
        <Table size="small" aria-label={`Timesheet for the week of ${formatDate(state.week)}`}>
          <TableHead>
            <TableRow>
              <TableCell sx={[{ ...STICKY, minWidth: narrow ? NAME_WIDTH + 16 : phone ? PHONE_COLUMN : FIRST_COLUMN }, HEAD_TINT, edgeSx]}>Milestone</TableCell>
              {days.map((d) => {
                const [weekday, ...date] = formatDayLabel(d).split(' ')
                return (
                  <TableCell key={d} align="center" data-today={d === today || undefined} data-weekend={isWeekend(d) || undefined}
                    sx={[{ minWidth: narrow ? 64 : phone ? 60 : 84, color: overDays.includes(d) ? 'error.main' : isWeekend(d) ? 'text.secondary' : undefined },
                      daySx, dayTint(d, today)]}>
                    <Box component="span" sx={{ display: 'block', fontWeight: 600 }}>{weekday}</Box>
                    <Box component="span" sx={{ display: 'block', fontWeight: 400 }}>{date.join(' ')}</Box>
                    {d === today ? (
                      <Typography variant="caption" component="span" sx={{ display: 'block', color: 'primary.main', fontWeight: 700 }}>Today</Typography>
                    ) : null}
                  </TableCell>
                )
              })}
              <TableCell align="right" sx={edgeSx}>Counted</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((g) => (
              <GroupRows key={g.project.id} group={g} days={days} today={today} state={state} thisWeek={thisWeek} onRequest={onRequest}
                onOpenEntry={onOpenEntry} dayCellSx={daySx} edgeSx={edgeSx} narrow={narrow} phone={phone} />
            ))}
            <TableRow sx={{ '& td, & th': { fontWeight: 700 } }}>
              <TableCell component="th" scope="row" sx={[STICKY, edgeSx]}>Daily total (counted)</TableCell>
              {days.map((d) => {
                const over = overDays.includes(d)
                return (
                  <TableCell key={d} align="center" data-testid={`day-total-${d}`} data-over={over}
                    sx={[{ color: over ? 'error.main' : undefined }, daySx, dayTint(d, today)]}>{formatHours(dayTotal(d))}</TableCell>
                )
              })}
              <TableCell align="right" sx={edgeSx}>{formatHours(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
        )}
      </ScrollHint>
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

function GroupRows({ group, days, today, state, thisWeek, onRequest, onOpenEntry, dayCellSx, edgeSx, narrow, phone }) {
  const { rowTotal, valueOf, entries, locks, overDays, noteOf, attention, timerNeedsNote, isDraft, isManual, setHours, setNote, closedLabel } = state
  return (
    <>
      {/* The project band is one cell across the row; its name runs on one line along it (it isn't held to the first
          column's width), staying in view as the days scroll. A very long name ends in an ellipsis (in full on hover)
          rather than widening the grid. */}
      <TableRow>
        <TableCell component="th" scope="row" colSpan={days.length + 2} sx={[PROJECT_TINT, { fontWeight: 700 }]}>
          <Box component="span" sx={{ position: 'sticky', left: 16, display: 'inline-flex', alignItems: 'center', gap: 0.75,
            maxWidth: { xs: 260, md: 520 } }}>
            <Folder aria-hidden="true" fontSize="small" />
            <Box component="span" title={group.project.name} sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              minWidth: 0 }}>{group.project.name}</Box>
          </Box>
        </TableCell>
      </TableRow>
      {group.rows.map((r) => {
        const closed = closedLabel(r)
        return (
          <TableRow key={r.milestone.id} aria-disabled={closed ? true : undefined}
            sx={closed ? { bgcolor: 'action.hover', '& th, & td': { color: 'text.disabled' } } : undefined}>
            <TableCell component="th" scope="row" sx={[STICKY, closed ? CLOSED_TINT : null, edgeSx]}>
              <Box sx={NAME}>
                {r.milestone.name}
                {r.role === 'supporting' ? <SupportingChip /> : null}
                {closed ? (
                  <Tooltip title={`${closed}. Hours already logged stay visible but can't be changed.`}>
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{closed}</Typography>
                  </Tooltip>
                ) : null}
                {thisWeek && !closed ? <Box sx={{ mt: 0.75 }}><LogTimeActions milestone={r.milestone} project={group.project} wrap={narrow || phone} wrapTimer={phone} /></Box> : null}
              </Box>
            </TableCell>
            {days.map((d) => {
              const k = key(r.milestone.id, d)
              const value = valueOf(k)
              const label = `${r.milestone.name}, ${formatDayLabel(d)}`
              return (
                <TableCell key={d} align="center" sx={[{ verticalAlign: 'top' }, dayCellSx, dayTint(d, today)]}>
                  {isManual(k) ? (
                    <ManualCell entry={entries[k]} label={label} row={r} closed={Boolean(closed)} />
                  ) : locks[k] ? (
                    <LockedCell lock={locks[k]} label={label} closed={Boolean(closed)}
                      onRequest={() => onRequest({ milestoneId: r.milestone.id, date: d, hours: locks[k].hours, label })} />
                  ) : <HoursField value={value} label={label} onChange={(v) => setHours(k, v)} disabled={Boolean(closed)}
                    compact={narrow ? 'always' : true} dim={isWeekend(d) && !value && !entries[k]}
                    error={num(value) > DAY_CAP || (num(value) > 0 && overDays.includes(d)) || (isDraft(k) && tooLow(value))} />}
                  {entries[k] ? (
                    <StatusLine entry={entries[k]} cellLabel={label} entryParam={entryParam(r.milestone.id, d)}
                      onOpen={() => onOpenEntry(r.milestone.id, d)} />
                  ) : null}
                  {!isManual(k) && (num(value) > 0 || entries[k]) ? (
                    <Stack direction="row" sx={{ justifyContent: 'center', alignItems: 'center', mt: 0.25, gap: 0.5 }}>
                      <NoteButton cellLabel={label} note={noteOf(k)} disabled={Boolean(closed)}
                        attention={!closed && attention(k)} onChange={(v) => setNote(k, v)} />
                      {!closed && timerNeedsNote(k) ? (
                        <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 600 }}>Add a note</Typography>
                      ) : null}
                    </Stack>
                  ) : null}
                </TableCell>
              )
            })}
            <TableCell align="right" sx={edgeSx}>{formatHours(rowTotal(r.milestone.id))}</TableCell>
          </TableRow>
        )
      })}
    </>
  )
}
