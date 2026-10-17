import { Box, Chip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { DIFFICULTY } from '../lib/labels.js'

// One teal ramp, light to deep: teal is used by no status (grey / blue / amber / green / purple / red) and no priority
// (red / amber), so a difficulty chip never reads as a status. Darker teal = harder.
const TEAL = {
  light: { easy: '#4DB6AC', medium: '#00897B', hard: '#00574B' },
  dark: { easy: '#80CBC4', medium: '#4DB6AC', hard: '#26A69A' },
}
const tealFor = (t, difficulty) => TEAL[t.palette.mode === 'dark' ? 'dark' : 'light'][difficulty]
// Dots show the progress weight (1 / 2 / 3), so the chip never relies on colour alone.
const WEIGHT = { easy: 1, medium: 2, hard: 3 }

/** A milestone's difficulty (Easy / Medium / Hard), which sets its weight in project progress. */
export default function DifficultyChip({ difficulty, sx }) {
  if (!DIFFICULTY[difficulty]) return null
  const label = (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      {DIFFICULTY[difficulty]} difficulty
      <Box component="span" aria-hidden sx={{ display: 'inline-flex', gap: '2px', ml: 0.75 }}>
        {[1, 2, 3].map((i) => (
          <Box key={i} component="span" sx={{ width: 5, height: 5, borderRadius: '50%', border: '1px solid currentColor',
            color: (t) => tealFor(t, difficulty),
            bgcolor: i <= WEIGHT[difficulty] ? 'currentColor' : 'transparent' }} />
        ))}
      </Box>
    </Box>
  )
  return (
    <Chip size="small" variant="outlined" label={label} aria-label={`Difficulty: ${DIFFICULTY[difficulty]}`}
      sx={[(t) => {
        const color = tealFor(t, difficulty)
        return { height: 20, color: 'text.primary', borderColor: alpha(color, 0.7),
          bgcolor: alpha(color, t.palette.mode === 'dark' ? 0.18 : 0.1), '& .MuiChip-label': { px: 0.75 } }
      }, ...(Array.isArray(sx) ? sx : [sx]).filter(Boolean)]} />
  )
}
