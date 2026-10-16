import ChevronRight from '@mui/icons-material/ChevronRight'
import PanTool from '@mui/icons-material/PanToolOutlined'
import Schedule from '@mui/icons-material/ScheduleOutlined'
import { Box, Chip, Link, Stack, Tooltip, Typography } from '@mui/material'
import AvatarStack from '../../components/AvatarStack.jsx'
import DataTable from '../../components/DataTable.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { effortText } from '../../lib/estimates.js'
import { formatDate, formatHours, nyTodayIso } from '../../lib/format.js'
import { STATUS_ORDER, assigneePeople, predecessorNames, stateOf } from './milestoneOrder.js'

const NARROW = ['index', 'name', 'status']
const EFFORT_INFO = 'Logged counts pending and approved hours of everyone on the milestone.'

const firstName = (name) => String(name ?? '').split(' ')[0]
const youTag = <Chip size="small" variant="outlined" color="primary" label="You" sx={{ height: 20, fontSize: '0.6875rem' }} />

/** Up to three avatars, then "+N" for the rest, then everyone's first name. */
function Assignees({ milestone: m }) {
  const people = assigneePeople(m)
  if (!people.length) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>Unassigned</Typography>
  const rest = people.slice(3)
  const others = rest.map((p) => p.name).join(', ')
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <AvatarStack people={people.slice(0, 3)} max={3} label={`People on ${m.name}`} />
      {rest.length ? (
        <Tooltip title={others}>
          <Box role="img" aria-label={`${rest.length} more: ${others}`}
            sx={{ px: 0.75, height: 22, borderRadius: 11, display: 'inline-flex', alignItems: 'center', flexShrink: 0,
              bgcolor: 'action.selected', color: 'primary.main', fontSize: '0.75rem', fontWeight: 600 }}>
            {`+${rest.length}`}
          </Box>
        </Tooltip>
      ) : null}
      <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 0 }}>{people.map((p) => firstName(p.name)).join(', ')}</Typography>
    </Stack>
  )
}

function PendingChip({ pending }) {
  if (!pending?.count) return null
  return <Chip size="small" variant="outlined" color="warning" icon={<Schedule />} label={`${pending.count} pending`} />
}

/**
 * The Milestones tab's List: one row per milestone in `items` (the shown, filtered part of `all`, which is the whole
 * list in the API's dependency order and gives each row its "#" and its dependencies' names). Columns follow the
 * viewer: Approvals for `view.decides`, Your hours for `view.mine`, and the "⋯" from `menuFor(milestone)` when given.
 * `narrow` (a panel is open beside it) keeps #, Milestone and Status, where the pending chip then sits. The name is a
 * button, the row's one keyboard target; a click anywhere on the row opens it too (`onOpen`). Phones get cards, with
 * the "⋯" beside each card's tap area.
 */
