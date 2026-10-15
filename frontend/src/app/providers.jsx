import { Alert, CssBaseline, Snackbar } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { QueryClientProvider } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { makeQueryClient } from './queryClient.js'
import { ColorModeContext, readPreference, resolveMode, storePreference, useSystemDark } from './colorMode.js'
import { buildTheme } from './theme.js'
import { ToastContext } from './toast.js'

function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const show = useCallback((severity, message) => setToast({ severity, message, key: Date.now() }), [])
  const value = useMemo(() => ({
    success: (message) => show('success', message),
    error: (message) => show('error', message),
    warning: (message) => show('warning', message),
    info: (message) => show('info', message),
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

/** `mode` pins the theme (light or dark); without it the viewer's choice applies, "system" by default. */
export function AppProviders({ children, queryClient, mode: pinned }) {
  const [preference, setChoice] = useState(readPreference)
  const systemDark = useSystemDark()
  const mode = pinned ?? resolveMode(preference, systemDark)
  const setPreference = useCallback((next) => { storePreference(next); setChoice(next) }, [])
  const colorMode = useMemo(() => ({ preference, mode, setPreference }), [preference, mode, setPreference])
  const theme = useMemo(() => buildTheme(mode), [mode])
  const [client] = useState(() => queryClient ?? makeQueryClient())
  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        {/* enableColorScheme tells the browser too, so scrollbars, inputs and date pickers match. */}
        <CssBaseline enableColorScheme />
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <QueryClientProvider client={client}>
            <ToastProvider>{children}</ToastProvider>
          </QueryClientProvider>
        </LocalizationProvider>
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}
