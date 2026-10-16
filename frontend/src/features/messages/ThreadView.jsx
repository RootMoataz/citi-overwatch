import ArrowBack from '@mui/icons-material/ArrowBack'
import Flag from '@mui/icons-material/FlagOutlined'
import { Alert, Box, Button, Chip, IconButton, Skeleton, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useLoadOlder, useMarkConversationRead, useThread } from '../../api/messages.js'
import { useBreadcrumb } from '../../app/breadcrumbs.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { ROLE_LABEL } from '../../lib/labels.js'
import { bubbleGroups, conversationTitle, isSeen, others, timeOf } from '../../lib/messaging.js'
import { EASE, useCalmMotion } from '../../lib/motion.js'
import Composer from './Composer.jsx'
import ConversationAvatar from './ConversationAvatar.jsx'

const same = (a, b) => a != null && b != null && String(a) === String(b)
const NEAR_BOTTOM_PX = 120

function DaySeparator({ label }) {
  return (
    <Stack direction="row" role="separator" aria-label={label} sx={{ alignItems: 'center', gap: 1.5, my: 1.5 }}>
      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>{label}</Typography>
      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
    </Stack>
  )
}

function Bubble({ message, mine, enter }) {
  return (
    <motion.div initial={enter} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.22, ease: EASE }}
      style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <Box data-message={message.id} title={new Date(message.created_at).toLocaleString()}
        sx={(t) => ({ maxWidth: { xs: '85%', sm: '72%' }, px: 1.5, py: 1, mb: 0.5, borderRadius: 2.5,
          // Plain text only: React escapes it, and pre-wrap keeps the writer's line breaks. Long words wrap.
          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', typography: 'body2', lineHeight: 1.5,
          ...(mine
            ? { bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.3 : 0.14), color: 'text.primary',
              borderBottomRightRadius: 6 }
            : { bgcolor: t.palette.mode === 'dark' ? alpha('#FFFFFF', 0.08) : alpha('#111C27', 0.06), color: 'text.primary',
              borderBottomLeftRadius: 6 }) })}>
        {message.body}
      </Box>
    </motion.div>
  )
}

function Group({ group, mine, showName, seenId, enter }) {
  const last = group.messages[group.messages.length - 1]
  return (
    <Stack direction="row" sx={{ gap: 1, justifyContent: mine ? 'flex-end' : 'flex-start', mb: 1 }}>
      {mine ? null : <UserAvatar userId={group.sender.id} name={group.sender.name} size={30} sx={{ mt: showName ? 2.5 : 0 }} />}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {showName ? (
          <Typography variant="caption" component="div" sx={{ color: 'text.secondary', fontWeight: 600, ml: 0.5, mb: 0.25 }}>
            {group.sender.name}
          </Typography>
        ) : null}
        <AnimatePresence initial={false}>
          {group.messages.map((m) => <Bubble key={m.id} message={m} mine={mine} enter={enter} />)}
        </AnimatePresence>
        <Typography variant="caption" component="div"
          sx={{ color: 'text.secondary', textAlign: mine ? 'right' : 'left', mx: 0.5 }}>
          {timeOf(last.created_at)}
          {group.messages.some((m) => same(m.id, seenId)) ? <Box component="span" sx={{ fontWeight: 600 }}> · Seen</Box> : null}
        </Typography>
      </Box>
    </Stack>
  )
}

function Header({ conversation, me, onBack }) {
  const rest = others(conversation, me)
  const title = conversationTitle(conversation, me)
  const one = !conversation.is_group && rest.length === 1 ? rest[0] : null
  const subtitle = one
    ? [one.job_title, ROLE_LABEL[one.role]].filter(Boolean).join(' · ')
    : `${conversation.participants.length} people: ${conversation.participants.map((p) => (same(p.id, me?.id) ? 'you' : p.name.split(' ')[0])).join(', ')}`
  const milestone = conversation.milestone
  return (
    <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', minHeight: 64 }}>
      {onBack ? <IconButton edge="start" aria-label="Back to conversations" onClick={onBack}><ArrowBack /></IconButton> : null}
      <ConversationAvatar conversation={conversation} me={me} size={36} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle1" component="h2" noWrap>{title}</Typography>
        <Typography variant="caption" component="div" noWrap sx={{ color: 'text.secondary' }}>{subtitle}</Typography>
      </Box>
      {milestone ? (
        <Chip size="small" variant="outlined" color="primary" icon={<Flag />} clickable component={RouterLink}
          to={`/projects/${milestone.project.id}?tab=milestones`} label={milestone.name}
          aria-label={`Milestone ${milestone.name} in ${milestone.project.name}`} sx={{ maxWidth: { xs: 120, sm: 240 } }} />
      ) : null}
    </Stack>
  )
}

