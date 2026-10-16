import CalendarToday from '@mui/icons-material/CalendarTodayOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import Group from '@mui/icons-material/GroupOutlined'
import Schedule from '@mui/icons-material/ScheduleOutlined'
import { Box, Button, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import { Fragment, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import AvatarStack from '../../components/AvatarStack.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import SidePanel from '../../components/SidePanel.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import SupportingChip from '../../components/SupportingChip.jsx'
import { formatDate, formatHours } from '../../lib/format.js'
import { WIDE_QUERY } from '../../lib/responsive.js'
import MilestoneDialog from './MilestoneDialog.jsx'
import MilestoneHistory from './MilestoneHistory.jsx'
import MilestoneMenu from './MilestoneMenu.jsx'
import MilestoneNotes from './MilestoneNotes.jsx'
import WorkLog from './WorkLog.jsx'
import { assigneePeople, predecessorNames, stateOf } from './milestoneOrder.js'
import DetailsTab from './panel/DetailsTab.jsx'
import DiscussionTab from './panel/DiscussionTab.jsx'
import { panelTabFor, panelTabsFor } from './panel/panelTabs.js'

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
  const after = predecessorNames(m, items)
  const people = assigneePeople(m)
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
              {people.map((person, i) => (
                <Fragment key={person.id}>
                  {i ? ', ' : ''}<PersonLink person={person} context={{ project }} />
                  {person.supporting ? <SupportingChip person={person.name} /> : null}
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

/**
 * The milestone's side panel beside `list` (a full-screen sheet on phones), open while `milestone` is set. Header: the
 * name (H2) and its state, then "Edit" and the "⋯" for managers, and Close. Under it: the description and three facts
 * (dates and dependencies, people, hours with "· You: <N>h" for an assignee). Below the facts come the tabs
 * (Details, Approvals for people who decide hours, Discussion, Work log, History, Notes), the open one named by
 * `panel` (the URL's ?panel=; one the viewer doesn't have, or none, opens Details) and changed with `onPanel`; or
 * `children` when given. Below `lg` the header has less room, so the state chip opens
 * the body instead and Edit is an icon. `onArchiveStart` and `onArchiveFailed` go to the "⋯" (see MilestoneMenu).
 */
export default function MilestonePanel({ project, milestone, items, members, view, user, myHours, panel, onPanel, onClose,
  returnFocus, onOpenPanel, onWarning, onArchiveStart, onArchiveFailed, list, children }) {
  const wide = useMediaQuery(WIDE_QUERY)
  const [editing, setEditing] = useState(false)
  const m = milestone
  const tabs = panelTabsFor(view)
  const tab = panelTabFor(view, panel)
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
      <MilestoneMenu milestone={m} project={project} items={items} members={members} manage={view.manage}
        onOpenPanel={onOpenPanel} onWarning={onWarning} onArchiveStart={onArchiveStart} onArchiveFailed={onArchiveFailed} />
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
                <>
                  <Tabs value={tab} onChange={(_, value) => onPanel?.(value)} variant="scrollable" allowScrollButtonsMobile
                    aria-label={`Sections of ${m.name}`} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, minHeight: 44 }}>
                    {tabs.map((t) => <Tab key={t.value} value={t.value} label={t.label} id={`milestone-tab-${t.value}`}
                      aria-controls={`milestone-panel-${t.value}`} sx={{ minHeight: 44 }} />)}
                  </Tabs>
                  <Box role="tabpanel" id={`milestone-panel-${tab}`} aria-labelledby={`milestone-tab-${tab}`} key={`${m.id}-${tab}`}>
                    {tab === 'details' ? (
                      <DetailsTab milestone={m} items={items} project={project} manage={view.manage} decides={view.decides}
                        onEdit={() => setEditing(true)} />
                    ) : null}
                    {tab === 'approvals' ? (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Hours waiting on this milestone are listed under Details for now.
                      </Typography>
                    ) : null}
                    {tab === 'discussion' ? <DiscussionTab milestone={m} manage={view.manage} user={user} /> : null}
                    {tab === 'worklog' ? <WorkLog milestone={m} /> : null}
                    {tab === 'history' ? <MilestoneHistory milestone={m} /> : null}
                    {tab === 'notes' ? <MilestoneNotes milestoneId={m.id} canPost={view.manage || m.is_assignee} /> : null}
                  </Box>
                </>
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
