import { Box, Button, Chip, Link, Paper, Stack, Typography } from '@mui/material'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useAllocations, useApprovals, useMembers, useMilestones, useProfile, useProjectSummary, useWeek } from '../../api/queries.js'
import { budgetTone } from '../../lib/chartData.js'
import DataTable from '../../components/DataTable.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import KpiStrip from '../../components/KpiStrip.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import Timeline from '../../components/Timeline.jsx'
import { can } from '../../lib/permissions.js'
import { projectEffort } from '../../lib/estimates.js'
import { daysBetween, formatDate, formatDateRange, formatHours, formatMoney, formatPct, mondayOfIso, nyTodayIso, plural } from '../../lib/format.js'
import { pendingHoursOf } from '../../lib/personWeeks.js'
import { WORK_MODE } from '../../lib/labels.js'
import { orderedRisks, riskSentence } from '../../lib/risk.js'
import { isOverdue } from '../milestones/milestoneOrder.js'

const COUNTED = new Set(['pending', 'approved'])
// Two risk reasons are sentences of their own; the milestone ones appear as counts below them.
const SENTENCE_RISKS = new Set(['PAST_DUE', 'BUDGET_BURN'])

function Card({ id, title, aside, children }) {
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <Typography id={id} variant="h3" component="h2">{title}</Typography>
        {aside}
      </Stack>
      {children}
    </Paper>
  )
}

const panelPath = (id) => `?tab=milestones&milestone=${id}`
const primaryOwner = (m) => (m.assignees ?? []).find((a) => !(m.supporting_ids ?? []).map(String).includes(String(a.id)))
const byStart = (a, b) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.end_date).localeCompare(String(b.end_date))

function Kpis({ project, summary, today }) {
  const s = summary.data
  const budget = Number(s?.budget ?? project.budget)
  const consumed = Number(s?.consumed ?? project.consumed)
  const budgetPct = Number(s?.budget_pct ?? project.budget_pct)
  const progress = Number(s?.progress_pct ?? project.progress_pct)
  const forecast = s?.forecast != null ? Number(s.forecast) : null
  const over = forecast != null && budget > 0 && forecast > budget
  const end = project.predicted_end_date
  const left = end ? daysBetween(today, end) : null
  let delivery = ''
  if (project.status === 'completed') delivery = `Completed ${formatDate(project.completed_at ?? end)}`
  else if (left != null) delivery = left > 0 ? plural(left, 'day remaining', 'days remaining') : (left === 0 ? 'Due today' : plural(-left, 'day overdue', 'days overdue'))
  const tone = budgetTone(budgetPct)
  const items = [
    { key: 'progress', label: 'Progress', value: formatPct(progress), hint: 'Weighted milestone completion', keepOnError: true,
      bar: { value: progress, label: 'Progress', tone: 'ok' } },
    { key: 'spend', label: 'Approved spend', value: `${formatMoney(consumed)} / ${formatMoney(budget)}`,
      hint: `${formatPct(budgetPct)} of budget used`, bar: { value: budgetPct, label: 'Budget used', tone } },
    { key: 'forecast', label: 'Forecast at finish', value: forecast == null ? '—' : formatMoney(forecast), tone: over ? 'warning' : undefined,
      hint: <>
        <span>Based on last 4 weeks</span>
        {over ? <Box component="span" sx={{ display: 'block', color: 'warning.main', fontWeight: 600 }}>⚠ Over budget</Box> : null}
      </> },
    { key: 'delivery', label: 'Delivery', value: formatDate(end), hint: delivery,
      tone: project.status !== 'completed' && left != null && left < 0 ? 'error' : undefined },
  ]
  return <KpiStrip ariaLabel="Project figures" items={items} loading={summary.isLoading} error={summary.error}
    onRetry={() => summary.refetch()} />
}

function Schedule({ project, milestones, planning }) {
  const navigate = useNavigate()
  const done = milestones.filter((m) => m.status === 'completed').length
  return (
    <Card id="ov-schedule" title="Milestone schedule" aside={planning ? null : (
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`${done} of ${milestones.length} milestones complete`}</Typography>
        <Link component={RouterLink} to="?tab=milestones&view=timeline" underline="hover" variant="body2">View milestones →</Link>
      </Stack>
    )}>
      {planning ? (
        <Typography variant="body2">
          This project is being planned.{' '}
          <Link component={RouterLink} to="?tab=plan" underline="hover">Open the Plan tab.</Link>
        </Typography>
      ) : milestones.length ? (
        <Timeline layout="compact" items={milestones} range={{ start: project.start_date, end: project.predicted_end_date }}
          onOpen={(m) => navigate(panelPath(m.id))} />
      ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>No milestones yet.</Typography>}
    </Card>
  )
}

