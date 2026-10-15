import EditNote from '@mui/icons-material/EditNoteOutlined'
import Forum from '@mui/icons-material/ForumOutlined'
import { Box, Button, Paper } from '@mui/material'
import { useMediaQuery } from 'react-responsive'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useConversations } from '../../api/messages.js'
import { useSession } from '../../auth/sessionContext.js'
import EmptyState from '../../components/EmptyState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { directWith } from '../../lib/messaging.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import ComposeDialog from './ComposeDialog.jsx'
import ConversationList from './ConversationList.jsx'
import ThreadView from './ThreadView.jsx'

/**
 * Messages: the inbox beside the open conversation on desktop; on phones the list, then the thread with a back
 * button. `?compose` opens a new message; `?to=<user id>` opens the existing one-to-one with that person, or a new
 * message to them (the Message buttons link here).
 */
export default function MessagesPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useSession()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const conversations = useConversations({ fast: true })
  const to = params.get('to')
  const composing = params.has('compose') || Boolean(to)

  if (to && conversations.data) {
    const existing = directWith(conversations.data.items, user, to)
    if (existing) return <Navigate to={`/messages/${existing.id}`} replace />
  }

  const openCompose = () => setParams({ compose: '' })
  const closeCompose = () => setParams({}, { replace: true })
  const threadOpen = Boolean(id)
  const subtitle = user?.role === 'employee' ? 'Talk to your managers and the threads you are part of' : 'Talk to your team'

  return (
    <>
      {desktop || !threadOpen ? (
        <PageHeader title="Messages" subtitle={subtitle}
          actions={<Button variant="contained" startIcon={<EditNote />} onClick={openCompose}>New message</Button>} />
      ) : null}
      <Paper variant="outlined" sx={{ display: 'grid', overflow: 'hidden', borderRadius: 3,
        gridTemplateColumns: desktop ? 'minmax(280px, 340px) 1fr' : '1fr',
        height: desktop ? 'max(460px, calc(100dvh - 250px))' : threadOpen ? 'calc(100dvh - 136px)' : 'auto' }}>
        {desktop || !threadOpen ? (
          <Box sx={{ minHeight: 0, overflowY: 'auto', borderRight: desktop ? 1 : 0, borderColor: 'divider' }}>
            <ConversationList query={conversations} me={user} activeId={id} onCompose={openCompose} />
          </Box>
        ) : null}
        {threadOpen ? (
          <Box sx={{ minHeight: 0, minWidth: 0 }}>
            <ThreadView key={id} id={id} me={user} onBack={desktop ? undefined : () => navigate('/messages')} />
          </Box>
        ) : desktop ? (
          <Box sx={{ display: 'grid', placeItems: 'center' }}>
            <EmptyState icon={<Forum fontSize="inherit" />} title="Pick a conversation"
              description="Or start a new one with the New message button." />
          </Box>
        ) : null}
      </Paper>
      {composing && (!to || conversations.data) ? (
        <ComposeDialog open onClose={closeCompose} initialTo={to} />
      ) : null}
    </>
  )
}
