import { Box } from '@mui/material'
import { AVATAR_SIZE } from '../lib/avatarLook.js'
import PersonLink from './PersonLink.jsx'
import UserAvatar from './UserAvatar.jsx'

/** A small avatar beside a person's name, kept on one line (long names end in an ellipsis). The name opens their
 * profile when the viewer may see it (`context` as for PersonLink); `link={false}` keeps it plain, e.g. inside a tappable card. */
export default function PersonWithAvatar({ person, size = AVATAR_SIZE.inline, link = true, context, children, sx }) {
  if (!person) return null
  const name = person.name ?? `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim()
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, maxWidth: '100%',
      verticalAlign: 'middle', ...sx }}>
      <UserAvatar userId={person.id} name={name} size={size} />
      <Box component="span" title={name}
        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {link ? <PersonLink person={{ ...person, name }} context={context}>{children}</PersonLink> : (children ?? name)}
      </Box>
    </Box>
  )
}
