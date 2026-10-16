import {
  Box, Button, Chip, Grid, Link, List, ListItem, ListItemText, MenuItem, Skeleton, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import PanTool from '@mui/icons-material/PanToolOutlined'
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
import { STATUS } from '../../app/theme.js'
import BulletChart from '../../components/BulletChart.jsx'
import DataBar from '../../components/DataBar.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import PriorityChip from '../../components/PriorityChip.jsx'
import { PrintButton, PrintHeader } from '../../components/PrintButton.jsx'
import RiskBadges from '../../components/RiskBadges.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, formatHours, formatMoney, formatPct, mondayOf } from '../../lib/format.js'
import { budgetRows, budgetTone, niceMax, ticksTo, utilizationTone } from '../../lib/chartData.js'
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
const RISK_ICONS = [<WarningAmber key="all" />, <EventBusy key="a" />, <HourglassBottom key="b" />, <TrendingUp key="c" />,
  <PanTool key="d" />]
const STATUS_ICONS = { planned: <EventNote />, active: <PlayCircle />, on_hold: <PauseCircle />, completed: <CheckCircle /> }

const projectLink = (p, tab) => (
  <Link component={RouterLink} to={`/projects/${p.id}${tab ? `?tab=${tab}` : ''}`} underline="hover">{p.name}</Link>
)

// The over-40h and busiest lists only hold the viewer's own people (the server scopes them).
const MANAGED = { managed: true }
const NUM = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

/** Q7: consumed vs budget per project as bullets on a shared "% of budget" scale, so a $250K project doesn't dwarf a
 * $60K one. Budget is the track, consumed the bar, the forecast at the end date the ink marker; most used first.
 * Spent past the budget is red, a forecast past it amber, and both are named in the row and the note under the chart. */
function BudgetChart({ budgets }) {
  const rows = budgetRows(budgets)
  const over = rows.filter((r) => r.hasBudget && r.forecastPct > 100)
  const max = Math.min(niceMax(Math.max(100, ...rows.map((r) => Math.max(r.usedPct, r.forecastPct))), 25), 200)
  const status = (r) => (r.tone === 'alert' ? ' · ⚠ over budget' : r.tone === 'warning' ? ' · ⚠ forecast over budget' : '')
  return (
    <>
      <BulletChart ariaLabel="Budget used per project" max={max} ticks={ticksTo(max, max > 100 ? 50 : 25)}
        tickFormat={(v) => `${v}%`} axisLabel="Share of budget (100% = the whole budget)"
        legend={[{ kind: 'track', label: 'Budget' }, { kind: 'bar', label: 'Consumed (approved hours)' },
          { kind: 'marker', label: 'Forecast at end date' },
          ...(rows.some((r) => r.tone === 'warning') ? [{ kind: 'bar', tone: 'warning', label: 'Forecast over budget' }] : []),
          ...(rows.some((r) => r.tone === 'alert') ? [{ kind: 'bar', tone: 'alert', label: 'Over budget' }] : [])]}
        rows={rows.map((r) => ({
          id: r.id, label: r.name, href: `/projects/${r.id}?tab=budget`, tone: r.tone,
          track: r.hasBudget ? 100 : null, value: r.hasBudget ? r.usedPct : null, marker: r.hasBudget ? r.forecastPct : null,
          valueText: r.hasBudget ? `${formatPct(r.usedPct)} used` : 'No budget',
          detail: r.hasBudget
            ? `${formatMoney(r.consumed)} of ${formatMoney(r.budget)} · forecast ${formatMoney(r.forecast)} (${formatPct(r.forecastPct)})${status(r)}`
            : `${formatMoney(r.consumed)} consumed, no budget set`,
          summary: r.hasBudget
            ? `${r.name}\nBudget ${formatMoney(r.budget)}\nConsumed ${formatMoney(r.consumed)} (${formatPct(r.usedPct)})\nForecast at end date ${formatMoney(r.forecast)} (${formatPct(r.forecastPct)})${status(r)}`
            : `${r.name}\nNo budget set\nConsumed ${formatMoney(r.consumed)}`,
        }))} />
      <Typography role="note" variant="body2" sx={{ mt: 1.5, color: over.length ? 'error.main' : 'text.secondary' }}>
        {over.length
          ? <>⚠ Forecast over budget: {over.map((r) => `${r.name} (${formatMoney(r.forecast)} forecast vs ${formatMoney(r.budget)} budget)`).join('; ')}.</>
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
              <PriorityChip priority={m.priority} hideDefault sx={{ mr: 0.75, flexShrink: 0 }} />
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
    ...Object.entries(RISK_LABELS).map(([code, label]) => [label, code === 'BLOCKED_MILESTONE'
      // Kicked-back milestones are counted one by one, not by project.
      ? atRisk.reduce((n, p) => n + (p.blocked_count ?? 0), 0)
      : atRisk.filter((p) => p.reasons.includes(code)).length])]
  return (
    <Box component="section" aria-labelledby={id}>
      <Typography id={id} variant="h3" component="h2" sx={{ mb: 1.5 }}>Risk</Typography>
      {/* Two columns on phones; from md as many 160 px tiles as fit, wrapping onto a second row (five fixed columns ran
          past the window at 900-970 px with the sidebar open). minmax(0, …) keeps a tile's text from widening its column. */}
      <Box component="ul" aria-label="At-risk projects by reason" sx={{ display: 'grid', gap: 2,
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(auto-fit, minmax(160px, 1fr))' },
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
                <RiskBadges reasons={p.reasons} counts={{ BLOCKED_MILESTONE: p.blocked_count }} />
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
          <Button component={RouterLink} to="/timesheets" variant="contained" color="warning">
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
                <TableHead><TableRow><TableCell>Project</TableCell><TableCell align="right">Progress (weighted by difficulty)</TableCell>
                  <TableCell align="right">Budget used</TableCell><TableCell align="right">Due</TableCell></TableRow></TableHead>
                <TableBody>
                  {active.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{projectLink(p)}</TableCell>
                      <TableCell align="right"><DataBar value={p.progress_pct} label={`${p.name} progress`} minWidth={100} /></TableCell>
                      <TableCell align="right"><DataBar value={p.budget_pct} tone={budgetTone(p.budget_pct)} label={`${p.name} budget used`} minWidth={100} /></TableCell>
                      <TableCell align="right" sx={NUM}>{formatDate(p.predicted_end_date)}</TableCell>
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
                  <TableCell align="right">Logged</TableCell><TableCell align="right">Utilization of 40h</TableCell></TableRow></TableHead>
                <TableBody>
                  {busiest.map((r) => (
                    <TableRow key={r.user.id}>
                      <TableCell><PersonWithAvatar person={r.user} context={MANAGED} /></TableCell>
                      <TableCell align="right" sx={NUM}>{formatHours(r.planned_total)}</TableCell>
                      <TableCell align="right" sx={NUM}>{formatHours(r.logged_total)}</TableCell>
                      <TableCell align="right"><DataBar value={r.utilization_pct} tone={utilizationTone(r.utilization_pct)}
                        label={`${r.user.name} utilization`} minWidth={110} /></TableCell>
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
