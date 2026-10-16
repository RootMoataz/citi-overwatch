import Psychology from '@mui/icons-material/PsychologyOutlined'
import { Chip, Stack, Typography } from '@mui/material'

/** Skills as small outlined chips. `highlight` (skill ids) fills the ones that matter here, e.g. a milestone's
 * required skills that a person has. `empty` is shown when there are none (nothing by default). */
export default function SkillChips({ skills = [], highlight = [], empty = null, label, sx }) {
  if (!skills.length) {
    return empty ? <Typography variant="body2" sx={{ color: 'text.secondary', ...sx }}>{empty}</Typography> : null
  }
  const strong = new Set(highlight.map(String))
  return (
    <Stack direction="row" useFlexGap component="ul" aria-label={label ?? 'Skills'}
      sx={{ flexWrap: 'wrap', gap: 0.5, listStyle: 'none', p: 0, m: 0, ...sx }}>
      {skills.map((s) => (
        // A long skill name ends in an ellipsis inside the row instead of widening it.
        <li key={s.id} style={{ maxWidth: '100%', minWidth: 0 }}>
          <Chip size="small" icon={<Psychology />} label={s.name} color="secondary"
            variant={strong.has(String(s.id)) ? 'filled' : 'outlined'} />
        </li>
      ))}
    </Stack>
  )
}
