import Add from '@mui/icons-material/Add'
import ChevronRight from '@mui/icons-material/ChevronRight'
import FormatListBulleted from '@mui/icons-material/FormatListBulleted'
import Schedule from '@mui/icons-material/ScheduleOutlined'
import ShowChart from '@mui/icons-material/ShowChart'
import {
  Alert, Box, Button, InputAdornment, Link, MenuItem, Paper, Skeleton, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useRef, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { Link as RouterLink, useLocation, useSearchParams } from 'react-router-dom'
import { useApprovals, useMembers, useMilestones, useProfile } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import FilterBar from '../../components/FilterBar.jsx'
import FootNote from '../../components/FootNote.jsx'
import MilestoneStatusBar from '../../components/MilestoneStatusBar.jsx'
import Timeline from '../../components/Timeline.jsx'
import { formatDateRange, formatHours, plural } from '../../lib/format.js'
import { DESKTOP_QUERY, WIDE_QUERY } from '../../lib/responsive.js'
import MilestoneDialog from './MilestoneDialog.jsx'
import MilestoneList from './MilestoneList.jsx'
import MilestoneMenu from './MilestoneMenu.jsx'
import MilestonePanel from './MilestonePanel.jsx'
import { stateOf } from './milestoneOrder.js'
import { pendingHoursOf } from '../../lib/personWeeks.js'
import { useMilestonePanelUrl } from './useMilestonePanelUrl.js'

// List or Timeline is kept per browser; the URL's ?view= wins. Blocked storage just means List every time.
const VIEW_KEY = 'overwatch.milestones.view'
const readView = () => {
  try { return window.localStorage.getItem(VIEW_KEY) === 'timeline' ? 'timeline' : 'list' } catch { return 'list' }
}
const storeView = (view) => {
  try { window.localStorage.setItem(VIEW_KEY, view) } catch { /* blocked: the choice lasts until the page closes */ }
}

const STATUS_FILTERS = [['', 'All'], ['not_started', 'Not started'], ['in_progress', 'In progress'],
  ['ready_for_review', 'Ready for review'], ['completed', 'Completed'], ['waiting', 'Waiting'], ['blocked', 'Blocked']]

/**
 * The Milestones tab: a summary card (milestones complete and the status bar, with the pending entries for people
 * who decide hours, or "Your part"), a toolbar (search, status, List or Timeline, Add milestone), the List or the
 * Timeline, and the milestone's side panel. URL state: ?milestone= opens the panel (see useMilestonePanelUrl),
 * ?view=timeline picks the Timeline. Variants come from `view` (projectView).
 */
export default function MilestonesTab({ project, user, view }) {
  const milestones = useMilestones(project.id)
  const members = useMembers(project.id)
  const approvals = useApprovals({ project: project.id }, view.decides)
  const profile = useProfile(user?.id, view.mine && Boolean(user?.id))
  const listRef = useRef(null)
  const { current, panel, setPanel, open, close, returnFocus, archiveStarted, archiveFailed } = useMilestonePanelUrl(milestones, listRef)
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const wide = useMediaQuery(WIDE_QUERY)
  const [remembered, setRemembered] = useState(readView)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [adding, setAdding] = useState(false)
  const [warning, setWarning] = useState('')

  const items = milestones.data ?? []
  const urlView = params.get('view')
  const mode = urlView === 'timeline' || urlView === 'list' ? urlView : remembered

  const needle = search.trim().toLowerCase()
  const shown = items.filter((m) => (!state || stateOf(m) === state)
    && (!needle || `${m.name}\n${m.description ?? ''}`.toLowerCase().includes(needle)))

  // Pending entries per milestone, and in all, for people who decide hours (the server lists only what they may decide).
  const pendingByMilestone = {}
  const pending = view.decides ? approvals.data ?? [] : []
  for (const item of pending) {
    const key = String(item.milestone?.id)
    pendingByMilestone[key] ??= { count: 0, hours: 0 }
    pendingByMilestone[key].count += 1
    pendingByMilestone[key].hours += pendingHoursOf([item])
  }
  const pendingHours = pendingHoursOf(pending)
  // Your hours: the viewer's own logged hours per milestone and on the project, from their profile.
  const mine = view.mine ? profile.data : undefined
  const myHoursByMilestone = Object.fromEntries((mine?.milestones ?? []).map((x) => [String(x.id), Number(x.logged_hours)]))
  const myProject = (mine?.projects ?? []).find((p) => String(p.id) === String(project.id))

  const changeMode = (next) => {
    storeView(next)
    setRemembered(next)
    // Keep the entry's state: an open panel's panelPushed mark is what lets Close undo the open (useMilestonePanelUrl).
    setParams((p) => { if (next === 'timeline') p.set('view', 'timeline'); else p.delete('view'); return p },
      { replace: true, state: location.state })
  }
  const clearFilters = () => { setSearch(''); setState('') }

  const menuFor = (m) => (
    <MilestoneMenu milestone={m} project={project} items={items} members={members.data ?? []} manage={view.manage}
      onOpenPanel={open} onWarning={setWarning} onArchiveStart={archiveStarted} onArchiveFailed={archiveFailed} />
  )

  const done = items.filter((m) => m.status === 'completed').length
  const summaryAside = (
    <>
      {view.decides && pending.length ? (
        <Link component={RouterLink} to={`/timesheets?project=${project.id}`} underline="hover"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'warning.main', fontWeight: 600, minHeight: 44 }}>
          <Schedule aria-hidden="true" fontSize="small" />
          {`${plural(pending.length, 'pending entry', 'pending entries')} · ${formatHours(pendingHours)}`}
          <ChevronRight aria-hidden="true" fontSize="small" />
        </Link>
      ) : null}
      {view.mine ? (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {`Your part: ${items.filter((m) => m.is_assignee).length} of ${plural(items.length, 'milestone', 'milestones')}`
            + (myProject ? ` · ${formatHours(myProject.logged_hours)} logged` : '')}
        </Typography>
      ) : null}
    </>
  )
  const hasAside = (view.decides && pending.length > 0) || view.mine

  const noMatch = (
    <EmptyState title="No milestones match" description="Try clearing the search or the status filter."
      action={<Button onClick={clearFilters}>Clear</Button>} />
  )
  const addButton = view.manage ? (
    <Button variant="contained" startIcon={<Add />} onClick={() => setAdding(true)} sx={{ minHeight: { xs: 44, md: 'auto' } }}>
      Add milestone
    </Button>
  ) : null

  const toolbar = (
    <FilterBar search={{ label: 'Search milestones', placeholder: 'Search milestones…', value: search, onChange: setSearch }}
      end={(
        <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <ToggleButtonGroup exclusive size="small" value={mode} aria-label="Milestones view"
            onChange={(_e, next) => { if (next) changeMode(next) }}
            sx={{ '& .MuiToggleButton-root': { gap: 0.75, px: 1.5, minHeight: desktop ? 'auto' : 44 } }}>
            <ToggleButton value="list"><FormatListBulleted fontSize="small" />List</ToggleButton>
            <ToggleButton value="timeline"><ShowChart fontSize="small" />Timeline</ToggleButton>
          </ToggleButtonGroup>
          {addButton}
        </Stack>
      )}>
      <TextField select size="small" value={state} onChange={(e) => setState(e.target.value)} sx={{ minWidth: 190 }}
        slotProps={{
          select: { displayEmpty: true },
          htmlInput: { 'aria-label': 'Status' },
          input: { startAdornment: <InputAdornment position="start">Status</InputAdornment> },
        }}>
        {STATUS_FILTERS.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
      </TextField>
    </FilterBar>
  )

  const listView = (
    <>
      <MilestoneList items={shown} all={items} view={view} pendingByMilestone={pendingByMilestone}
        myHoursByMilestone={myHoursByMilestone} selectedId={current ? String(current.id) : undefined}
        narrow={desktop && Boolean(current)} onOpen={(m) => open(m)} menuFor={view.manage ? menuFor : undefined}
        loading={milestones.isLoading} empty={noMatch} />
      {shown.length ? (
        <Stack sx={{ flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', gap: { xs: 0.5, md: 2 },
          color: 'text.secondary', mt: 1.5 }}>
          <Typography variant="caption" component="p" sx={{ m: 0 }}>
            {`${plural(shown.length, 'milestone', 'milestones')} · Select a row to view details, discussion and history.`}
          </Typography>
          <Typography variant="caption" component="p" sx={{ m: 0 }}>
            <span aria-hidden="true">ⓘ</span>{' '}Effort shows logged / estimated hours. Status does not imply hours are approved.
          </Typography>
        </Stack>
      ) : null}
    </>
  )

  const timelineView = (
    <>
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'baseline' }, gap: { xs: 0.5, sm: 2 }, mb: 1.5 }}>
        <Typography variant="h3" component="h2">Planned schedule</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {`${formatDateRange(project.start_date, project.predicted_end_date)} · Bars show planned dates, colours show current status.`}
        </Typography>
      </Stack>
      {milestones.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
      {!milestones.isLoading && shown.length ? (
        <Timeline items={shown} all={items} range={{ start: project.start_date, end: project.predicted_end_date }}
          onOpen={(m) => open(m)} layout={wide && !current ? 'detailed' : 'default'} />
      ) : null}
      {!milestones.isLoading && !shown.length ? noMatch : null}
      <FootNote note="Select a milestone to inspect dependencies, approvals and history." />
    </>
  )

  const listCard = (
    <Paper ref={listRef} variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      {toolbar}
      <Box sx={{ mt: 2 }}>{mode === 'timeline' ? timelineView : listView}</Box>
    </Paper>
  )
  const failed = Boolean(milestones.error) && !milestones.data
  const empty = milestones.isSuccess && items.length === 0

  return (
    <Stack sx={{ gap: 2 }}>
      {items.length ? (
        <MilestoneStatusBar items={items} headingComponent="h2"
          title={`${done} of ${plural(items.length, 'milestone', 'milestones')} complete`} aside={hasAside ? summaryAside : undefined} />
      ) : null}
      {project.work_mode === 'pull' ? (
        <Alert severity="info">
          This project works in pull mode: team members claim milestones that are ready to start and have nobody on them.
          Claiming one makes you its owner and lets the manager know.
        </Alert>
      ) : null}
      {warning ? <Alert severity="warning" onClose={() => setWarning('')}>{warning}</Alert> : null}
      <ErrorAlert error={milestones.error} onRetry={() => milestones.refetch()} />
      {empty ? (
        <Paper variant="outlined">
          <EmptyState title="No milestones yet"
            description={view.manage ? 'Break the project into milestones with dates, owners and dependencies.'
              : "Your manager hasn't planned any milestones yet."}
            action={addButton} />
        </Paper>
      ) : null}
      {!empty && !failed ? (
        <MilestonePanel project={project} milestone={current} items={items} members={members.data ?? []} view={view} user={user} panel={panel} onPanel={setPanel}
          myHours={view.mine && profile.data ? (myHoursByMilestone[String(current?.id)] ?? 0) : undefined}
          onClose={close} returnFocus={returnFocus} onOpenPanel={open} onWarning={setWarning}
          onArchiveStart={archiveStarted} onArchiveFailed={archiveFailed} list={listCard} />
      ) : null}
      {adding ? (
        <MilestoneDialog project={project} milestone={null} milestones={items} members={members.data ?? []}
          onClose={() => setAdding(false)} onWarning={setWarning} />
      ) : null}
    </Stack>
  )
}
