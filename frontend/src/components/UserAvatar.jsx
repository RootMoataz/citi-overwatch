import { Avatar } from '@mui/material'
import { useAvatar, useAvatarIndex } from '../api/queries.js'
import { AVATAR_SIZE, colourFor, initialsFor, initialsStyle } from '../lib/avatarLook.js'

/**
 * A person's round photo, or their initials on a stable colour when they have none. Photos are only requested
 * for people the avatar index says have one, and each is cached per user + version.
 * Decorative by default (the name is usually right beside it); pass `label` when the avatar stands alone.
 */
export default function UserAvatar({ userId, name, size = AVATAR_SIZE.inline, label, sx, ref, ...props }) {
  const index = useAvatarIndex()
  const version = userId ? index.data?.[String(userId)] : undefined
  const photo = useAvatar(userId, version)
  const src = photo.data
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <Avatar ref={ref} src={src} alt={src ? '' : undefined} {...a11y} {...props}
      sx={{ width: size, height: size, ...initialsStyle(size), bgcolor: colourFor(userId ?? name), color: '#fff',
        flexShrink: 0, ...sx }}>
      {initialsFor(name, size)}
    </Avatar>
  )
}
