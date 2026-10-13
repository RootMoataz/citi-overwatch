import { zodResolver } from '@hookform/resolvers/zod'
import LockReset from '@mui/icons-material/LockReset'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useMediaQuery } from 'react-responsive'
import ErrorAlert from '../components/ErrorAlert.jsx'
import PasswordPolicyChecklist from '../components/PasswordPolicyChecklist.jsx'
import { DESKTOP_QUERY } from '../lib/responsive.js'
import { changePasswordSchema } from '../lib/schemas.js'
import { useSession } from './sessionContext.js'

/** First sign-in: a full-screen step that can't be dismissed. The only other way out is signing out. */
export default function ForcePasswordChange() {
  const { user, changePassword, logout } = useSession()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const titleId = useId()
  const [serverError, setServerError] = useState(null)
  const { register, handleSubmit, control, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  })

  const newPassword = useWatch({ control, name: 'new_password' })

  const onSubmit = async (values) => {
    setServerError(null)
    try {
      await changePassword(values.current_password, values.new_password)
    } catch (err) {
      if (err.code === 'PASSWORD_POLICY') setError('new_password', { message: "Doesn't meet the password rules yet" })
      else if (err.code === 'PASSWORD_REUSED') setError('new_password', { message: 'Choose a password different from your temporary one' })
      else if (err.details?.current_password) setError('current_password', { message: "That isn't your temporary password" })
      else setServerError(err)
    }
  }

  return (
    <Dialog open fullScreen={!desktop} maxWidth="sm" fullWidth disableEscapeKeyDown onClose={() => {}}
      aria-labelledby={titleId}>
      <Box component="form" noValidate onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LockReset color="primary" aria-hidden /> Choose a new password
        </DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            <Alert severity="info">
              Welcome{user?.first_name ? `, ${user.first_name}` : ''}! Before you continue, replace the temporary
              password you were sent with one only you know.
            </Alert>
            <ErrorAlert error={serverError} />
            <TextField label="Temporary password" type="password" autoComplete="current-password" required
              {...register('current_password')} error={Boolean(errors.current_password)}
              helperText={errors.current_password?.message} disabled={isSubmitting} />
            <TextField label="New password" type="password" autoComplete="new-password" required
              {...register('new_password')} error={Boolean(errors.new_password)}
              helperText={errors.new_password?.message} disabled={isSubmitting} />
            <PasswordPolicyChecklist value={newPassword} />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" required
              {...register('confirm_password')} error={Boolean(errors.confirm_password)}
              helperText={errors.confirm_password?.message} disabled={isSubmitting} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              The new password must be different from the temporary one.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={logout} disabled={isSubmitting}>Sign out</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save password'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
