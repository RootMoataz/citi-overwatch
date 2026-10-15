import { Chip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { STATUS, statusColor } from '../app/theme.js'

/** Status as text plus a tinted background; the label carries the meaning, never color alone. */
export default function StatusChip({ status, label, size = 'small' }) {
  const meta = STATUS[status] ?? { ...STATUS.planned, label: status }
  return (
    <Chip size={size} label={label ?? meta.label}
      sx={(t) => {
        const color = statusColor(meta, t)
        return { bgcolor: alpha(color, t.palette.mode === 'dark' ? 0.16 : 0.12), color, border: `1px solid ${alpha(color, 0.4)}` }
      }} />
  )
}
