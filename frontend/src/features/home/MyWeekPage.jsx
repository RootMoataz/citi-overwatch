import Schedule from '@mui/icons-material/ScheduleOutlined'
import {
  Box, Button, Chip, Grid, Link, Skeleton, Stack, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useClaimMilestone, useMilestonesOf, useProfile, useProjects } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import CountUp from '../../components/CountUp.jsx'
import DifficultyChip from '../../components/DifficultyChip.jsx'
import PriorityChip from '../../components/PriorityChip.jsx'
import Reveal from '../../components/Reveal.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { chartPalette } from '../../app/chartColors.js'
import { formatDate, formatHours } from '../../lib/format.js'
import { priorityRank } from '../../lib/labels.js'
import Section from '../dashboard/Section.jsx'

const WEEKLY_CAP = 40
// Projects whose milestones can be claimed (the server also refuses claims on other statuses).
const CLAIMABLE_PROJECT = new Set(['planned', 'active'])

const projectLink = (project) => (
  <Link component={RouterLink} to={`/projects/${project.id}?tab=milestones`} underline="hover">{project.name}</Link>
)

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

const todayIso = () => new Date().toLocaleDateString('en-CA')
const overdue = (m) => m.status !== 'completed' && String(m.end_date) < todayIso()

function MilestoneItem({ m, action }) {
  return (
    <Box component="li" sx={{ py: 1.5, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0, pt: 0 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3" sx={{ lineHeight: 1.3 }}>{m.name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {projectLink(m.project)} · due {formatDate(m.end_date)}
          </Typography>
        </Box>
        <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          {overdue(m) ? <Chip size="small" color="error" variant="outlined" label="Overdue" /> : null}
          <StatusChip status={m.status} />
          <PriorityChip priority={m.priority} hideDefault />
          <DifficultyChip difficulty={m.difficulty} />
          {m.role === 'supporting' ? <Chip size="small" variant="outlined" label="Supporting" sx={{ height: 20 }} /> : null}
          {action}
        </Stack>
      </Stack>
    </Box>
  )
}

/** Open work first: overdue, then the most important (priority), then the soonest due. Finished milestones drop to
 * the bottom, soonest due first. */
function byUrgency(a, b) {
  const done = (m) => (m.status === 'completed' ? 1 : 0)
  const rank = (m) => (done(m) ? 0 : priorityRank(m.priority))
  return done(a) - done(b) || Number(overdue(b)) - Number(overdue(a)) || rank(a) - rank(b)
    || String(a.end_date).localeCompare(String(b.end_date))
}

function MyMilestones({ milestones }) {
  const mine = milestones.filter((m) => m.role && !m.is_archived && !m.project?.is_archived).sort(byUrgency)
  return (
    <Section question="My milestones" hint="Assigned to you: overdue first, then by priority and due date.">
      {mine.length ? (
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {mine.map((m) => <MilestoneItem key={m.id} m={m} />)}
        </Box>
      ) : <EmptyState title="Nothing assigned to you right now" description="Milestones your manager gives you, or that you claim, show up here." />}
    </Section>
  )
}

function ClaimButton({ milestone }) {
  const claim = useClaimMilestone(milestone.project_id)
  const [failure, setFailure] = useState(null)
  const take = async () => {
    setFailure(null)
    try { await claim.mutateAsync(milestone.id) } catch (err) { setFailure(err) }
  }
  return (
    <>
      <Button size="small" variant="contained" aria-label={`Claim ${milestone.name}`} disabled={claim.isPending} onClick={take}>
        Claim
      </Button>
      {failure ? <Box sx={{ flexBasis: '100%' }}><ErrorAlert error={failure} /></Box> : null}
    </>
  )
}

/** Ready, unowned milestones in pull-mode projects the employee is on. */
function Claimable() {
  const projects = useProjects({})
  const pull = (projects.data?.items ?? []).filter((p) => p.work_mode === 'pull' && CLAIMABLE_PROJECT.has(p.status))
  const milestones = useMilestonesOf(pull.map((p) => p.id))
  const nameOf = new Map(pull.map((p) => [String(p.id), p.name]))
  const open = milestones.data.filter((m) => m.can_claim)
    .map((m) => ({ ...m, project: { id: m.project_id, name: nameOf.get(String(m.project_id)) } })).sort(byUrgency)
  const loading = projects.isLoading || milestones.isLoading
  return (
    <Section question="Milestones you can claim" hint="Pull-mode projects you're on: take a ready milestone that nobody owns yet.">
      <ErrorAlert error={projects.error ?? milestones.error} onRetry={() => { projects.refetch(); milestones.refetch() }} />
      {loading ? <Skeleton variant="rounded" height={64} /> : open.length ? (
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {open.map((m) => <MilestoneItem key={m.id} m={m} action={<ClaimButton milestone={m} />} />)}
        </Box>
      ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing to claim right now.</Typography>}
    </Section>
  )
}

/** An employee's home: their week and their work, not the managers' delivery dashboard. */
export default function MyWeekPage() {
  const { user } = useSession()
  const profile = useProfile(user.id)
  return (
    <>
      <PageHeader title="My week" subtitle={`Hello, ${user.first_name}. Your hours and the milestones on your plate.`} />
      <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          {profile.data ? <Reveal><ThisWeek week={profile.data.this_week} /></Reveal> : profile.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          {profile.data ? <Reveal index={1}><MyMilestones milestones={profile.data.milestones} /></Reveal> : profile.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
        </Grid>
        <Grid size={12}>
          <Claimable />
        </Grid>
      </Grid>
    </>
  )
}
