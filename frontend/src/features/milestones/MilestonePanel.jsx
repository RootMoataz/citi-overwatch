import CalendarToday from '@mui/icons-material/CalendarTodayOutlined'
import ChatBubble from '@mui/icons-material/ChatBubbleOutlineOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import Group from '@mui/icons-material/GroupOutlined'
import History from '@mui/icons-material/HistoryOutlined'
import Info from '@mui/icons-material/InfoOutlined'
import PanTool from '@mui/icons-material/PanToolOutlined'
import Schedule from '@mui/icons-material/ScheduleOutlined'
import Timeline from '@mui/icons-material/TimelineOutlined'
import { Box, Button, Collapse, IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import { Fragment, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useClaimMilestone, useMilestoneStatus } from '../../api/queries.js'
import { useConversations } from '../../api/messages.js'
import AvatarStack from '../../components/AvatarStack.jsx'
import DifficultyChip from '../../components/DifficultyChip.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import EstimateLine from '../../components/EstimateLine.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import PriorityChip from '../../components/PriorityChip.jsx'
import SidePanel from '../../components/SidePanel.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import SupportingChip from '../../components/SupportingChip.jsx'
import { formatDate, formatHours } from '../../lib/format.js'
import { statusActions } from '../../lib/milestoneActions.js'
import { WIDE_QUERY } from '../../lib/responsive.js'
import MilestonePendingHours from '../approvals/MilestonePendingHours.jsx'
import DiscussButton from '../messages/DiscussButton.jsx'
import KickbackDialog from './KickbackDialog.jsx'
import KickbackPanel from './KickbackPanel.jsx'
import MilestoneDetails from './MilestoneDetails.jsx'
import MilestoneDialog from './MilestoneDialog.jsx'
import MilestoneHistory from './MilestoneHistory.jsx'
import MilestoneMenu from './MilestoneMenu.jsx'
import MilestoneNotes from './MilestoneNotes.jsx'
import WorkLog from './WorkLog.jsx'

const STATES = ['completed', 'ready_for_review', 'in_progress', 'not_started', 'waiting', 'blocked']
const stateOf = (m) => [m.display_status, m.status].find((s) => STATES.includes(s)) ?? 'not_started'
const namesOf = (ids, items) => (ids ?? []).map((id) => items.find((x) => String(x.id) === String(id))?.name).filter(Boolean)

// The sections of the milestone's details, one open at a time (Details first).
const SECTIONS = [
  { value: 'details', label: 'Details', Icon: Info },
  { value: 'log', label: 'Work log', Icon: Timeline },
  { value: 'history', label: 'History', Icon: History },
  { value: 'notes', label: 'Notes', Icon: ChatBubble },
]

function Fact({ icon: Icon, children }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Icon aria-hidden="true" fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
      {children}
    </Stack>
  )
}

/** The three facts under the description: dates and dependencies, the people, and the hours. */
function Facts({ milestone: m, items, project, myHours }) {
  const after = namesOf(m.predecessors, items)
  const supporting = new Set((m.supporting_ids ?? []).map(String))
  const ordered = [...(m.assignees ?? [])].sort((a, b) => supporting.has(String(a.id)) - supporting.has(String(b.id)))
  const mixed = ordered.some((a) => supporting.has(String(a.id)))
  const people = ordered.map((a) => {
    const helper = supporting.has(String(a.id))
    return { id: a.id, name: a.name, detail: helper ? 'Supporting' : 'Primary', highlight: mixed && !helper }
  })
  const logged = Number(m.logged_hours) || 0
  const hours = m.estimated_hours != null
    ? `${formatHours(logged)} logged / ${formatHours(m.estimated_hours)} estimated` : `${formatHours(logged)} logged`
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap sx={{ gap: { xs: 1, sm: 3 }, flexWrap: 'wrap', alignItems: { sm: 'center' } }}>
      <Fact icon={CalendarToday}>
        <Typography variant="body2">
          {`${formatDate(m.start_date)} – ${formatDate(m.end_date)}${after.length ? ` · After ${after.join(', ')}` : ''}`}
        </Typography>
      </Fact>
      <Fact icon={Group}>
        {people.length ? (
          <>
            <AvatarStack people={people} max={4} label={`People on ${m.name}`} />
            <Typography variant="body2" component="div" sx={{ minWidth: 0 }}>
              {ordered.map((a, i) => (
                <Fragment key={a.id}>
                  {i ? ', ' : ''}<PersonLink person={a} context={{ project }} />
                  {supporting.has(String(a.id)) ? <SupportingChip person={a.name} /> : null}
                </Fragment>
              ))}
            </Typography>
          </>
        ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>Unassigned</Typography>}
      </Fact>
      <Fact icon={Schedule}>
        <Typography variant="body2">{hours}{m.is_assignee && myHours != null ? ` · You: ${formatHours(myHours)}` : ''}</Typography>
      </Fact>
    </Stack>
  )
}

/** Today's milestone details and the viewer's actions on it: priority and difficulty, the estimate and progress, the
 * open kickback, Claim, the status moves, Kick back, the discussion, and the Details, Work log, History
 * and Notes sections (Details, with the objective, open first). People who decide hours also see the milestone's
 * pending entries. */
