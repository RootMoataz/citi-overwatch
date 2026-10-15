import Add from '@mui/icons-material/Add'
import Search from '@mui/icons-material/Search'
import {
  Box, Button, Checkbox, Chip, FormControlLabel, InputAdornment, LinearProgress, Link, MenuItem, Paper, Stack, TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useCreateProject, useDepartments, useManagers, useProjects } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { STATUS } from '../../app/theme.js'
import EmptyState from '../../components/EmptyState.jsx'
import AvatarStack from '../../components/AvatarStack.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import ExportCsvButton from '../../components/ExportCsvButton.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import ResponsiveTable from '../../components/ResponsiveTable.jsx'
import RiskBadges from '../../components/RiskBadges.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { num } from '../../lib/csv.js'
import { formatDate, formatPct } from '../../lib/format.js'
import { PROGRESS_WEIGHTING, RISK_LABELS } from '../../lib/labels.js'
import { can } from '../../lib/permissions.js'
import ProjectForm from './ProjectForm.jsx'

const FILTERS = ['q', 'status', 'manager', 'at_risk', 'department']

const CSV_COLUMNS = [
  { header: 'Project', value: (p) => p.name },
  { header: 'Status', value: (p) => STATUS[p.status]?.label ?? p.status },
  { header: 'Manager', value: (p) => p.manager?.name },
  { header: 'Department', value: (p) => p.department?.name },
  { header: 'Team', value: (p) => (p.team ?? []).map((t) => t.name).join('; ') },
  { header: 'Progress (%)', value: (p) => num(p.progress_pct) },
  { header: 'Budget (USD)', value: (p) => num(p.budget) },
  { header: 'Consumed (USD)', value: (p) => num(p.consumed) },
  { header: 'Budget used (%)', value: (p) => num(p.budget_pct) },
  { header: 'Start date', value: (p) => p.start_date },
  { header: 'Due date', value: (p) => p.predicted_end_date },
  { header: 'At risk', value: (p) => (p.at_risk_reasons ?? []).map((r) => RISK_LABELS[r] ?? r).join('; ') },
]

function Progress({ value, compact = false }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, width: '100%' }}>
      <LinearProgress variant="determinate" value={Math.min(value, 100)}
        sx={{ flexGrow: 1, minWidth: compact ? 32 : 64, height: 6, borderRadius: 3 }}
        aria-label="Progress, weighted by milestone difficulty" />
      <Typography variant="body2" sx={{ minWidth: 44, textAlign: 'right' }}>{formatPct(value)}</Typography>
    </Stack>
  )
}

function TeamAvatars({ project }) {
  return <AvatarStack people={project.team ?? []} max={4} label={`${project.name} team`} />
}

