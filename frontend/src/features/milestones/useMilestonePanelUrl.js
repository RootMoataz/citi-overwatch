import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../../app/toast.js'

const GONE = 'That milestone is no longer available.'

/**
 * The milestone side panel's URL state on the Milestones tab; `milestones` is the tab's `useMilestones` result.
 *
 * - `?milestone=<id>` opens the panel. `open(milestone, panel?)` pushes a history entry, so Back closes it (and pushes
 *   nothing when that exact panel is already showing); `close()` removes `milestone` and `panel` with replace.
 * - An id the loaded list lacks may only mean the list is a stale cache (the Overview fills the same cache, and a
 *   bell link can name a milestone created since). So the list is refetched once, and only if the id is still missing
 *   when that refetch is back does the panel close, with the toast "That milestone is no longer available.". The
 *   toast stays silent for a milestone this viewer is archiving (`archiveStarted`; `archiveFailed` undoes that).
 * - `returnFocus()` gives the element to focus after the panel closes: the milestone's name button, timeline row or
 *   phone card inside `listRef` (the caller's ref on the list card), else the "Search milestones" field, never the
 *   page body.
 */
export function useMilestonePanelUrl(milestones, listRef) {
  const [params, setParams] = useSearchParams()
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

  const open = (m, next) => {
    if (openId === String(m.id) && (next ?? null) === panel) return
    setParams((p) => {
      p.set('milestone', m.id)
      if (next) p.set('panel', next)
      else p.delete('panel')
      return p
    })
  }
  const close = () => setParams((p) => { p.delete('milestone'); p.delete('panel'); return p }, { replace: true })

  useEffect(() => { if (openId) lastOpen.current = openId }, [openId])

  useEffect(() => {
    if (!openId) { check.current = null; return }
    if (!isSuccess || isFetching || (data ?? []).some((m) => String(m.id) === openId)) return
    const c = check.current
    if (c?.id !== openId) {
      const n = (asked.current += 1)
      check.current = { id: openId, n, closed: false }
      refetch().then(() => setSettled(n))
      return
    }
    if (c.closed || settled !== c.n) return   // that refetch isn't back yet
    c.closed = true
    if (!archiving.current.has(openId)) toast.info(GONE)
    setParams((p) => { p.delete('milestone'); p.delete('panel'); return p }, { replace: true })
  }, [openId, data, isSuccess, isFetching, refetch, settled, toast, setParams])

  const returnFocus = () => {
    const root = listRef?.current
    const id = lastOpen.current
    const found = id && (root?.querySelector(`[data-milestone-name="${id}"]`)
      ?? root?.querySelector(`li[data-milestone-id="${id}"]`)
      ?? root?.querySelector(`[data-milestone-card="${id}"]`)?.closest('button'))
    return found || root?.querySelector('input[aria-label="Search milestones"]') || null
  }

  return {
    openId, panel, current, open, close, returnFocus,
    archiveStarted: (m) => { archiving.current.add(String(m.id)) },
    archiveFailed: (m) => { archiving.current.delete(String(m.id)) },
  }
}
