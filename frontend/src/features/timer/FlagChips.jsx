import { Chip, Stack, Tooltip } from '@mui/material'
import { FLAG_LABEL } from './timerClock.js'

const toneOf = (flag) => (flag.code === 'NO_PROOF' ? 'error' : flag.severity === 'warn' ? 'warning' : 'neutral')
const COLOR = { error: 'error', warning: 'warning', neutral: 'default' }

/** "⚠" chips for an entry's red flags, worst first as the server sends them. Nothing is blocked by a flag. `warn` flags
 * use the warning colour and `info` ones stay neutral (spec §4.4); "No proof of work" keeps the error colour. Each chip
 * carries its tone in `data-tone` ('warning', 'neutral' or 'error'). */
export default function FlagChips({ flags, sx }) {
  if (!flags?.length) return null
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', ...sx }}>
      {flags.map((f) => {
        const tone = toneOf(f)
        return (
          <Tooltip key={f.code} title={f.message}>
            <Chip size="small" variant="outlined" label={`⚠ ${FLAG_LABEL[f.code] ?? f.code}`} color={COLOR[tone]} data-tone={tone}
              aria-label={`Red flag: ${f.message}`} sx={{ height: 20, fontSize: '0.72rem' }} />
          </Tooltip>
        )
      })}
    </Stack>
  )
}
