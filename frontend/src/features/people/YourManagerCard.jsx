import ChatOutlined from '@mui/icons-material/ChatOutlined'
import { Box, Button, Link, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { useContacts } from '../../api/messages.js'
import { useSession } from '../../auth/sessionContext.js'
import UserAvatar from '../../components/UserAvatar.jsx'
import { canMessage } from '../../lib/messaging.js'
import { canViewProfile } from '../../lib/permissions.js'
import Section from '../dashboard/Section.jsx'

/** The signed-in person's own manager, made obvious: photo, name, title, department and one press to message them
 * (the Messages ?to= flow opens the existing conversation, or a new message to them). Nothing without a manager.
 * `collapsible` (with `open` and `onToggle`) lets My week fold it away. */
export default function YourManagerCard({ manager, sx, collapsible = false, open = true, onToggle }) {
  const { user } = useSession()
  const contacts = useContacts(Boolean(manager?.id))
  if (!manager?.id || manager.is_archived) return null
  const first = manager.first_name ?? String(manager.name ?? '').split(' ')[0]
  const details = [manager.job_title, manager.department?.name].filter(Boolean).join(' · ')
  const messageable = canMessage(contacts.data, manager, user)
  return (
    <Box sx={sx}>
      <Section question="Your manager" collapsible={collapsible} open={open} onToggle={onToggle}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, alignItems: { sm: 'center' } }}>
          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', minWidth: 0, flexGrow: 1 }}>
            <UserAvatar userId={manager.id} name={manager.name} size={48} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" component="p" sx={{ fontWeight: 700, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{manager.name}</Typography>
              {details ? <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{details}</Typography> : null}
              {canViewProfile(user, manager.id) ? (
                <Link component={RouterLink} to={`/people/${manager.id}/profile`} variant="body2" underline="hover">View profile</Link>
              ) : null}
            </Box>
          </Stack>
          {messageable ? (
            <Button component={RouterLink} to={`/messages?to=${encodeURIComponent(manager.id)}`} variant="outlined"
              startIcon={<ChatOutlined />} sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'center' }, minHeight: 44 }}>
              Message {first}
            </Button>
          ) : null}
        </Stack>
      </Section>
    </Box>
  )
}
