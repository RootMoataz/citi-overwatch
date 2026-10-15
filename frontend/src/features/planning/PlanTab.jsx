import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import Flag from '@mui/icons-material/FlagOutlined'
import { Alert, Box, Button, Card, Chip, Skeleton, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useArchiveMilestone, useMembers, useMilestones, useSaveMilestone } from '../../api/queries.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatDate } from '../../lib/format.js'
import { useCalmMotion } from '../../lib/motion.js'
import MilestoneDialog from '../milestones/MilestoneDialog.jsx'
import { buildColumns, cardWarnings, COLUMN_LABEL, COLUMNS, moveCard, toOrderItems } from './board.js'
import FinalizeDialog from './FinalizeDialog.jsx'
import PlanCard, { CardBody } from './PlanCard.jsx'
import PlanColumn from './PlanColumn.jsx'
import { usePlan, useQuickAddCard, useReorderPlan } from './planningApi.js'

const columnIn = (columns, id) => (COLUMN_LABEL[id] ? id : Object.keys(columns).find((k) => columns[k].includes(id)))
const sameOrder = (a, b) => COLUMNS.every((c) => a[c.id].join() === b[c.id].join())

const INSTRUCTIONS = 'To move a card, focus its move handle and press Space or Enter. Use the arrow keys to move it '
  + 'within and between columns, Space or Enter to drop it, Escape to cancel. Or use the card\'s actions menu.'

/** The Plan tab: while the project is Planned, its manager (or an admin) arranges milestones on a Kanban board
 * (Backlog → Ready → Scheduled) and finalizes the plan. Everyone else, and everyone after finalizing, sees it read-only. */
