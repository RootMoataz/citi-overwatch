import Flag from '@mui/icons-material/Flag'
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp'
import Remove from '@mui/icons-material/Remove'
import { Chip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { chartPalette } from '../app/chartColors.js'
import { PRIORITY } from '../lib/labels.js'
import Critical from './Critical.jsx'

const ICONS = { critical: Flag, high: KeyboardArrowUp, medium: Remove, low: KeyboardArrowDown }
/** The urgent priorities: their label is bold (Critical and High; Medium and Low stay regular). */
const URGENT = new Set(['critical', 'high'])

/** Icon, border and text for each priority, from the semantic chart tokens. Critical is the alert colour (its text
 * passes 4.5:1 on both card surfaces); High keeps its label in the body colour, since amber text is too faint on
 * white; Medium is neutral and Low muted. The word always carries the meaning, never colour alone. */
function tone(priority, t) {
  const palette = chartPalette(t)
  if (priority === 'critical') {
    return [{ color: palette.alert, borderColor: alpha(palette.alert, 0.6), fontWeight: 600,
      bgcolor: alpha(palette.alert, t.palette.mode === 'dark' ? 0.16 : 0.08) }, palette.alert]
  }
  if (priority === 'high') return [{ color: 'text.primary', borderColor: alpha(palette.warning, 0.7) }, palette.warning]
  if (priority === 'low') return [{ color: 'text.secondary', borderStyle: 'dashed' }, palette.reference]
  return [{ color: 'text.primary' }, palette.reference]
}

/** A milestone's priority (Low / Medium / High / Critical): how urgent it is. Separate from difficulty.
 * `hideDefault`: compact lists skip the default Medium, so it isn't read next to a Medium difficulty as "Medium · Medium". */
export default function PriorityChip({ priority, sx, hideDefault = false }) {
  if (!PRIORITY[priority] || (hideDefault && priority === 'medium')) return null
  const Icon = ICONS[priority]
  const text = `${PRIORITY[priority]} priority`   // sentence case, as the Now card says it
  return (
    <Chip size="small" variant="outlined" icon={<Icon aria-hidden />}
      label={URGENT.has(priority) ? <Critical>{text}</Critical> : text}
      aria-label={`Priority: ${PRIORITY[priority]}`}
      sx={[(t) => {
        const [chip, icon] = tone(priority, t)
        return { height: 20, '& .MuiChip-label': { px: 0.75 }, '& .MuiChip-icon': { fontSize: 14, ml: 0.5, mr: -0.25, color: icon }, ...chip }
      }, ...(Array.isArray(sx) ? sx : [sx]).filter(Boolean)]} />
  )
}
