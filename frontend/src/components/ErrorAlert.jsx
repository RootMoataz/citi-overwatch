import { Alert, AlertTitle, Button, Typography } from '@mui/material'

/** Friendly error with the request id, so any failure can be traced to the exact backend log line. */
export default function ErrorAlert({ error, title, onRetry, sx }) {
  if (!error) return null
  const requestId = error.requestId
  return (
    <Alert severity="error" role="alert" sx={sx}
      action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>Try again</Button> : undefined}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {error.message || 'Something went wrong.'}
      {requestId ? (
        <Typography component="span" variant="caption" sx={{ display: 'block', opacity: 0.8, mt: 0.5 }}>
          ref: {requestId}
        </Typography>
      ) : null}
    </Alert>
  )
}
