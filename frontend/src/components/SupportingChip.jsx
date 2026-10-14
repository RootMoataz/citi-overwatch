import { Chip } from '@mui/material'

/** Marks someone who was auto-routed onto a milestone as support after sending their own work for review. */
export default function SupportingChip({ person }) {
  return (
    <Chip size="small" variant="outlined" color="info" label="Supporting"
      aria-label={person ? `${person} is supporting` : undefined}
      sx={{ ml: 0.75, height: 18, verticalAlign: 'middle', '& .MuiChip-label': { px: 0.75 } }} />
  )
}