function NextMilestones({ milestones }) {
  const navigate = useNavigate()
  const next = milestones.filter((m) => m.status !== 'completed').sort(byStart).slice(0, 3)
  if (!next.length) return null
  const columns = [
    { key: 'name', header: 'Milestone', rowHeader: true, render: (m) => (
      <Stack sx={{ gap: 0.5, alignItems: 'flex-start' }}>
        <Link component={RouterLink} to={panelPath(m.id)} underline="hover" sx={{ fontWeight: 600 }}>{m.name}</Link>
        <StatusChip status={m.display_status ?? m.status} />
      </Stack>) },
    { key: 'dates', header: 'Dates', render: (m) => formatDateRange(m.start_date, m.end_date) },
    { key: 'owner', header: 'Owner', render: (m) => primaryOwner(m)?.name ?? 'Unassigned' },
  ]
  return (
    <Card id="ov-next" title="Next milestones">
      <DataTable ariaLabel="Next milestones" columns={columns} rows={next} onRowOpen={(m) => navigate(panelPath(m.id))} />
    </Card>
  )
}

function Row({ children }) {
  return <Typography variant="body2" component="li">{children}</Typography>
}

function NeedsAttention({ project, view, milestones, today }) {
  const approvals = useApprovals({ project: project.id }, view.decides)
  const pending = approvals.data ?? []
  const pendingHours = pendingHoursOf(pending)
  const risks = orderedRisks(project.at_risk_reasons).filter((code) => SENTENCE_RISKS.has(code))
  const overdue = milestones.filter((m) => isOverdue(m, today)).length
  const kickedBack = milestones.filter((m) => m.status === 'blocked').length
  if (!pending.length && !risks.length && !overdue && !kickedBack) return null
  return (
    <Card id="ov-attention" title="Needs attention">
      <Stack component="ul" sx={{ m: 0, pl: 2.5, gap: 0.75 }}>
        {pending.length ? <Row>
          <span>{plural(pending.length, 'pending entry', 'pending entries')}</span>
          {' · '}
          <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{`${formatHours(pendingHours)} awaiting approval`}</Typography>
          {' '}
          <Link component={RouterLink} to={`/timesheets?project=${project.id}`} underline="hover">Review hours</Link>
        </Row> : null}
        {risks.map((code) => <Row key={code}>{riskSentence(code, project, today)}</Row>)}
        {overdue ? <Row>{plural(overdue, 'overdue milestone', 'overdue milestones')}</Row> : null}
        {kickedBack ? <Row>{`${kickedBack} kicked back`}</Row> : null}
      </Stack>
    </Card>
  )
}

function TeamThisWeek({ project, week }) {
  const allocations = useAllocations(week, true)
  const rows = (allocations.data ?? []).flatMap((person) => person.projects
    .filter((p) => String(p.id) === String(project.id))
    .map((p) => ({ id: person.user.id, name: person.user.name, planned: Number(p.planned), logged: Number(p.logged) })))
  const columns = [
    { key: 'name', header: 'Name', rowHeader: true, render: (r) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography> },
    { key: 'planned', header: 'Planned', align: 'right', render: (r) => formatHours(r.planned) },
    { key: 'logged', header: 'Logged', align: 'right', render: (r) => (
      <Stack direction="row" sx={{ gap: 0.75, justifyContent: 'flex-end', alignItems: 'center' }}>
        <span>{formatHours(r.logged)}</span>
        {r.logged > r.planned ? <Chip size="small" color="warning" variant="outlined" label={`+${formatHours(r.logged - r.planned)}`} /> : null}
      </Stack>) },
  ]
  return (
    <Card id="ov-team" title="Team this week" aside={<Typography variant="body2" sx={{ color: 'text.secondary' }}>{`Week of ${formatDate(week)}`}</Typography>}>
      <ErrorAlert error={allocations.error} onRetry={() => allocations.refetch()} />
      {rows.length || allocations.isLoading ? (
        <DataTable ariaLabel="Team this week" columns={columns} rows={rows} loading={allocations.isLoading} skeletonRows={3} />
      ) : !allocations.error ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nobody is planned on this project this week.</Typography> : null}
    </Card>
  )
}

