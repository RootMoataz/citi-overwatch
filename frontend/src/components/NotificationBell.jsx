import Notifications from '@mui/icons-material/NotificationsOutlined'
import { Badge, Divider, IconButton, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarkAllRead, useMarkRead, useNotifications } from '../api/queries.js'

/** The project's milestones tab, scrolled to the milestone the alert is about. */
const milestoneLink = (n) => `/projects/${n.payload.project.id}?tab=milestones&milestone=${n.payload.milestone.id}`

/** Where each alert type leads, and the hint shown under its message. */
const TARGETS = {
  OVER_40H: (n) => [`/timesheets?user=${n.subject_user.id}`, 'Review their hours in Timesheets'],
  ENTRY_REJECTED: (n) => [`/timesheet?week=${n.week_start}`, 'Open your timesheet for that week'],
  SUPPORT_ASSIGNED: (n) => [`/projects/${n.payload.project.id}?tab=milestones`, "Open the project's milestones"],
  SUPPORT_ROUTED: (n) => [`/projects/${n.payload.project.id}?tab=milestones`, "Open the project's milestones"],
  MILESTONE_CLAIMED: (n) => [`/projects/${n.payload.project.id}?tab=milestones`, "Open the project's milestones"],
  DELEGATE_ASSIGNED: (n) => [`/timesheets?project=${n.payload.project.id}`, "Review the project's hours in Timesheets"],
  TIMESHEET_EMPTY: (n) => [`/timesheet?week=${n.week_start}`, 'Log your hours for that week'],
  TIMER_AUTO_STOPPED: (n) => [`/timesheet?week=${n.week_start}`, 'Open your timesheet to submit the hours'],
  TIMER_STOPPED_BY_MANAGER: (n) => [`/timesheet?week=${n.week_start}`, 'Open your timesheet to submit the hours'],
  TIMER_OVER_LIMIT: () => ['/timesheets', 'See who is running a timer'],
  TIME_EDIT_REQUESTED: () => ['/timesheets#change-requests', 'Approve or reject it in Timesheets'],
  TIME_EDIT_APPROVED: (n) => [`/timesheet?week=${n.week_start}`, 'Open your timesheet'],
  TIME_EDIT_REJECTED: (n) => [`/timesheet?week=${n.week_start}`, 'Open your timesheet'],
  PLAN_FINALIZED: (n) => [`/projects/${n.payload.project.id}?tab=milestones`, "Open the project's milestones"],
  MESSAGE_RECEIVED: (n) => [`/messages/${n.payload.conversation_id}`, 'Open the conversation'],
  AUTO_ASSIGNED: (n) => [milestoneLink(n), 'Open the milestone'],
  AUTO_ROUTED: (n) => [milestoneLink(n), 'Open the milestone to reassign it if needed'],
  NO_QUALIFIED_PERSON: (n) => [milestoneLink(n), 'Open the milestone to assign someone'],
  MILESTONE_UPDATE: (n) => [milestoneLink(n), 'Open the work log'],
  KICKBACK_RAISED: (n) => [milestoneLink(n), 'Review the kickback'],
  KICKBACK_RESOLVED: (n) => [milestoneLink(n), 'Open the milestone'],
}
const target = (n) => (TARGETS[n.type] ?? TARGETS.OVER_40H)(n)

/** Unread alerts (overtime, rejected hours, auto-routing, claimed milestones, progress updates, kickbacks, Friday's
 * empty-timesheet reminder, new messages); opening one marks it read and goes to the page it's about. */
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
      <IconButton aria-label={`Notifications, ${items.length} unread`} onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ flexShrink: 0 }}>
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
