import Forum from '@mui/icons-material/ForumOutlined'
import { Button, Tooltip } from '@mui/material'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useOpenDiscussion } from '../../api/messages.js'
import { useToast } from '../../app/toast.js'

const same = (a, b) => a != null && b != null && String(a) === String(b)

/**
 * A milestone's discussion thread. Anyone already in it gets "Open discussion"; the project's manager or an admin
 * gets "Discuss", which starts it with the assignees (or joins it). Everyone else sees nothing.
 * `conversations` is the viewer's inbox (passed in so a list of cards shares one request).
 */
export default function DiscussButton({ milestone, manage, conversations }) {
  const navigate = useNavigate()
  const toast = useToast()
  const open = useOpenDiscussion()
  const existing = (conversations ?? []).find((c) => same(c.milestone?.id, milestone.id))
  if (existing) {
    return (
      <Button size="small" startIcon={<Forum />} component={RouterLink} to={`/messages/${existing.id}`}
        aria-label={`Open the discussion about ${milestone.name}`}>
        Open discussion
      </Button>
    )
  }
  if (!manage) return null
  const nobody = !milestone.assignees?.length
  const start = async () => {
    try {
      const conversation = await open.mutateAsync(milestone.id)
      navigate(`/messages/${conversation.id}`)
    } catch (err) {
      toast.error(err.message)
    }
  }
  const button = (
    <Button size="small" startIcon={<Forum />} onClick={start} disabled={nobody || open.isPending}
      aria-label={`Discuss ${milestone.name}`}>
      Discuss
    </Button>
  )
  return nobody ? <Tooltip title="Assign someone first"><span>{button}</span></Tooltip> : button
}