export default function MilestoneList({ items, all = items, view, pendingByMilestone, myHoursByMilestone, selectedId, narrow,
  onOpen, menuFor, loading = false, empty }) {
  const today = nyTodayIso()
  const position = Object.fromEntries(all.map((m, i) => [String(m.id), i + 1]))
  const dependency = (m) => {
    const names = predecessorNames(m, all)
    return names.length ? `Dependency: after ${names.join(', ')}` : 'Dependency: None'
  }
  const pendingOf = (m) => pendingByMilestone?.[String(m.id)]
  const myHours = (m) => {
    const hours = Number(myHoursByMilestone?.[String(m.id)])
    return hours ? formatHours(hours) : '—'
  }
  const overdue = (m) => m.status !== 'completed' && String(m.end_date).slice(0, 10) < today
  const dates = (m) => (
    <Box>
      <Typography variant="body2" component="div" sx={{ whiteSpace: 'nowrap', color: overdue(m) ? 'error.main' : undefined }}>
        {`${formatDate(m.start_date)} – ${formatDate(m.end_date)}`}
      </Typography>
      {overdue(m) ? <Typography variant="caption" component="div" sx={{ color: 'error.main', fontWeight: 600 }}>Overdue</Typography> : null}
    </Box>
  )
  const effort = (m) => {
    const { text, over } = effortText(m)
    return (
      <Box>
        <Typography variant="body2" component="div" sx={{ whiteSpace: 'nowrap' }}>{text}</Typography>
        {over ? <Typography variant="caption" component="div" sx={{ color: 'warning.main', fontWeight: 600 }}>{over}</Typography> : null}
      </Box>
    )
  }
  const status = (m, withPending) => (
    <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
      <StatusChip status={stateOf(m)} icon />
      {m.open_kickback ? <Chip size="small" variant="outlined" color="error" icon={<PanTool />} label="Kicked back" /> : null}
      {withPending ? <PendingChip pending={pendingOf(m)} /> : null}
    </Stack>
  )

  const columns = [
    { key: 'index', header: '#', render: (m) => (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{position[String(m.id)]}</Typography>) },
    { key: 'name', header: 'Milestone', sortable: true, sortValue: (m) => m.name, render: (m) => (
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Link component="button" type="button" data-milestone-name={m.id} onClick={() => onOpen(m)} underline="hover"
            sx={{ fontWeight: 600, textAlign: 'left', color: 'text.primary', fontSize: '0.9375rem' }}>{m.name}</Link>
          {m.is_assignee ? youTag : null}
        </Stack>
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{dependency(m)}</Typography>
      </Box>) },
    { key: 'status', header: 'Status', sortable: true, sortValue: (m) => STATUS_ORDER.indexOf(stateOf(m)),
      render: (m) => status(m, narrow) },
    { key: 'assignees', header: 'Assignees', render: (m) => <Assignees milestone={m} /> },
    { key: 'dates', header: 'Planned dates', sortable: true, sortValue: (m) => m.start_date, render: dates },
    { key: 'effort', header: <>Effort <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>(logged / estimate)</Box></>,
      info: EFFORT_INFO, render: effort },
    ...(view.decides ? [{ key: 'approvals', header: 'Approvals',
      render: (m) => (pendingOf(m)?.count ? <PendingChip pending={pendingOf(m)} /> : '—') }] : []),
    ...(view.mine ? [{ key: 'yours', header: 'Your hours', render: myHours }] : []),
    { key: 'more', header: 'More', align: 'right', render: (m) => (
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
        <ChevronRight aria-hidden="true" sx={{ color: 'text.secondary' }} />
        {menuFor?.(m)}
      </Stack>) },
  ]

  // Phones: the card's tap area is a button, so it holds no buttons; the "⋯" sits beside it (`renderCardActions`).
  const renderCard = (m) => (
    <Stack data-milestone-card={m.id} sx={{ gap: 0.75 }}>
      <Box>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600 }}>{`${position[String(m.id)]}. ${m.name}`}</Typography>
          {m.is_assignee ? youTag : null}
        </Stack>
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{dependency(m)}</Typography>
      </Box>
      {status(m, view.decides)}
      <CardLine label="Planned dates">{dates(m)}</CardLine>
      <CardLine label="Effort">{effort(m)}</CardLine>
      <CardLine label="Assignees">
        {m.assignees?.length ? assigneePeople(m).map((p) => firstName(p.name)).join(', ') : 'Unassigned'}
      </CardLine>
      {view.mine ? <CardLine label="Your hours">{myHours(m)}</CardLine> : null}
    </Stack>
  )

  return (
    <DataTable ariaLabel="Milestones" columns={columns} rows={items} getRowId={(m) => String(m.id)}
      visibleKeys={narrow ? NARROW : undefined} onRowOpen={onOpen} selectedId={selectedId} renderCard={renderCard}
      renderCardActions={menuFor}
      loading={loading} empty={empty} />
  )
}

function CardLine({ label, children }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{label}:</Typography>
      <Box sx={{ textAlign: 'right', typography: 'body2' }}>{children}</Box>
    </Box>
  )
}
