import { Paper, Typography } from '@mui/material'

/** A labelled number for summaries and the dashboard. */
export default function StatTile({ label, value, hint, tone }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="h2" component="p" sx={{ mt: 0.5, color: tone ? `${tone}.main` : 'text.primary' }}>{value}</Typography>
      {hint ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>{hint}</Typography> : null}
    </Paper>
  )
}
