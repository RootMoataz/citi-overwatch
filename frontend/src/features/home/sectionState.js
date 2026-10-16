import { useCallback, useEffect, useRef, useState } from 'react'

export const SECTION_KEYS = ['nowNext', 'inProgress', 'upNext', 'review', 'coming', 'done', 'claim', 'week', 'manager']

const STORAGE_KEY = 'overwatch.myweek.sections'

/** The collapsed keys from storage; garbage or a blocked store means nothing is collapsed. */
function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v === true))
  } catch {
    return {}
  }
}

function write(collapsed) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed))
  } catch {
    // Blocked storage: the choice still holds in memory for this visit.
  }
}

/** Which My week sections are collapsed, remembered across visits. Everything starts open. */
export function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState(read)
  // Stored after each change, not from inside the state updater (which React may run twice): the state as read is
  // never written back, so nothing is stored until something changes.
  const initial = useRef(collapsed)
  useEffect(() => {
    if (collapsed !== initial.current) write(collapsed)
  }, [collapsed])

  const set = useCallback((key, isCollapsed) => {
    setCollapsed((prev) => {
      if (Boolean(prev[key]) === isCollapsed) return prev
      const next = { ...prev }
      if (isCollapsed) next[key] = true
      else delete next[key]
      return next
    })
  }, [])

  const isOpen = useCallback((key) => !collapsed[key], [collapsed])
  const toggle = useCallback((key) => set(key, !collapsed[key]), [set, collapsed])
  const open = useCallback((key) => set(key, false), [set])
  return { isOpen, toggle, open }
}
