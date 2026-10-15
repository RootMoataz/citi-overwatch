import { Chip } from '@mui/material'
import { DIFFICULTY } from '../lib/labels.js'

/** A milestone's difficulty (Easy / Medium / Hard), which sets its weight in project progress. */
export default function DifficultyChip({ difficulty, sx }) {
  if (!DIFFICULTY[difficulty]) return null
  return (
    <Chip size="small" variant="outlined" label={DIFFICULTY[difficulty]} aria-label={`Difficulty: ${DIFFICULTY[difficulty]}`}
      sx={{ height: 20, '& .MuiChip-label': { px: 0.75 }, ...sx }} />
  )
}
