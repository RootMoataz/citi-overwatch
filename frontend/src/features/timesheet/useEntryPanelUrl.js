import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

const PARAM = /^(.+):(\d{4}-\d{2}-\d{2})$/
/** "m1:2026-10-14" → "m1|2026-10-14" (the week's cell key); anything else → null. */
const keyOf = (raw) => {
  const m = PARAM.exec(raw ?? '')
  return m ? `${m[1]}|${m[2]}` : null
}
/** The `?entry=` value of a cell, and the `data-entry` mark of its status line: "m1:2026-10-14". */
export const entryParam = (milestoneId, date) => `${milestoneId}:${date}`
const paramOf = (cellKey) => cellKey.replace('|', ':')

/**
 * Entry details' URL state on My timesheet, as `useMilestonePanelUrl` keeps the milestone panel's.
 *
 * - `?entry=<milestoneId>:<date>` opens the panel; `entryKey` is that cell's key (`<milestoneId>|<date>`), or null while
 *   the week isn't `ready` (its own data, not the previous week's placeholder) or when `has(key)` refuses it.
 * - `open(milestoneId, date)` from a closed panel pushes an entry marked `state.panelPushed`, so Back closes it; while one
 *   is open it replaces the entry instead, keeping the mark. It does nothing when that cell is already showing.
 * - `close()` (Close, Esc, Done, a successful Save & resubmit, a view change) goes back when the entry is marked, which
 *   undoes the open. A panel the page landed on (a link, a reload) has no mark, so `entry` is removed with replace.
 * - A bad value (another week, a typo, an empty cell, a row no longer listed) is dropped once the week is ready,
 *   silently, as `close()` does: no panel ever opens for it, and an entry pushed by an open leaves no dead Back step.
 *   Only one Back is taken for an entry, however many closes ask for it before it lands.
 * - `returnFocus()` gives the element to focus after the panel closes: the cell's status line (`[data-entry]`) or the Day
 *   view's Details for it (`[data-entry-details]`), else the week range heading. Focus the person already put on a
 *   control outside the panel (the view toggle or a week arrow that closed it) stays where it is.
 */
export function useEntryPanelUrl({ ready, has }) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const lastOpen = useRef(null)
  const leaving = useRef(null)   // the history entry a Back is already leaving
  const raw = params.get('entry')
  const asked = keyOf(raw)
  const known = asked !== null && has(asked)
  const entryKey = ready && known ? asked : null
  const kept = location.state   // a replace keeps the entry's state, and so its panelPushed mark
  const pushed = Boolean(kept?.panelPushed)

  const open = (milestoneId, date) => {
    const next = entryParam(milestoneId, date)
    if (entryKey && raw === next) return
    const write = (p) => { p.set('entry', next); return p }
    if (entryKey) setParams(write, { replace: true, state: kept })
    else setParams(write, { state: { ...kept, panelPushed: true } })
  }
  const back = () => {
    if (leaving.current === location.key) return
    leaving.current = location.key
    navigate(-1)
  }
  const close = () => {
    if (pushed) back()
    else setParams((p) => { p.delete('entry'); return p }, { replace: true, state: kept })
  }

  useEffect(() => { if (entryKey) lastOpen.current = paramOf(entryKey) }, [entryKey])

  const bad = raw !== null && ready && !known
  useEffect(() => {
    if (!bad) return
    if (pushed) {
      if (leaving.current !== location.key) { leaving.current = location.key; navigate(-1) }
    } else setParams((p) => { p.delete('entry'); return p }, { replace: true, state: kept })
  }, [bad, pushed, location.key, navigate, setParams, kept])

  const returnFocus = () => {
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected && !active.closest('[role="dialog"], [role="complementary"]')) return active
    const marked = (attr) => [...document.querySelectorAll(`[${attr}]`)].find((el) => el.getAttribute(attr) === lastOpen.current)
    return marked('data-entry') ?? marked('data-entry-details') ?? document.querySelector('[data-week-range]')
  }

  return { entryKey, open, close, returnFocus }
}
