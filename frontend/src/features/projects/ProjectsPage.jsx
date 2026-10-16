import Add from '@mui/icons-material/Add'
import FileDownload from '@mui/icons-material/FileDownloadOutlined'
import WarningAmber from '@mui/icons-material/WarningAmber'
import { Button, Chip, FormControlLabel, Link, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client.js'
import { useCreateProject, useDepartments, useManagers, useProjects } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { STATUS } from '../../app/theme.js'
import DataBar from '../../components/DataBar.jsx'
import DataTable from '../../components/DataTable.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import FilterBar from '../../components/FilterBar.jsx'
import FootNote from '../../components/FootNote.jsx'
import KpiStrip from '../../components/KpiStrip.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import RiskText from '../../components/RiskText.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { budgetTone } from '../../lib/chartData.js'
import { csvFilename, downloadCsv, num, toCsv } from '../../lib/csv.js'
import { formatDate, formatLongDate, nyTodayIso } from '../../lib/format.js'
import { RISK_LABELS } from '../../lib/labels.js'
import { can } from '../../lib/permissions.js'
import { dueLine } from '../../lib/risk.js'
import ProjectForm from './ProjectForm.jsx'

const FILTERS = ['q', 'status', 'manager', 'at_risk', 'department', 'archived']
const PAGE_SIZE = 25
const EXPORT_PAGE_SIZE = 100
const DEFAULT_SORT = { key: 'name', dir: 'asc' }
const SORT_KEYS = ['name', 'status', 'manager', 'progress', 'budget_used', 'due', 'risk']

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

const FOOT_NOTE = "Progress is milestone completion weighted by difficulty. Budget used is approved spend against the budget. "
  + "The due date is the project's planned end."

function DueLine({ project, today }) {
  const line = dueLine(project, today)
  if (!line) return null
  return (
    <Typography variant="caption" component="div" sx={{ color: line.overdue ? 'error.main' : 'text.secondary' }}>
      {line.text}
    </Typography>
  )
}

function ProgressBar({ project }) {
  return <DataBar value={project.progress_pct} label={`${project.name} progress`} minWidth={0} />
}

function BudgetBar({ project }) {
  return <DataBar value={project.budget_pct} tone={budgetTone(project.budget_pct)} label={`${project.name} budget used`} minWidth={0} />
}

function StatusCell({ project }) {
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
      <StatusChip status={project.status} />
      {project.is_archived ? <Chip size="small" variant="outlined" label="Archived" /> : null}
    </Stack>
  )
}

