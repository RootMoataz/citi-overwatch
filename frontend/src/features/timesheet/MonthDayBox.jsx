import { Box, Button, ButtonBase, Link, Paper, Typography } from '@mui/material'
import { useId } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { STATUS, statusColor } from '../../app/theme.js'
import { formatDayFull, formatDayShort, formatHours } from '../../lib/format.js'
import { DAY_CAP } from './useTimesheetWeek.js'
import { LINE_WORD, hoursWords, isOverdue, lineSx, milestoneHref, num, stateKey } from './monthText.js'

const MAX_LINES = 3
const dayNumber = (iso) => Number(iso.slice(8))
const red = (t) => statusColor(STATUS.rejected, t)
const nameOf = (names, id) => names.get(id)?.name ?? 'Milestone'

/** One day of the grid. A button: its name lists the date, total, every line and any milestone due that day. */
export function DayBox({ date, info, names, due, overtime, inMonth, weekend, past, isToday, phone, selected, onPick }) {
  const lines = info?.lines ?? []
  const total = num(info?.total)
  const noHours = inMonth && !weekend && past && !lines.length
  const name = [formatDayShort(date), isToday ? 'today' : '', noHours ? 'no hours' : hoursWords(total), total > DAY_CAP ? `over ${DAY_CAP} hours` : '',
    overtime ? 'overtime' : '', ...lines.map((l) => `${nameOf(names, l.milestone_id)} ${hoursWords(l.hours)} ${LINE_WORD[l.kind]}`),
    ...due.map((m) => `due: ${m.name}`)].filter(Boolean).join(', ')
  const dots = [...new Set(lines.map((l) => l.milestone_id))].slice(0, MAX_LINES)
  return (
    <ButtonBase component="button" aria-label={name} aria-pressed={phone ? selected : undefined} onClick={() => onPick(date)}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', width: '100%', height: '100%',
        textAlign: 'left', gap: 0.25, p: { xs: 0.5, sm: 0.75 }, minHeight: { xs: 56, sm: 104 },
        bgcolor: weekend ? 'action.hover' : 'transparent',
        boxShadow: (t) => {
          if (isToday) return `inset 0 0 0 2px ${t.palette.primary.main}`
          return selected ? `inset 0 0 0 2px ${t.palette.text.secondary}` : 'none'
        },
        '&:hover': { bgcolor: 'action.selected' } }}>
      <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 0.5 }}>
        <Typography component="span" variant="body2" sx={{ fontWeight: isToday ? 700 : 500, color: inMonth ? 'text.primary' : 'text.disabled' }}>{dayNumber(date)}</Typography>
        {lines.length ? (
          <Typography component="span" variant="caption" sx={{ fontWeight: 700, color: total > DAY_CAP ? red : 'text.primary' }}>
            {formatHours(total)}
          </Typography>
        ) : null}
      </Box>
      {overtime ? (
        <Typography component="span" variant="caption" sx={{ display: 'flex', gap: 0.5, lineHeight: 1.2, color: (t) => statusColor(STATUS.on_hold, t) }}>
          <Box component="span" aria-hidden>⚠</Box>{phone ? null : <Box component="span">Overtime</Box>}
        </Typography>
      ) : null}
      {phone ? (
        <Box component="span" sx={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {dots.map((id) => (
            <Box component="span" key={id} aria-hidden
              sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: (t) => statusColor(STATUS[names.has(id) ? stateKey(names.get(id)) : 'not_started'], t) }} />
          ))}
        </Box>
      ) : (
        <>
          {lines.slice(0, MAX_LINES).map((l, i) => (
            <Box component="span" key={i}
              sx={[{ display: 'block', fontSize: '0.75rem', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                (t) => lineSx(l.kind, t)]}>
              {`${nameOf(names, l.milestone_id)} ${formatHours(l.hours)}`}
            </Box>
          ))}
          {lines.length > MAX_LINES
            ? <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{`+${lines.length - MAX_LINES} more`}</Typography> : null}
          {noHours ? <Typography component="span" variant="caption" sx={{ color: 'text.disabled' }}>No hours</Typography> : null}
        </>
      )}
    </ButtonBase>
  )
}

/** On a phone: the chosen day's milestones and hours, under the grid. */
export function DayPanel({ date, info, milestones, names, today, onOpen }) {
  const id = useId()
  const lines = info?.lines ?? []
  const active = milestones.filter((m) => m.start_date <= date && date <= m.end_date)
  return (
    <Paper component="section" variant="outlined" aria-labelledby={id} sx={{ p: 2, mt: 2 }}>
      <Typography id={id} variant="h6" component="h3">{formatDayFull(date)}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>{`${formatHours(info?.total)} logged`}</Typography>
      {active.length ? (
        <Box component="ul" aria-label="Milestones" sx={{ m: 0, mb: 1, pl: 2.5 }}>
          {active.map((m) => {
            const note = [m.end_date === date ? 'Due' : '', isOverdue(m, today) ? '⚠ Overdue' : ''].filter(Boolean).join(' · ')
            return (
              <Typography key={m.id} component="li" variant="body2">
                <Link component={RouterLink} to={milestoneHref(m)} underline="hover" color="inherit">{m.name}</Link>
                {` · ${STATUS[stateKey(m)].label}${note ? ` · ${note}` : ''}`}
              </Typography>
            )
          })}
        </Box>
      ) : null}
      {lines.length ? (
        <Box component="ul" aria-label="Hours" sx={{ listStyle: 'none', m: 0, mb: 1, p: 0, display: 'grid', gap: 0.5 }}>
          {lines.map((l, i) => (
            <Box component="li" key={i} sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
              <Box component="span" sx={[{ fontSize: '0.8125rem' }, (t) => lineSx(l.kind, t)]}>
                {`${nameOf(names, l.milestone_id)} ${formatHours(l.hours)}`}
              </Box>
              <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{LINE_WORD[l.kind]}</Typography>
            </Box>
          ))}
        </Box>
      ) : <Typography variant="body2" sx={{ mb: 1 }}>No hours logged.</Typography>}
      <Button variant="outlined" size="small" onClick={onOpen}>Open this day</Button>
    </Paper>
  )
}
