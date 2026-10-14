import { Link } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'

const profilePath = (id) => `/people/${id}/profile`

/** A person's name that opens their profile page. The server decides whether the viewer may see it. */
export default function PersonLink({ person, children, ...props }) {
  return (
    <Link component={RouterLink} to={profilePath(person.id)} underline="hover" {...props}>
      {children ?? person.name}
    </Link>
  )
}
