import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useToast } from '../../app/toast.js'

const GONE = 'That milestone is no longer available.'

/**
 * The milestone side panel's URL state on the Milestones tab; `milestones` is the tab's `useMilestones` result.
 *
 * - `?milestone=<id>` opens the panel. History: Back undoes an open, and closing never leaves a dead entry behind.
 *   - `open(milestone, panel?)` from a closed panel pushes an entry marked `state.panelPushed`, so Back closes it;
 *     while the panel is open it replaces the entry instead (switching rows, or the ⋯'s "Open discussion"), keeping
 *     the mark, so Back after closing never reopens the one before; it does nothing when that exact panel is showing.
 *   - `close()` (Close, Esc) goes back when the entry is marked: that undoes the open. A panel the page landed on
 *     (a link or a reload of a deep link) has no mark, so it removes `milestone` and `panel` with replace instead.
 * - `?panel=<tab>` picks the panel's tab: `panel` is the raw value (the panel decides what the viewer may see) and
 *   `setPanel(tab)` writes it with replace, keeping the mark, so Back still closes the panel.
 * - An id the loaded list lacks may only mean the list is a stale cache (the Overview fills the same cache, and a
 *   bell link can name a milestone created since). So the list is refetched once, and only if the id is still missing
 *   when that refetch is back does the panel close (as `close()` does), with the toast "That milestone is no longer
 *   available.". The toast stays silent for a milestone this viewer is archiving (`archiveStarted`; `archiveFailed`
 *   undoes that). A refetch that fails leaves the panel shut and the URL as it is, with no toast.
 * - `returnFocus()` gives the element to focus after the panel closes: the milestone's name button, timeline row or
 *   phone card inside `listRef` (the caller's ref on the list card), else the "Search milestones" field, never the
 *   page body.
 */
export function useMilestonePanelUrl(milestones, listRef) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const lastOpen = useRef(null)          // whose row gets focus back
  const archiving = useRef(new Set())    // ids this viewer is archiving: they close silently
  const check = useRef(null)             // { id, n, closed }: the missing id being checked, and its refetch's number
  const asked = useRef(0)
  const [settled, setSettled] = useState(0)   // the number of the last checking refetch that came back
  const openId = params.get('milestone')
  const panel = params.get('panel')
  const { data, isSuccess, isFetching, refetch } = milestones
  const current = openId ? (data ?? []).find((m) => String(m.id) === openId) : undefined

  const kept = location.state   // a replace keeps the entry's state, and so its panelPushed mark
  const pushed = Boolean(kept?.panelPushed)

  const open = (m, next) => {
    if (openId === String(m.id) && (next ?? null) === panel) return
    const write = (p) => {
      p.set('milestone', m.id)
      if (next) p.set('panel', next)
      else p.delete('panel')
      return p
    }
    if (openId) setParams(write, { replace: true, state: kept })
    else setParams(write, { state: { ...kept, panelPushed: true } })
  }
  // Switching tabs replaces the entry, so Back still closes the panel rather than stepping through tabs.
  const setPanel = (next) => setParams((p) => { p.set('panel', next); return p }, { replace: true, state: kept })
  const close = () => {
    if (pushed) navigate(-1)
    else setParams((p) => { p.delete('milestone'); p.delete('panel'); return p }, { replace: true, state: kept })
  }

  useEffect(() => { if (openId) lastOpen.current = openId }, [openId])

  useEffect(() => {
    if (!openId) { check.current = null; return }
    if (!isSuccess || isFetching || (data ?? []).some((m) => String(m.id) === openId)) return
    const c = check.current
    if (c?.id !== openId) {
      const n = (asked.current += 1)
      check.current = { id: openId, n, closed: false }
      // A failed refetch settles nothing: the panel stays shut and the URL as it is, without a toast.
      Promise.resolve(refetch()).then(() => setSettled(n), () => {})
      return
    }
    if (c.closed || settled !== c.n) return   // that refetch isn't back yet
    c.closed = true
    if (!archiving.current.has(openId)) toast.info(GONE)
    if (pushed) navigate(-1)   // as close() does
    else setParams((p) => { p.delete('milestone'); p.delete('panel'); return p }, { replace: true, state: kept })
  }, [openId, data, isSuccess, isFetching, refetch, settled, toast, setParams, pushed, navigate, kept])

  const returnFocus = () => {
    const root = listRef?.current
    const id = lastOpen.current
    const found = id && (root?.querySelector(`[data-milestone-name="${id}"]`)
      ?? root?.querySelector(`li[data-milestone-id="${id}"]`)
      ?? root?.querySelector(`[data-milestone-card="${id}"]`)?.closest('button'))
    return found || root?.querySelector('input[aria-label="Search milestones"]') || null
  }

  return {
    openId, panel, setPanel, current, open, close, returnFocus,
    archiveStarted: (m) => { archiving.current.add(String(m.id)) },
    archiveFailed: (m) => { archiving.current.delete(String(m.id)) },
  }
}
