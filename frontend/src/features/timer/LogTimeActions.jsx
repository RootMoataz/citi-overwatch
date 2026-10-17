import { Stack } from '@mui/material'
import ManualHoursButton from './ManualHoursButton.jsx'
import TimerButton from './TimerButton.jsx'

/** Start timer and Log hours manually side by side, wrapping on narrow screens. The caller decides where a
 * milestone can be logged on at all. `project` = { name }. */
export default function LogTimeActions({ milestone, project, size = 'small', touch = false, wrap = false }) {
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      <TimerButton milestone={milestone} size={size} touch={touch} wrap={wrap} />
      <ManualHoursButton milestone={milestone} project={project} size={size} touch={touch} wrap={wrap} />
    </Stack>
  )
}
