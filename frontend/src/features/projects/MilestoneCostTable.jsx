import { Box, Paper, Skeleton, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useMilestoneCosts } from '../../api/queries.js'
import DataTable from '../../components/DataTable.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import ExportCsvButton from '../../components/ExportCsvButton.jsx'
import FootNote from '../../components/FootNote.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { STATUS } from '../../app/theme.js'
import { chartPalette } from '../../app/chartColors.js'
import { num } from '../../lib/csv.js'
import { PRIORITY } from '../../lib/labels.js'
import { formatDate, formatHours, formatMoney, formatPct, nyTodayIso } from '../../lib/format.js'

const pctText = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : formatPct(v))
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'

/** The CSV mirrors the table, total row included; hours only when the viewer sees them on screen. */
function csvColumns(showHours) {
  return [
    { header: 'Milestone', value: (r) => r.milestone?.name ?? 'Total (consumed)' },
    { header: 'Status', value: (r) => (r.milestone ? STATUS[r.milestone.status]?.label ?? r.milestone.status : '') },
    { header: 'Priority', value: (r) => (r.milestone ? PRIORITY[r.milestone.priority] ?? '' : '') },
    ...(showHours ? [{ header: 'Approved hours', value: (r) => num(r.approved_hours) },
      { header: 'Pending hours', value: (r) => num(r.pending_hours) }] : []),
    { header: 'Approved cost (USD)', value: (r) => num(r.approved_cost) },
    { header: 'Share of budget (%)', value: (r) => num(r.budget_pct) },
  ]
}

/** A thin bar under the cost: the costliest milestone fills it, the others are relative. The percent is its own cell. */
function ShareBar({ pct, max, label }) {
  const palette = chartPalette(useTheme())
  const value = Number.isFinite(Number(pct)) ? Number(pct) : 0
  return (
    <Box role="meter" aria-label={label} aria-valuenow={Math.round(value * 10) / 10} aria-valuemin={0} aria-valuemax={max}
      aria-valuetext={formatPct(value)}
      sx={{ position: 'relative', height: 6, mt: 0.5, ml: 'auto', maxWidth: 120, minWidth: 80, borderRadius: 3, bgcolor: palette.track, overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', inset: 0, right: 'auto', width: `${Math.min(Math.max((value / max) * 100, 0), 100)}%`,
        minWidth: value > 0 ? 3 : 0, bgcolor: palette.ok, borderRadius: '0 3px 3px 0' }} />
    </Box>
  )
}

/** Approved cost per milestone. The server's total is the project's Consumed figure, so the two always agree.
 * Hours columns only appear for the project's manager and admins (team hours are private). Never shows a rate. */
export default function MilestoneCostTable({ project }) {
  const costs = useMilestoneCosts(project.id)
  if (costs.error) return <ErrorAlert error={costs.error} onRetry={() => costs.refetch()} />
  if (costs.isLoading) return <Skeleton variant="rounded" height={160} />
  const { items, total, hours_visible: showHours } = costs.data
  if (!items.length) return null
  const maxPct = Math.max(0.1, ...items.map((r) => Number(r.budget_pct) || 0))   // the costliest milestone fills its bar
  const costCell = (r) => (
    <>{formatMoney(r.approved_cost)}<ShareBar pct={r.budget_pct} max={maxPct} label={`${r.milestone.name} share of budget`} /></>)
  const hoursCols = showHours ? [
    { key: 'approved_hours', header: 'Approved hours', align: 'right', render: (r) => formatHours(r.approved_hours) },
    { key: 'pending_hours', header: 'Pending hours', align: 'right', render: (r) => formatHours(r.pending_hours) }] : []
  const columns = [
    { key: 'milestone', header: 'Milestone', rowHeader: true, render: (r) => <>{r.milestone.name} <StatusChip status={r.milestone.status} size="small" /></> },
    ...hoursCols,
    { key: 'approved_cost', header: 'Approved cost', align: 'right', render: costCell },
    { key: 'share', header: 'Share of project budget', align: 'right', render: (r) => pctText(r.budget_pct) },
  ]
  const totalRow = { milestone: 'Total', approved_hours: formatHours(total.approved_hours), pending_hours: formatHours(total.pending_hours),
    approved_cost: formatMoney(total.approved_cost), share: pctText(total.budget_pct) }
  const renderCard = (r) => (
    <>
      <Typography component="div" sx={{ fontWeight: 600, mb: 0.5 }}>{r.milestone.name} <StatusChip status={r.milestone.status} size="small" /></Typography>
      {[...hoursCols, columns.at(-2), columns.at(-1)].map((c) => (
        <Stack key={c.key} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, py: 0.25 }}>
          <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{c.header}:</Typography>
          <Typography variant="body2" component="span" sx={{ textAlign: 'right' }}>{c.render(r)}</Typography>
        </Stack>
      ))}
    </>
  )
  return (
    <Paper variant="outlined" component="section">
      <Stack direction="row" sx={{ px: 2, pt: 2, gap: 1, justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h3" component="h2">Cost by milestone</Typography>
        <ExportCsvButton name={`${slug(project.name)}-milestone-costs`} columns={csvColumns(showHours)} rows={[...items, total]} />
      </Stack>
      <Box sx={{ px: { xs: 2, md: 0 }, pt: 1, '& td, & th': { fontVariantNumeric: 'tabular-nums' } }}>
        <DataTable ariaLabel={`Cost by milestone on ${project.name}`} columns={columns} rows={items}
          getRowId={(r) => r.milestone.id} totalRow={totalRow} renderCard={renderCard} />
      </Box>
      <Box sx={{ px: 2, pb: 1.5 }}>
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', pt: 1 }}>
          Bars compare the milestones; the percent is each one's share of the budget.
        </Typography>
        <FootNote note="Displayed costs are rounded; totals use underlying values. Approved spend uses the rate saved at approval. Pending entries remain uncosted until approved."
          end={`As of ${formatDate(nyTodayIso())}`} />
      </Box>
    </Paper>
  )
}