function MilestoneBody({ milestone: m, project, items, manage, decides, onEdit }) {
  const status = useMilestoneStatus(project.id)
  const claim = useClaimMilestone(project.id)
  const conversations = useConversations()   // whether the viewer is already in this milestone's discussion
  const [section, setSection] = useState('details')
  const [kicking, setKicking] = useState(false)
  const [failure, setFailure] = useState(null)
  const waitingOn = namesOf(m.predecessors, items)
  const actions = statusActions(m, { manager: manage, assignee: m.is_assignee })

  const run = async (action) => {
    setFailure(null)
    try { await action() } catch (err) { setFailure(err) }
  }

  return (
    <Stack sx={{ gap: 1.5 }}>
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <PriorityChip priority={m.priority} />
        <DifficultyChip difficulty={m.difficulty} />
      </Stack>
      <EstimateLine milestone={m} />
      {m.progress_percent != null && m.status !== 'completed' ? (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, maxWidth: 320 }}>
          <LinearProgress variant="determinate" value={m.progress_percent} sx={{ flex: 1, height: 6, borderRadius: 3 }}
            aria-label={`${m.name}: ${m.progress_percent}% complete, from the latest update`} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{m.progress_percent}% done</Typography>
        </Stack>
      ) : null}
      <KickbackPanel milestone={m} onEdit={manage ? onEdit : undefined} />
      <ErrorAlert error={failure} />
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {m.can_claim ? (
          <Button size="small" variant="contained" aria-label={`Claim ${m.name}`} disabled={claim.isPending}
            onClick={() => run(() => claim.mutateAsync(m.id))}>
            Claim
          </Button>
        ) : null}
        {actions.map((a) => {
          const blocked = m.blocked && m.status === 'not_started'
          const button = (
            <Button key={a.target + a.label} size="small" variant={a.primary ? 'contained' : 'outlined'}
              disabled={blocked || status.isPending} onClick={() => run(() => status.mutateAsync({ id: m.id, status: a.target }))}>
              {a.label}
            </Button>
          )
          return blocked ? <Tooltip key={a.label} title={`Waiting on: ${waitingOn.join(', ')}`}><span>{button}</span></Tooltip> : button
        })}
        {m.can_kick_back ? (
          <Button size="small" color="error" variant="outlined" startIcon={<PanTool />} onClick={() => setKicking(true)}>Kick back</Button>
        ) : null}
        <Box sx={{ flexGrow: 1 }} />
        <DiscussButton milestone={m} manage={manage} conversations={conversations.data?.items} />
      </Stack>
      <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', borderTop: 1, borderColor: 'divider', pt: 1 }}>
        {SECTIONS.map(({ value, label, Icon }) => (
          <Button key={value} size="small" startIcon={<Icon />} aria-expanded={section === value}
            aria-label={`${label} for ${m.name}`} onClick={() => setSection((s) => (s === value ? null : value))}>
            {label}
          </Button>
        ))}
      </Stack>
      <Collapse in={section === 'details'} unmountOnExit><MilestoneDetails milestone={m} /></Collapse>
      <Collapse in={section === 'log'} unmountOnExit><WorkLog milestone={m} /></Collapse>
      <Collapse in={section === 'history'} unmountOnExit><MilestoneHistory milestone={m} /></Collapse>
      <Collapse in={section === 'notes'} unmountOnExit>
        <MilestoneNotes milestoneId={m.id} canPost={manage || m.is_assignee} />
      </Collapse>
      {decides ? <MilestonePendingHours milestone={m} /> : null}
      {kicking ? <KickbackDialog milestone={m} onClose={() => setKicking(false)} /> : null}
    </Stack>
  )
}

/**
 * The milestone's side panel beside `list` (a full-screen sheet on phones), open while `milestone` is set. Header: the
 * name (H2) and its state, then "Edit" and the "⋯" for managers, and Close. Under it: the description and three facts
 * (dates and dependencies, people, hours with "· You: <N>h" for an assignee). Below the facts comes `children` when
 * given, otherwise the milestone's details and actions. Below `lg` the header has less room, so the state chip opens
 * the body instead and Edit is an icon.
 */
export default function MilestonePanel({ project, milestone, items, members, user, view, myHours, onClose, returnFocus,
  onOpenPanel, onWarning, onArchive, list, children }) {
  const wide = useMediaQuery(WIDE_QUERY)
  const [editing, setEditing] = useState(false)
  const m = milestone
  const state = m ? <StatusChip status={stateOf(m)} icon /> : null
  const actions = m && view.manage ? (
    <>
      {wide ? (
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditing(true)} sx={{ minHeight: 44 }}>Edit</Button>
      ) : (
        <Tooltip title="Edit">
          <IconButton aria-label="Edit" onClick={() => setEditing(true)} sx={{ width: 44, height: 44 }}><EditIcon /></IconButton>
        </Tooltip>
      )}
      <MilestoneMenu milestone={m} project={project} items={items} members={members} user={user} onOpenPanel={onOpenPanel}
        onWarning={onWarning} onArchive={onArchive} />
    </>
  ) : null

  return (
    <>
      <SidePanel open={Boolean(m)} title={m?.name ?? ''} titleAdornment={wide ? state : null}
        actions={actions} onClose={onClose} returnFocus={returnFocus} list={list}>
        {m ? (
          <Stack sx={{ gap: 2 }}>
            {wide ? null : <Box>{state}</Box>}
            {m.description ? <Typography variant="body2">{m.description}</Typography> : null}
            <Facts milestone={m} items={items} project={project} myHours={myHours} />
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
              {children ?? (
                <MilestoneBody key={m.id} milestone={m} project={project} items={items} manage={view.manage} decides={view.decides}
                  onEdit={() => setEditing(true)} />
              )}
            </Box>
          </Stack>
        ) : null}
      </SidePanel>
      {editing && m ? (
        <MilestoneDialog project={project} milestone={m} milestones={items} members={members}
          onClose={() => setEditing(false)} onWarning={onWarning} />
      ) : null}
    </>
  )
}
