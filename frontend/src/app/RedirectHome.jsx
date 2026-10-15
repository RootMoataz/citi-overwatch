import { useEffect } from 'react'
import { useRedirectHome } from './access.js'

/** Rendered where a page can't be shown: sends the viewer home with `message`. */
export default function RedirectHome({ message }) {
  const redirect = useRedirectHome()
  useEffect(() => { redirect(message) }, [message, redirect])
  return null
}
