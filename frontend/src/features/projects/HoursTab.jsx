import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { Alert, Box, Button, IconButton, Link, Paper, Popover, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { useAllocations, useMembers, useMilestones, useWeek } from '../../api/queries.js'
import DataTable from '../../components/DataTable.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import FootNote from '../../components/FootNote.jsx'
import KpiStrip from '../../components/KpiStrip.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { AVATAR_SIZE } from '../../lib/avatarLook.js'
import { addDays, formatDate, formatHours, formatWeekRange, mondayOfIso, nyTodayIso } from '../../lib/format.js'
import { can } from '../../lib/permissions.js'
import { BANNER_PROPS } from './pendingBanner.js'

const sum = (rows, key) => rows.reduce((total, r) => total + r[key], 0)
const LOGGED_INFO = 'Logged means pending + approved. Rejected hours excluded.'
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Hours awaiting approval: in the warning colour (and `data-tone="warning"`) when there are any. */
function PendingHours({ hours }) {
  if (!(hours > 0)) return formatHours(hours)
  return <Box component="span" data-tone="warning" sx={{ color: 'warning.main', fontWeight: 600 }}>{formatHours(hours)}</Box>
}

/** The week in the URL (`?week=`), defaulting to this week on the New York calendar. Other params are kept. */
function useHoursWeek() {
  const [params, setParams] = useSearchParams()
  const thisWeek = mondayOfIso(nyTodayIso())
  const asked = params.get('week')
  const week = asked && ISO_DAY.test(asked) ? mondayOfIso(asked) : thisWeek
  const setWeek = (next) => setParams((prev) => {
    const copy = new URLSearchParams(prev)
    if (next === thisWeek) copy.delete('week')
    else copy.set('week', next)
    return copy
  }, { replace: true })
  return { week, thisWeek, setWeek }
}

function WeekBar({ week, thisWeek, setWeek }) {
  const [anchor, setAnchor] = useState(null)
  const current = week === thisWeek
  return (
    <Stack sx={{ flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { md: 'center' }, gap: 1 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <IconButton aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))} sx={{ minWidth: 44, minHeight: 44 }}><ChevronLeft /></IconButton>
        <Typography variant="subtitle1" component="p" sx={{ minWidth: 150, textAlign: 'center' }}>{formatWeekRange(week)}</Typography>
        <IconButton aria-label="Next week" onClick={() => setWeek(addDays(week, 7))} sx={{ minWidth: 44, minHeight: 44 }}><ChevronRight /></IconButton>
        <IconButton aria-label="Pick a week" onClick={(e) => setAnchor(e.currentTarget)} sx={{ minWidth: 44, minHeight: 44 }}><CalendarMonthOutlined /></IconButton>
        <Button variant="outlined" size="small" disabled={current} onClick={() => setWeek(thisWeek)} sx={{ minHeight: 44 }}>This week</Button>
        <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}>
          <Stack sx={{ p: 2 }}>
            <TextField type="date" size="small" label="Any day in the week" value={week}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={(e) => {
                if (!ISO_DAY.test(e.target.value)) return
                setWeek(mondayOfIso(e.target.value))
                setAnchor(null)
              }} />
          </Stack>
        </Popover>
      </Stack>
      <Stack sx={{ alignItems: { md: 'flex-end' } }}>
        <Typography variant="body2" component="p" sx={{ color: 'text.secondary' }}>
          {`Project hours · ${current ? 'This week' : `Week of ${formatDate(week).replace(/, \d{4}$/, '')}`}`}
        </Typography>
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>{`As of ${formatDate(nyTodayIso())}`}</Typography>
      </Stack>
    </Stack>
  )
}

function TeamHours({ project, week }) {
  const allocations = useAllocations(week, true)
  const rows = (allocations.data ?? []).flatMap((person) => person.projects
    .filter((p) => String(p.id) === String(project.id))
    .map((p) => {
      const planned = Number(p.planned)
      const logged = Number(p.logged)
      const approved = Number(p.approved)
      return { id: person.user.id, person: person.user, planned, logged, approved, pending: logged - approved }
    }))
  const pending = sum(rows, 'pending')
  const columns = [
    { key: 'person', header: 'Person', rowHeader: true, render: (r) => (
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <UserAvatar userId={r.person.id} name={r.person.name} size={AVATAR_SIZE.row} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}><PersonLink person={r.person} context={{ project }} /></Typography>
          <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{r.person.job_title || 'No title'}</Typography>
          {r.logged > r.planned ? (
            <Typography variant="caption" component="div" sx={{ color: 'warning.main' }}>{`${formatHours(r.logged - r.planned)} above project plan`}</Typography>
          ) : null}
        </Box>
      </Stack>) },
    { key: 'planned', header: 'Planned / week', align: 'right', render: (r) => formatHours(r.planned) },
    { key: 'logged', header: 'Logged', align: 'right', render: (r) => formatHours(r.logged) },
    { key: 'approved', header: 'Approved', align: 'right', render: (r) => formatHours(r.approved) },
    { key: 'pending', header: 'Pending', align: 'right', render: (r) => <PendingHours hours={r.pending} /> },
    { key: 'review', header: 'Review', align: 'right', render: (r) => (r.pending > 0
      ? <Link component={RouterLink} to={`/timesheets?project=${project.id}&user=${r.person.id}`} underline="hover">View entries</Link>
      : '—') },
  ]
  const totalRow = { person: 'Total', planned: formatHours(sum(rows, 'planned')), logged: formatHours(sum(rows, 'logged')),
    approved: formatHours(sum(rows, 'approved')), pending: formatHours(pending), review: null }
  const items = [
    { key: 'planned', label: 'Planned', value: formatHours(sum(rows, 'planned')) },
    { key: 'logged', label: 'Logged', value: formatHours(sum(rows, 'logged')), info: LOGGED_INFO },
    { key: 'approved', label: 'Approved', value: formatHours(sum(rows, 'approved')) },
    { key: 'pending', label: 'Pending', value: formatHours(pending), tone: pending > 0 ? 'warning' : undefined },
  ]
  return (
    <>
      <ErrorAlert error={allocations.error} onRetry={() => allocations.refetch()} />
      {allocations.error ? null : (
        <>
          <KpiStrip ariaLabel="Hours this week" items={items} loading={allocations.isLoading} />
          {pending > 0 ? (
            <Alert severity="info" variant="outlined" {...BANNER_PROPS}
              action={<Link component={RouterLink} to={`/timesheets?project=${project.id}`} underline="hover" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Review this week's entries →</Link>}>
              {`${formatHours(pending)} awaiting approval this week · Pending hours do not contribute to approved project spend.`}
            </Alert>
          ) : null}
          <Paper variant="outlined" sx={{ p: { xs: 1, md: 2 } }}>
            <DataTable ariaLabel={`Hours on ${project.name}`} columns={columns} rows={rows} loading={allocations.isLoading}
              skeletonRows={3} totalRow={totalRow} rowTone={(r) => (r.logged > r.planned ? 'warning' : undefined)}
              empty={<EmptyState title="No hours this week" description="Hours appear as the team logs them." />} />
            <FootNote note="Planned hours are weekly allocations. This is not a measure of productivity." />
          </Paper>
        </>
      )}
    </>
  )
}

