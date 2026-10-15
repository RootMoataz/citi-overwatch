import { Link } from '@mui/material'
import { useContext } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { SessionContext } from '../auth/sessionContext.js'
import { canViewProfile } from '../lib/permissions.js'

const profilePath = (id) => `/people/${id}/profile`

/**
 * A person's name that opens their profile page when the viewer may see it, and plain text otherwise.
 * `context` says where the person appears (see canViewProfile); the server still has the final say.
 * A click on the name doesn't also count as a click on the table row or card around it.
 */
export default function PersonLink({ person, context, children, ...props }) {
  const viewer = useContext(SessionContext)?.user
  const text = children ?? person.name
  if (!canViewProfile(viewer, person.id, context)) return <>{text}</>
  return (
    <Link component={RouterLink} to={profilePath(person.id)} underline="hover" onClick={(e) => e.stopPropagation()} {...props}>
      {text}
    </Link>
  )
}
