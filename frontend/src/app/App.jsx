import { Route, Routes } from 'react-router-dom'
import RequireAuth from '../auth/RequireAuth.jsx'
import SessionProvider from '../auth/SessionProvider.jsx'
import { useSession } from '../auth/sessionContext.js'
import EmptyState from '../components/EmptyState.jsx'
import ForgotPasswordPage from '../features/login/ForgotPasswordPage.jsx'
import LoginPage from '../features/login/LoginPage.jsx'
import Layout from './Layout.jsx'
import NotFound from './NotFound.jsx'

function Shell() {
  const { user, logout } = useSession()
  return <Layout user={user} onLogout={logout} />
}

function Welcome() {
  const { user } = useSession()
  return <EmptyState title={`Welcome, ${user.first_name}`} description="Pick a section from the menu to get started." />
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<Welcome />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}