function YourHours({ project, user, week }) {
  const entries = useWeek(week, undefined, true)
  const milestones = useMilestones(project.id)
  const members = useMembers(project.id)
  const names = new Map((milestones.data ?? []).map((m) => [String(m.id), m.name]))
  const byMilestone = new Map()
  for (const e of entries.data?.entries ?? []) {
    if (String(e.project_id) !== String(project.id)) continue
    const key = String(e.milestone_id)
    const row = byMilestone.get(key) ?? { id: key, name: names.get(key) ?? 'Unknown milestone', logged: 0, approved: 0, pending: 0, rejected: 0 }
    const hours = Number(e.hours)
    if (e.status === 'approved') { row.approved += hours; row.logged += hours }
    else if (e.status === 'pending') { row.pending += hours; row.logged += hours }
    else if (e.status === 'rejected') row.rejected += hours
    byMilestone.set(key, row)
  }
  const rows = [...byMilestone.values()]
  const me = (members.data ?? []).find((m) => String(m.user.id) === String(user.id))
  const items = [
    { key: 'planned', label: 'Planned', value: me ? formatHours(me.planned_hours_per_week) : '—' },
    { key: 'logged', label: 'Logged', value: formatHours(sum(rows, 'logged')), info: LOGGED_INFO },
    { key: 'approved', label: 'Approved', value: formatHours(sum(rows, 'approved')) },
    { key: 'pending', label: 'Pending', value: formatHours(sum(rows, 'pending')), tone: sum(rows, 'pending') > 0 ? 'warning' : undefined },
  ]
  const columns = [
    { key: 'name', header: 'Milestone', rowHeader: true, render: (r) => r.name },
    { key: 'logged', header: 'Logged', align: 'right', render: (r) => formatHours(r.logged) },
    { key: 'approved', header: 'Approved', align: 'right', render: (r) => formatHours(r.approved) },
    { key: 'pending', header: 'Pending', align: 'right', render: (r) => <PendingHours hours={r.pending} /> },
    { key: 'rejected', header: 'Needs revision', align: 'right', render: (r) => formatHours(r.rejected) },
  ]
  const totalRow = { name: 'Total', logged: formatHours(sum(rows, 'logged')), approved: formatHours(sum(rows, 'approved')),
    pending: formatHours(sum(rows, 'pending')), rejected: formatHours(sum(rows, 'rejected')) }
  return (
    <Paper variant="outlined" component="section" aria-labelledby="hours-yours" sx={{ p: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <Typography id="hours-yours" variant="h3" component="h2">Your hours</Typography>
        <Button component={RouterLink} to={`/timesheet?week=${week}`} variant="outlined" size="small" sx={{ minHeight: 44 }}>Open my timesheet</Button>
      </Stack>
      <ErrorAlert error={entries.error} onRetry={() => entries.refetch()} />
      {entries.error ? null : (
        <Stack sx={{ gap: 2 }}>
        <KpiStrip ariaLabel="Your hours this week" items={items} loading={entries.isLoading} />
        <DataTable ariaLabel="Your hours by milestone" columns={columns} rows={rows} getRowId={(r) => r.id}
          loading={entries.isLoading} skeletonRows={3} totalRow={totalRow}
          empty={<EmptyState title="No hours this week" description="Hours appear as the team logs them." />} />
        </Stack>
      )}
    </Paper>
  )
}

/** Planned vs. logged vs. approved hours on this project for one week; the week lives in the URL. */
export default function HoursTab({ project, user, view }) {
  const { week, thisWeek, setWeek } = useHoursWeek()
  const own = !view.lead && can(user, 'timesheet.use')
  return (
    <Stack sx={{ gap: 2 }}>
      {view.lead || own ? <WeekBar week={week} thisWeek={thisWeek} setWeek={setWeek} /> : null}
      {view.lead ? <TeamHours project={project} week={week} /> : null}
      {own ? <YourHours project={project} user={user} week={week} /> : null}
      {!view.lead && !own ? (
        <EmptyState title="Team hours are private" description="Only the project's manager and admins see everyone's hours." />
      ) : null}
    </Stack>
  )
}
