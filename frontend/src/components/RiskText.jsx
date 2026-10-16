import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import WarningAmber from '@mui/icons-material/WarningAmber'
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material'
import { RISK_SHORT } from '../lib/labels.js'
import { orderedRisks, riskSentence } from '../lib/risk.js'

/**
 * A project's risk in words. `cell`: a warning icon and the first reason ("—", named "No risk", when there is none).
 * `chip`: a warning chip with the first reason, or a success "On track" chip. Both share one tooltip with a sentence
 * per reason and the name "Risk: <word>, <word>". `today` is the New York date.
 */
export default function RiskText({ project, today, variant = 'cell' }) {
  const codes = orderedRisks(project.at_risk_reasons)
  if (!codes.length) {
    if (variant === 'chip') return <Chip size="small" icon={<CheckCircleOutlined />} label="On track" color="success" variant="outlined" />
    return <Box component="span" role="img" aria-label="No risk" sx={{ color: 'text.secondary' }}>—</Box>
  }
  // tabIndex 0 on at-risk cells is deliberate: it makes the reasons' tooltip reachable by keyboard (WCAG 1.4.13).
  // It is the only extra tab stop, and only on at-risk rows.
  const words = codes.map((code) => RISK_SHORT[code] ?? code)
  const name = `Risk: ${words.join(', ')}`
  const tip = (
    <Stack component="ul" sx={{ m: 0, p: 0, listStyle: 'none', gap: 0.5 }}>
      {codes.map((code) => <li key={code}>{riskSentence(code, project, today)}</li>)}
    </Stack>
  )
  return (
    <Tooltip title={tip}>
      {variant === 'chip'
        ? <Chip size="small" icon={<WarningAmber />} label={words[0]} color="warning" variant="outlined" tabIndex={0} role="img" aria-label={name} />
        : (
          <Box component="span" tabIndex={0} role="img" aria-label={name}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'warning.main', minWidth: 0 }}>
            <WarningAmber fontSize="small" aria-hidden />
            <Typography variant="body2" component="span" sx={{ color: 'text.primary' }}>{words[0]}</Typography>
          </Box>
        )}
    </Tooltip>
  )
}
