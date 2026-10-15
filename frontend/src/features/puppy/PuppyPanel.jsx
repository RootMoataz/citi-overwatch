import ChevronRight from '@mui/icons-material/ChevronRightRounded'
import DoneAll from '@mui/icons-material/DoneAllRounded'
import ErrorOutline from '@mui/icons-material/ErrorOutlineOutlined'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import WarningAmber from '@mui/icons-material/WarningAmber'
import {
  Box, Button, Divider, List, ListItem, ListItemButton, ListItemText, Skeleton, Stack, Tab, Tabs, Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client.js'
import { useUnreadMessages } from '../../api/messages.js'
import { useApprovals, useMarkAllRead, useMissingTimesheets } from '../../api/queries.js'
import { ROUTE_ROLES } from '../../app/access.js'
import { can } from '../../lib/permissions.js'
import AskPuppy from './AskPuppy.jsx'
import PuppyFace from './PuppyFace.jsx'
import SoundSettings from './SoundSettings.jsx'
import { buildSummary } from './summary.js'

export const PUPPY_TAGLINE = 'Puppy · your rule-based assistant'
export const PUPPY_DISCLAIMER = 'Puppy follows rules from your data — no AI service involved.'

const SEVERITY_ICON = { high: [ErrorOutline, 'error.main'], medium: [WarningAmber, 'warning.main'], low: [InfoOutlined, 'info.main'] }

// The dashboard's smart insights, from the same cache entry as the dashboard's panel (all departments).
const useTopInsights = () => useQuery({ queryKey: ['dashboard', 'smart', ''], queryFn: () => api.get('/insights/smart', { department: '' }) })

function insightTarget(link = {}) {
  if (link.to === 'project') return `/projects/${link.id}${link.tab ? `?tab=${link.tab}` : ''}`
  if (link.to === 'person') return `/people/${link.id}/profile`
  return '/approvals'
}

const mayOpen = (user, route) => !ROUTE_ROLES[route] || ROUTE_ROLES[route].includes(user?.role)
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function SectionTitle({ children }) {
  return (
    <Typography variant="overline" component="h3" sx={{ display: 'block', color: 'text.secondary', lineHeight: 2, mt: 1 }}>
      {children}
    </Typography>
  )
}

function Summary({ user, notifications, go }) {
  const approver = can(user, 'approvals.view')
  const manages = user?.role === 'manager' || user?.role === 'admin'
  const approvals = useApprovals({}, approver)
  const unread = useUnreadMessages()
  const missing = useMissingTimesheets('', manages)
  const insights = useTopInsights()
  const markAll = useMarkAllRead()
  const sentences = buildSummary({ user, today: todayIso(), notifications, unreadMessages: unread.data?.unread ?? 0,
    approvals: approvals.data ?? [], missing: missing.data })
  const top = (insights.data ?? []).slice(0, 3)

  const actions = [
    approver ? { label: 'Open approvals', to: '/approvals' } : null,
    can(user, 'timesheet.use') && mayOpen(user, 'timesheet') ? { label: 'Open timesheet', to: '/timesheet' } : null,
    can(user, 'messages.use') && mayOpen(user, 'messages') ? { label: 'Open messages', to: '/messages' } : null,
  ].filter(Boolean)

  return (
    <>
      <SectionTitle>What needs you</SectionTitle>
      {sentences.length ? (
        <List dense disablePadding aria-label="What needs you">
          {sentences.map((s) => (s.to ? (
            <ListItemButton key={s.id} onClick={() => go(s.to)} sx={{ borderRadius: 1.5, px: 1 }}>
              <ListItemText primary={s.text} />
              <ChevronRight fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
            </ListItemButton>
          ) : (
            <ListItem key={s.id} sx={{ px: 1 }}><ListItemText primary={s.text} /></ListItem>
          )))}
        </List>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 1, py: 0.5 }}>
          You&apos;re all caught up. Nothing needs you right now.
        </Typography>
      )}

      <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
        {actions.map((a) => <Button key={a.to} size="small" variant="outlined" onClick={() => go(a.to)}>{a.label}</Button>)}
        {notifications.length ? (
          <Button size="small" startIcon={<DoneAll />} onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            Mark all read
          </Button>
        ) : null}
      </Stack>

      <SectionTitle>Top insights</SectionTitle>
      {insights.isLoading ? <Skeleton variant="rounded" height={56} /> : null}
      {!insights.isLoading && !top.length ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 1 }}>No suggestions right now.</Typography>
      ) : null}
      {top.length ? (
        <List dense disablePadding aria-label="Top insights">
          {top.map((i) => {
            const [Icon, color] = SEVERITY_ICON[i.severity] ?? SEVERITY_ICON.low
            return (
              <ListItemButton key={i.id} onClick={() => go(insightTarget(i.link))} sx={{ borderRadius: 1.5, px: 1, gap: 1, alignItems: 'flex-start' }}>
                <Icon fontSize="small" aria-hidden sx={{ color, mt: 0.5 }} />
                <ListItemText primary={i.title} secondary={i.detail}
                  slotProps={{ secondary: { sx: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } } }} />
              </ListItemButton>
            )
          })}
        </List>
      ) : null}

      <SectionTitle>Ask Puppy</SectionTitle>
      <AskPuppy />
    </>
  )
}

/** The panel behind the Puppy button: a summary of what needs attention, and the sound settings. */
export default function PuppyPanel({ user, notifications, settings, onSettings, onClose }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState('summary')
  const go = (to) => { onClose(); navigate(to) }
  const name = user?.first_name ? `, ${user.first_name}` : ''
  return (
    <Box sx={{ width: { xs: 'calc(100vw - 32px)', sm: 380 }, maxWidth: 380 }}>
      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', px: 2, pt: 2 }}>
        <PuppyFace size={44} perked={notifications.length > 0} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
            Hi{name}! Woof.
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{PUPPY_TAGLINE}</Typography>
        </Box>
      </Stack>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" aria-label="Puppy" sx={{ mt: 1, minHeight: 40,
        '& .MuiTab-root': { minHeight: 40 } }}>
        <Tab value="summary" label="Summary" />
        <Tab value="sound" label="Sound" />
      </Tabs>
      <Divider />
      <Box sx={{ px: 2, pb: 1.5, maxHeight: { xs: '62vh', sm: 480 }, overflowY: 'auto' }}>
        {tab === 'summary' ? <Summary user={user} notifications={notifications} go={go} />
          : <Box sx={{ pt: 1.5 }}><SoundSettings settings={settings} onChange={onSettings} /></Box>}
      </Box>
      <Divider />
      <Typography variant="caption" component="p" sx={{ px: 2, py: 1, color: 'text.secondary' }}>{PUPPY_DISCLAIMER}</Typography>
    </Box>
  )
}
