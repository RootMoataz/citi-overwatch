import { Route, Routes } from 'react-router-dom'
import Layout from './Layout.jsx'
import NotFound from './NotFound.jsx'

// Session handling and the real pages are added in Tasks 15-19.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout user={null} />}>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
