import { Alert, Box, Skeleton, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material'
import { useBreakdown } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatMoney, formatPct } from '../../lib/format.js'

const exact = (v) => formatMoney(v, { exact: true })

/** What approving this request does to the project's budget, plus the spend forecast (spec §3.7). */
export default function BreakdownPanel({ entryId }) {
  const breakdown = useBreakdown(entryId)
  if (breakdown.isLoading) return <Skeleton variant="rounded" height={160} />
  if (breakdown.error) return <ErrorAlert error={breakdown.error} onRetry={() => breakdown.refetch()} />
  const b = breakdown.data
  const rows = [
    // Managers get the cost only; an hourly rate would reveal the person's salary (admins see it).
    ['This request', exact(b.request_cost), b.hourly_rate == null ? `${b.hours}h logged` : `${b.hours}h × ${exact(b.hourly_rate)}/h`],
    ['Milestone cost so far', `${exact(b.milestone_cost)} → ${exact(b.milestone_cost_after)}`],
    ['Project budget remaining', `${exact(b.remaining_before)} → ${exact(b.remaining_after)}`, `of ${exact(b.budget)}`],
    ['Share of remaining budget', b.pct_of_remaining == null ? 'No budget left' : formatPct(b.pct_of_remaining)],
    ['Projected total', `${exact(b.forecast)} of ${exact(b.budget)}`,
      `Last 4 weeks' average spend × ${b.weeks_remaining} weeks left`],
  ]
  return (
    <Box>
      {b.forecast_over_budget ? (
        <Alert severity="warning" role="alert" sx={{ mb: 1 }}>
          Projected to go over budget by {exact(b.forecast - b.budget)} at the current pace.
        </Alert>
      ) : null}
      <Table size="small" aria-label="Budget impact of approving">
        <TableBody>
          {rows.map(([label, value, hint]) => (
            <TableRow key={label}>
              <TableCell component="th" scope="row" sx={{ color: 'text.secondary', width: '45%' }}>{label}</TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
                {hint ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>{hint}</Typography> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}