/** One conversation: header, the messages (mine on the right) and the composer. Reading it marks it read. It names
 * the top bar's last crumb: `title` (from the inbox) at once, else the thread's own conversation once it loads (one
 * outside the loaded inbox page too), or "Not found" when it can't be opened. */
export default function ThreadView({ id, me, title, onBack }) {
  const thread = useThread(id)
  const loaded = thread.data?.conversation
  useBreadcrumb(title ?? (loaded ? conversationTitle(loaded, me) : undefined), { failed: Boolean(thread.error) })
  const older = useLoadOlder(id)
  const { mutate: markRead, isPending: marking } = useMarkConversationRead()
  const calm = useCalmMotion()
  const scroller = useRef(null)
  const nearBottom = useRef(true)
  const keepOffset = useRef(null)

  const conversation = thread.data?.conversation
  const items = thread.data?.items ?? []
  const latest = items[items.length - 1]
  const myLast = [...items].reverse().find((m) => same(m.sender.id, me?.id))
  const seenId = myLast && isSeen(conversation, me, myLast) ? myLast.id : null
  const needsRead = Boolean(conversation && latest && !same(latest.sender.id, me?.id)
    && (!conversation.last_read_at || new Date(conversation.last_read_at) < new Date(latest.created_at)))

  useEffect(() => {
    if (needsRead && !marking) markRead(id)
  }, [needsRead, marking, markRead, id])

  // Stay pinned to the newest message while the reader is at the bottom; keep their place when older ones load.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (keepOffset.current != null) {
      el.scrollTop = el.scrollHeight - keepOffset.current
      keepOffset.current = null
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [latest?.id, items.length])

  const loadOlder = () => {
    if (scroller.current) keepOffset.current = scroller.current.scrollHeight - scroller.current.scrollTop
    older.mutate()
  }

  if (thread.isLoading) {
    return <Stack sx={{ p: 2, gap: 1.5 }}><Skeleton variant="rounded" height={48} /><Skeleton variant="rounded" height={240} /></Stack>
  }
  if (thread.error?.status === 404) {
    return (
      <Box sx={{ p: 2 }}>
        {onBack ? <IconButton aria-label="Back to conversations" onClick={onBack}><ArrowBack /></IconButton> : null}
        <EmptyState title="This conversation isn't available" description="It doesn't exist, or you're not part of it." />
      </Box>
    )
  }
  if (thread.error) return <Box sx={{ p: 2 }}><ErrorAlert error={thread.error} onRetry={() => thread.refetch()} /></Box>

  const archivedPartner = !conversation.is_group && others(conversation, me).every((p) => p.is_archived)
  const groups = bubbleGroups(items)
  const enter = calm ? false : { opacity: 0, y: 10, scale: 0.98 }

  return (
    <Stack sx={{ minHeight: 0, height: '100%' }}>
      <Header conversation={conversation} me={me} onBack={onBack} />
      <Box ref={scroller} role="log" aria-label="Messages"
        onScroll={(e) => {
          const el = e.currentTarget
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
        }}
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 1.5, sm: 2.5 }, py: 2 }}>
        {thread.data.has_more ? (
          <Stack sx={{ alignItems: 'center', mb: 1 }}>
            <Button size="small" onClick={loadOlder} disabled={older.isPending}>Load earlier messages</Button>
          </Stack>
        ) : null}
        {!items.length ? <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>No messages yet.</Typography> : null}
        <AnimatePresence initial={false}>
          {groups.map((g) => {
            const mine = same(g.sender.id, me?.id)
            return (
              <motion.div key={g.key} initial={enter} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.22, ease: EASE }}>
                {g.day ? <DaySeparator label={g.day} /> : null}
                <Group group={g} mine={mine} showName={conversation.is_group && !mine} seenId={seenId} enter={enter} />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </Box>
      {archivedPartner ? (
        <Alert severity="info" sx={{ borderRadius: 0 }}>This person's account has been archived, so the conversation is read-only.</Alert>
      ) : (
        <Composer conversationId={id} onSent={() => { nearBottom.current = true }} />
      )}
    </Stack>
  )
}
