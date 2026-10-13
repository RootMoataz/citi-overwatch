import { Button } from '@mui/material'
import { Link } from 'react-router-dom'
import EmptyState from '../components/EmptyState.jsx'

export default function NotFound() {
  return (
    <EmptyState title="Page not found" description="That page doesn't exist or you don't have access to it."
      action={<Button component={Link} to="/" variant="contained">Go to the dashboard</Button>} />
  )
}
