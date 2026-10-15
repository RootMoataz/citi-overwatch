import { Grid, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import { BarChart } from '@mui/x-charts/BarChart'
import { useProjectSummary } from '../../api/queries.js'
import { BRAND } from '../../app/theme.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatMoney, formatPct } from '../../lib/format.js'
import MilestoneCostTable from './MilestoneCostTable.jsx'
import StatTile from './StatTile.jsx'

// Planned is a light steel blue, consumed the brand blue (red once it passes the budget).
const BAR_COLORS = { planned: '#9DB6D3', consumed: BRAND, over: '#B3261E' }
const compactMoney = (v) => `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}`

export default function BudgetTab({ project }) {
  const summary = useProjectSummary(project.id)
  if (summary.error) return <ErrorAlert error={summary.error} onRetry={() => summary.refetch()} />
  const s = summary.data ?? { budget: project.budget, consumed: project.consumed, remaining: project.budget - project.consumed,
    budget_pct: project.budget_pct }
  const over = s.remaining < 0
  return (
    <Stack sx={{ gap: 3 }}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Planned budget" value={formatMoney(s.budget)} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Consumed (approved hours)" value={formatMoney(s.consumed)} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><StatTile label="Remaining" tone={over ? 'error' : undefined}
          value={`${formatMoney(Math.abs(s.remaining))} ${over ? 'over' : 'remaining'}`} /></Grid>
      </Grid>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" component="h2">{formatPct(s.budget_pct)} of the budget used</Typography>
        <LinearProgress variant="determinate" value={Math.min(s.budget_pct, 100)} color={over ? 'error' : 'primary'}
          sx={{ height: 10, borderRadius: 5, my: 2 }} aria-label="Budget used" />
        <BarChart height={200} layout="horizontal"
          yAxis={[{ scaleType: 'band', data: ['Planned budget', 'Consumed'], width: 120 }]}
          xAxis={[{ tickNumber: 6, valueFormatter: (v, ctx) => (ctx.location === 'tick' ? compactMoney(v) : formatMoney(v)) }]}
          series={[{ data: [Number(s.budget), Number(s.consumed)], label: 'Amount', valueFormatter: (v) => formatMoney(v),
            colorGetter: ({ dataIndex }) => BAR_COLORS[dataIndex === 0 ? 'planned' : over ? 'over' : 'consumed'] }]}
          hideLegend margin={{ right: 32 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Consumed counts approved hours only, at each person's hourly rate (salary ÷ 2,080) when the hours were approved.
        </Typography>
      </Paper>
      <MilestoneCostTable project={project} />
    </Stack>
  )
}
