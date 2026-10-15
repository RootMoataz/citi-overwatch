import { Box, MenuItem, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { useApprovedWeeks } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import ExportCsvButton from '../../components/ExportCsvButton.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { num } from '../../lib/csv.js'
import { addDays, formatDate, formatHours, formatMoney, mondayOf } from '../../lib/format.js'
import { HR_CHANGED } from '../../lib/labels.js'
import { can } from '../../lib/permissions.js'

const SPANS = [4, 8, 13, 26] // weeks back, this week included

/** Where an approved week stands with HR: sent, partly sent, changed since it was sent, or not sent yet. */
function hrStatus(week) {
  if (week.hr_changed_count) return { status: 'on_hold', label: HR_CHANGED }
  if (week.hr_submitted) return { status: 'completed', label: 'Submitted to HR' }
  if (week.hr_submitted_count) return { status: 'pending', label: 'Partly submitted to HR' }
  return { status: 'planned', label: 'Not yet sent to HR' }
}

const range = (weeks) => {
  const monday = mondayOf()
  return { from: addDays(monday, -7 * (weeks - 1)), to: addDays(monday, 6) }
}

/** Approved hours per person and week: the viewer's people (all people for admins), with their HR status. */
export default function ApprovedTab() {
  const { user } = useSession()
  const admin = can(user, 'hr.submit')
  const [span, setSpan] = useState(8)
  const weeks = useApprovedWeeks(range(span))
  const rows = weeks.data ?? []
  const columns = [
    { header: 'Person', value: (w) => w.user.name },
    { header: 'Username', value: (w) => w.user.username },
    { header: 'Week of', value: (w) => w.week_start },
    { header: 'Hours', value: (w) => num(w.hours) },
    { header: 'Entries', value: (w) => w.entry_count },
    { header: 'Projects', value: (w) => w.projects.join('; ') },
    { header: 'HR status', value: (w) => hrStatus(w).label },
    ...(admin ? [{ header: 'Cost', value: (w) => num(w.cost) }] : []),
  ]
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, mb: 2, alignItems: { sm: 'center' } }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          {admin ? 'Approved hours of everyone, by week.' : 'Approved hours on the projects you manage, by week.'}
          {' '}Admins send them to HR for payroll.
        </Typography>
        <TextField select size="small" label="Show" value={span} onChange={(e) => setSpan(Number(e.target.value))} fullWidth={false} sx={{ width: 180, flexShrink: 0 }}>
          {SPANS.map((n) => <MenuItem key={n} value={n}>Last {n} weeks</MenuItem>)}
        </TextField>
        <ExportCsvButton name="approved-weeks" columns={columns} rows={rows} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }} />
      </Stack>
      <ErrorAlert error={weeks.error} onRetry={() => weeks.refetch()} sx={{ mb: 2 }} />
      {weeks.isLoading ? <Skeleton variant="rounded" height={200} /> : null}
      {!weeks.isLoading && !weeks.error && rows.length === 0 ? (
        <EmptyState title="No approved hours in these weeks" description="Hours you approve show up here, week by week." />
      ) : null}
      {rows.length ? (
        <Paper variant="outlined">
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Approved weeks">
              <TableHead>
                <TableRow>
                  <TableCell>Person</TableCell><TableCell>Week of</TableCell><TableCell align="right">Hours</TableCell>
                  <TableCell align="right">Entries</TableCell><TableCell>Projects</TableCell><TableCell>HR status</TableCell>
                  {admin ? <TableCell align="right">Cost</TableCell> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((w) => {
                  const hr = hrStatus(w)
                  return (
                    <TableRow key={`${w.user.id}|${w.week_start}`}>
                      <TableCell><PersonWithAvatar person={w.user} context={{ managed: true }} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(w.week_start)}</TableCell>
                      <TableCell align="right">{formatHours(w.hours)}</TableCell>
                      <TableCell align="right">{w.entry_count}</TableCell>
                      <TableCell>{w.projects.join(', ')}</TableCell>
                      <TableCell><StatusChip status={hr.status} label={hr.label} /></TableCell>
                      {admin ? <TableCell align="right">{formatMoney(w.cost, { exact: true })}</TableCell> : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      ) : null}
    </>
  )
}
