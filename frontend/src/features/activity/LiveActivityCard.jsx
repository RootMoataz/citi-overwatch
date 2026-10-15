import Settings from '@mui/icons-material/SettingsOutlined'
import { Avatar, Box, Link, Paper, Skeleton, Stack, Typography } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useId, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useActivity } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { canViewProfile } from '../../lib/permissions.js'
import { relativeTime } from '../../lib/relativeTime.js'

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(46, 160, 67, 0.55); }
  70% { box-shadow: 0 0 0 7px rgba(46, 160, 67, 0); }
  100% { box-shadow: 0 0 0 0 rgba(46, 160, 67, 0); }
`

/** The current time, refreshed every `ms`, so "2 min ago" keeps counting between polls. */
function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

/** Where an event's object lives, when the viewer can open it. */
function objectPath(item, viewer) {
  const obj = item.object
  if (!obj?.id) return null
  if (obj.type === 'project') return `/projects/${obj.id}`
  if (obj.type === 'milestone' && item.project) return `/projects/${item.project.id}?tab=milestones`
  if (obj.type === 'user' && canViewProfile(viewer, obj.id)) return `/people/${obj.id}/profile`
  return null
}

function Event({ item, now, viewer, calm }) {
  const to = objectPath(item, viewer)
  const actor = item.actor ?? { name: 'System' }
  return (
    <Box component={motion.li} layout={calm ? false : 'position'}
      initial={calm ? false : { opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={calm ? undefined : { opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', py: 1.1, borderTop: 1, borderColor: 'divider',
        '&:first-of-type': { borderTop: 0 } }}>
      {actor.id ? <UserAvatar userId={actor.id} name={actor.name} /> : (
        <Avatar aria-hidden sx={{ width: 28, height: 28, bgcolor: 'action.selected', color: 'text.secondary' }}>
          <Settings sx={{ fontSize: 18 }} />
        </Avatar>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          <Box component="span" sx={{ fontWeight: 700 }}>{actor.id ? <PersonLink person={actor} /> : actor.name}</Box>
          {' '}{item.verb}
          {item.object ? <>{' '}{to ? <Link component={RouterLink} to={to} underline="hover" sx={{ fontWeight: 600 }}>{item.object.name}</Link>
            : <Box component="span" sx={{ fontWeight: 600 }}>{item.object.name}</Box>}</> : null}
          {item.tail ? ` ${item.tail}` : null}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {item.project && item.object?.type !== 'project' ? <>{item.project.name} · </> : null}
          <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>{relativeTime(item.created_at, now)}</time>
        </Typography>
      </Box>
    </Box>
  )
}

/** The latest events in the viewer's scope (the server decides what that is), newest on top. New ones slide in
 *  as the dashboard refreshes; nothing moves for people who prefer reduced motion. */
export default function LiveActivityCard({ department = '' }) {
  const id = useId()
  const { user } = useSession()
  const activity = useActivity(department)
  const now = useNow()
  const calm = Boolean(useReducedMotion())
  const items = activity.data?.items ?? []
  let body
  if (activity.isLoading) body = <Stack sx={{ gap: 1 }}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={40} />)}</Stack>
  else if (activity.error) body = <ErrorAlert error={activity.error} onRetry={() => activity.refetch()} />
  else if (!items.length) body = <EmptyState title="Nothing yet" description="Changes to your projects will show up here as they happen." />
  else {
    body = (
      <Box component="ol" aria-label="Recent activity" sx={{ listStyle: 'none', p: 0, m: 0, maxHeight: 440, overflowY: 'auto' }}>
        <AnimatePresence initial={false}>
          {items.map((item) => <Event key={item.id} item={item} now={now} viewer={user} calm={calm} />)}
        </AnimatePresence>
      </Box>
    )
  }
  return (
    <Paper component="section" variant="outlined" aria-labelledby={id} sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography id={id} variant="h3" component="h2">Live activity</Typography>
        <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main',
          animation: calm ? 'none' : `${pulse} 2s ease-out infinite` }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', ml: 'auto' }}>Updates every 30 seconds</Typography>
      </Stack>
      {body}
    </Paper>
  )
}
