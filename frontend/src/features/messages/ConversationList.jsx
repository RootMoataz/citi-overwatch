import Flag from '@mui/icons-material/FlagOutlined'
import { Box, Button, List, ListItemAvatar, ListItemButton, Skeleton, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { conversationTitle, previewLine } from '../../lib/messaging.js'
import { relativeTime } from '../../lib/relativeTime.js'
import ConversationAvatar from './ConversationAvatar.jsx'

function UnreadCount({ count }) {
  return (
    <Box component="span" aria-label={`${count} unread`} sx={{ minWidth: 20, height: 20, px: 0.75, borderRadius: 10, flexShrink: 0,
      bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 12, fontWeight: 700, lineHeight: 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {count > 99 ? '99+' : count}
    </Box>
  )
}

function Row({ conversation: c, me, active }) {
  const unread = c.unread_count > 0
  const title = conversationTitle(c, me)
  return (
    <ListItemButton component={RouterLink} to={`/messages/${c.id}`} selected={active} aria-current={active ? 'page' : undefined}
      sx={{ gap: 1.5, py: 1.25, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
      <ListItemAvatar sx={{ minWidth: 0 }}><ConversationAvatar conversation={c} me={me} /></ListItemAvatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline' }}>
          <Typography component="span" noWrap sx={{ flex: 1, fontWeight: unread ? 700 : 500 }}>{title}</Typography>
          <Typography component="span" variant="caption" noWrap
            sx={{ flexShrink: 0, color: unread ? 'primary.main' : 'text.secondary', fontWeight: unread ? 700 : 400 }}>
            {relativeTime(c.last_activity_at)}
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', mt: 0.25 }}>
          {c.milestone ? <Flag aria-label="Milestone discussion" sx={{ fontSize: 16, color: 'text.secondary' }} /> : null}
          <Typography component="span" variant="body2" noWrap
            sx={{ flex: 1, color: unread ? 'text.primary' : 'text.secondary', fontWeight: unread ? 600 : 400 }}>
            {previewLine(c, me)}
          </Typography>
          {unread ? <UnreadCount count={c.unread_count} /> : null}
        </Stack>
      </Box>
    </ListItemButton>
  )
}

/** The inbox: newest conversation first, unread ones in bold with their count. */
export default function ConversationList({ query, me, activeId, onCompose }) {
  const items = query.data?.items ?? []
  if (query.isLoading) {
    return <Stack sx={{ p: 2, gap: 1.5 }}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={56} />)}</Stack>
  }
  if (query.error) return <Box sx={{ p: 2 }}><ErrorAlert error={query.error} onRetry={() => query.refetch()} /></Box>
  if (!items.length) {
    return <EmptyState title="No conversations yet" description="Start one and it shows up here."
      action={onCompose ? <Button variant="outlined" onClick={onCompose}>Write a message</Button> : null} />
  }
  return (
    <List aria-label="Conversations" disablePadding>
      {items.map((c) => <Row key={c.id} conversation={c} me={me} active={String(c.id) === String(activeId)} />)}
    </List>
  )
}
