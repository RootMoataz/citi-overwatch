import Forum from '@mui/icons-material/ForumOutlined'
import { Box, Button, Skeleton, Tooltip, Typography } from '@mui/material'
import { useMilestoneDiscussion, useOpenDiscussion } from '../../../api/messages.js'
import { useToast } from '../../../app/toast.js'
import ErrorAlert from '../../../components/ErrorAlert.jsx'
import ThreadView from '../../messages/ThreadView.jsx'

/**
 * The milestone's discussion thread, inside a 420 px box (full height on the phone sheet). Until one exists the
 * server answers 404: the project's manager (`manage`) then gets "Start a discussion", which needs an assignee, and
 * everyone else is told their manager can start one. The thread never renames the page's crumb.
 */
export default function DiscussionTab({ milestone, manage, user }) {
  const discussion = useMilestoneDiscussion(milestone.id)
  const open = useOpenDiscussion()
  const toast = useToast()
  if (discussion.isLoading) return <Skeleton variant="rounded" height={240} />
  if (discussion.data) {
    return (
      <Box sx={{ height: { xs: 'calc(100dvh - 260px)', md: 420 }, minHeight: 320, border: 1, borderColor: 'divider',
        borderRadius: 1, overflow: 'hidden' }}>
        <ThreadView id={discussion.data.id} me={user} crumb={false} />
      </Box>
    )
  }
  if (discussion.error && discussion.error.status !== 404) {
    return <ErrorAlert error={discussion.error} onRetry={() => discussion.refetch()} />
  }
  if (!manage) {
    return <Typography variant="body2" sx={{ color: 'text.secondary' }}>No discussion yet. Your manager can start one.</Typography>
  }
  const nobody = !milestone.assignees?.length
  const start = async () => {
    try { await open.mutateAsync(milestone.id) } catch (err) { toast.error(err.message) }
  }
  const button = (
    <Button variant="contained" startIcon={<Forum />} onClick={start} disabled={nobody || open.isPending} sx={{ minHeight: 44 }}>
      Start a discussion
    </Button>
  )
  return nobody ? <Tooltip title="Assign someone first"><span>{button}</span></Tooltip> : button
}
