import Add from '@mui/icons-material/Add'
import Search from '@mui/icons-material/Search'
import {
  Box, Button, Checkbox, FormControlLabel, InputAdornment, LinearProgress, Link, MenuItem, Paper, Stack, TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useCreateProject, useManagers, useProjects } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { STATUS } from '../../app/theme.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import ResponsiveTable from '../../components/ResponsiveTable.jsx'
import RiskBadges from '../../components/RiskBadges.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, formatPct } from '../../lib/format.js'
import { PROGRESS_WEIGHTING } from '../../lib/labels.js'
import { can } from '../../lib/permissions.js'
import ProjectForm from './ProjectForm.jsx'

const FILTERS = ['q', 'status', 'manager', 'at_risk']

function Progress({ value }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, width: '100%' }}>
      <LinearProgress variant="determinate" value={Math.min(value, 100)} sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
        aria-label="Progress, weighted by milestone difficulty" />
      <Typography variant="body2" sx={{ minWidth: 44, textAlign: 'right' }}>{formatPct(value)}</Typography>
    </Stack>
  )
}

export default function ProjectsPage() {
  const { user } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? '']).filter(([, v]) => v)), [params])
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [creating, setCreating] = useState(false)
  const projects = useProjects(filters)
  const showManagerFilter = user.role !== 'employee'
  const managers = useManagers(showManagerFilter && user.role === 'admin')
  const create = useCreateProject()

  const setFilter = (key, value) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (value) next.set(key, value)
    else next.delete(key)
    return next
  }, { replace: true })

  // Debounce typing so we don't refetch on every key press.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) setFilter('q', search.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = projects.data?.items ?? []
  const columns = [
    { field: 'name', headerName: 'Project', flex: 1.6, minWidth: 200,
      renderCell: ({ row }) => <Link component={RouterLink} to={`/projects/${row.id}`} underline="hover">{row.name}</Link> },
    { field: 'status', headerName: 'Status', width: 140, renderCell: ({ value }) => <StatusChip status={value} /> },
    { field: 'manager', headerName: 'Manager', flex: 1, minWidth: 140, valueGetter: (value) => value?.name },
    { field: 'progress_pct', headerName: 'Progress', description: `Milestones done, weighted by difficulty. ${PROGRESS_WEIGHTING}`,
      flex: 1, minWidth: 160,
      renderCell: ({ value }) => <Progress value={value} /> },
    { field: 'budget_pct', headerName: 'Budget', width: 110, renderCell: ({ value }) => `${formatPct(value)} used` },
    { field: 'predicted_end_date', headerName: 'Due', width: 120, valueFormatter: (value) => formatDate(value) },
    { field: 'at_risk_reasons', headerName: 'Risk', flex: 1.4, minWidth: 220, sortable: false,
      renderCell: ({ value }) => <Box sx={{ py: 1 }}><RiskBadges reasons={value} /></Box> },
  ]

  const canCreate = can(user, 'project.create')
  const empty = Object.keys(filters).length
    ? <EmptyState title="No projects match these filters" description="Try clearing a filter or searching for something else."
        action={<Button onClick={() => { setSearch(''); setParams({}, { replace: true }) }}>Clear filters</Button>} />
    : <EmptyState title="No projects yet"
        description={canCreate ? 'Create a project, or approve a request from a manager.' : "You aren't on any projects yet. A manager adds you when you're needed."}
        action={canCreate ? <Button variant="contained" onClick={() => setCreating(true)}>Create the first project</Button> : null} />

  return (
    <>
      <PageHeader title="Projects" subtitle="Status, progress (weighted by milestone difficulty), budget and risk for every project you can see."
        actions={canCreate ? <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>New project</Button> : null} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2, alignItems: { md: 'center' } }}>
          <TextField type="search" label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }}
            sx={{ flex: 2 }} />
          <TextField select label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)} sx={{ flex: 1 }}>
            <MenuItem value="">All statuses</MenuItem>
            {['planned', 'active', 'on_hold', 'completed'].map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
          </TextField>
          {showManagerFilter && user.role === 'admin' ? (
            <TextField select label="Manager" value={filters.manager ?? ''} onChange={(e) => setFilter('manager', e.target.value)} sx={{ flex: 1 }}>
              <MenuItem value="">All managers</MenuItem>
              {(managers.data ?? []).map((m) => <MenuItem key={m.id} value={String(m.id)}>{`${m.first_name} ${m.last_name}`}</MenuItem>)}
            </TextField>
          ) : null}
          <FormControlLabel label="At risk only" sx={{ flexShrink: 0 }}
            control={<Checkbox checked={filters.at_risk === 'true'} onChange={(e) => setFilter('at_risk', e.target.checked ? 'true' : '')} />} />
        </Stack>
      </Paper>
      <ErrorAlert error={projects.error} onRetry={() => projects.refetch()} sx={{ mb: 2 }} />
      <ResponsiveTable ariaLabel="Projects" rows={rows} columns={columns} loading={projects.isLoading}
        onRowClick={(row) => navigate(`/projects/${row.id}`)} emptyState={projects.isError ? null : empty}
        renderCard={(row) => (
          <Stack sx={{ gap: 1 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="subtitle1">{row.name}</Typography>
              <StatusChip status={row.status} />
            </Stack>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {row.manager?.name} · due {formatDate(row.predicted_end_date)} · {formatPct(row.budget_pct)} used
            </Typography>
            <Progress value={row.progress_pct} />
            <RiskBadges reasons={row.at_risk_reasons} />
          </Stack>
        )} />
      {creating ? (
        <ProjectForm open onClose={() => setCreating(false)} onSave={async (body) => {
          const created = await create.mutateAsync(body)
          setCreating(false)
          navigate(`/projects/${created.id}`)
        }} />
      ) : null}
    </>
  )
}
