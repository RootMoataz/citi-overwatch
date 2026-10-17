import CheckCircle from '@mui/icons-material/CheckCircleOutlined'
import ErrorIcon from '@mui/icons-material/ErrorOutlineOutlined'
import PlayCircle from '@mui/icons-material/PlayCircleOutlined'
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked'
import RateReview from '@mui/icons-material/RateReviewOutlined'
import { Box, Chip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { STATUS, statusColor } from '../app/theme.js'
import Critical from './Critical.jsx'
import { stripes } from './stateStripes.js'

// With `icon`, a milestone state also gets a glyph; waiting is a striped disc, as on the status bar and the timeline.
const ICONS = { completed: CheckCircle, in_progress: PlayCircle, ready_for_review: RateReview, blocked: ErrorIcon,
  not_started: RadioButtonUnchecked }

// States waiting on someone: kicked back (the manager's review) and waiting on dependencies. Their own label is bold; a
// chip that borrows a state's colour for another word ("Archived") is not.
const CRITICAL = new Set(['blocked', 'waiting'])

function stateIcon(status) {
  if (status === 'waiting') {
    return <Box component="span" aria-hidden="true"
      sx={(t) => ({ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, bgcolor: statusColor(STATUS.waiting, t),
        backgroundImage: stripes(2) })} />
  }
  const Icon = ICONS[status]
  return Icon ? <Icon aria-hidden="true" /> : undefined
}

/** Status as text plus a tinted background; the label carries the meaning, never color alone. */
export default function StatusChip({ status, label, size = 'small', icon = false }) {
  const meta = STATUS[status] ?? { ...STATUS.planned, label: status }
  const text = label ?? meta.label
  return (
    <Chip size={size} label={CRITICAL.has(status) && label == null ? <Critical>{text}</Critical> : text}
      icon={icon ? stateIcon(status) : undefined}
      sx={(t) => {
        const color = statusColor(meta, t)
        return { bgcolor: alpha(color, t.palette.mode === 'dark' ? 0.16 : 0.12), color, border: `1px solid ${alpha(color, 0.4)}`,
          '& .MuiChip-icon': { color } }
      }} />
  )
}
