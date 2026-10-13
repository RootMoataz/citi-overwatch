import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './app/App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AppProviders } from './app/providers.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProviders>
      <BrowserRouter>
        <ErrorBoundary><App /></ErrorBoundary>
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
)
