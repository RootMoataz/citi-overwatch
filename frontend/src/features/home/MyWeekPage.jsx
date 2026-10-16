import Schedule from '@mui/icons-material/ScheduleOutlined'
import { Box, Button, Chip, Grid, Skeleton, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { flushSync } from 'react-dom'
import { Link as RouterLink } from 'react-router-dom'
import { useProfile } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import CountUp from '../../components/CountUp.jsx'
import Reveal from '../../components/Reveal.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { chartPalette } from '../../app/chartColors.js'
import { formatDate, formatHours, nyTodayIso } from '../../lib/format.js'
import TimerLimitBanner from '../timer/TimerLimitBanner.jsx'
import Section from '../dashboard/Section.jsx'
import YourManagerCard from '../people/YourManagerCard.jsx'
import Claimable from './Claimable.jsx'
import MilestoneGroups, { COMING_ID } from './MilestoneGroups.jsx'
import YourFocusCard from './YourFocusCard.jsx'
import { groupMilestones } from './myWork.js'
import { useCollapsedSections } from './sectionState.js'

const WEEKLY_CAP = 40
const NONE = []

/** Logged hours as a bar against the 40h week (dashed), with the planned hours as an ink marker. Past 40h the bar runs
 * over the line in the alert colour; the chips below say the same in words. */
function WeekMeter({ logged, planned, over }) {
  const palette = chartPalette(useTheme())
  const max = Math.max(WEEKLY_CAP, logged, planned)
  const at = (v) => `${Math.min((v / max) * 100, 100)}%`
  return (
    <Box sx={{ my: 1.5 }}>
      <Box role="progressbar" aria-label="Hours logged this week" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round((logged / WEEKLY_CAP) * 100)} aria-valuetext={`${formatHours(logged)} of ${WEEKLY_CAP}h, ${formatHours(planned)} planned`}
        sx={{ position: 'relative', height: 22 }}>
        <Box sx={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: at(WEEKLY_CAP), bgcolor: palette.track, borderRadius: '0 4px 4px 0' }} />
        <Box sx={{ position: 'absolute', left: 0, top: 5, bottom: 5, width: at(logged), minWidth: logged > 0 ? 3 : 0,
          bgcolor: over ? palette.alert : palette.ok, borderRadius: '0 4px 4px 0', transition: 'width 600ms ease' }} />
        <Box sx={{ position: 'absolute', top: -2, bottom: -2, left: at(WEEKLY_CAP), borderLeft: `2px dashed ${palette.reference}`,
          transform: 'translateX(-1px)' }} />
        {planned > 0 ? (
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: at(planned), width: 3, transform: 'translateX(-1.5px)',
            bgcolor: palette.marker, borderRadius: 1, boxShadow: (t) => `0 0 0 2px ${t.palette.background.paper}` }} />
        ) : null}
      </Box>
      <Stack direction="row" useFlexGap aria-hidden sx={{ gap: 2, mt: 0.75, flexWrap: 'wrap' }}>
        {[['bar', 'Logged'], ['marker', 'Planned'], ['reference', '40h week']].map(([kind, label]) => (
          <Stack key={kind} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ flexShrink: 0, ...{
              bar: { width: 14, height: 8, borderRadius: '0 3px 3px 0', bgcolor: over ? palette.alert : palette.ok },
              marker: { width: 3, height: 14, borderRadius: 1, bgcolor: palette.marker },
              reference: { height: 14, borderLeft: `2px dashed ${palette.reference}` } }[kind] }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

/** This week's logged hours against the 40-hour week, with a way into the timesheet. */
function ThisWeek({ week }) {
  const logged = Number(week.logged)
  const overtime = Number(week.overtime) > 0
  return (
    <Section question="This week" hint={`Week of ${formatDate(week.week_start)} · pending and approved hours`}>
      <Typography variant="h2" component="p" sx={{ color: overtime ? 'error.main' : 'text.primary' }}>
        <CountUp value={logged} format={(v) => `${formatHours(v === logged ? v : Math.round(v))} of ${WEEKLY_CAP}h`} />
      </Typography>
      <WeekMeter logged={logged} planned={Number(week.planned)} over={overtime} />
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', mb: 2 }}>
        <Chip size="small" variant="outlined" label={`${formatHours(week.planned)} planned`} />
        {overtime
          ? <Chip size="small" color="error" label={`⚠ ${formatHours(week.overtime)} over 40h`} />
          : <Chip size="small" variant="outlined" label={`${formatHours(Math.max(WEEKLY_CAP - logged, 0))} left`} />}
      </Stack>
      <Button component={RouterLink} to="/timesheet" variant="contained" startIcon={<Schedule />}>Open my timesheet</Button>
    </Section>
  )
}

/** An employee's home: their week and their work, not the managers' delivery dashboard. */
export default function MyWeekPage() {
  const { user } = useSession()
  const profile = useProfile(user.id)
  const sections = useCollapsedSections()
  const today = nyTodayIso()
  const data = profile.data
  const groups = groupMilestones(data?.milestones, today)
  const comingUp = data?.coming_up ?? NONE

  // Open "Might come your way" now (not after the next paint), so the target is in the DOM to scroll to and focus.
  const reveal = (targetId, focusTarget) => {
    flushSync(() => sections.open('coming'))
    const target = document.getElementById(targetId)
    target?.scrollIntoView?.({ block: 'start' })
    focusTarget(target)?.focus()
  }
  const showComing = () => reveal(COMING_ID, (section) => section?.querySelector('h2 button'))
  const showPrediction = (id) => reveal(`${COMING_ID}-${id}`, (row) => row)

  return (
    <>
      <PageHeader title="My week" subtitle={`Hello, ${user.first_name}. Your hours and the milestones on your plate.`} />
      <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} sx={{ mb: 2 }} />
      <TimerLimitBanner showUnsubmitted />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack sx={{ gap: 2 }}>
            {data ? (
              <>
                <Reveal>
                  <YourFocusCard groups={groups} comingUp={comingUp} today={today} sections={sections}
                    onShowComing={showComing} onShowPrediction={showPrediction} />
                </Reveal>
                <MilestoneGroups groups={groups} comingUp={comingUp} today={today} sections={sections} />
              </>
            ) : profile.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
            <Claimable sections={sections} />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack sx={{ gap: 2 }}>
            {data ? <Reveal index={1}><ThisWeek week={data.this_week} /></Reveal>
              : profile.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
            {data?.user?.manager ? <YourManagerCard manager={data.user.manager} /> : null}
          </Stack>
        </Grid>
      </Grid>
    </>
  )
}
