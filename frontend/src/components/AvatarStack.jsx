import { Avatar, AvatarGroup, Tooltip } from '@mui/material'
import { AVATAR_SIZE, initialsStyle } from '../lib/avatarLook.js'
import UserAvatar from './UserAvatar.jsx'

// A ring in the surface colour separates overlapping discs; a highlighted person gets a second, primary ring
// outside it (drawn as a shadow so it doesn't shrink the circle).
const paperRing = { border: '2px solid', borderColor: 'background.paper', boxSizing: 'content-box' }
const primaryRing = { boxShadow: (t) => `0 0 0 2px ${(t.vars ?? t).palette.primary.main}` }

/**
 * Overlapping avatars for a group of people (a team, a milestone's assignees), at most `max` circles with a
 * "+N" for the rest. Each circle has a tooltip; `people` items are {id, name, detail?, highlight?}, where
 * `highlight` adds a primary-coloured outer ring (e.g. a milestone's primary assignee). Earlier people sit on top.
 */
export default function AvatarStack({ people, max = 4, size = AVATAR_SIZE.inline, label, sx }) {
  if (!people?.length) return null
  const shown = people.length > max ? people.slice(0, max - 1) : people
  const rest = people.slice(shown.length)
  const overlap = Math.round(size * 0.22)
  return (
    <AvatarGroup aria-label={label} role="group" spacing={overlap}
      sx={{ justifyContent: 'flex-end', flexShrink: 0, p: '2px', '& .MuiAvatar-root': paperRing, ...sx }}>
      {shown.map((p) => {
        const text = p.detail ? `${p.name} · ${p.detail}` : p.name
        return (
          <Tooltip key={p.id} title={text}>
            <UserAvatar userId={p.id} name={p.name} size={size} label={text} sx={p.highlight ? primaryRing : undefined} />
          </Tooltip>
        )
      })}
      {rest.length ? (
        <Tooltip title={rest.map((p) => p.name).join(', ')}>
          <Avatar role="img" aria-label={`${rest.length} more: ${rest.map((p) => p.name).join(', ')}`}
            sx={{ width: size, height: size, ...initialsStyle(size), bgcolor: 'divider', color: 'text.secondary' }}>
            +{rest.length}
          </Avatar>
        </Tooltip>
      ) : null}
    </AvatarGroup>
  )
}
