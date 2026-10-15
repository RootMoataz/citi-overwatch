import Add from '@mui/icons-material/Add'
import Archive from '@mui/icons-material/ArchiveOutlined'
import ChatBubble from '@mui/icons-material/ChatBubbleOutlineOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, IconButton, Skeleton, Stack, Tooltip, Typography,
} from '@mui/material'
import { Fragment, useState } from 'react'
import {
  useArchiveMilestone, useClaimMilestone, useMembers, useMilestones, useMilestoneStatus,
} from '../../api/queries.js'
import { useConversations } from '../../api/messages.js'
import AvatarStack from '../../components/AvatarStack.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import DifficultyChip from '../../components/DifficultyChip.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import PriorityChip from '../../components/PriorityChip.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import SupportingChip from '../../components/SupportingChip.jsx'
import Timeline from '../../components/Timeline.jsx'
import EstimateLine from '../../components/EstimateLine.jsx'
import { formatDate } from '../../lib/format.js'
import { statusActions } from '../../lib/milestoneActions.js'
import DiscussButton from '../messages/DiscussButton.jsx'
import MilestoneDialog from './MilestoneDialog.jsx'
import MilestoneNotes from './MilestoneNotes.jsx'

function MilestoneCard({ m, project, names, manage, onEdit, onArchive, extra, conversations }) {
  const status = useMilestoneStatus(m.project_id)
  const claim = useClaimMilestone(m.project_id)
  const [notesOpen, setNotesOpen] = useState(false)
  const [failure, setFailure] = useState(null)
  const waitingOn = m.predecessors.map((id) => names[String(id)]).filter(Boolean)
  const supporting = new Set((m.supporting_ids ?? []).map(String))
  const actions = statusActions(m, { manager: manage, assignee: m.is_assignee })
  // Primary assignees first; when some people are only supporting, the primaries get a ring to tell them apart.
  const mixed = m.assignees.some((a) => supporting.has(String(a.id)))
  const ordered = [...m.assignees].sort((a, b) => supporting.has(String(a.id)) - supporting.has(String(b.id)))
  const people = ordered.map((a) => {
    const helper = supporting.has(String(a.id))
    return { id: a.id, name: a.name, detail: helper ? 'Supporting' : 'Primary', highlight: mixed && !helper }
  })

  const move = async (target) => {
    setFailure(null)
    try { await status.mutateAsync({ id: m.id, status: target }) } catch (err) { setFailure(err) }
  }

  const take = async () => {
    setFailure(null)
    try { await claim.mutateAsync(m.id) } catch (err) { setFailure(err) }
  }

  return (
    <Card data-milestone={m.id}>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" component="h3">{m.name}</Typography>
              <StatusChip status={m.display_status} />
              <PriorityChip priority={m.priority} />
              <DifficultyChip difficulty={m.difficulty} />
              {m.is_assignee ? <Chip size="small" variant="outlined" label="Assigned to you" /> : null}
            </Stack>
            <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {formatDate(m.start_date)} – {formatDate(m.end_date)}
              {waitingOn.length ? ` · after ${waitingOn.join(', ')}` : ''}
            </Typography>
            <EstimateLine milestone={m} />
            <Stack direction="row" useFlexGap
              sx={{ mt: 1.25, gap: 1, alignItems: 'center' }}>
              {people.length ? (
                <>
                  <AvatarStack people={people} max={4} label={`People on ${m.name}`} sx={{ ml: '-2px' }} />
                  <Typography variant="body2" component="div" sx={{ minWidth: 0 }}>
                    {ordered.map((a, i) => (
                      <Fragment key={a.id}>
                        {i ? ', ' : ''}<PersonLink person={a} context={{ project }} />
                        {supporting.has(String(a.id)) ? <SupportingChip person={a.name} /> : null}
                      </Fragment>
                    ))}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>Nobody assigned</Typography>
              )}
            </Stack>
            {m.description ? <Typography variant="body2" sx={{ mt: 1 }}>{m.description}</Typography> : null}
          </Box>
          {manage ? (
            <Stack direction="row" sx={{ alignSelf: 'flex-start' }}>
              <Tooltip title="Edit"><IconButton aria-label={`Edit ${m.name}`} onClick={() => onEdit(m)}><EditIcon /></IconButton></Tooltip>
              <Tooltip title="Archive"><IconButton aria-label={`Archive ${m.name}`} onClick={() => onArchive(m)}><Archive /></IconButton></Tooltip>
            </Stack>
          ) : null}
        </Stack>
        <ErrorAlert error={failure} sx={{ mt: 1 }} />
        <Stack direction="row" useFlexGap sx={{ gap: 1, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          {m.can_claim ? (
            <Button size="small" variant="contained" aria-label={`Claim ${m.name}`} disabled={claim.isPending} onClick={take}>
              Claim
            </Button>
          ) : null}
          {actions.map((a) => {
            const blocked = m.blocked && m.status === 'not_started'
            const button = (
              <Button key={a.target + a.label} size="small" variant={a.primary ? 'contained' : 'outlined'}
                disabled={blocked || status.isPending} onClick={() => move(a.target)}>{a.label}</Button>
            )
            return blocked ? (
              <Tooltip key={a.label} title={`Waiting on: ${waitingOn.join(', ')}`}><span>{button}</span></Tooltip>
            ) : button
          })}
          <Box sx={{ flexGrow: 1 }} />
          <DiscussButton milestone={m} manage={manage} conversations={conversations} />
          <Button size="small" startIcon={<ChatBubble />} aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)}>
            Notes
          </Button>
        </Stack>
        {extra ? extra(m) : null}
        <Collapse in={notesOpen} unmountOnExit>
          <MilestoneNotes milestoneId={m.id} canPost={manage || m.is_assignee} />
        </Collapse>
      </CardContent>
    </Card>
  )
}

