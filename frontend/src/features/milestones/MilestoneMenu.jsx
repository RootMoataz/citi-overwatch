import MoreHoriz from '@mui/icons-material/MoreHoriz'
import { Divider, IconButton, ListItemText, Menu, MenuItem } from '@mui/material'
import { useId, useState } from 'react'
import { useArchiveMilestone, useMilestoneStatus } from '../../api/queries.js'
import { useToast } from '../../app/toast.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { statusActions } from '../../lib/milestoneActions.js'
import MilestoneDialog from './MilestoneDialog.jsx'

/**
 * The "⋯" on a milestone, in its row and in its panel, for whoever manages the project (callers render it only for
 * `view.manage`): Edit details, Assign people and Dependencies (today's dialog, focused on that field), the status moves
 * `statusActions` allows, Open discussion (the panel's Discussion tab) and Archive milestone (after a confirmation).
 * `onWarning` gets the dialog's dependency warning; `onArchive(milestone)` is told just before the archive request.
 */
export default function MilestoneMenu({ milestone: m, project, items, members, onOpenPanel, onWarning, onArchive }) {
  const menuId = useId()
  const toast = useToast()
  const status = useMilestoneStatus(project.id)
  const archive = useArchiveMilestone(project.id)
  const [anchor, setAnchor] = useState(null)
  const [editing, setEditing] = useState(null)   // the field the dialog opens on
  const [archiving, setArchiving] = useState(false)
  const moves = statusActions(m, { manager: true, assignee: m.is_assignee })
  const waiting = m.blocked && m.status === 'not_started'
  const waitingOn = (m.predecessors ?? []).map((id) => items.find((x) => String(x.id) === String(id))?.name).filter(Boolean)

  const close = () => setAnchor(null)
  const edit = (field) => { close(); setEditing(field) }
  const move = async (target) => {
    close()
    try { await status.mutateAsync({ id: m.id, status: target }) } catch (err) { toast.error(err.message) }
  }
  const confirmArchive = async () => {
    onArchive?.(m)
    try { await archive.mutateAsync(m.id) } catch (err) { toast.error(err.message) }
    setArchiving(false)
  }

  return (
    <>
      <IconButton aria-label={`More actions for ${m.name}`} aria-haspopup="menu" aria-expanded={anchor ? 'true' : undefined}
        aria-controls={anchor ? menuId : undefined} onClick={(e) => setAnchor(e.currentTarget)} sx={{ width: 44, height: 44 }}>
        <MoreHoriz />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={() => edit('name')}>Edit details</MenuItem>
        <MenuItem onClick={() => edit('assignee_ids')}>Assign people</MenuItem>
        <MenuItem onClick={() => edit('predecessor_ids')}>Dependencies</MenuItem>
        {moves.length ? <Divider /> : null}
        {moves.map((a) => (
          <MenuItem key={a.target + a.label} disabled={waiting || status.isPending} onClick={() => move(a.target)}>
            {waiting && waitingOn.length
              ? <ListItemText primary={a.label} secondary={`Waiting on: ${waitingOn.join(', ')}`} />
              : a.label}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => { close(); onOpenPanel?.(m, 'discussion') }}>Open discussion</MenuItem>
        <MenuItem onClick={() => { close(); setArchiving(true) }} sx={{ color: 'error.main' }}>Archive milestone</MenuItem>
      </Menu>
      {editing ? (
        <MilestoneDialog project={project} milestone={m} milestones={items} members={members} focusField={editing}
          onClose={() => setEditing(null)} onWarning={onWarning} />
      ) : null}
      <ConfirmDialog open={archiving} title="Archive this milestone?" confirmLabel="Archive" busy={archive.isPending}
        body="It's hidden from the project and stops counting toward progress and budget. An admin can restore it."
        onClose={() => setArchiving(false)} onConfirm={confirmArchive} />
    </>
  )
}
