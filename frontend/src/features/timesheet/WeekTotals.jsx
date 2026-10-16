import { Box, Paper, Skeleton, Stack, Typography } from '@mui/material'
import FootNote from '../../components/FootNote.jsx'
import { formatHours } from '../../lib/format.js'
import { useCalmMotion } from '../../lib/motion.js'
import { KIND, kindColor } from './monthText.js'

const FIGURES = [['approved', 'approved'], ['pending', 'pending'], ['rejected', 'needsRevision']]

/** The week's totals: the counted hours against the 40h reference with a bar, then approved, pending and needs revision.
 * figures: the weekFigures result. loading: the shown week's own data isn't in yet (the previous week's may still be
 * on show), so the card is a skeleton rather than figures from two weeks mixed. */
export default function WeekTotals({ figures, cap = 40, loading = false }) {
  const calm = useCalmMotion()
  if (loading) {
    return (
      <Paper variant="outlined" role="group" aria-label="Week totals" aria-busy="true" sx={{ p: 2, mb: 2 }}>
        <Skeleton width="40%" height={36} />
        <Skeleton variant="rounded" height={8} sx={{ my: 1 }} />
        <Skeleton width="60%" />
      </Paper>
    )
  }
  const { counted } = figures
  const over = counted > cap
  return (
    <Paper variant="outlined" role="group" aria-label="Week totals" sx={{ p: 2, mb: 2 }}>
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 1.5, sm: 3 }, alignItems: { sm: 'center' } }}>
        <Typography data-testid="week-total" data-over={over} variant="h3" component="p"
          sx={{ color: over ? 'warning.main' : 'text.primary', flexShrink: 0 }}>
          {formatHours(counted)} counted of {cap}h
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
          <Box role="progressbar" aria-label={`Counted hours against ${cap}h`} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.min(Math.round((counted / cap) * 100), 100)} aria-valuetext={`${formatHours(counted)} of ${cap}h`}
            sx={{ flex: 1, minWidth: 0, height: 8, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${Math.min((counted / cap) * 100, 100)}%`, bgcolor: over ? 'warning.main' : 'primary.main',
              transition: calm ? 'none' : 'width 600ms ease' }} />
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>{Math.round((counted / cap) * 100)}%</Typography>
        </Stack>
      </Stack>
      <Stack direction="row" component="ul" useFlexGap sx={{ listStyle: 'none', m: 0, p: 0, mt: 1.5, gap: { xs: 1.5, sm: 4 }, flexWrap: 'wrap' }}>
        {FIGURES.map(([kind, field]) => (
          <Stack key={kind} component="li" direction="row" sx={{ alignItems: 'baseline', gap: 0.75 }}>
            <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: kind === 'rejected' ? '1px' : '50%', flexShrink: 0,
              alignSelf: 'center', bgcolor: (t) => kindColor(kind, t) }} />
            <Typography component="span" variant="body1" sx={{ fontWeight: 600 }}>{formatHours(figures[field])}</Typography>
            <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>{KIND[kind].legend}</Typography>
          </Stack>
        ))}
      </Stack>
      <FootNote note="Rejected hours are excluded from counted totals." />
      {figures.unlisted > 0 ? (
        <FootNote note={`Includes ${formatHours(figures.unlisted)} on milestones you're no longer assigned to.`} />
      ) : null}
    </Paper>
  )
}
