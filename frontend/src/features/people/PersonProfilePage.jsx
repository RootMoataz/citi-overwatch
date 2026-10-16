import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import { Button, Grid, Skeleton, Stack } from '@mui/material'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { useProfile } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { NO_ACCESS, useRedirectOnDenied } from '../../app/access.js'
import { useBreadcrumb } from '../../app/breadcrumbs.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import FootNote from '../../components/FootNote.jsx'
import KpiStrip from '../../components/KpiStrip.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { formatDate, formatHours } from '../../lib/format.js'
import { ROLE_LABEL } from '../../lib/labels.js'
import { can } from '../../lib/permissions.js'
import MessageButton from '../messages/MessageButton.jsx'
import HistoryTabs from './HistoryTabs.jsx'
import ProfileCard from './ProfileCard.jsx'

/** Someone's profile, and an employee's own "My history": who they are, this week's hours and everything they've worked on.
 * The server decides who may open it (404 otherwise), only sends a salary to admins and its owner, and leaves archived
 * work out for employees; the role check here keeps that true against a stale payload too. */
export default function PersonProfilePage() {
  const { id } = useParams()
  const { user: viewer } = useSession()
  const profile = useProfile(id)
  // The server answers 404 for anyone the viewer may not see, so that reads as "no access", not "missing".
  const leaving = useRedirectOnDenied(profile.error, { notFound: NO_ACCESS })
  useBreadcrumb(profile.data?.user?.name, { failed: Boolean(profile.error) })
  if (leaving) return null
  if (profile.isLoading) return <Skeleton variant="rounded" height={320} />
  if (profile.error) return <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} />
  const { user: p, this_week: week, all_time: total, projects, milestones, skills, can_edit_skills: canEditSkills } = profile.data
  const own = viewer?.id != null && String(viewer.id) === String(p.id)
  const history = own && can(viewer, 'history.own')
  const hasArchived = projects.some((r) => r.is_archived) || milestones.some((m) => m.is_archived || m.project?.is_archived)
  const canSeeArchived = viewer?.role !== 'employee' && hasArchived
  const overtime = Number(week.overtime) > 0

  const timesheet = own && can(viewer, 'timesheet.use') ? (
    <Button component={RouterLink} to="/timesheet" variant="outlined" startIcon={<CalendarMonthOutlined />} sx={{ minHeight: 44 }}>
      Open my timesheet
    </Button>
  ) : null
  const actions = timesheet ?? (own ? null : <MessageButton person={p} />)

  return (
    <>
      {history
        ? <PageHeader title="My history" subtitle="Your work record, including completed milestones." actions={actions} />
        : <PageHeader title={p.name} subtitle={<>{p.job_title || ROLE_LABEL[p.role]}{p.is_archived ? ' · Archived' : ''}</>} actions={actions} />}
      {/* Keyed by person: Employment details and the tab filters start fresh on each profile, a cached one included.
          The history card spans the width under the profile card and the figures, so its six columns fit (the
          mockup's widths); narrower, its table scrolls inside the card. */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <ProfileCard key={p.id} person={p} skills={skills ?? []} canEditSkills={Boolean(canEditSkills)} own={own} />
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack sx={{ gap: 2 }}>
            <KpiStrip title={`Week of ${formatDate(week.week_start)}`} items={[
              { key: 'logged', label: 'Logged this week', value: formatHours(week.logged), hint: 'Pending and approved' },
              { key: 'planned', label: 'Planned this week', value: formatHours(week.planned) },
              { key: 'overtime', label: 'Overtime this week', value: formatHours(week.overtime), tone: overtime ? 'warning' : undefined,
                hint: 'Above 40h' },
            ]} />
            <KpiStrip title="All time summary" items={[
              { key: 'logged', label: 'Total hours logged', value: formatHours(total.logged), hint: 'All time' },
              { key: 'approved', label: 'Total hours approved', value: formatHours(total.approved), hint: 'All time' },
            ]} />
          </Stack>
        </Grid>
        <Grid size={12}>
          <HistoryTabs key={p.id} projects={projects} milestones={milestones} canSeeArchived={canSeeArchived} />
          {own ? <FootNote icon={<LockOutlined fontSize="inherit" />} note="Read-only history. Edit eligible hours in My timesheet." /> : null}
        </Grid>
      </Grid>
    </>
  )
}
