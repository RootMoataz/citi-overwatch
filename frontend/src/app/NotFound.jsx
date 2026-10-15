import { NOT_FOUND } from './access.js'
import RedirectHome from './RedirectHome.jsx'

/** An address no route matches: back to the home page, saying so. */
export default function NotFound() {
  return <RedirectHome message={NOT_FOUND} />
}