export default function ProjectsPage() {
  const { user } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const today = nyTodayIso(new Date())
  const showArchived = can(user, 'archive.everything')
  // `archived` only counts for people who can see its switch, so an employee's ?archived=true is never forwarded.
  const filters = useMemo(() => Object.fromEntries(FILTERS.filter((k) => k !== 'archived' || showArchived)
    .map((k) => [k, params.get(k) ?? '']).filter(([, v]) => v)), [params, showArchived])
  const sort = useMemo(() => {
    const key = params.get('sort')
    return SORT_KEYS.includes(key) ? { key, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' } : DEFAULT_SORT
  }, [params])
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '', 10) || 1)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [creating, setCreating] = useState(false)
  const projects = useProjects({ ...filters, sort: sort.key, dir: sort.dir, page, page_size: PAGE_SIZE })
  const showManagerFilter = can(user, 'projects.filterByManager')  // admins and executives see every manager's projects
  const managers = useManagers(showManagerFilter)
  const create = useCreateProject()
  const departments = useDepartments({ enabled: Boolean(filters.department) })
  const department = (departments.data?.items ?? []).find((d) => String(d.id) === filters.department)

  // Every change to the view goes through here; a filter or sort change always returns to page 1 (no `page`).
  const change = (changes, { keepPage = false } = {}) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!keepPage) next.delete('page')
    return next
  }, { replace: true })
  const setFilter = (key, value) => change({ [key]: value })

  // Debounce typing so we don't refetch on every key press.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) setFilter('q', search.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearFilters = () => {
    setSearch('')
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const key of [...FILTERS, 'page']) next.delete(key)
      return next
    }, { replace: true })
  }

  const rows = projects.data?.items ?? []
  const total = projects.data?.total ?? 0
  const [exporting, setExporting] = useState(false)

  // A page past the last one (the list shrank, or the URL was edited) goes to the last page that has rows.
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => {
    if (projects.isSuccess && !projects.isPlaceholderData && page > 1 && rows.length === 0 && total > 0) {
      change({ page: lastPage > 1 ? String(lastPage) : '' }, { keepPage: true })
    }
  }, [projects.isSuccess, projects.isPlaceholderData, page, rows.length, total, lastPage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Export what the filters and sort select, not just the page on screen: fetch every page at click time.
  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = []
      for (let next = 1; ; next += 1) {
        const res = await api.get('/projects', { ...filters, sort: sort.key, dir: sort.dir, page: next, page_size: EXPORT_PAGE_SIZE })
        const items = res.items ?? []
        all.push(...items)
        if (!items.length || all.length >= (res.total ?? 0)) break
      }
      downloadCsv(csvFilename('projects'), toCsv(CSV_COLUMNS, all))
    } finally {
      setExporting(false)
    }
  }
  const counts = projects.data?.counts
  const open = (row) => navigate(`/projects/${row.id}`)

  const columns = [
    { key: 'name', header: 'Project', sortable: true,
      render: (p) => (
        <div>
          <Link component={RouterLink} to={`/projects/${p.id}`} underline="hover" sx={{ fontWeight: 600 }}>{p.name}</Link>
          {p.department?.name ? <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{p.department.name}</Typography> : null}
        </div>
      ) },
    { key: 'status', header: 'Status', sortable: true, render: (p) => <StatusCell project={p} /> },
    { key: 'manager', header: 'Manager', sortable: true, render: (p) => <PersonWithAvatar person={p.manager} /> },
    { key: 'progress', header: 'Progress', sortable: true, render: (p) => <ProgressBar project={p} /> },
    { key: 'budget_used', header: 'Budget used', sortable: true, render: (p) => <BudgetBar project={p} /> },
    { key: 'due', header: 'Due date', sortable: true,
      render: (p) => (
        <div>
          <Typography variant="body2" component="div" sx={{ whiteSpace: 'nowrap' }}>{formatDate(p.predicted_end_date)}</Typography>
          <DueLine project={p} today={today} />
        </div>
      ) },
    { key: 'risk', header: 'Risk', sortable: true, render: (p) => <RiskText project={p} today={today} /> },
  ]

  const renderCard = (p) => (
    <Stack sx={{ gap: 1 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <div>
          <Typography variant="subtitle1" component="div">{p.name}</Typography>
          {p.department?.name ? <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{p.department.name}</Typography> : null}
        </div>
        <StatusCell project={p} />
      </Stack>
      <RiskText project={p} today={today} />
      <Stack sx={{ gap: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Progress</Typography>
        <ProgressBar project={p} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Budget used</Typography>
        <BudgetBar project={p} />
      </Stack>
      <div>
        <Typography variant="body2" component="div">Due {formatDate(p.predicted_end_date)}</Typography>
        <DueLine project={p} today={today} />
      </div>
    </Stack>
  )

  const canCreate = can(user, 'project.create')
  // ?new=1 (the command palette's "new project") opens the create form straight away.
  const createFromUrl = canCreate && params.get('new') === '1'
  const closeCreate = () => { setCreating(false); if (createFromUrl) change({ new: '' }, { keepPage: true }) }
  const filtered = Object.keys(filters).length > 0
  const empty = filtered
    ? <EmptyState title="No projects match" description="Try clearing a filter or searching for something else."
        action={<Button onClick={clearFilters}>Clear filters</Button>} />
    : <EmptyState title="No projects yet"
        description={canCreate ? 'Create a project, or approve a request from a manager.' : "You aren't on any projects yet. A manager adds you when you're needed."}
        action={canCreate ? <Button variant="contained" onClick={() => setCreating(true)}>Create the first project</Button> : null} />

  const atRisk = counts?.at_risk ?? 0
  const figure = (n) => (counts ? n : '—')
  const kpis = [
    { key: 'total', label: counts?.total === 1 ? 'project' : 'projects', value: figure(counts?.total) },
    { key: 'active', label: 'active', value: figure(counts?.active) },
    { key: 'at_risk', label: 'at risk', value: figure(counts?.at_risk), tone: atRisk > 0 ? 'warning' : undefined,
      icon: atRisk > 0 ? <WarningAmber /> : undefined, onClick: () => setFilter('at_risk', 'true') },
  ]

  return (
    <>
      <PageHeader title="Projects" subtitle="Keep delivery, budget and risk in view."
        actions={<>
          <Button size="small" variant="outlined" startIcon={<FileDownload />} disabled={!rows.length || exporting}
            title={rows.length ? `Download all ${total} projects as a CSV file` : 'Nothing to export'} onClick={exportCsv}>
            Export CSV
          </Button>
          {canCreate ? <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>New project</Button> : null}
          {can(user, 'request.submit')
            ? <Button variant="contained" component={RouterLink} to="/requests?new=1">Request a project</Button> : null}
        </>} />
      <Stack sx={{ gap: 2 }}>
        <KpiStrip ariaLabel="Projects summary" items={kpis} layout="value-first" phoneColumns={3} loading={projects.isLoading} />
        <FilterBar search={{ label: 'Search projects', placeholder: 'Search projects…', value: search, onChange: setSearch }}>
          <TextField select size="small" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}
            slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Status' } }} sx={{ minWidth: 150 }}>
            <MenuItem value="">All statuses</MenuItem>
            {['planned', 'active', 'on_hold', 'completed'].map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
          </TextField>
          {showManagerFilter ? (
            <TextField select size="small" value={filters.manager ?? ''} onChange={(e) => setFilter('manager', e.target.value)}
              slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Manager' } }} sx={{ minWidth: 170 }}>
              <MenuItem value="">All managers</MenuItem>
              {(managers.data ?? []).map((m) => <MenuItem key={m.id} value={String(m.id)}>{`${m.first_name} ${m.last_name}`}</MenuItem>)}
            </TextField>
          ) : null}
          <FormControlLabel label="At risk only"
            control={<Switch checked={filters.at_risk === 'true'} onChange={(e) => setFilter('at_risk', e.target.checked ? 'true' : '')} />} />
          {showArchived ? (
            <FormControlLabel label="Archived"
              control={<Switch checked={filters.archived === 'true'} onChange={(e) => setFilter('archived', e.target.checked ? 'true' : '')} />} />
          ) : null}
          {filters.department ? (
            <Chip label={`Department: ${department?.name ?? '…'}`} onDelete={() => setFilter('department', '')} />
          ) : null}
        </FilterBar>
        <ErrorAlert error={projects.error} onRetry={() => projects.refetch()} />
        {projects.isError && !projects.data ? null : (
          <div>
            <DataTable ariaLabel="Projects" columns={columns} rows={rows} sort={sort} serverSort
              onSortChange={(next) => change({ sort: next.key === DEFAULT_SORT.key && next.dir === DEFAULT_SORT.dir ? '' : next.key,
                dir: next.key === DEFAULT_SORT.key && next.dir === DEFAULT_SORT.dir ? '' : next.dir })}
              onRowOpen={open} renderCard={renderCard} loading={projects.isLoading} empty={empty}
              pagination={total > PAGE_SIZE || page > 1 ? { page: page - 1, pageSize: PAGE_SIZE, total,
                onPageChange: (zeroBased) => change({ page: zeroBased > 0 ? String(zeroBased + 1) : '' }, { keepPage: true }) } : undefined} />
            <FootNote note={FOOT_NOTE} end={`Today is ${formatLongDate(today)}`} />
          </div>
        )}
      </Stack>
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
