import { Grid, Paper, Stack, Typography } from '@mui/material'
import { useProjectSummary } from '../../api/queries.js'
import { TONE_TEXT } from '../../app/chartColors.js'
import BulletChart from '../../components/BulletChart.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { PrintButton, PrintHeader } from '../../components/PrintButton.jsx'
import { budgetRows, compactMoney, niceMax, ticksTo } from '../../lib/chartData.js'
import { formatMoney, formatPct } from '../../lib/format.js'
import MilestoneCostTable from './MilestoneCostTable.jsx'
import StatTile from '../../components/StatTile.jsx'

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
    <BulletChart ariaLabel={`${name}: consumed against budget`} max={max} ticks={ticksTo(max, step)} tickFormat={compactMoney}
      axisLabel="US dollars"
      legend={[{ kind: 'track', label: 'Budget' }, { kind: 'bar', tone: row.tone, label: 'Consumed (approved hours)' },
        { kind: 'marker', label: 'Forecast at end date' }]}
      rows={[{
        id: row.id, label: 'Consumed', tone: row.tone, track: row.budget, value: row.consumed, marker: row.forecast,
        valueText: `${formatMoney(row.consumed)} of ${formatMoney(row.budget)}`,
        detail: `Forecast at end date ${formatMoney(row.forecast)}${row.hasBudget ? ` (${formatPct(row.forecastPct)} of budget)` : ''}${note}`,
        summary: `Budget ${formatMoney(row.budget)}\nConsumed ${formatMoney(row.consumed)} (${formatPct(row.usedPct)})\nForecast at end date ${formatMoney(row.forecast)}${note}`,
      }]} />
  )
}

export default function BudgetTab({ project }) {
  const summary = useProjectSummary(project.id)
  if (summary.error) return <ErrorAlert error={summary.error} onRetry={() => summary.refetch()} />
  const s = summary.data ?? { budget: project.budget, consumed: project.consumed, remaining: project.budget - project.consumed,
    budget_pct: project.budget_pct }
  const over = s.remaining < 0
  const forecast = s.forecast ?? s.consumed
  const tone = budgetRows([{ id: 'p', name: project.name, budget: s.budget, consumed: s.consumed, forecast }])[0].tone
  return (
    <Stack sx={{ gap: 3 }}>
      <PrintHeader title={`${project.name}: budget`} />
      <Stack direction="row" data-print="hide" sx={{ justifyContent: 'flex-end', mb: -1 }}><PrintButton /></Stack>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Planned budget" value={Number(s.budget)} format={formatMoney} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Consumed (approved hours)" value={Number(s.consumed)} format={formatMoney} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Remaining" tone={over ? 'error' : undefined}
          value={`${formatMoney(Math.abs(s.remaining))} ${over ? 'over' : 'remaining'}`} /></Grid>
      </Grid>
      <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-labelledby="budget-used">
        <Typography id="budget-used" variant="h3" component="h2" sx={{ mb: 1.5 }}>
          <Typography component="span" variant="inherit" sx={{ color: TONE_TEXT[tone] }}>
            {tone === 'ok' ? '' : '⚠ '}{formatPct(s.budget_pct)}
          </Typography> of the budget used
        </Typography>
        <BudgetBullet name={project.name} budget={s.budget} consumed={s.consumed} forecast={forecast} />
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
          Consumed counts approved hours only, at each person's hourly rate (salary ÷ 2,080) when the hours were approved.
          The forecast carries the last 4 weeks' pace to the end date.
        </Typography>
      </Paper>
      <MilestoneCostTable project={project} />
    </Stack>
  )
}
