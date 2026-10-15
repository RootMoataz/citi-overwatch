import { Box, Chip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { chartPalette } from '../app/chartColors.js'
import { DIFFICULTY } from '../lib/labels.js'

// Hues kept clear of priority's red and amber: Easy green, Medium blue, Hard violet (from the categorical palette).
const HUE = { easy: 2, medium: 0, hard: 6 }
// Dots show the progress weight (1 / 2 / 3), so the chip never relies on colour alone.
const WEIGHT = { easy: 1, medium: 2, hard: 3 }

/** A milestone's difficulty (Easy / Medium / Hard), which sets its weight in project progress. */
export default function DifficultyChip({ difficulty, sx }) {
  if (!DIFFICULTY[difficulty]) return null
  const label = (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      {DIFFICULTY[difficulty]}
      <Box component="span" aria-hidden sx={{ display: 'inline-flex', gap: '2px', ml: 0.75 }}>
        {[1, 2, 3].map((i) => (
          <Box key={i} component="span" sx={{ width: 5, height: 5, borderRadius: '50%', border: '1px solid currentColor',
            color: (t) => chartPalette(t).series[HUE[difficulty]],
            bgcolor: i <= WEIGHT[difficulty] ? 'currentColor' : 'transparent' }} />
        ))}
      </Box>
    </Box>
  )
  return (
    <Chip size="small" variant="outlined" label={label} aria-label={`Difficulty: ${DIFFICULTY[difficulty]}`}
      sx={[(t) => {
        const color = chartPalette(t).series[HUE[difficulty]]
        return { height: 20, color: 'text.primary', borderColor: alpha(color, 0.7),
          bgcolor: alpha(color, t.palette.mode === 'dark' ? 0.18 : 0.1), '& .MuiChip-label': { px: 0.75 } }
      }, ...(Array.isArray(sx) ? sx : [sx]).filter(Boolean)]} />
  )
}
