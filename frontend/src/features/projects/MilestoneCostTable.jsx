import { Paper, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { useMilestoneCosts } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatHours, formatMoney, formatPct } from '../../lib/format.js'

/** Approved cost per milestone. The server's total is the project's Consumed figure, so the two always agree.
 * Hours columns only appear for the project's manager and admins (team hours are private). Never shows a rate. */
export default function MilestoneCostTable({ project }) {
  const costs = useMilestoneCosts(project.id)
  if (costs.error) return <ErrorAlert error={costs.error} onRetry={() => costs.refetch()} />
  if (costs.isLoading) return <Skeleton variant="rounded" height={160} />
  const { items, total, hours_visible: showHours } = costs.data
  if (!items.length) return null
  const bold = { fontWeight: 700 }
  return (
    <TableContainer component={Paper} variant="outlined">
      <Typography variant="h3" component="h2" sx={{ px: 2, pt: 2 }}>Cost by milestone</Typography>
      <Table size="small" aria-label={`Cost by milestone on ${project.name}`}>
        <TableHead>
          <TableRow>
            <TableCell>Milestone</TableCell>
            {showHours ? <><TableCell align="right">Approved hours</TableCell><TableCell align="right">Pending hours</TableCell></> : null}
            <TableCell align="right">Approved cost</TableCell><TableCell align="right">Share of budget</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((r) => (
            <TableRow key={r.milestone.id}>
              <TableCell component="th" scope="row">{r.milestone.name} <StatusChip status={r.milestone.status} size="small" /></TableCell>
              {showHours ? <><TableCell align="right">{formatHours(r.approved_hours)}</TableCell>
                <TableCell align="right">{formatHours(r.pending_hours)}</TableCell></> : null}
              <TableCell align="right">{formatMoney(r.approved_cost)}</TableCell>
              <TableCell align="right">{formatPct(r.budget_pct)}</TableCell>
            </TableRow>
          ))}
          <TableRow data-total-row>
            <TableCell component="th" scope="row" sx={bold}>Total (consumed)</TableCell>
            {showHours ? <><TableCell align="right" sx={bold}>{formatHours(total.approved_hours)}</TableCell>
              <TableCell align="right" sx={bold}>{formatHours(total.pending_hours)}</TableCell></> : null}
            <TableCell align="right" sx={bold}>{formatMoney(total.approved_cost)}</TableCell>
            <TableCell align="right" sx={bold}>{formatPct(total.budget_pct)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', px: 2, py: 1 }}>
        Approved cost uses each person's rate when their hours were approved. Pending hours cost nothing until approved.
        {showHours ? null : ' Only the project’s manager and admins see the hours.'}
      </Typography>
    </TableContainer>
  )
}
