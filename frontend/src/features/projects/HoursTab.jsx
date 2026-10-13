import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import {
  IconButton, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { useState } from 'react'
import { useAllocations } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { addDays, formatDate, formatHours, mondayOf } from '../../lib/format.js'

/** Planned vs. logged vs. approved hours per person on this project, for one week. */
export default function HoursTab({ project, manage }) {
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const allocations = useAllocations(week, manage)
  if (!manage) {
    return <EmptyState title="Team hours are private" description="Only the project's manager and admins see everyone's hours. Your own hours are on My timesheet." />
  }
  const rows = (allocations.data ?? []).flatMap((person) => person.projects
    .filter((p) => String(p.id) === String(project.id))
    .map((p) => ({ person: person.user, planned: Number(p.planned), logged: Number(p.logged), approved: Number(p.approved) })))

  return (
    <Stack sx={{ gap: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <IconButton aria-label="Previous week" onClick={() => setWeek((w) => addDays(w, -7))}><ChevronLeft /></IconButton>
        <Typography variant="subtitle1" component="p">Week of {formatDate(week)}</Typography>
        <IconButton aria-label="Next week" onClick={() => setWeek((w) => addDays(w, 7))}><ChevronRight /></IconButton>
      </Stack>
      <ErrorAlert error={allocations.error} onRetry={() => allocations.refetch()} />
      {allocations.isLoading ? <Skeleton variant="rounded" height={160} /> : null}
      {!allocations.isLoading && rows.length === 0 ? <EmptyState title="No hours this week" description="Hours appear as the team logs them." /> : null}
      {rows.length ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label={`Hours on ${project.name}`}>
            <TableHead>
              <TableRow>
                <TableCell>Person</TableCell><TableCell align="right">Planned / week</TableCell><TableCell align="right">Logged</TableCell>
                <TableCell align="right">Approved</TableCell><TableCell align="right">Pending</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.person.id}>
                  <TableCell component="th" scope="row">{r.person.name}</TableCell>
                  <TableCell align="right">{formatHours(r.planned)}</TableCell>
                  <TableCell align="right" sx={{ color: r.logged > r.planned ? 'warning.main' : undefined }}>{formatHours(r.logged)}</TableCell>
                  <TableCell align="right">{formatHours(r.approved)}</TableCell>
                  <TableCell align="right">{formatHours(r.logged - r.approved)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </Stack>
  )
}
