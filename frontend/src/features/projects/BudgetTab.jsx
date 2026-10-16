import { Alert, Link, Paper, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { useApprovals, useProjectSummary } from '../../api/queries.js'
import BulletChart from '../../components/BulletChart.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { PrintButton, PrintHeader } from '../../components/PrintButton.jsx'
import { budgetRows, compactMoney, niceMax, ticksTo } from '../../lib/chartData.js'
import { formatHours, formatMoney, formatPct } from '../../lib/format.js'
import { pendingHoursOf } from '../../lib/personWeeks.js'
import MilestoneCostTable from './MilestoneCostTable.jsx'
import KpiStrip from '../../components/KpiStrip.jsx'
import { BANNER_PROPS } from './pendingBanner.js'

/** A round dollar step giving about five ticks up to `max`. */
function moneyStep(max) {
  const raw = max / 5
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1))
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10
}

/** One bullet in dollars: the budget as the track, consumed as the bar, the forecast at the end date as the marker. */
function BudgetBullet({ name, budget, consumed, forecast }) {
  const [row] = budgetRows([{ id: 'project', name, budget, consumed, forecast }])
  const top = Math.max(row.budget, row.consumed, row.forecast, 1)
  const step = moneyStep(top)
  const max = niceMax(top, step)
  const note = row.tone === 'alert' ? ' · ⚠ over budget' : row.tone === 'warning' ? ' · ⚠ forecast over budget' : ''
  return (
    <BulletChart ariaLabel={`${name}: approved spend against budget`} max={max} ticks={ticksTo(max, step)} tickFormat={compactMoney}
      axisLabel="US dollars"
      legend={[{ kind: 'track', label: 'Budget' }, { kind: 'bar', tone: row.tone, label: 'Approved spend' },
        { kind: 'marker', label: 'Forecast at completion' }]}
      rows={[{
        id: row.id, label: 'Approved spend', tone: row.tone, track: row.budget, value: row.consumed, marker: row.forecast,
        valueText: `${formatMoney(row.consumed)} of ${formatMoney(row.budget)}`,
        detail: `Forecast at completion ${formatMoney(row.forecast)}${row.hasBudget ? ` (${formatPct(row.forecastPct)} of budget)` : ''}${note}`,
        summary: `Budget ${formatMoney(row.budget)}\nApproved spend ${formatMoney(row.consumed)} (${formatPct(row.usedPct)})\nForecast at completion ${formatMoney(row.forecast)}${note}`,
      }]} />
  )
}

export default function BudgetTab({ project, view }) {
  const summary = useProjectSummary(project.id)
  const approvals = useApprovals({ project: project.id }, Boolean(view?.decides))
  const pending = approvals.data ?? []
  const pendingHours = pendingHoursOf(pending)
  const s = summary.data ?? { budget: project.budget, consumed: project.consumed, remaining: project.budget - project.consumed,
    budget_pct: project.budget_pct }
  const budget = Number(s.budget)
  const consumed = Number(s.consumed)
  const remaining = Number(s.remaining)
  const forecast = s.forecast != null ? Number(s.forecast) : consumed
  const [row] = budgetRows([{ id: 'p', name: project.name, budget, consumed, forecast }])
  const items = [
    { key: 'budget', label: 'Budget', value: formatMoney(budget) },
    { key: 'spend', label: 'Approved spend', value: formatMoney(consumed), hint: row.hasBudget ? `${formatPct(row.usedPct)} of budget used` : undefined },
    { key: 'available', label: 'Available budget', value: remaining < 0 ? `${formatMoney(-remaining)} over budget` : formatMoney(remaining),
      tone: remaining < 0 ? 'error' : undefined },
    { key: 'forecast', label: 'Forecast at completion', value: formatMoney(forecast),
      tone: row.hasBudget && forecast > budget ? 'warning' : undefined,
      hint: row.hasBudget && forecast > budget ? '⚠ Over budget' : undefined },
  ]
  return (
    <Stack sx={{ gap: 3 }}>
      <PrintHeader title={`${project.name}: budget`} />
      <KpiStrip ariaLabel="Budget figures" items={items} loading={summary.isLoading} error={summary.error}
        onRetry={() => summary.refetch()} />
      {pending.length ? (
        // The link sits on the message's line (Alert puts its action higher than the text by default).
        <Alert severity="info" variant="outlined" data-print="hide" {...BANNER_PROPS}
          action={<Link component={RouterLink} to={`/timesheets?project=${project.id}`} underline="hover" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Review pending hours →</Link>}>
          {`${formatHours(pendingHours)} awaiting approval · Not yet included in spend.`}
        </Alert>
      ) : null}
      {summary.error ? null : (
        <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-labelledby="budget-spend">
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            <div>
              <Typography id="budget-spend" variant="h3" component="h2">Spend and forecast</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {row.hasBudget ? `${formatPct(row.usedPct)} approved spend · ${formatPct(row.forecastPct)} forecast` : '— approved spend · — forecast'}
              </Typography>
            </div>
            <span data-print="hide"><PrintButton /></span>
          </Stack>
          <BudgetBullet name={project.name} budget={budget} consumed={consumed} forecast={forecast} />
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
            Forecast projects the last 4 weeks of approved spending to the project end date.
          </Typography>
        </Paper>
      )}
      <MilestoneCostTable project={project} />
    </Stack>
  )
}
