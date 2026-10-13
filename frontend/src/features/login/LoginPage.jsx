import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Link, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/sessionContext.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { loginSchema } from '../../lib/schemas.js'
import AuthCard from './AuthCard.jsx'

const KNOWN = {
  INVALID_CREDENTIALS: () => 'Incorrect username or password.',
  TEMP_PASSWORD_EXPIRED: () => 'Temporary password expired — ask an admin to reset it.',
  ACCOUNT_LOCKED: (err) => {
    const until = err.details?.until ? new Date(err.details.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
    return `Too many failed attempts. Try again${until ? ` after ${until}` : ' in 15 minutes'}.`
  },
}

export default function LoginPage() {
  const { status, login } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [failure, setFailure] = useState(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' },
  })

  if (status === 'ready' || status === 'restricted') return <Navigate to={location.state?.from ?? '/'} replace />

  const onSubmit = async ({ username, password }) => {
    setFailure(null)
    try {
      await login(username, password)
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setFailure(err)
    }
  }

  const known = failure && KNOWN[failure.code]
  return (
    <AuthCard title="Sign in" subtitle="Track projects, milestones, people, hours and budgets in one place.">
      <Stack component="form" noValidate onSubmit={handleSubmit(onSubmit)} sx={{ gap: 2 }}>
        {location.state?.notice ? <Alert severity="success">{location.state.notice}</Alert> : null}
        {known ? <Alert severity="error" role="alert">{known(failure)}</Alert> : <ErrorAlert error={failure} />}
        <TextField label="Username" autoComplete="username" autoFocus required {...register('username')}
          error={Boolean(errors.username)} helperText={errors.username?.message} disabled={isSubmitting} />
        <TextField label="Password" type="password" autoComplete="current-password" required {...register('password')}
          error={Boolean(errors.password)} helperText={errors.password?.message} disabled={isSubmitting} />
        <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ alignSelf: 'center' }}>
          Forgot password?
        </Link>
      </Stack>
    </AuthCard>
  )
}