export default function MilestonesTab({ project, manage, extra }) {
  const milestones = useMilestones(project.id)
  const members = useMembers(project.id)
  const archive = useArchiveMilestone(project.id)
  const conversations = useConversations()  // which milestones already have a discussion the viewer is in
  const [editing, setEditing] = useState(null)
  const [archiving, setArchiving] = useState(null)
  const [warning, setWarning] = useState('')
  const items = milestones.data ?? []
  const names = Object.fromEntries(items.map((m) => [String(m.id), m.name]))

  return (
    <Stack sx={{ gap: 2 }}>
      {manage ? (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={<Add />} onClick={() => setEditing({ milestone: null })}>Add milestone</Button>
        </Stack>
      ) : null}
      {project.work_mode === 'pull' ? (
        <Alert severity="info">
          This project works in pull mode: team members claim milestones that are ready to start and have nobody on them.
          Claiming one makes you its owner and lets the manager know.
        </Alert>
      ) : null}
      {warning ? <Alert severity="warning" onClose={() => setWarning('')}>{warning}</Alert> : null}
      <ErrorAlert error={milestones.error} onRetry={() => milestones.refetch()} />
      {milestones.isLoading ? <Skeleton variant="rounded" height={160} /> : null}
      {!milestones.isLoading && !milestones.error && items.length === 0 ? (
        <EmptyState title="No milestones yet"
          description={manage ? 'Break the project into milestones with dates, owners and dependencies.' : 'The project manager adds milestones here.'} />
      ) : null}
      {items.length ? <Timeline items={items} range={{ start: project.start_date, end: project.predicted_end_date }} /> : null}
      {items.map((m) => (
        <MilestoneCard key={m.id} m={m} project={project} names={names} manage={manage} extra={extra}
          conversations={conversations.data?.items}
          onEdit={(milestone) => setEditing({ milestone })} onArchive={setArchiving} />
      ))}
      {editing ? (
        <MilestoneDialog project={project} milestone={editing.milestone} milestones={items} members={members.data ?? []}
          onClose={() => setEditing(null)} onWarning={setWarning} />
      ) : null}
      <ConfirmDialog open={Boolean(archiving)} title="Archive this milestone?" confirmLabel="Archive" busy={archive.isPending}
        body="It's hidden from the project and stops counting toward progress and budget. An admin can restore it."
        onClose={() => setArchiving(null)}
        onConfirm={async () => { await archive.mutateAsync(archiving.id); setArchiving(null) }} />
    </Stack>
  )
}
