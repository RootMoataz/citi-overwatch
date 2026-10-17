import { Stack, Typography } from '@mui/material'
import { ThisWeekButton, WeekRange, WeekStep } from '../../components/WeekNav.jsx'
import { addDays, formatWeekRange } from '../../lib/format.js'

/** Steps the hours card back through past weeks. `week` and `current` are Mondays; there is no week after `current`. */
export default function WeekPicker({ week, current, onChange }) {
  const now = week === current
  return (
    <Stack direction="row" role="group" aria-label="Week shown in This week's hours" useFlexGap
      sx={{ alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
      <WeekStep direction="previous" onClick={() => onChange(addDays(week, -7))} />
      <WeekRange>
        <Typography variant="body2" component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatWeekRange(week)}</Typography>
      </WeekRange>
      <WeekStep direction="next" disabled={now} onClick={() => onChange(addDays(week, 7))} />
      <ThisWeekButton disabled={now} onClick={() => onChange(current)} />
    </Stack>
  )
}
