import { Box, Paper, Typography } from '@mui/material'
import CountUp from './CountUp.jsx'

/**
 * A labelled number for summaries and the dashboard: label, big value, a small hint underneath and an optional icon
 * in the corner.
 * Numeric values count up (formatted by `format`); text values show as they are. `tone` colours the value.
 */
export default function StatTile({ label, value, format, hint, tone, icon }) {
  const numeric = typeof value === 'number' && Number.isFinite(value)
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600, pr: icon ? 5 : 0 }}>{label}</Typography>
      <Typography variant="h2" component="p" sx={{ mt: 0.75, fontSize: '1.625rem', letterSpacing: '-0.01em',
        color: tone ? `${tone}.main` : 'text.primary' }}>
        {numeric ? <CountUp value={value} format={format} /> : value}
      </Typography>
      {hint ? <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.25 }}>{hint}</Typography> : null}
      {icon ? (
        <Box aria-hidden sx={{ position: 'absolute', top: 12, right: 12, display: 'grid', placeItems: 'center', width: 32, height: 32,
          borderRadius: 2, bgcolor: tone ? `${tone}.main` : 'action.selected', color: tone ? 'background.paper' : 'primary.main',
          '& svg': { fontSize: 18 } }}>{icon}</Box>
      ) : null}
    </Paper>
  )
}
