import ChevronRight from '@mui/icons-material/ChevronRightRounded'
import Close from '@mui/icons-material/CloseRounded'
import ErrorOutline from '@mui/icons-material/ErrorOutlineOutlined'
import ExpandMore from '@mui/icons-material/ExpandMoreRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import Lightbulb from '@mui/icons-material/LightbulbOutlined'
import Shield from '@mui/icons-material/ShieldOutlined'
import WarningAmber from '@mui/icons-material/WarningAmber'
import {
  Box, Button, ButtonBase, Collapse, Divider, IconButton, List, ListItem, ListItemButton, ListItemText, Skeleton, Stack, Tab,
  Tabs, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client.js'
import { useContacts, useUnreadMessages } from '../../api/messages.js'
import { useApprovals, useMarkAllRead, useMissingTimesheets } from '../../api/queries.js'
import { ROUTE_ROLES } from '../../app/access.js'
import { useColorMode } from '../../app/colorMode.js'
import { useToast } from '../../app/toast.js'
import { can } from '../../lib/permissions.js'
import usePaletteData from '../palette/usePaletteData.js'
import { buildActions } from './actions.js'
import AskPuppy from './AskPuppy.jsx'
import ConfirmAction from './ConfirmAction.jsx'
import { PUPPY_CAN_SEE, PUPPY_DISCLAIMER, PUPPY_TAGLINE } from './copy.js'
import { puppyView } from './privacy.js'
import PuppyFace from './PuppyFace.jsx'
import SoundSettings from './SoundSettings.jsx'
import { buildSummary } from './summary.js'
import { buildTips, dismissTip, readDismissed } from './tips.js'

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

/** Everything Puppy reads, from the viewer's normal role-scoped endpoints (shared caches), cut to the allow-list. */
function usePuppyData(user, notifications) {
  const approver = can(user, 'approvals.view')
  const manages = user?.role === 'manager' || user?.role === 'admin'
  const approvals = useApprovals({}, approver)
  const unread = useUnreadMessages()
  const missing = useMissingTimesheets('', manages)
  const insights = useTopInsights()
  const contacts = useContacts(user?.role === 'employee')
  const palette = usePaletteData(user)
  const view = useMemo(() => puppyView({ notifications, insights: insights.data, approvals: approvals.data, missing: missing.data,
    projects: palette.projects, milestones: palette.milestones, contacts: contacts.data?.items, people: palette.people,
    departments: palette.departments }),
  [notifications, insights.data, approvals.data, missing.data, palette.projects, palette.milestones, contacts.data,
    palette.people, palette.departments])
  return { view, unreadMessages: unread.data?.unread ?? 0, insightsLoading: insights.isLoading, loading: palette.loading }
}

function SectionTitle({ children }) {
  return (
    <Typography variant="overline" component="h3" sx={{ display: 'block', color: 'text.secondary', lineHeight: 2, mt: 1 }}>
      {children}
    </Typography>
  )
}

function Tips({ tips, onDismiss, go }) {
  if (!tips.length) return null
  return (
    <Stack component="ul" aria-label="Tips from Puppy" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5, gap: 0.75 }}>
      {tips.map((t) => (
        <Box component="li" key={t.id} sx={(theme) => ({ display: 'flex', gap: 1, alignItems: 'flex-start', p: 1, pl: 1.25,
          borderRadius: 2, bgcolor: alpha(theme.palette.warning.main, 0.1) })}>
          <Lightbulb fontSize="small" aria-hidden sx={{ color: 'warning.main', mt: 0.25 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2">{t.text}</Typography>
            <Button size="small" sx={{ px: 0, minWidth: 0 }} onClick={() => go(t.action.to)}>{t.action.label}</Button>
          </Box>
          <IconButton size="small" aria-label="Dismiss tip" onClick={() => onDismiss(t.id)}><Close fontSize="small" /></IconButton>
        </Box>
      ))}
    </Stack>
  )
}

function Summary({ user, view, unreadMessages, insightsLoading, go }) {
  const [dismissed, setDismissed] = useState(readDismissed)
  const today = todayIso()
  const sentences = buildSummary({ user, today, notifications: view.notifications, unreadMessages, approvals: view.approvals,
    missing: view.missing })
  const tips = buildTips({ user, today, notifications: view.notifications, approvals: view.approvals, milestones: view.milestones,
    dismissed })
  const top = view.insights.slice(0, 3)
  const links = [
    can(user, 'approvals.view') ? { label: 'Open approvals', to: '/approvals' } : null,
    can(user, 'timesheet.use') && mayOpen(user, 'timesheet') ? { label: 'Open timesheet', to: '/timesheet' } : null,
    can(user, 'messages.use') && mayOpen(user, 'messages') ? { label: 'Open messages', to: '/messages' } : null,
  ].filter(Boolean)

  return (
    <>
      <Tips tips={tips} go={go} onDismiss={(id) => setDismissed(dismissTip(id))} />
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
        {links.map((a) => <Button key={a.to} size="small" variant="outlined" onClick={() => go(a.to)}>{a.label}</Button>)}
      </Stack>

      <SectionTitle>Top insights</SectionTitle>
      {insightsLoading ? <Skeleton variant="rounded" height={56} /> : null}
      {!insightsLoading && !top.length ? (
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
    </>
  )
}

function DoIt({ actions, onRun, busy }) {
  const [chosen, setChosen] = useState(null)
  const action = actions.find((a) => a.id === chosen)
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1.5, mb: 1 }}>
        Puppy can do these for you. Each one asks first, and runs as you through Scout&apos;s normal pages.
      </Typography>
      <Stack sx={{ gap: 0.75 }} data-testid="puppy-actions">
        {actions.map((a) => (a.id === chosen && action ? (
          <ConfirmAction key={a.id} action={action} busy={busy}
            onConfirm={async () => { await onRun(action); setChosen(null) }} onCancel={() => setChosen(null)} />
        ) : (
          <Button key={a.id} variant="outlined" size="small" onClick={() => setChosen(a.id)}
            sx={{ justifyContent: 'flex-start', textAlign: 'left' }}>{a.label}</Button>
        )))}
      </Stack>
    </>
  )
}

