import {
  Box, Button, Chip, Grid, LinearProgress, Link, List, ListItem, ListItemText, MenuItem, Skeleton, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { BarChart } from '@mui/x-charts/BarChart'
import WarningAmber from '@mui/icons-material/WarningAmberRounded'
import EventBusy from '@mui/icons-material/EventBusyOutlined'
import TrendingUp from '@mui/icons-material/TrendingUpRounded'
import HourglassBottom from '@mui/icons-material/HourglassBottomOutlined'
import PlayCircle from '@mui/icons-material/PlayCircleOutlined'
import PauseCircle from '@mui/icons-material/PauseCircleOutlined'
import CheckCircle from '@mui/icons-material/CheckCircleOutlined'
import EventNote from '@mui/icons-material/EventNoteOutlined'
import { useId } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { useAllocations, useDashboard, useDepartments } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { chartColors, STATUS } from '../../app/theme.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import { PrintButton, PrintHeader } from '../../components/PrintButton.jsx'
import RiskBadges from '../../components/RiskBadges.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, formatHours, formatMoney, formatPct, mondayOf } from '../../lib/format.js'
import { RISK_LABELS } from '../../lib/labels.js'
import { can } from '../../lib/permissions.js'
import Reveal from '../../components/Reveal.jsx'
import StatTile from '../../components/StatTile.jsx'
import MissingTimesheets from './MissingTimesheets.jsx'
import Section from './Section.jsx'
import SmartInsightsPanel from './SmartInsightsPanel.jsx'
import LiveActivityCard from '../activity/LiveActivityCard.jsx'
import EmailReportButton from '../report/EmailReportButton.jsx'

// One icon per risk tile (in RISK_LABELS order, after the total) and per status tile.
const RISK_ICONS = [<WarningAmber key="all" />, <EventBusy key="a" />, <HourglassBottom key="b" />, <TrendingUp key="c" />]
const STATUS_ICONS = { planned: <EventNote />, active: <PlayCircle />, on_hold: <PauseCircle />, completed: <CheckCircle /> }

const projectLink = (p, tab) => (
  <Link component={RouterLink} to={`/projects/${p.id}${tab ? `?tab=${tab}` : ''}`} underline="hover">{p.name}</Link>
)

// The over-40h and busiest lists only hold the viewer's own people (the server scopes them).
const MANAGED = { managed: true }
const overBudget = (b) => Number(b.budget) > 0 && Number(b.forecast) > Number(b.budget)

/** Q7: planned vs consumed vs forecast per project. Over-budget forecasts are red, marked ⚠ on the axis,
 * flagged in the tooltip and named in the note under the chart, so colour is never the only signal. */
function BudgetChart({ budgets }) {
  const colors = chartColors(useTheme())
  const over = budgets.filter(overBudget)
  const overNames = new Set(over.map((b) => b.name))
  const isOver = (i) => overBudget(budgets[i])
  const money = (v) => formatMoney(v)
  return (
    <>
      <BarChart height={300} borderRadius={4} grid={{ horizontal: true }}
        xAxis={[{ scaleType: 'band', data: budgets.map((b) => b.name), label: 'Project',
          valueFormatter: (name, ctx) => (ctx.location === 'tick' && overNames.has(name) ? `⚠ ${name}` : name) }]}
        yAxis={[{ label: 'US dollars', width: 90, valueFormatter: money }]}
        series={[
          { data: budgets.map((b) => Number(b.budget)), label: 'Budget (planned)', color: colors.planned, valueFormatter: money },
          { data: budgets.map((b) => Number(b.consumed)), label: 'Consumed (approved hours)', color: colors.actual,
            valueFormatter: money },
          { data: budgets.map((b) => Number(b.forecast)), label: 'Forecast at end date', color: colors.forecast,
            colorGetter: ({ dataIndex }) => (isOver(dataIndex) ? colors.over : colors.forecast),
            valueFormatter: (v, { dataIndex }) => `${formatMoney(v)}${isOver(dataIndex) ? ' (over budget)' : ''}` },
        ]} />
      <Typography role="note" variant="body2" sx={{ mt: 1, color: over.length ? 'error.main' : 'text.secondary' }}>
        {over.length
          ? <>⚠ Forecast over budget: {over.map((b) => `${b.name} (${formatMoney(b.forecast)} forecast vs ${formatMoney(b.budget)} budget)`).join('; ')}. Their forecast bars are red.</>
          : 'Every forecast is within budget.'}
      </Typography>
    </>
  )
}

/** Tables scroll inside their card instead of pushing it wider on narrow screens. */
const TableScroll = ({ children }) => <Box sx={{ overflowX: 'auto', mx: -2, px: 2 }}>{children}</Box>

function Milestones({ title, items, tone }) {
  return (
    <>
      <Typography variant="subtitle2" component="h3" sx={{ color: tone }}>{title} ({items.length})</Typography>
      {items.length ? (
        <List dense disablePadding>
          {items.slice(0, 6).map((m) => (
            <ListItem key={m.id} disableGutters>
              <ListItemText primary={m.name} secondary={<>{projectLink(m.project, 'milestones')} · due {formatDate(m.end_date)}</>} />
              <StatusChip status={m.status} />
            </ListItem>
          ))}
        </List>
      ) : <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>None</Typography>}
    </>
  )
}

/** Q2 first: how many projects are at risk and why, then the at-risk list with each project's reasons as badges. */
function Risk({ atRisk }) {
  const id = useId()
  const counts = [['At-risk projects', atRisk.length],
    ...Object.entries(RISK_LABELS).map(([code, label]) => [label, atRisk.filter((p) => p.reasons.includes(code)).length])]
  return (
    <Box component="section" aria-labelledby={id}>
      <Typography id={id} variant="h3" component="h2" sx={{ mb: 1.5 }}>Risk</Typography>
      <Box component="ul" aria-label="At-risk projects by reason" sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2,
        listStyle: 'none', p: 0, m: 0, mb: 2 }}>
        {counts.map(([label, count], i) => (
          <Reveal as="li" key={label} index={i}>
            <StatTile label={label} value={count} tone={count ? 'warning' : undefined} icon={RISK_ICONS[i]} />
          </Reveal>
        ))}
      </Box>
      <Section question="Which projects are at risk of missing their deadlines?">
        {atRisk.length ? (
          <List disablePadding>
            {atRisk.map((p) => (
              <ListItem key={p.id} disableGutters sx={{ display: 'block' }}>
                <Typography variant="subtitle2">{projectLink(p)}</Typography>
                <RiskBadges reasons={p.reasons} />
              </ListItem>
            ))}
          </List>
        ) : <EmptyState title="Nothing at risk" description="Every visible project is on track." />}
      </Section>
    </Box>
  )
}

