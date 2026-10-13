import Notifications from '@mui/icons-material/NotificationsOutlined'
import { Badge, Divider, IconButton, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarkAllRead, useMarkRead, useNotifications } from '../api/queries.js'

/** Unread over-40h alerts; opening one marks it read and filters Approvals to that person. */
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
    navigate(`/approvals?user=${n.subject_user.id}`)
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
            <ListItemText primary={n.message} secondary="Review their hours in Approvals" />
          </MenuItem>
        ))}
        {items.length ? <Divider /> : null}
        {items.length ? <MenuItem onClick={() => { setAnchor(null); markAll.mutate() }}>Mark all as read</MenuItem> : null}
      </Menu>
    </>
  )
}
