import { Box } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useCallback, useEffect, useState } from 'react'

const fade = (side, surface) => ({
  position: 'absolute', top: 0, bottom: 0, [side]: 0, width: 32, pointerEvents: 'none', zIndex: 3,
  background: (t) => {
    const colour = t.palette.background[surface]
    return `linear-gradient(to ${side === 'right' ? 'left' : 'right'}, ${colour}, ${alpha(colour, 0)})`
  },
})

/**
 * Content that scrolls sideways inside its card, with a cue that it does: a soft fade over each edge that has more to
 * show (the right until it is scrolled to the end, the left once it is scrolled, unless `left` is false because a fixed
 * first column sits there), so a cut-off table reads as "more this way", never as clipped. Give the scrolling element
 * `thinScrollbar` (thinScrollbar.js) too.
 * children(ref, onScroll): renders the scrolling element itself (a TableContainer, say) with that ref (a callback ref)
 * and onScroll. `surface`: what it sits on, so the fade matches: 'paper' (a card, the default) or 'default' (the page).
 */
export default function ScrollHint({ children, left = true, surface = 'paper' }) {
  const [scroller, setScroller] = useState(null)
  const [more, setMore] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    if (!scroller) return
    const rest = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft
    const next = { left: scroller.scrollLeft > 1, right: rest > 1 }
    setMore((m) => (m.left === next.left && m.right === next.right ? m : next))
  }, [scroller])
  useEffect(() => {
    if (!scroller || typeof ResizeObserver === 'undefined') return undefined
    // The box resizes with the window and its content with the data (a new week, a filter): both change what's cut
    // off. An observer reports each element once when it starts watching, which takes the first measure too.
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild)
    return () => observer.disconnect()
  }, [scroller, measure])
  return (
    <Box sx={{ position: 'relative' }}>
      {children(setScroller, measure)}
      {left && more.left ? <Box aria-hidden="true" data-scroll-fade="left" sx={fade('left', surface)} /> : null}
      {more.right ? <Box aria-hidden="true" data-scroll-fade="right" sx={fade('right', surface)} /> : null}
    </Box>
  )
}