function YourPart({ project, user, milestones, members, week }) {
  const profile = useProfile(user.id, true)
  const timesheet = can(user, 'timesheet.use')
  const entries = useWeek(week, undefined, timesheet)
  const mine = milestones.filter((m) => m.is_assignee)
  const next = mine.filter((m) => m.status !== 'completed').sort(byStart)[0]
  const stats = (profile.data?.projects ?? []).find((p) => String(p.id) === String(project.id))
  const me = (members.data ?? []).find((m) => String(m.user.id) === String(user.id))
  const logged = (entries.data?.entries ?? []).filter((e) => String(e.project_id) === String(project.id) && COUNTED.has(e.status))
    .reduce((sum, e) => sum + Number(e.hours), 0)
  const onTeam = members.data ? Boolean(me) : true
  return (
    <Card id="ov-yours" title="Your part">
      {!onTeam ? <Typography variant="body2">You aren't on this project's team.</Typography> : (
        <Stack sx={{ gap: 1 }}>
          <Typography variant="body2">{`Your milestones: ${mine.length} of ${milestones.length}`}</Typography>
          {next ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {'Next: '}<Link component={RouterLink} to={panelPath(next.id)} underline="hover">{next.name}</Link>{` · due ${formatDate(next.end_date)}`}
            </Typography>
          ) : null}
          {stats ? <Typography variant="body2">{`Your hours: ${formatHours(stats.logged_hours)} logged · ${formatHours(stats.approved_hours)} approved`}</Typography> : null}
          {timesheet && me && entries.data ? (
            <Typography variant="body2">{`This week: ${formatHours(logged)} of ${formatHours(me.planned_hours_per_week)} planned`}</Typography>
          ) : null}
          {timesheet ? <Box><Button component={RouterLink} to="/timesheet" size="small" variant="outlined">Open my timesheet</Button></Box> : null}
        </Stack>
      )}
    </Card>
  )
}

function Details({ project, summary, members }) {
  const s = summary.data
  const budget = Number(s?.budget ?? project.budget)
  const remaining = Number(s?.remaining ?? budget - Number(project.consumed ?? 0))
  const effort = projectEffort(s?.project ?? project)
  const count = members.data?.length ?? s?.member_count
  const mode = WORK_MODE[project.work_mode ?? 'push']
  const rows = [
    ['Budget available', <>
      <Typography component="span" variant="body2" sx={{ color: remaining < 0 ? 'error.main' : 'text.primary', fontWeight: 600 }}>
        {formatMoney(Math.abs(remaining))}
      </Typography>
      <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>{remaining < 0 ? ' over budget' : ` of ${formatMoney(budget)}`}</Typography>
    </>],
    ['Estimated effort', <>
      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>{effort.value}</Typography>
      {effort.hint ? <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{effort.hint}</Typography> : null}
    </>],
    ['Team', count == null ? '—' : plural(count, 'person', 'people')],
  ]
  return (
    <Card id="ov-details" title="Project details">
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1 }}>
        {rows.map(([term, value]) => (
          <Box key={term} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="body2" sx={{ color: 'text.secondary' }}>{term}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0, textAlign: 'right' }}>{value}</Typography>
          </Box>
        ))}
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1.5 }}>{`${mode.label} mode: ${mode.help.toLowerCase()}`}</Typography>
    </Card>
  )
}

export default function OverviewTab({ project, user, view }) {
  const summary = useProjectSummary(project.id)
  const milestones = useMilestones(project.id)
  const members = useMembers(project.id)
  const today = nyTodayIso()
  const week = mondayOfIso(today)
  const live = (milestones.data ?? []).filter((x) => !x.is_archived)
  const planning = project.status === 'planned' && !project.plan_finalized_at
  const teamWeek = view.lead && !view.executive

  return (
    <Stack sx={{ gap: 2 }}>
      <Kpis project={project} summary={summary} today={today} />
      <ErrorAlert error={milestones.error} onRetry={() => milestones.refetch()} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 2fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Stack sx={{ gap: 2, minWidth: 0 }}>
          <Schedule project={project} milestones={live} planning={planning} />
          <NextMilestones milestones={live} />
        </Stack>
        <Stack sx={{ gap: 2, minWidth: 0 }}>
          <NeedsAttention project={project} view={view} milestones={live} today={today} />
          {teamWeek ? <TeamThisWeek project={project} week={week} /> : null}
          {view.mine ? <YourPart project={project} user={user} milestones={live} members={members} week={week} /> : null}
          <Details project={project} summary={summary} members={members} />
        </Stack>
      </Box>
    </Stack>
  )
}
