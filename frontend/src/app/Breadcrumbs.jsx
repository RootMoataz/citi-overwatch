import ArrowBack from '@mui/icons-material/ArrowBack'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import { Box, Link, Skeleton, Typography } from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { crumbsFor, useCrumbLabel } from './breadcrumbs.js'

// How much of the current page's name (px) the desktop trail keeps before it drops its leading crumbs.
const MIN_CURRENT = 64
// Under this width (px) the phone back link shows its arrow alone.
const BACK_TEXT_MIN = 56

/**
 * Phones, on a nested page: a link back to the parent crumb ("‹ Projects"). It sits where the logo would and takes the
 * room the bar has spare; with too little room for its text it shows the arrow alone, still a 24 × 40 px target. Its name
 * is always "Back to <parent>", which holds the text it shows.
 */
export function BackLink({ crumb }) {
  return (
    <Box sx={{ flex: '1 1 0', minWidth: 24, display: 'flex', alignItems: 'center', containerType: 'inline-size' }}>
      <Link component={RouterLink} to={crumb.to} aria-label={`Back to ${crumb.label}`} underline="hover" color="text.primary"
        sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 24, minHeight: 40, fontWeight: 600,
          [`@container (max-width: ${BACK_TEXT_MIN - 0.02}px)`]: { '& [data-back-text]': { display: 'none' } } }}>
        <ChevronLeft aria-hidden sx={{ flexShrink: 0 }} />
        <Box component="span" data-back-text sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {crumb.label}
        </Box>
      </Link>
    </Box>
  )
}

/**
 * Whether the trail `key` drops its leading crumbs to fit the nav's room. It does when every crumb but the last, plus
 * MIN_CURRENT px of the last, is wider than the room. What the full trail needs is measured while it shows and kept, so
 * the trail comes back once the room grows. Measured before paint (ResizeObserver, flushSync), so it never flashes; jsdom
 * has no layout and keeps the full trail.
 */
function useTightTrail(navRef, key, droppable) {
  const [tightKey, setTightKey] = useState(null)
  const need = useRef(new Map())
  const tight = droppable && tightKey === key
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!droppable || !nav || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      if (!tight) {
        const items = [...nav.querySelectorAll(':scope > ol > li')]
        const last = items.at(-1)
        const label = last?.lastElementChild
        if (!label) return
        const lead = items.slice(0, -1).reduce((sum, li) => sum + li.getBoundingClientRect().width, 0)
        const separator = last.getBoundingClientRect().width - label.getBoundingClientRect().width
        need.current.set(key, lead + separator + Math.min(MIN_CURRENT, label.scrollWidth))
      }
      const fits = nav.clientWidth + 0.5 >= (need.current.get(key) ?? 0)
      flushSync(() => setTightKey(fits ? null : key))
    })
    observer.observe(nav)
    return () => observer.disconnect()
  }, [navRef, key, droppable, tight])
  return tight
}

/**
 * The desktop trail (phones get BackLink instead). It takes the bar's spare room and only it gives way: every crumb but
 * the last keeps its width, and the last one (a name of up to 120 characters) ends in an ellipsis. When even that can't
 * fit (a narrow desktop with the sidebar open), a three-crumb trail shows only the parent and the current page; the root
 * stays for screen readers, visually hidden, so the trail reads the same.
 */
export default function Breadcrumbs({ user }) {
  const { pathname } = useLocation()
  const crumbs = crumbsFor(pathname, user, useCrumbLabel())
  const navRef = useRef(null)
  const key = crumbs.map((crumb) => (crumb.pending ? '…' : crumb.label)).join('\n')
  const tight = useTightTrail(navRef, key, crumbs.length > 2)
  const first = tight ? crumbs.length - 2 : 0

  return (
    <Box component="nav" ref={navRef} aria-label="Breadcrumb" sx={{ flex: '1 1 auto', minWidth: 0 }}>
      <Box component="ol" sx={{ display: 'flex', alignItems: 'center', listStyle: 'none', m: 0, p: 0, minWidth: 0,
        '& > li': { display: 'flex', alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap' },
        '& > li:last-of-type': { flexShrink: 1, minWidth: 0 } }}>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <Box component="li" key={`${index}-${crumb.label ?? 'pending'}`} sx={index < first ? visuallyHidden : undefined}>
              {index > first ? <Box component="span" aria-hidden="true" sx={{ mx: 1, color: 'text.disabled' }}>/</Box> : null}
              {crumb.pending ? (
                <Skeleton variant="text" width={96} aria-current="page" aria-busy="true" />
              ) : crumb.to && !last ? (
                <Link component={RouterLink} to={crumb.to} underline="hover" variant="body2" color="text.secondary"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                  {index === 0 ? <ArrowBack fontSize="inherit" aria-hidden /> : null}{crumb.label}
                </Link>
              ) : (
                <Typography variant="body2" noWrap aria-current={last ? 'page' : undefined} title={last ? crumb.label : undefined}
                  sx={{ minWidth: 0, color: last ? 'text.primary' : 'text.secondary', fontWeight: last ? 600 : 400 }}>
                  {crumb.label}
                </Typography>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
