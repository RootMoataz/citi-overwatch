import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import {
  Card, CardContent, IconButton, LinearProgress, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from '@mui/material'
import { useMediaQuery } from 'react-responsive'
import { useSearchParams } from 'react-router-dom'
import { useAllocations } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import { addDays, formatDate, formatHours, formatPct, mondayOf } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import AllocationCharts from './AllocationCharts.jsx'

function Utilization({ value }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minWidth: 140 }}>
      <LinearProgress variant="determinate" value={Math.min(value, 100)} color={value > 100 ? 'warning' : 'primary'}
        sx={{ flexGrow: 1, height: 8, borderRadius: 4 }} aria-label="Utilization" />
      <Typography variant="body2" sx={{ minWidth: 52, textAlign: 'right', color: value > 100 ? 'warning.main' : undefined }}>
        {formatPct(value)}
      </Typography>
    </Stack>
  )
}

export default function AllocationPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [params, setParams] = useSearchParams()
  const week = params.get('week') ?? mondayOf(new Date())
  const allocations = useAllocations(week)
  const people = allocations.data ?? []
  const projects = [...new Map(people.flatMap((p) => p.projects).map((p) => [String(p.id), p])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
  const cell = (person, project) => person.projects.find((p) => String(p.id) === String(project.id))

  return (
    <>
      <PageHeader title="Allocation" subtitle="Planned vs. logged hours per person and project. Utilization = logged hours ÷ 40." />
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton aria-label="Previous week" onClick={() => setParams({ week: addDays(week, -7) })}><ChevronLeft /></IconButton>
        <Typography variant="subtitle1" component="p">Week of {formatDate(week)}</Typography>
        <IconButton aria-label="Next week" onClick={() => setParams({ week: addDays(week, 7) })}><ChevronRight /></IconButton>
      </Stack>
      <ErrorAlert error={allocations.error} onRetry={() => allocations.refetch()} sx={{ mb: 2 }} />
      {allocations.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
      {people.length ? <AllocationCharts people={people} /> : null}
      {!allocations.isLoading && !people.length ? <EmptyState title="Nobody to show" description="People appear once they're on a project you manage." /> : null}
      {people.length && desktop ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Allocation by person and project">
            <TableHead>
              <TableRow>
                <TableCell>Person</TableCell>
                {projects.map((p) => <TableCell key={p.id}>{p.name}</TableCell>)}
                <TableCell>Utilization</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {people.map((person) => (
                <TableRow key={person.user.id}>
                  <TableCell component="th" scope="row">
                    <Typography variant="body2" component="div" sx={{ fontWeight: 600 }}><PersonWithAvatar person={person.user} link /></Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{person.user.job_title}</Typography>
                  </TableCell>
                  {projects.map((p) => {
                    const c = cell(person, p)
                    return <TableCell key={p.id}>{c ? `${formatHours(c.planned)} planned · ${formatHours(c.logged)} logged` : '—'}</TableCell>
                  })}
                  <TableCell><Utilization value={person.utilization_pct} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
      {people.length && !desktop ? (
        <Stack sx={{ gap: 1 }}>
          {people.map((person) => (
            <Card key={person.user.id}>
              <CardContent>
                <Typography variant="subtitle1" component="div"><PersonWithAvatar person={person.user} link /></Typography>
                <Utilization value={person.utilization_pct} />
                {person.projects.map((c) => (
                  <Typography key={c.id} variant="body2" sx={{ color: 'text.secondary' }}>
                    {c.name}: {formatHours(c.planned)} planned · {formatHours(c.logged)} logged
                  </Typography>
                ))}
              </CardContent>
            </Card>
          ))}
        </Stack>
      ) : null}
    </>
  )
}