export default function ProjectsPage() {
  const { user } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? '']).filter(([, v]) => v)), [params])
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [creating, setCreating] = useState(false)
  const projects = useProjects(filters)
  const showManagerFilter = can(user, 'projects.filterByManager')  // admins and executives see every manager's projects
  const managers = useManagers(showManagerFilter)
  const create = useCreateProject()
  const departments = useDepartments({ enabled: Boolean(filters.department) })
  const department = (departments.data?.items ?? []).find((d) => String(d.id) === filters.department)

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
  // Sized to fit a 1366px laptop without sideways scrolling: names wrap, people stay on one line.
  const columns = [
    { field: 'name', headerName: 'Project', flex: 1.2, minWidth: 132,
      renderCell: ({ row }) => (
        <Link component={RouterLink} to={`/projects/${row.id}`} underline="hover"
          sx={{ whiteSpace: 'normal', lineHeight: 1.35, py: 0.5 }}>{row.name}</Link>
      ) },
    { field: 'status', headerName: 'Status', width: 112, renderCell: ({ value }) => <StatusChip status={value} /> },
    { field: 'manager', headerName: 'Manager', flex: 1, minWidth: 172, valueGetter: (value) => value?.name,
      renderCell: ({ row }) => <PersonWithAvatar person={row.manager} /> },
    { field: 'team', headerName: 'Team', width: 136, sortable: false,
      renderCell: ({ row }) => <TeamAvatars project={row} /> },
    { field: 'progress_pct', headerName: 'Progress', description: `Milestones done, weighted by difficulty. ${PROGRESS_WEIGHTING}`,
      width: 104, renderCell: ({ value }) => <Progress value={value} compact /> },
    { field: 'budget_pct', headerName: 'Budget', description: 'Share of the budget used so far', width: 84,
      renderCell: ({ value }) => formatPct(value) },
    { field: 'predicted_end_date', headerName: 'Due', width: 120, valueFormatter: (value) => formatDate(value) },
    { field: 'at_risk_reasons', headerName: 'Risk', flex: 1.2, minWidth: 172, sortable: false,
      renderCell: ({ value }) => <Box sx={{ py: 0.5 }}><RiskBadges reasons={value} /></Box> },
  ]

  const canCreate = can(user, 'project.create')
  // ?new=1 (the command palette's "new project") opens the create form straight away.
  const createFromUrl = canCreate && params.get('new') === '1'
  const closeCreate = () => { setCreating(false); if (createFromUrl) setFilter('new', '') }
  const empty = Object.keys(filters).length
    ? <EmptyState title="No projects match these filters" description="Try clearing a filter or searching for something else."
        action={<Button onClick={() => { setSearch(''); setParams({}, { replace: true }) }}>Clear filters</Button>} />
    : <EmptyState title="No projects yet"
        description={canCreate ? 'Create a project, or approve a request from a manager.' : "You aren't on any projects yet. A manager adds you when you're needed."}
        action={canCreate ? <Button variant="contained" onClick={() => setCreating(true)}>Create the first project</Button> : null} />

  return (
    <>
      <PageHeader title="Projects" subtitle="Status, progress (weighted by milestone difficulty), budget and risk for every project you can see."
        actions={<>
          <ExportCsvButton name="projects" columns={CSV_COLUMNS} rows={rows} />
          {canCreate ? <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>New project</Button> : null}
        </>} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2, alignItems: { md: 'center' } }}>
          <TextField type="search" label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }}
            sx={{ flex: 2 }} />
          <TextField select label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)} sx={{ flex: 1 }}>
            <MenuItem value="">All statuses</MenuItem>
            {['planned', 'active', 'on_hold', 'completed'].map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
          </TextField>
          {showManagerFilter ? (
            <TextField select label="Manager" value={filters.manager ?? ''} onChange={(e) => setFilter('manager', e.target.value)} sx={{ flex: 1 }}>
              <MenuItem value="">All managers</MenuItem>
              {(managers.data ?? []).map((m) => <MenuItem key={m.id} value={String(m.id)}>{`${m.first_name} ${m.last_name}`}</MenuItem>)}
            </TextField>
          ) : null}
          <FormControlLabel label="At risk only" sx={{ flexShrink: 0 }}
            control={<Checkbox checked={filters.at_risk === 'true'} onChange={(e) => setFilter('at_risk', e.target.checked ? 'true' : '')} />} />
          {filters.department ? (
            <Chip label={`Department: ${department?.name ?? '…'}`} onDelete={() => setFilter('department', '')} sx={{ flexShrink: 0 }} />
          ) : null}
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
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
              <PersonWithAvatar person={row.manager} link={false} sx={{ flex: 1 }} />
              <TeamAvatars project={row} />
            </Stack>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              due {formatDate(row.predicted_end_date)} · {formatPct(row.budget_pct)} used
            </Typography>
            <Progress value={row.progress_pct} />
            <RiskBadges reasons={row.at_risk_reasons} />
          </Stack>
        )} />
      {creating || createFromUrl ? (
        <ProjectForm open onClose={closeCreate} onSave={async (body) => {
          const created = await create.mutateAsync(body)
          setCreating(false)
          navigate(`/projects/${created.id}`)
        }} />
      ) : null}
    </>
  )
}
