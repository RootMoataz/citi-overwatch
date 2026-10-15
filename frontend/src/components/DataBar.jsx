import { Box, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { chartPalette, TONE_TEXT } from '../app/chartColors.js'
import { formatPct } from '../lib/format.js'

/**
 * A % for a table cell with an inline data bar behind it: the bar fills to 100% (anything past is capped and the
 * number says by how much), coloured by tone: ok, warning or alert. The number is the accessible value.
 */
export default function DataBar({ value, tone = 'ok', label, minWidth = 120 }) {
  const palette = chartPalette(useTheme())
  const pct = Number(value ?? 0)
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minWidth, justifyContent: 'flex-end' }}>
      <Box role="meter" aria-label={label} aria-valuenow={Math.round(pct * 10) / 10} aria-valuemin={0} aria-valuemax={100}
        aria-valuetext={formatPct(pct)}
        sx={{ position: 'relative', flex: 1, maxWidth: 120, height: 8, borderRadius: 4, bgcolor: palette.track, overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, right: 'auto', width: `${Math.min(Math.max(pct, 0), 100)}%`,
          minWidth: pct > 0 ? 3 : 0, bgcolor: palette[tone] ?? palette.ok, borderRadius: '0 4px 4px 0' }} />
      </Box>
      <Typography variant="body2" component="span" sx={{ minWidth: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
        fontWeight: tone === 'ok' ? 400 : 600, color: TONE_TEXT[tone] ?? 'text.primary' }}>
        {tone === 'alert' ? <Box component="span" aria-hidden sx={{ mr: 0.5 }}>⚠</Box> : null}{formatPct(pct)}
      </Typography>
    </Stack>
  )
}
