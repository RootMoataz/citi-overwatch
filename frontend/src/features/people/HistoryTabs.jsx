import { Box, Checkbox, Chip, FormControlLabel, Link, MenuItem, Paper, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useId, useMemo, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import DataTable from '../../components/DataTable.jsx'
import FilterBar from '../../components/FilterBar.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import SupportingChip from '../../components/SupportingChip.jsx'
import { formatDateRange, formatHours } from '../../lib/format.js'

const NONE = []
const chip = (label) => <Chip size="small" variant="outlined" label={label} sx={{ ml: 0.75 }} />
const hours = (key) => (row) => formatHours(row[key])
const num = (key) => (row) => Number(row[key] ?? 0)

const projectName = (project, canOpen, tab) => (canOpen
  ? <Link component={RouterLink} to={`/projects/${project.id}${tab ? `?tab=${tab}` : ''}`} underline="hover">{project.name}</Link>
  : project.name)

const MILESTONE_COLUMNS = [
  { key: 'name', header: 'Milestone', rowHeader: true, sortable: true, sortValue: (m) => m.name,
    render: (m) => (
      <>
        {m.can_open
          ? <Link component={RouterLink} to={`/projects/${m.project.id}?tab=milestones&milestone=${m.id}`} underline="hover">{m.name}</Link>
          : m.name}
        {m.role === 'supporting' ? <SupportingChip /> : null}
        {m.role == null ? <Typography variant="caption" component="span" sx={{ color: 'text.secondary', ml: 0.75 }}>No longer assigned</Typography> : null}
        {m.is_archived ? chip('Archived') : null}
      </>
    ) },
  { key: 'project', header: 'Project', sortable: true, sortValue: (m) => m.project?.name,
    render: (m) => (
      <>
        {projectName(m.project, m.can_open, 'milestones')}
        {m.project.is_archived ? chip('Project archived') : m.project.status === 'completed' ? chip('Project completed') : null}
      </>
    ) },
  { key: 'status', header: 'Status', sortable: true, sortValue: (m) => m.display_status ?? m.status,
    render: (m) => <StatusChip icon status={m.display_status ?? m.status} /> },
  { key: 'dates', header: 'Planned dates', sortable: true, sortValue: (m) => `${m.start_date ?? ''}|${m.end_date ?? ''}`,
    render: (m) => formatDateRange(m.start_date, m.end_date) },
  { key: 'logged', header: 'Hours logged', align: 'right', sortable: true, sortValue: num('logged_hours'), render: hours('logged_hours') },
  { key: 'approved', header: 'Hours approved', align: 'right', sortable: true, sortValue: num('approved_hours'), render: hours('approved_hours') },
]

const PROJECT_COLUMNS = [
  { key: 'name', header: 'Project', rowHeader: true, sortable: true, sortValue: (p) => p.name,
    render: (p) => <>{projectName(p, p.can_open)}{p.is_archived ? chip('Archived') : null}</> },
  { key: 'status', header: 'Status', sortable: true, sortValue: (p) => p.status, render: (p) => <StatusChip status={p.status} /> },
  { key: 'planned', header: 'Planned / week', align: 'right', sortable: true, sortValue: num('planned_hours_per_week'),
    render: (p) => (p.on_team ? formatHours(p.planned_hours_per_week) : 'Left the team') },
  { key: 'logged', header: 'Hours logged', align: 'right', sortable: true, sortValue: num('logged_hours'), render: hours('logged_hours') },
  { key: 'approved', header: 'Hours approved', align: 'right', sortable: true, sortValue: num('approved_hours'), render: hours('approved_hours') },
]

const TAB_SX = { minHeight: 48, minWidth: 0, px: 2 }
const archivedMilestone = (m) => Boolean(m.is_archived || m.project?.is_archived)

function TabLabel({ label, count }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      {label}{' '}
      <Box component="span" sx={{ minWidth: 22, height: 22, px: 0.75, borderRadius: 11, bgcolor: 'action.selected',
        color: 'text.primary', fontSize: '0.75rem', fontWeight: 600, lineHeight: '22px', textAlign: 'center' }}>{count}</Box>
    </Box>
  )
}

