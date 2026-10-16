import EventOutlined from '@mui/icons-material/EventOutlined'
import { Box, ButtonBase } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { STATUS, statusColor } from '../../app/theme.js'
import { formatDayShort, formatHours } from '../../lib/format.js'
import { DAY_CAP } from './useTimesheetWeek.js'
import { KIND, KIND_ICON, chipSx, deadlineWords, hoursWords, kindColor, kindText, num } from './monthText.js'

const MAX_LINES = 3
const red = (t) => statusColor(STATUS.rejected, t)
const amber = (t) => kindText('pending', t)
const nameOf = (names, id) => names.get(id)?.name ?? 'Milestone'
const caption = { fontSize: '0.75rem', lineHeight: 1.3 }

/** One hours line: an icon and the name with its hours, then the status word (approved has none: its ✓ is named instead). */
function LineChip({ line, name }) {
  const { kind } = line
  const Icon = KIND_ICON[kind]
  const word = KIND[kind].chip
  return (
    <Box component="span" data-line={kind}
      sx={[{ ...caption, display: 'flex', alignItems: 'flex-start', gap: 0.5, px: 0.625, py: 0.375, minWidth: 0 }, chipSx(kind)]}>
      <Icon titleAccess={word ? undefined : KIND[kind].panel} sx={{ fontSize: 14, mt: '1px', flexShrink: 0, color: (t) => kindColor(kind, t) }} />
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere', color: 'text.primary' }}>
        {kind === 'rejected'
          ? <>{name} <Box component="s" sx={{ textDecoration: 'line-through' }}>{formatHours(line.hours)}</Box></>
          : `${name} ${formatHours(line.hours)}`}
        {word ? <Box component="span" sx={{ display: 'block', fontSize: '0.6875rem', color: (t) => kindText(kind, t) }}>{word}</Box> : null}
      </Box>
    </Box>
  )
}

const SHAPE = { approved: 'circle', pending: 'ring', rejected: 'square', draft: 'dashed' }
const shapeSx = (kind, t) => {
  const c = kindColor(kind, t)
  return { width: 8, height: 8, boxSizing: 'border-box', flexShrink: 0, display: 'inline-block',
    ...(kind === 'approved' ? { bgcolor: c, borderRadius: '50%' } : kind === 'pending' ? { border: `2px solid ${c}`, borderRadius: '50%' }
      : kind === 'rejected' ? { bgcolor: c, borderRadius: '1px' } : { border: `1px dashed ${c}`, borderRadius: '50%' }) }
}

/** A status as a small shape, so phones don't rely on colour alone: approved a filled circle, pending a ring, needs revision
 * a square, a timer draft a dashed ring. In the legend it is decorative. */
export function StatusShape({ kind, legend }) {
  return (
    <Box component="span" data-shape={SHAPE[kind]} {...(legend ? { 'data-testid': 'legend-shape', 'aria-hidden': true } : { role: 'img', 'aria-label': KIND[kind].legend })}
      sx={(t) => shapeSx(kind, t)} />
  )
}

/** One day of the grid, as a button that selects it. Its name lists the date, total, marks, every line and any deadlines. */
export function DayBox({ date, info, names, deadlines, overtime, inMonth, weekend, isToday, selected, phone, onPick }) {
  const lines = info?.lines ?? []
  const total = num(info?.total)
  const over = total > DAY_CAP
  const name = [formatDayShort(date), isToday ? 'today' : '', lines.length ? hoursWords(total) : 'no hours',
    over ? `over ${DAY_CAP} hours` : '', overtime ? 'over 40 hours' : '',
    ...lines.map((l) => `${nameOf(names, l.milestone_id)} ${hoursWords(l.hours)} ${KIND[l.kind].spoken}`),
    deadlines ? deadlineWords(deadlines) : ''].filter(Boolean).join(', ')
  // A day of the next or previous month reads "28 Sep" (just "28" on a phone).
  const label = inMonth || phone ? String(Number(date.slice(8))) : formatDayShort(date).split(' ').slice(1).join(' ')
  const deadlineMark = deadlines ? (
    <Box component="span" sx={{ ...caption, display: 'flex', alignItems: 'flex-start', gap: 0.5, color: 'text.secondary' }}>
      <EventOutlined sx={{ fontSize: 14, mt: '1px' }} />{phone ? null : deadlineWords(deadlines)}
    </Box>
  ) : null
  const overtimeMark = overtime ? (
    <Box component="span" sx={{ ...caption, fontWeight: 600, color: amber }}>
      <Box component="span" aria-hidden>⚠</Box>{phone ? null : ' Over 40h'}
    </Box>
  ) : null
  return (
    <ButtonBase component="button" aria-label={name} aria-pressed={selected} onClick={() => onPick(date)}
      sx={(t) => ({ display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 0.5,
        width: '100%', height: '100%', minWidth: 0, minHeight: phone ? 64 : 112, p: phone ? 0.5 : 1, overflow: 'hidden', textAlign: 'left',
        bgcolor: selected ? alpha(t.palette.primary.main, 0.08) : weekend ? alpha(t.palette.text.primary, 0.035) : 'transparent',
        boxShadow: selected ? `inset 0 0 0 2px ${t.palette.primary.main}` : isToday ? `inset 0 0 0 1px ${t.palette.primary.main}` : 'none',
        '&:hover': { bgcolor: selected ? alpha(t.palette.primary.main, 0.12) : 'action.hover' },
        '&.Mui-focusVisible': { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: -4 } })}>
      <Box component="span" sx={{ display: 'flex', flexDirection: phone ? 'column' : 'row', justifyContent: 'space-between',
        alignItems: phone ? 'flex-start' : 'center', gap: phone ? 0.25 : 0.5 }}>
        <Box component="span" sx={isToday
          ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: phone ? 20 : 24, height: phone ? 20 : 24, px: 0.5,
            borderRadius: 12, bgcolor: 'primary.main', color: 'primary.contrastText', typography: 'body2', fontWeight: 700 }
          : { typography: 'body2', fontWeight: 600, color: inMonth ? 'text.primary' : 'text.disabled' }}>
          {label}
        </Box>
        <Box component="span" sx={{ typography: 'caption', fontWeight: 700, color: over ? red : lines.length ? 'text.primary' : 'text.secondary' }}>
          {lines.length ? formatHours(total) : '–'}
        </Box>
      </Box>
      {phone ? (
        <Box component="span" sx={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap', minHeight: 14 }}>
          {lines.slice(0, MAX_LINES).map((l, i) => <StatusShape key={i} kind={l.kind} />)}
          {overtimeMark}
          {deadlineMark}
        </Box>
      ) : (
        <>
          {overtimeMark}
          {lines.slice(0, MAX_LINES).map((l, i) => <LineChip key={i} line={l} name={nameOf(names, l.milestone_id)} />)}
          {lines.length > MAX_LINES
            ? <Box component="span" sx={{ ...caption, color: 'text.secondary' }}>{`+${lines.length - MAX_LINES} more`}</Box> : null}
          {deadlineMark}
        </>
      )}
    </ButtonBase>
  )
}
