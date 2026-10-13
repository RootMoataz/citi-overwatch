import { Alert, CssBaseline, Snackbar } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { QueryClientProvider } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { makeQueryClient } from './queryClient.js'
import { buildTheme } from './theme.js'
import { ToastContext } from './toast.js'

function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const show = useCallback((severity, message) => setToast({ severity, message, key: Date.now() }), [])
  const value = useMemo(() => ({
    success: (message) => show('success', message),
    error: (message) => show('error', message),
  }), [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar key={toast?.key} open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  )
}

export function AppProviders({ children, queryClient, mode = 'light' }) {
  const theme = useMemo(() => buildTheme(mode), [mode])
  const [client] = useState(() => queryClient ?? makeQueryClient())
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </LocalizationProvider>
    </ThemeProvider>
  )
}
