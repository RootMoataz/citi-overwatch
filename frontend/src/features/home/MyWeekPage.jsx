import Schedule from '@mui/icons-material/ScheduleOutlined'
import {
  Box, Button, Chip, Grid, LinearProgress, Link, Skeleton, Stack, Typography,
} from '@mui/material'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useClaimMilestone, useMilestonesOf, useProfile, useProjects } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import CountUp from '../../components/CountUp.jsx'
import DifficultyChip from '../../components/DifficultyChip.jsx'
import Reveal from '../../components/Reveal.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, formatHours } from '../../lib/format.js'
import Section from '../dashboard/Section.jsx'

const WEEKLY_CAP = 40
// Projects whose milestones can be claimed (the server also refuses claims on other statuses).
const CLAIMABLE_PROJECT = new Set(['planned', 'active'])

const projectLink = (project) => (
  <Link component={RouterLink} to={`/projects/${project.id}?tab=milestones`} underline="hover">{project.name}</Link>
)

/** This week's logged hours against the 40-hour week, with a way into the timesheet. */
function ThisWeek({ week }) {
  const logged = Number(week.logged)
  const overtime = Number(week.overtime) > 0
  return (
    <Section question="This week" hint={`Week of ${formatDate(week.week_start)} · pending and approved hours`}>
      <Typography variant="h2" component="p" sx={{ color: overtime ? 'warning.main' : 'text.primary' }}>
        <CountUp value={logged} format={(v) => `${formatHours(v === logged ? v : Math.round(v))} of ${WEEKLY_CAP}h`} />
      </Typography>
      <LinearProgress variant="determinate" value={Math.min((logged / WEEKLY_CAP) * 100, 100)}
        color={overtime ? 'warning' : 'primary'} aria-label="Hours logged this week"
        sx={{ height: 10, borderRadius: 5, my: 1.5 }} />
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', mb: 2 }}>
        <Chip size="small" variant="outlined" label={`${formatHours(week.planned)} planned`} />
        {overtime
          ? <Chip size="small" color="warning" label={`${formatHours(week.overtime)} over 40h`} />
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
          <DifficultyChip difficulty={m.difficulty} />
          {m.role === 'supporting' ? <Chip size="small" variant="outlined" label="Supporting" sx={{ height: 20 }} /> : null}
          {action}
        </Stack>
      </Stack>
    </Box>
  )
}

/** Open work first, soonest due first; finished milestones drop to the bottom. */
function byUrgency(a, b) {
  const done = (m) => (m.status === 'completed' ? 1 : 0)
  return done(a) - done(b) || String(a.end_date).localeCompare(String(b.end_date))
}

function MyMilestones({ milestones }) {
  const mine = milestones.filter((m) => m.role && !m.is_archived && !m.project?.is_archived).sort(byUrgency)
  return (
    <Section question="My milestones" hint="Assigned to you, soonest due first.">
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