/** Projects and Milestones as tabs (?tab=projects, else Milestones). Archived rows are hidden unless the viewer may see
 * them (`canSeeArchived`) and ticks Include archived. */
export default function HistoryTabs({ projects = NONE, milestones = NONE, canSeeArchived = false }) {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const ids = useId()
  const tab = params.get('tab') === 'projects' ? 'projects' : 'milestones'
  const withArchived = canSeeArchived && includeArchived

  const shownProjects = useMemo(() => projects.filter((p) => withArchived || !p.is_archived), [projects, withArchived])
  const shownMilestones = useMemo(() => milestones.filter((m) => withArchived || !archivedMilestone(m)), [milestones, withArchived])
  const options = useMemo(() => {
    const seen = new Map()
    shownMilestones.forEach((m) => { if (m.project && !seen.has(String(m.project.id))) seen.set(String(m.project.id), m.project.name) })
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]))
  }, [shownMilestones])
  const selected = options.some(([id]) => id === projectId) ? projectId : ''
  const needle = search.trim().toLowerCase()
  const rows = shownMilestones.filter((m) => (!selected || String(m.project?.id) === selected)
    && (!needle || m.name.toLowerCase().includes(needle)))

  const choose = (_, next) => setParams((prev) => {
    const out = new URLSearchParams(prev)
    if (next === 'projects') out.set('tab', 'projects')
    else out.delete('tab')
    return out
  }, { replace: true })
  const tabId = (t) => `${ids}-tab-${t}`
  const panelId = (t) => `${ids}-panel-${t}`

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Tabs value={tab} onChange={choose} aria-label="Work history" sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 48, px: 1 }}>
        <Tab value="projects" id={tabId('projects')} aria-controls={panelId('projects')} sx={TAB_SX}
          label={<TabLabel label="Projects" count={shownProjects.length} />} />
        <Tab value="milestones" id={tabId('milestones')} aria-controls={panelId('milestones')} sx={TAB_SX}
          label={<TabLabel label="Milestones" count={shownMilestones.length} />} />
      </Tabs>
      <Box role="tabpanel" id={panelId('projects')} aria-labelledby={tabId('projects')} hidden={tab !== 'projects'} sx={{ p: 2 }}>
        {tab === 'projects' ? (
          <DataTable ariaLabel="Projects" columns={PROJECT_COLUMNS} rows={shownProjects}
            empty={<Typography variant="body2" sx={{ color: 'text.secondary' }}>Not on any projects yet.</Typography>} />
        ) : null}
      </Box>
      <Box role="tabpanel" id={panelId('milestones')} aria-labelledby={tabId('milestones')} hidden={tab !== 'milestones'} sx={{ p: 2 }}>
        {tab === 'milestones' ? (
          <>
            <FilterBar search={{ label: 'Search milestones', placeholder: 'Search milestones…', value: search, onChange: setSearch }}>
              <TextField select size="small" value={selected} onChange={(e) => setProjectId(e.target.value)} sx={{ minWidth: 190 }}
                slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Project' } }}>
                <MenuItem value="">All projects</MenuItem>
                {options.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
              </TextField>
              {canSeeArchived ? (
                <FormControlLabel label="Include archived"
                  control={<Checkbox checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />} />
              ) : null}
            </FilterBar>
            <Box sx={{ mt: 1.5 }}>
              <DataTable ariaLabel="Milestones" columns={MILESTONE_COLUMNS} rows={rows} defaultSort={{ key: 'dates', dir: 'desc' }}
                empty={<Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {shownMilestones.length ? 'No milestones match.' : 'No milestones yet.'}</Typography>} />
            </Box>
          </>
        ) : null}
      </Box>
    </Paper>
  )
}
