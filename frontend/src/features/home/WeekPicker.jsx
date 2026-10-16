import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { Button, IconButton, Stack, Typography } from '@mui/material'
import { addDays, formatWeekRange } from '../../lib/format.js'

const TARGET = { minWidth: 44, minHeight: 44 }

/** Steps the hours card back through past weeks. `week` and `current` are Mondays; there is no week after `current`. */
export default function WeekPicker({ week, current, onChange }) {
  const now = week === current
  return (
    <Stack direction="row" role="group" aria-label="Week shown in This week's hours" useFlexGap
      sx={{ alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
      <IconButton aria-label="Previous week" onClick={() => onChange(addDays(week, -7))} sx={TARGET}><ChevronLeft /></IconButton>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
        <CalendarMonthOutlined fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatWeekRange(week)}</Typography>
      </Stack>
      <IconButton aria-label="Next week" disabled={now} onClick={() => onChange(addDays(week, 7))} sx={TARGET}><ChevronRight /></IconButton>
      <Button variant="outlined" size="small" disabled={now} onClick={() => onChange(current)} sx={TARGET}>This week</Button>
    </Stack>
  )
}