export default function PlanTab({ project, manage }) {
  const [, setParams] = useSearchParams()
  const milestones = useMilestones(project.id)
  const plan = usePlan(project.id)
  const members = useMembers(project.id)
  const reorder = useReorderPlan(project.id)
  const quickAdd = useQuickAddCard(project.id)
  const save = useSaveMilestone(project.id)
  const archive = useArchiveMilestone(project.id)
  const calm = useCalmMotion()
  const [draft, setDraft] = useState(null)  // the board while a card is being dragged
  const [activeId, setActiveId] = useState(null)
  const [editing, setEditing] = useState(null)
  const [archiving, setArchiving] = useState(null)
  const [finalizing, setFinalizing] = useState(false)
  const [warning, setWarning] = useState('')
  const [failure, setFailure] = useState(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const items = useMemo(() => milestones.data ?? [], [milestones.data])
  const byId = useMemo(() => Object.fromEntries(items.map((m) => [String(m.id), m])), [items])
  const names = useMemo(() => Object.fromEntries(items.map((m) => [String(m.id), m.name])), [items])
  const saved = useMemo(() => buildColumns(items), [items])
  const columns = draft ?? saved
  const editable = manage && Boolean(plan.data?.editable)
  const finalizedAt = plan.data?.plan_finalized_at ?? project.plan_finalized_at

  const commit = (next) => { if (!sameOrder(next, saved)) reorder.mutate(toOrderItems(next)) }
  const label = (id) => byId[id]?.name ?? 'card'
  const placeOf = (cols, id) => {
    const col = columnIn(cols, id)
    return col ? `${COLUMN_LABEL[col]}, position ${cols[col].indexOf(id) + 1} of ${cols[col].length}` : ''
  }
  const announcements = {
    onDragStart: ({ active }) => `Picked up ${label(active.id)}. ${placeOf(columns, active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${label(active.id)} is over ${placeOf(columns, String(over.id)) || COLUMN_LABEL[over.id]}.` : ''),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${label(active.id)}.` : `${label(active.id)} was put back.`),
    onDragCancel: ({ active }) => `Moving ${label(active.id)} was cancelled; it's back where it was.`,
  }

  const onDragStart = ({ active }) => { setActiveId(String(active.id)); setDraft(saved) }
  const onDragOver = ({ active, over }) => {
    if (!over) return
    setDraft((cols) => {
      const current = cols ?? saved
      const from = columnIn(current, String(active.id))
      const to = columnIn(current, String(over.id))
      if (!from || !to || from === to) return current
      const at = current[to].indexOf(String(over.id))
      return moveCard(current, String(active.id), to, at === -1 ? current[to].length : at)
    })
  }
  const onDragEnd = ({ active, over }) => {
    const current = draft ?? saved
    setActiveId(null)
    setDraft(null)
    if (!over) return
    const id = String(active.id)
    const to = columnIn(current, String(over.id))
    let next = current
    if (to && to === columnIn(current, id)) {
      const at = current[to].indexOf(String(over.id))
      if (at !== -1 && at !== current[to].indexOf(id)) next = moveCard(current, id, to, at)
    }
    commit(next)
  }
  const onDragCancel = () => { setActiveId(null); setDraft(null) }

  const actions = {
    onEdit: (m) => setEditing({ milestone: m }),
    onMove: (m, to, index) => commit(moveCard(saved, String(m.id), to, index)),
    onPriority: (m, priority) => {
      if (m.priority !== priority) save.mutate({ id: m.id, fields: { priority }, predecessorIds: null, assigneeIds: null })
    },
    onArchive: setArchiving,
  }

  const add = async (column, name) => {
    setFailure(null)
    try {
      const created = await quickAdd.mutateAsync({ name, project, column, columns: saved })
      setEditing({ milestone: created })  // straight on to dates, people and dependencies
    } catch (err) {
      setFailure(err)
    }
  }

  const checks = plan.data?.checks ?? []
  const failing = checks.filter((c) => !c.ok).length
  const active = activeId ? byId[activeId] : null

  return (
    <Stack sx={{ gap: 2 }}>
      {finalizedAt ? (
        <Alert severity="success" icon={<Flag />}>
          Plan finalized on {formatDate(finalizedAt)}. The board is read-only now; the work itself happens on the
          Milestones tab.
        </Alert>
      ) : null}
      {!finalizedAt && !editable && plan.data ? (
        <Alert severity="info">
          {project.manager?.name || 'The project manager'} is still planning this project. This is the plan so far.
        </Alert>
      ) : null}
      {editable ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 640 }}>
            Shape the plan: move milestones from Backlog through Ready to Scheduled, in the order the work will happen.
            Finalize when everything is scheduled, dated and staffed.
          </Typography>
          <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexShrink: 0 }}>
            {checks.length ? (
              <Chip size="small" variant="outlined" color={failing ? 'warning' : 'success'}
                label={failing ? `${failing} of ${checks.length} checks to fix` : 'Ready to finalize'} />
            ) : null}
            <Button variant="contained" startIcon={<Flag />} onClick={() => setFinalizing(true)}>Finalize plan</Button>
          </Stack>
        </Stack>
      ) : null}
      {warning ? <Alert severity="warning" onClose={() => setWarning('')}>{warning}</Alert> : null}
      <ErrorAlert error={milestones.error ?? plan.error} onRetry={() => { milestones.refetch(); plan.refetch() }} />
      <ErrorAlert error={failure} />
      {milestones.isLoading ? <Skeleton variant="rounded" height={280} /> : null}
      {!milestones.isLoading && !milestones.error ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart}
          onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}
          accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}>
          <Box role="region" aria-label="Planning board" tabIndex={0}
            sx={{ display: 'grid', gridAutoFlow: 'column', gap: 2, overflowX: 'auto', pb: 1, borderRadius: 1,
              gridAutoColumns: { xs: 'minmax(260px, 84%)', sm: 'minmax(280px, 1fr)' },
              scrollSnapType: { xs: 'x mandatory', md: 'none' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
            {COLUMNS.map((column) => (
              <PlanColumn key={column.id} column={column} ids={columns[column.id]} editable={editable}
                adding={quickAdd.isPending ? quickAdd.variables?.column : null} onAdd={(name) => add(column.id, name)}>
                {columns[column.id].map((id, index) => byId[id] ? (
                  <PlanCard key={id} m={byId[id]} column={column.id} index={index} count={columns[column.id].length}
                    names={names} editable={editable} actions={actions}
                    warnings={cardWarnings(byId[id], { project, columns, names })} />
                ) : null)}
              </PlanColumn>
            ))}
          </Box>
          <DragOverlay dropAnimation={calm ? null : undefined}>
            {active ? (
              <Card variant="outlined" sx={{ p: 1.5, boxShadow: 8, cursor: 'grabbing', transform: calm ? 'none' : 'rotate(1.5deg)' }}>
                <CardBody m={active} names={names} warnings={cardWarnings(active, { project, columns, names })} />
              </Card>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}
      {editing ? (
        <MilestoneDialog project={project} milestone={editing.milestone} milestones={items} members={members.data ?? []}
          onClose={() => setEditing(null)} onWarning={setWarning} />
      ) : null}
      <ConfirmDialog open={Boolean(archiving)} title={`Archive ${archiving?.name ?? 'this card'}?`} confirmLabel="Archive"
        busy={archive.isPending}
        body="It comes off the board and the plan. An admin or this project's manager can restore it from the archive."
        onClose={() => setArchiving(null)}
        onConfirm={async () => { await archive.mutateAsync(archiving.id); setArchiving(null) }} />
      {finalizing ? (
        <FinalizeDialog project={project} onClose={() => setFinalizing(false)}
          onFinalized={() => { setFinalizing(false); setParams({ tab: 'milestones' }, { replace: true }) }} />
      ) : null}
    </Stack>
  )
}
