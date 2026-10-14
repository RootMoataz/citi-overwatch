import Notifications from '@mui/icons-material/NotificationsOutlined'
import { Badge, Divider, IconButton, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarkAllRead, useMarkRead, useNotifications } from '../api/queries.js'

/** Where each alert type leads, and the hint shown under its message. */
const TARGETS = {
  OVER_40H: (n) => [`/approvals?user=${n.subject_user.id}`, 'Review their hours in Approvals'],
  ENTRY_REJECTED: (n) => [`/timesheet?week=${n.week_start}`, 'Open your timesheet for that week'],
  SUPPORT_ASSIGNED: (n) => [`/projects/${n.payload.project.id}?tab=milestones`, "Open the project's milestones"],
  SUPPORT_ROUTED: (n) => [`/projects/${n.payload.project.id}?tab=milestones`, "Open the project's milestones"],
}
const target = (n) => (TARGETS[n.type] ?? TARGETS.OVER_40H)(n)

/** Unread alerts (overtime, rejected hours, auto-routed support); opening one marks it read and goes to the page it's about. */
export default function NotificationBell() {
  const navigate = useNavigate()
  const notifications = useNotifications()
  const markRead = useMarkRead()
  const markAll = useMarkAllRead()
  const [anchor, setAnchor] = useState(null)
  const items = notifications.data ?? []

  const open = async (n) => {
    setAnchor(null)
    try { await markRead.mutateAsync(n.id) } catch { /* the link still works */ }
    navigate(target(n)[0])
  }

  return (
    <>
      <IconButton aria-label={`Notifications, ${items.length} unread`} onClick={(e) => setAnchor(e.currentTarget)}>
        <Badge badgeContent={items.length} color="warning"><Notifications /></Badge>
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 340, maxWidth: '90vw' } } }}>
        <Typography variant="subtitle1" sx={{ px: 2, py: 1 }}>Notifications</Typography>
        <Divider />
        {items.length === 0 ? <MenuItem disabled>You're all caught up</MenuItem> : null}
        {items.map((n) => (
          <MenuItem key={n.id} onClick={() => open(n)} sx={{ whiteSpace: 'normal' }}>
            <ListItemText primary={n.message} secondary={target(n)[1]} />
          </MenuItem>
        ))}
        {items.length ? <Divider /> : null}
        {items.length ? <MenuItem onClick={() => { setAnchor(null); markAll.mutate() }}>Mark all as read</MenuItem> : null}
      </Menu>
    </>
  )
}
