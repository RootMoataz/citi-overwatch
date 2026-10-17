import Schedule from '@mui/icons-material/ScheduleOutlined'
import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { Link as RouterLink } from 'react-router-dom'
import { chartPalette } from '../../app/chartColors.js'
import Critical from '../../components/Critical.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatDate, formatHours } from '../../lib/format.js'
import { useCalmMotion } from '../../lib/motion.js'
import Section from '../dashboard/Section.jsx'
import { shortDate } from '../timesheet/monthText.js'

const WEEKLY_CAP = 40
// Scale labels near an end stay inside the card: they hang off the marker instead of centring on it.
const anchor = (pct) => (pct < 12 ? 'translateX(0)' : pct > 88 ? 'translateX(-100%)' : 'translateX(-50%)')

/** Logged hours as a bar against the 40h week (dashed), with the planned hours as an ink marker and a 0h to 40h scale.
 * Past 40h the bar runs over the line in the alert colour; the text under the card says the same in words. */
export function WeekMeter({ logged, planned, over, label = 'Hours logged this week' }) {
  const palette = chartPalette(useTheme())
  const calm = useCalmMotion()
  const max = Math.max(WEEKLY_CAP, logged, planned)
  const pct = (v) => Math.min((v / max) * 100, 100)
  const at = (v) => `${pct(v)}%`
  // The planned marker's label replaces the 40h scale label when it sits on it (planned at, or within a hair of, 40).
  const coversCap = planned > 0 && Math.abs(pct(planned) - pct(WEEKLY_CAP)) < 8
  return (
    <Box sx={{ my: 1.5 }}>
      <Box role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} data-over={over ? 'true' : 'false'}
        aria-valuenow={Math.round((logged / WEEKLY_CAP) * 100)} aria-valuetext={`${formatHours(logged)} of ${WEEKLY_CAP}h, ${formatHours(planned)} planned`}
        sx={{ position: 'relative', height: 22 }}>
        <Box sx={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: at(WEEKLY_CAP), bgcolor: palette.track, borderRadius: '0 4px 4px 0' }} />
        <Box sx={{ position: 'absolute', left: 0, top: 5, bottom: 5, width: at(logged), minWidth: logged > 0 ? 3 : 0,
          bgcolor: over ? palette.alert : palette.ok, borderRadius: '0 4px 4px 0', transition: calm ? 'none' : 'width 600ms ease' }} />
        <Box sx={{ position: 'absolute', top: -2, bottom: -2, left: at(WEEKLY_CAP), borderLeft: `2px dashed ${palette.reference}`,
          transform: 'translateX(-1px)' }} />
        {planned > 0 ? (
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: at(planned), width: 3, transform: 'translateX(-1.5px)',
            bgcolor: palette.marker, borderRadius: 1, boxShadow: (t) => `0 0 0 2px ${t.palette.background.paper}` }} />
        ) : null}
      </Box>
      <Box aria-hidden sx={{ position: 'relative', height: 40, mt: 0.5 }}>
        <Typography variant="caption" sx={{ position: 'absolute', left: 0, top: 0, color: 'text.secondary' }}>0h</Typography>
        {coversCap ? null : (
          <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: at(WEEKLY_CAP), transform: anchor(pct(WEEKLY_CAP)),
            color: 'text.secondary', whiteSpace: 'nowrap' }}>{WEEKLY_CAP}h</Typography>
        )}
        {planned > 0 ? (
          <Typography variant="caption" sx={{ position: 'absolute', top: 20, left: at(planned), transform: anchor(pct(planned)),
            color: 'text.primary', fontWeight: 600, whiteSpace: 'nowrap' }}>{`${formatHours(planned)} planned`}</Typography>
        ) : null}
      </Box>
    </Box>
  )
}

const Figure = ({ label, value }) => (
  <Box>
    <Typography variant="h3" component="p">{value}</Typography>
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
  </Box>
)

/** The hours card: any week up to this one, logged against the 40h reference, with the way into that week's timesheet. */
export default function WeekHoursCard({ week, current, data, loading, error, onRetry, open, onToggle }) {
  const isCurrent = week === current
  const sameYear = week.slice(0, 4) === current.slice(0, 4)
  const title = isCurrent ? "This week's hours" : `Hours · week of ${sameYear ? shortDate(week) : formatDate(week)}`
  const logged = Number(data?.logged ?? 0)
  const planned = Number(data?.planned ?? 0)
  const overtime = Number(data?.overtime ?? 0)
  const over = overtime > 0 || logged > WEEKLY_CAP
  const label = isCurrent ? 'Hours logged this week' : `Hours logged in the week of ${shortDate(week)}`
  return (
    <Section collapsible open={open} onToggle={onToggle} question={title}>
      <ErrorAlert error={error} onRetry={onRetry} sx={{ mb: 1.5 }} />
      {loading ? <Skeleton variant="rounded" height={160} /> : data ? (
        <>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Pending + approved</Typography>
          <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h2" component="p" sx={{ color: over ? 'error.main' : 'text.primary' }}>{`${formatHours(logged)} logged`}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>/ {WEEKLY_CAP}h weekly reference</Typography>
          </Stack>
          <WeekMeter logged={logged} planned={planned} over={over} label={label} />
          <Stack direction="row" sx={{ gap: 4, mb: 2 }}>
            <Figure label="Planned" value={formatHours(planned)} />
            <Figure label="Logged" value={formatHours(logged)} />
          </Stack>
          <Button component={RouterLink} to={`/timesheet?week=${week}`} variant="contained" fullWidth startIcon={<Schedule />}
            sx={{ minHeight: 44 }}>Open my timesheet</Button>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
            Logged hours include pending and approved entries.
          </Typography>
          {over ? (
            <Typography variant="body2" component="p" sx={{ color: 'error.main', mt: 0.5 }}>
              <Critical>{`${formatHours(overtime > 0 ? overtime : logged - WEEKLY_CAP)} over 40h`}</Critical>
              {' (sent to your manager as overtime)'}
            </Typography>
          ) : null}
        </>
      ) : null}
    </Section>
  )
}
