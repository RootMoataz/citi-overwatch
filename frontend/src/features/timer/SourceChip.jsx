import { Chip, Tooltip } from '@mui/material'
import { SOURCE_LABEL } from './timerClock.js'

const MEANING = {
  tracked: 'Every hour came from a start/stop timer',
  manual: 'Typed into the timesheet by hand',
  mixed: 'Partly from a timer, partly typed by hand',
}

/** Where an entry's hours came from: a timer ("Tracked"), typed by hand ("Manual"), or both ("Mixed"). */
export default function SourceChip({ source, hours, trackedHours, sx }) {
  if (!SOURCE_LABEL[source]) return null
  const detail = source === 'mixed' && hours != null ? ` (${Number(trackedHours)}h of ${Number(hours)}h tracked)` : ''
  return (
    <Tooltip title={`${MEANING[source]}${detail}`}>
      <Chip size="small" variant="outlined" color={source === 'manual' ? 'default' : 'info'} label={SOURCE_LABEL[source]}
        sx={{ height: 18, fontSize: '0.7rem', '& .MuiChip-label': { px: 0.75 }, ...sx }} />
    </Tooltip>
  )
}
