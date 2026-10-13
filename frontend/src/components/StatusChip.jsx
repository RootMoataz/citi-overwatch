import { Chip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { STATUS } from '../app/theme.js'

/** Status as text plus a tinted background; the label carries the meaning, never color alone. */
export default function StatusChip({ status, label, size = 'small' }) {
  const meta = STATUS[status] ?? { label: status, color: '#5B6B7F' }
  return (
    <Chip size={size} label={label ?? meta.label}
      sx={{ bgcolor: alpha(meta.color, 0.12), color: meta.color, border: `1px solid ${alpha(meta.color, 0.35)}` }} />
  )
}
