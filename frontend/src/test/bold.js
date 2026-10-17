// The critical details are bold app-wide (components/Critical.jsx). They are found by the `strong` role: Critical renders
// a <strong>, which has no other testable role or name (a documented exception to the role-and-label-only queries: the
// role is queried, then the element's text).
import { within } from '@testing-library/react'

/** The texts shown in bold inside `el`, in order. `options` go to the role query, e.g. `{ hidden: true }` inside an
 * aria-hidden drawing. */
export const bold = (el, options) => within(el).queryAllByRole('strong', options).map((s) => s.textContent)
