import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Check from '@mui/icons-material/Check'
import DragIndicator from '@mui/icons-material/DragIndicator'
import MoreVert from '@mui/icons-material/MoreVert'
import WarningAmber from '@mui/icons-material/WarningAmberRounded'
import {
  Box, Card, Chip, Divider, IconButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Stack, Tooltip,
  Typography,
} from '@mui/material'
import { useId, useState } from 'react'
import AvatarStack from '../../components/AvatarStack.jsx'
import DifficultyChip from '../../components/DifficultyChip.jsx'
import PriorityChip from '../../components/PriorityChip.jsx'
import { formatDate } from '../../lib/format.js'
import { PRIORITY } from '../../lib/labels.js'
import { COLUMNS, skillNames } from './board.js'

/** What a card shows: name, priority, difficulty, due date, dependencies, skills, people and its problems. */
export function CardBody({ m, names, warnings, handle, menu }) {
  const after = (m.predecessors ?? []).map((id) => names[String(id)]).filter(Boolean)
  const skills = skillNames(m)
  const people = (m.assignees ?? []).map((a) => ({ id: a.id, name: a.name }))
  return (
    <Stack sx={{ gap: 0.75 }}>
      <Stack direction="row" sx={{ gap: 0.5, alignItems: 'flex-start' }}>
        {handle}
        <Typography variant="subtitle2" component="h3" sx={{ flexGrow: 1, minWidth: 0, pt: 0.5, overflowWrap: 'anywhere' }}>
          {m.name}
        </Typography>
        {warnings.length ? (
          <Tooltip title={<Box component="ul" sx={{ m: 0, pl: 2 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</Box>}>
            <Box component="span" role="img" aria-label={`Problems: ${warnings.join('; ')}`} tabIndex={0}
              sx={{ display: 'inline-flex', color: 'warning.main', mt: 0.5, borderRadius: 1 }}>
              <WarningAmber sx={{ fontSize: 20 }} />
            </Box>
          </Tooltip>
        ) : null}
        {menu}
      </Stack>
      <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <PriorityChip priority={m.priority} />
        <DifficultyChip difficulty={m.difficulty} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Due {formatDate(m.end_date)}</Typography>
      </Stack>
      {after.length ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {after.length === 1 ? 'After' : `${after.length} dependencies: after`} {after.join(', ')}
        </Typography>
      ) : null}
      {skills.length ? (
        <Stack direction="row" useFlexGap aria-label="Required skills" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
          {skills.map((s) => <Chip key={s} size="small" label={s} sx={{ height: 20, '& .MuiChip-label': { px: 0.75 } }} />)}
        </Stack>
      ) : null}
      {people.length ? (
        <AvatarStack people={people} max={4} label={`People on ${m.name}`} sx={{ justifyContent: 'flex-start', ml: '-2px' }} />
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>Nobody assigned</Typography>
      )}
    </Stack>
  )
}

/** The card's menu: edit, move without dragging, set priority, archive. */
function CardMenu({ m, column, index, count, onEdit, onMove, onPriority, onArchive }) {
  const [anchor, setAnchor] = useState(null)
  const menuId = useId()
  const run = (fn) => () => { setAnchor(null); fn() }
  return (
    <>
      <IconButton size="small" aria-label={`Actions for ${m.name}`} aria-haspopup="menu" aria-controls={anchor ? menuId : undefined}
        aria-expanded={Boolean(anchor)} onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreVert fontSize="small" />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={run(() => onEdit(m))}>Edit…</MenuItem>
        <Divider />
        <ListSubheader>Move to…</ListSubheader>
        {COLUMNS.filter((c) => c.id !== column).map((c) => (
          <MenuItem key={c.id} onClick={run(() => onMove(m, c.id))}>{c.label}</MenuItem>
        ))}
        {index > 0 ? <MenuItem onClick={run(() => onMove(m, column, index - 1))}>Up one place</MenuItem> : null}
        {index < count - 1 ? <MenuItem onClick={run(() => onMove(m, column, index + 1))}>Down one place</MenuItem> : null}
        <Divider />
        <ListSubheader>Priority</ListSubheader>
        {Object.entries(PRIORITY).map(([value, label]) => (
          <MenuItem key={value} selected={m.priority === value} onClick={run(() => onPriority(m, value))}>
            <ListItemIcon>{m.priority === value ? <Check fontSize="small" /> : null}</ListItemIcon>
            <ListItemText>{label}</ListItemText>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={run(() => onArchive(m))} sx={{ color: 'error.main' }}>Archive…</MenuItem>
      </Menu>
    </>
  )
}

/** A draggable card. Drag by the handle (mouse, touch or keyboard: focus it, Space to lift, arrows, Space to drop). */
export default function PlanCard({ m, column, index, count, names, warnings, editable, actions }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(m.id), disabled: !editable })
  const handle = editable ? (
    <IconButton size="small" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Move ${m.name}`}
      aria-roledescription="draggable card" sx={{ cursor: 'grab', touchAction: 'none', ml: -0.75, mt: -0.25 }}>
      <DragIndicator fontSize="small" />
    </IconButton>
  ) : null
  return (
    <Card component="li" ref={setNodeRef} data-card={m.id} variant="outlined"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{ p: 1.5, opacity: isDragging ? 0.35 : 1, borderColor: warnings.length ? 'warning.main' : 'divider',
        borderLeftWidth: warnings.length ? 3 : 1 }}>
      <CardBody m={m} names={names} warnings={warnings} handle={handle}
        menu={editable ? <CardMenu m={m} column={column} index={index} count={count} {...actions} /> : null} />
    </Card>
  )
}
