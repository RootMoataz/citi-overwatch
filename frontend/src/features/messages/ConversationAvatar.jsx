import { Box } from '@mui/material'
import UserAvatar from '../../components/UserAvatar.jsx'
import { others } from '../../lib/messaging.js'

/** One person's photo for a one-to-one conversation; two overlapping ones for a group. */
export default function ConversationAvatar({ conversation, me, size = 40 }) {
  const rest = others(conversation, me)
  if (rest.length <= 1) {
    const p = rest[0]
    return <UserAvatar userId={p?.id} name={p?.name} size={size} />
  }
  const small = Math.round(size * 0.72)
  const ring = { border: '2px solid', borderColor: 'background.paper', boxSizing: 'content-box' }
  return (
    <Box aria-hidden sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <UserAvatar userId={rest[1].id} name={rest[1].name} size={small} sx={{ position: 'absolute', top: -2, left: -2, ...ring }} />
      <UserAvatar userId={rest[0].id} name={rest[0].name} size={small} sx={{ position: 'absolute', bottom: -2, right: -2, ...ring }} />
    </Box>
  )
}
