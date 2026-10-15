import { Box } from '@mui/material'
import PersonLink from './PersonLink.jsx'
import UserAvatar from './UserAvatar.jsx'

/** A small avatar beside a person's name; `link` makes the name open their profile. */
export default function PersonWithAvatar({ person, size = 24, link = false, children, sx }) {
  if (!person) return null
  const name = person.name ?? `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim()
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0, verticalAlign: 'middle', ...sx }}>
      <UserAvatar userId={person.id} name={name} size={size} />
      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {link ? <PersonLink person={{ ...person, name }}>{children}</PersonLink> : (children ?? name)}
      </Box>
    </Box>
  )
}
