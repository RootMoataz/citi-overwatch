import { Avatar, AvatarGroup, Tooltip } from '@mui/material'
import UserAvatar from './UserAvatar.jsx'

/**
 * Overlapping avatars for a group of people (a team, a milestone's assignees), at most `max` circles with a
 * "+N" for the rest. Each circle has a tooltip; `people` items are {id, name, detail?, highlight?}, where
 * `highlight` draws a primary-coloured ring (e.g. a milestone's primary assignee).
 */
export default function AvatarStack({ people, max = 4, size = 24, label, sx }) {
  if (!people?.length) return null
  const shown = people.length > max ? people.slice(0, max - 1) : people
  const rest = people.slice(shown.length)
  const ring = (highlight) => (highlight ? { border: 2, borderColor: 'primary.main' } : {})
  return (
    <AvatarGroup aria-label={label} role="group"
      sx={{ justifyContent: 'flex-end', '& .MuiAvatar-root': { width: size, height: size, boxSizing: 'border-box' }, ...sx }}>
      {shown.map((p) => {
        const text = p.detail ? `${p.name} · ${p.detail}` : p.name
        return (
          <Tooltip key={p.id} title={text}>
            <UserAvatar userId={p.id} name={p.name} size={size} label={text} sx={ring(p.highlight)} />
          </Tooltip>
        )
      })}
      {rest.length ? (
        <Tooltip title={rest.map((p) => p.name).join(', ')}>
          <Avatar role="img" aria-label={`${rest.length} more: ${rest.map((p) => p.name).join(', ')}`}
            sx={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)), bgcolor: 'action.selected',
              color: 'text.primary' }}>
            +{rest.length}
          </Avatar>
        </Tooltip>
      ) : null}
    </AvatarGroup>
  )
}
