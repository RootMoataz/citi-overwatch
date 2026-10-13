import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import WarningAmber from '@mui/icons-material/WarningAmber'
import { Chip, Stack } from '@mui/material'
import { RISK_LABELS } from '../lib/labels.js'


export default function RiskBadges({ reasons = [], showOnTrack = true }) {
  if (!reasons.length) {
    return showOnTrack
      ? <Chip size="small" icon={<CheckCircleOutlined />} label="On track" color="success" variant="outlined" />
      : null
  }
  return (
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {reasons.map((code) => (
        <Chip key={code} size="small" icon={<WarningAmber />} color="warning" variant="outlined"
          label={RISK_LABELS[code] ?? code} />
      ))}
    </Stack>
  )
}