function CanSee() {
  const [open, setOpen] = useState(false)
  return (
    <Box sx={{ px: 2, pt: 1 }}>
      <ButtonBase onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="puppy-can-see"
        sx={{ gap: 0.75, borderRadius: 1, typography: 'caption', fontWeight: 600, color: 'text.secondary' }}>
        <Shield fontSize="inherit" aria-hidden />What Puppy can see
        <ExpandMore fontSize="inherit" aria-hidden sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </ButtonBase>
      <Collapse in={open} id="puppy-can-see">
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, color: 'text.secondary', typography: 'caption' }}>
          {PUPPY_CAN_SEE.map((line) => <li key={line}>{line}</li>)}
        </Box>
      </Collapse>
    </Box>
  )
}

/** The panel behind the Puppy button: tips and a summary, do-it-for-me actions, Ask Puppy and the sound settings. */
export default function PuppyPanel({ user, notifications, settings, onSettings, onClose }) {
  const navigate = useNavigate()
  const toast = useToast()
  const colorMode = useColorMode()
  const markAll = useMarkAllRead()
  const [tab, setTab] = useState('summary')
  const data = usePuppyData(user, notifications)
  const { view } = data
  const go = (to) => { onClose(); navigate(to) }
  const actions = buildActions({ user, today: todayIso(), unread: view.notifications.length, mode: colorMode.mode,
    projects: view.projects, contacts: view.contacts, approvals: view.approvals })

  // Runs a confirmed action, as the viewer, through the app's normal hooks and pages.
  const run = async (action) => {
    if (action.id === 'mark-read') {
      try {
        await markAll.mutateAsync()
        toast.success(action.confirm.replace('Puppy will mark', 'Puppy marked').replace(' as read.', ' as read'))
      } catch {
        toast.error("Puppy couldn't mark them read. Try again from the bell.")
      }
    } else if (action.id === 'theme') {
      colorMode.setPreference(action.mode)
      toast.success(`Switched to the ${action.mode} theme`)
    } else if (action.id === 'sound') setTab('sound')
    else if (action.to) go(action.to)
  }

  const name = user?.first_name ? `, ${user.first_name}` : ''
  const askData = useMemo(() => ({ loading: data.loading, projects: view.projects, people: view.people,
    departments: view.departments }), [data.loading, view.projects, view.people, view.departments])
  return (
    <Box sx={{ width: { xs: 'calc(100vw - 32px)', sm: 400 }, maxWidth: 400 }}>
      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', px: 2, pt: 2 }}>
        <PuppyFace size={44} perked={notifications.length > 0} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>Hi{name}! Woof.</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{PUPPY_TAGLINE}</Typography>
        </Box>
      </Stack>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" aria-label="Puppy" sx={{ mt: 1, minHeight: 40,
        '& .MuiTab-root': { minHeight: 40, minWidth: 0, px: 1 } }}>
        <Tab value="summary" label="Summary" />
        <Tab value="do" label="Do it" />
        <Tab value="ask" label="Ask" />
        <Tab value="sound" label="Sound" />
      </Tabs>
      <Divider />
      <Box sx={{ px: 2, pb: 1.5, maxHeight: { xs: '58vh', sm: 460 }, overflowY: 'auto' }}>
        {tab === 'summary' ? <Summary user={user} view={view} unreadMessages={data.unreadMessages}
          insightsLoading={data.insightsLoading} go={go} /> : null}
        {tab === 'do' ? <DoIt actions={actions} onRun={run} busy={markAll.isPending} /> : null}
        {tab === 'ask' ? <Box sx={{ pt: 1.5 }}><AskPuppy user={user} data={askData} actions={actions} onRun={run} go={go} /></Box> : null}
        {tab === 'sound' ? <Box sx={{ pt: 1.5 }}><SoundSettings settings={settings} onChange={onSettings} /></Box> : null}
      </Box>
      <Divider />
      <CanSee />
      <Typography variant="caption" component="p" sx={{ px: 2, pt: 0.5, pb: 1, color: 'text.secondary' }}>{PUPPY_DISCLAIMER}</Typography>
    </Box>
  )
}