/** Narrows the project widgets and the people lists to one department; the choice lives in ?department=. */
function DepartmentFilter({ value, onChange }) {
  const departments = useDepartments()
  const items = departments.data?.items ?? []
  if (!items.length) return null
  return (
    <TextField select size="small" label="Department" value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 220, width: { xs: '100%', sm: 'auto' } }}
      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
      <MenuItem value="">All departments</MenuItem>
      {items.map((d) => <MenuItem key={d.id} value={String(d.id)}>{d.name}</MenuItem>)}
    </TextField>
  )
}

/** The delivery dashboard. Role homes reuse it: `intro` sits under the page title (an admin's control centre), `top` is
 * pinned above Risk (a manager's approvals queue) and `approvalsButton` can go when that queue is already on the page. */
export default function DashboardPage({ title, subtitle = 'Live view of delivery health. Refreshes every 30 seconds.', intro,
  top, approvalsButton = true }) {
  const { user } = useSession()
  const approver = can(user, 'approvals.view')
  const [params, setParams] = useSearchParams()
  const department = params.get('department') ?? ''
  const dashboard = useDashboard(department)
  const allocations = useAllocations(mondayOf(new Date()), approver)
  const pickDepartment = (id) => setParams(id ? { department: id } : {}, { replace: true })

  if (dashboard.isLoading) {
    return <Grid container spacing={2}>{[0, 1, 2, 3].map((i) => <Grid key={i} size={{ xs: 12, md: 6 }}><Skeleton variant="rounded" height={220} /></Grid>)}</Grid>
  }
  if (dashboard.error) return <ErrorAlert error={dashboard.error} onRetry={() => dashboard.refetch()} />
  const d = dashboard.data
  const active = d.projects.filter((p) => p.status === 'active')
  // Managers and admins chase empty timesheets in their scope (the server answers 403 to anyone else).
  const chasesTimesheets = user.role === 'manager' || user.role === 'admin'
  const heading = title ?? `Hello, ${user.first_name}`
  const busiest = [...(allocations.data ?? [])].filter((r) => !department || String(r.user.department_id) === department).sort((a, b) => b.utilization_pct - a.utilization_pct).slice(0, 6)

  return (
    <>
      <PrintHeader title={title ?? 'Delivery dashboard'} />
      <PageHeader title={heading} subtitle={subtitle} actions={<><EmailReportButton dashboard={d} department={department} /><PrintButton /></>} />
      {intro}
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap role="toolbar" aria-label="Dashboard filters"
        sx={{ gap: 1.5, mt: -1.5, mb: 3, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}>
        <DepartmentFilter value={department} onChange={pickDepartment} />
        {approvalsButton && approver && d.pending_approvals ? (
          <Button component={RouterLink} to="/approvals" variant="contained" color="warning">
            {d.pending_approvals} waiting for your approval
          </Button>) : null}
      </Stack>
      <Grid container spacing={2}>
        {top ? <Grid size={12}>{top}</Grid> : null}
        <Grid size={12}>
          <Risk atRisk={d.at_risk} />
        </Grid>

        <Grid size={12}>
          <SmartInsightsPanel department={department} />
        </Grid>

        <Grid size={12}>
          <Section question="What is the status of each active project?">
            <Grid container spacing={2} sx={{ mb: 2 }}>
              {Object.entries(d.status_counts).map(([status, count], i) => (
                <Grid key={status} size={{ xs: 6, md: 3 }}>
                  <Reveal index={i}><StatTile label={STATUS[status].label} value={count} icon={STATUS_ICONS[status]} /></Reveal>
                </Grid>
              ))}
            </Grid>
            {active.length ? (
              <TableScroll><Table size="small" aria-label="Active projects">
                <TableHead><TableRow><TableCell>Project</TableCell><TableCell>Progress (weighted by difficulty)</TableCell>
                  <TableCell>Budget used</TableCell><TableCell>Due</TableCell></TableRow></TableHead>
                <TableBody>
                  {active.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{projectLink(p)}</TableCell>
                      <TableCell sx={{ minWidth: 140 }}>
                        <LinearProgress variant="determinate" value={Math.min(p.progress_pct, 100)} sx={{ height: 6, borderRadius: 3 }}
                          aria-label={`${p.name} progress`} />
                        <Typography variant="caption">{formatPct(p.progress_pct)}</Typography>
                      </TableCell>
                      <TableCell>{formatPct(p.budget_pct)}</TableCell>
                      <TableCell>{formatDate(p.predicted_end_date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table></TableScroll>
            ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>No active projects right now.</Typography>}
          </Section>
        </Grid>

        <Grid size={12}><LiveActivityCard department={department} /></Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Section question="Which team members are over-allocated across multiple projects?" hint="More than 40 logged hours this week">
            {d.over_allocated.length ? (
              <List dense disablePadding>
                {d.over_allocated.map((o) => (
                  <ListItem key={o.user.id} disableGutters
                    secondaryAction={<Chip color="warning" size="small" label={formatHours(o.week_logged_total)} />}>
                    <ListItemText primary={<PersonWithAvatar person={o.user} context={MANAGED} />} />
                  </ListItem>
                ))}
              </List>
            ) : <EmptyState title="Nobody is over 40 hours" />}
          </Section>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Section question="How are resources allocated across projects?"
            action={approver ? <Link component={RouterLink} to="/allocation">Full view</Link> : null}>
            {approver ? (busiest.length ? (
              <TableScroll><Table size="small" aria-label="Busiest people this week">
                <TableHead><TableRow><TableCell>Person</TableCell><TableCell align="right">Planned</TableCell>
                  <TableCell align="right">Logged</TableCell><TableCell align="right">Utilization</TableCell></TableRow></TableHead>
                <TableBody>
                  {busiest.map((r) => (
                    <TableRow key={r.user.id}>
                      <TableCell><PersonWithAvatar person={r.user} context={MANAGED} /></TableCell><TableCell align="right">{formatHours(r.planned_total)}</TableCell>
                      <TableCell align="right">{formatHours(r.logged_total)}</TableCell>
                      <TableCell align="right" sx={{ color: r.utilization_pct > 100 ? 'warning.main' : undefined }}>{formatPct(r.utilization_pct)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table></TableScroll>
            ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>No allocations yet.</Typography>) : (
              <Typography variant="body2">Your own planned and logged hours are on <Link component={RouterLink} to="/timesheet">My timesheet</Link>.</Typography>
            )}
          </Section>
        </Grid>

        {chasesTimesheets ? (
          <Grid size={12}>
            <MissingTimesheets department={department} />
          </Grid>
        ) : null}

        <Grid size={{ xs: 12, lg: 6 }}>
          <Section question="What are the key deliverables and their completion status?">
            <Milestones title="Overdue" items={d.milestones.overdue} tone="error.main" />
            <Milestones title="Due in the next 14 days" items={d.milestones.due_soon} />
          </Section>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Section question="What is the dependency chain between deliverables?" hint="Each project's timeline shows what waits on what.">
            <Stack sx={{ gap: 1 }}>
              {d.projects.filter((p) => p.status !== 'completed').map((p) => (
                <Stack key={p.id} direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2">{p.name}</Typography>
                  <Link component={RouterLink} to={`/projects/${p.id}?tab=milestones`} aria-label={`${p.name} timeline`}>Timeline</Link>
                </Stack>
              ))}
            </Stack>
          </Section>
        </Grid>

        <Grid size={12}>
          <Section question="How much budget has been consumed versus planned for each project?"
            hint="Consumed counts approved hours; the forecast projects the last 4 weeks' pace to the end date.">
            {d.budgets.length ? <BudgetChart budgets={d.budgets} /> : <EmptyState title="No budgets yet" />}
          </Section>
        </Grid>
      </Grid>
    </>
  )
}
