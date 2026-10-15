import {
  Chip, Grid, Link, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { useProfile } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { NO_ACCESS, useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import DifficultyChip from '../../components/DifficultyChip.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, formatHours, formatMoney } from '../../lib/format.js'
import StatTile from '../projects/StatTile.jsx'

const ROLE = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }

function ReadOnly({ label, value }) {
  return (
    <Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body1">{value || '—'}</Typography>
    </Stack>
  )
}

const projectLink = (project, canOpen, tab) => (canOpen
  ? <Link component={RouterLink} to={`/projects/${project.id}${tab ? `?tab=${tab}` : ''}`} underline="hover">{project.name}</Link>
  : project.name)

function HistoryTable({ title, label, head, children, empty }) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Typography variant="h3" component="h2" sx={{ px: 2, pt: 2 }}>{title}</Typography>
      {empty ? <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>{empty}</Typography> : (
        <Table size="small" aria-label={label}>
          <TableHead><TableRow>{head.map((h) => <TableCell key={h} align={/hours|week/i.test(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{children}</TableBody>
        </Table>
      )}
    </TableContainer>
  )
}

/** Someone's profile: who they are, this week's hours and everything they've worked on.
 * The server decides who may open it (404 otherwise) and only sends a salary to admins and its owner. */
export default function PersonProfilePage() {
  const { id } = useParams()
  const { user: viewer } = useSession()
  const profile = useProfile(id)
  // The server answers 404 for anyone the viewer may not see, so that reads as "no access", not "missing".
  const leaving = useRedirectOnDenied(profile.error, { notFound: NO_ACCESS })
  if (leaving) return null
  if (profile.isLoading) return <Skeleton variant="rounded" height={320} />
  if (profile.error) return <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} />
  const { user: p, this_week: week, all_time: total, projects, milestones } = profile.data
  const overtime = Number(week.overtime) > 0
  const own = viewer?.id != null && String(viewer.id) === String(p.id)

  return (
    <>
      <PageHeader title={p.name} avatar={<UserAvatar userId={p.id} name={p.name} size={56} />} subtitle={<>{p.job_title || ROLE[p.role]}{p.is_archived ? ' · Archived' : ''}</>} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}><ReadOnly label="Job title" value={p.job_title} /></Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}><ReadOnly label="Role" value={ROLE[p.role]} /></Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}><ReadOnly label="Reports to" value={p.manager ? <PersonLink person={p.manager} /> : null} /></Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}><ReadOnly label="Department" value={p.department?.name} /></Grid>
          {'salary' in p ? <Grid size={{ xs: 12, sm: 6, md: 3 }}><ReadOnly label="Annual salary" value={formatMoney(p.salary)} /></Grid> : null}
        </Grid>
      </Paper>
      <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>Week of {formatDate(week.week_start)}</Typography>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Logged this week" value={formatHours(week.logged)} hint="Pending and approved" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Overtime this week" value={formatHours(week.overtime)}
          tone={overtime ? 'warning' : undefined} hint={overtime ? 'Over 40h this week' : 'Within 40h'} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Planned this week" value={formatHours(week.planned)} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><StatTile label="Total hours logged" value={formatHours(total.logged)} hint="All time, pending and approved" /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><StatTile label="Total hours approved" value={formatHours(total.approved)} hint="All time" /></Grid>
      </Grid>
      {own ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          A read-only record of your work, including finished and archived projects. Hours are changed on My timesheet while a project is open.
        </Typography>
      ) : null}
      <Stack sx={{ gap: 2 }}>
        <HistoryTable title="Projects" label={`Projects ${p.name} has been on`}
          head={['Project', 'Status', 'Dates', 'Planned / week', 'Hours logged', 'Hours approved']}
          empty={projects.length ? null : 'Not on any projects yet.'}>
          {projects.map((r) => (
            <TableRow key={r.id}>
              <TableCell component="th" scope="row">
                {projectLink(r, r.can_open)}
                {r.on_team ? null : <Chip size="small" variant="outlined" label="Left the team" sx={{ ml: 1 }} />}
                {r.is_archived ? <Chip size="small" variant="outlined" label="Archived" sx={{ ml: 1 }} /> : null}
              </TableCell>
              <TableCell><StatusChip status={r.status} /></TableCell>
              <TableCell>{formatDate(r.start_date)} – {formatDate(r.predicted_end_date)}</TableCell>
              <TableCell align="right">{formatHours(r.planned_hours_per_week)}</TableCell>
              <TableCell align="right">{formatHours(r.logged_hours)}</TableCell>
              <TableCell align="right">{formatHours(r.approved_hours)}</TableCell>
            </TableRow>
          ))}
        </HistoryTable>
        <HistoryTable title="Milestones" label={`Milestones ${p.name} has worked on`}
          head={['Milestone', 'Project', 'Role', 'Status', 'Dates', 'Hours logged', 'Hours approved']}
          empty={milestones.length ? null : 'No milestones yet.'}>
          {milestones.map((m) => (
            <TableRow key={m.id}>
              <TableCell component="th" scope="row">
                {m.name}
                {m.is_archived ? <Chip size="small" variant="outlined" label="Archived" sx={{ ml: 1 }} /> : null}
              </TableCell>
              <TableCell>
                {projectLink(m.project, m.can_open, 'milestones')}
                {m.project.is_archived ? <Chip size="small" variant="outlined" label="Project archived" sx={{ ml: 1 }} />
                  : m.project.status === 'completed' ? <Chip size="small" variant="outlined" label="Project completed" sx={{ ml: 1 }} /> : null}
              </TableCell>
              <TableCell>{m.role === 'supporting' ? 'Supporting' : m.role === 'primary' ? 'Primary' : 'No longer assigned'}</TableCell>
              <TableCell><StatusChip status={m.status} /><DifficultyChip difficulty={m.difficulty} sx={{ ml: 0.75 }} /></TableCell>
              <TableCell>{formatDate(m.start_date)} – {formatDate(m.end_date)}</TableCell>
              <TableCell align="right">{formatHours(m.logged_hours)}</TableCell>
              <TableCell align="right">{formatHours(m.approved_hours)}</TableCell>
            </TableRow>
          ))}
        </HistoryTable>
      </Stack>
    </>
  )
}
