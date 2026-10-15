import { ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { formatDayShort, formatHours } from '../../lib/format.js'

/** The week's days as one row of buttons, each with that day's hours; a day over the cap turns red.
 * days: YYYY-MM-DD strings. selected: the open day. dayTotal(d): hours. overDays: the days over the cap. onSelect(d). */
export default function WeekStrip({ days, selected, dayTotal, overDays, onSelect }) {
  return (
    <ToggleButtonGroup exclusive fullWidth value={selected} aria-label="Days of the week" sx={{ mb: 2 }}
      onChange={(_, day) => { if (day) onSelect(day) }}>
      {days.map((d) => {
        const hours = formatHours(dayTotal(d))
        const over = overDays.includes(d)
        const [weekday, dayOfMonth] = formatDayShort(d).split(' ')
        return (
          <ToggleButton key={d} value={d} aria-label={`${formatDayShort(d)}, ${hours}`} data-over={over}
            sx={{ flexDirection: 'column', minWidth: 0, px: 0.5, py: 0.75, textTransform: 'none', lineHeight: 1.3,
              ...(over ? { color: 'error.main', bgcolor: (t) => alpha(t.palette.error.main, 0.08),
                '&.Mui-selected, &.Mui-selected:hover': { color: 'error.main', bgcolor: (t) => alpha(t.palette.error.main, 0.16) } } : null) }}>
            <Typography variant="caption" component="span" sx={{ color: 'inherit' }}>{weekday}</Typography>
            <Typography variant="subtitle1" component="span" sx={{ color: 'inherit', fontWeight: 700 }}>{dayOfMonth}</Typography>
            <Typography variant="caption" component="span" sx={{ color: 'inherit', fontVariantNumeric: 'tabular-nums' }}>{hours}</Typography>
          </ToggleButton>
        )
      })}
    </ToggleButtonGroup>
  )
}
