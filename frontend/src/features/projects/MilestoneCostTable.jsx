import { Box, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useMilestoneCosts } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import ExportCsvButton from '../../components/ExportCsvButton.jsx'
import FootNote from '../../components/FootNote.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { useTheme } from '@mui/material/styles'
import { STATUS } from '../../app/theme.js'
import { chartPalette } from '../../app/chartColors.js'
import { num } from '../../lib/csv.js'
import { PRIORITY } from '../../lib/labels.js'
import { formatDate, formatHours, formatMoney, formatPct, nyTodayIso } from '../../lib/format.js'

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
  const value = Number(pct ?? 0)
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
  const bold = { fontWeight: 700 }
  const maxPct = Math.max(0.1, ...items.map((r) => Number(r.budget_pct ?? 0)))   // the costliest milestone fills its bar
  return (
    <TableContainer component={Paper} variant="outlined">
      <Stack direction="row" sx={{ px: 2, pt: 2, gap: 1, justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h3" component="h2">Cost by milestone</Typography>
        <ExportCsvButton name={`${slug(project.name)}-milestone-costs`} columns={csvColumns(showHours)} rows={[...items, total]} />
      </Stack>
      <Table size="small" aria-label={`Cost by milestone on ${project.name}`}
        sx={{ '& td, & th': { fontVariantNumeric: 'tabular-nums' }, '& tbody tr:not([data-total-row]):nth-of-type(even)': { bgcolor: 'action.hover' } }}>
        <TableHead>
          <TableRow>
            <TableCell>Milestone</TableCell>
            {showHours ? <><TableCell align="right">Approved hours</TableCell><TableCell align="right">Pending hours</TableCell></> : null}
            <TableCell align="right">Approved cost</TableCell><TableCell align="right">Share of project budget</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((r) => (
            <TableRow key={r.milestone.id}>
              <TableCell component="th" scope="row">{r.milestone.name} <StatusChip status={r.milestone.status} size="small" /></TableCell>
              {showHours ? <><TableCell align="right">{formatHours(r.approved_hours)}</TableCell>
                <TableCell align="right">{formatHours(r.pending_hours)}</TableCell></> : null}
              <TableCell align="right">{formatMoney(r.approved_cost)}
                <ShareBar pct={r.budget_pct} max={maxPct} label={`${r.milestone.name} share of budget`} /></TableCell>
              <TableCell align="right">{formatPct(r.budget_pct)}</TableCell>
            </TableRow>
          ))}
          <TableRow data-total-row sx={{ '& th, & td': { borderTop: 2, borderColor: 'divider', borderBottom: 0 } }}>
            <TableCell component="th" scope="row" sx={bold}>Total</TableCell>
            {showHours ? <><TableCell align="right" sx={bold}>{formatHours(total.approved_hours)}</TableCell>
              <TableCell align="right" sx={bold}>{formatHours(total.pending_hours)}</TableCell></> : null}
            <TableCell align="right" sx={bold}>{formatMoney(total.approved_cost)}</TableCell>
            <TableCell align="right" sx={{ ...bold, pr: 2 }}>{formatPct(total.budget_pct)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Box sx={{ px: 2, pb: 1.5 }}>
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', pt: 1 }}>
          Bars compare the milestones; the percent is each one's share of the budget.
        </Typography>
        <FootNote note="Displayed costs are rounded; totals use underlying values. Approved spend uses the rate saved at approval. Pending entries remain uncosted until approved."
          end={`As of ${formatDate(nyTodayIso())}`} />
      </Box>
    </TableContainer>
  )
}
