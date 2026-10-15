import ChatOutlined from '@mui/icons-material/ChatOutlined'
import { Button, IconButton, Tooltip } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { useContacts } from '../../api/messages.js'
import { useSession } from '../../auth/sessionContext.js'
import { canMessage } from '../../lib/messaging.js'

const same = (a, b) => a != null && b != null && String(a) === String(b)

/** "Message <name>": shown only when the viewer may write to this person (the server's contact list decides),
 * so an employee sees it for their managers and fellow employees, never for admins or executives. Opens the existing conversation or a new message. */
export default function MessageButton({ person, variant = 'button', size = 'medium' }) {
  const { user } = useSession()
  const self = same(person?.id, user?.id)
  const contacts = useContacts(Boolean(person?.id) && !self)
  if (self || !canMessage(contacts.data, person, user)) return null
  const name = person.name ?? `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim()
  const to = `/messages?to=${encodeURIComponent(person.id)}`
  if (variant === 'icon') {
    return (
      <Tooltip title={`Message ${name}`}>
        <IconButton component={RouterLink} to={to} size={size} aria-label={`Message ${name}`}><ChatOutlined fontSize="small" /></IconButton>
      </Tooltip>
    )
  }
  return (
    <Button component={RouterLink} to={to} variant="outlined" size={size} startIcon={<ChatOutlined />} aria-label={`Message ${name}`}>
      Message
    </Button>
  )
}
