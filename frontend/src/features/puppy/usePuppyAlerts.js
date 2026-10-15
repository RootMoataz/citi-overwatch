// Watches the unread notifications (the bell's own query, so no extra requests) and, when new ones arrive, alerts
// three ways so sound is never the only signal: a toast, a polite screen-reader announcement and (if chosen) a
// sound. detector.js decides what is new; the gate keeps alerts at most one per 5 seconds, adding bursts together.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../app/toast.js'
import { armAudioUnlock, playSound } from './audio.js'
import { createAlertGate, detectNew, initialDetector } from './detector.js'

export const alertText = (count) => `Puppy: ${count} new ${count === 1 ? 'notification' : 'notifications'}`
const UNLOCK_HINT = 'Click anywhere to enable sounds.'

/** Remembers when the viewer's own last save finished, so alerts their own action caused stay quiet. */
function useOwnActionClock() {
  const queryClient = useQueryClient()
  const at = useRef(-Infinity)
  useEffect(() => queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action?.type === 'success') at.current = Date.now()
  }), [queryClient])
  return at
}

/** → { announcement, excitedAt } for the Puppy button (excitedAt changes each time Puppy alerts). */
export function usePuppyAlerts({ me, notifications, settings }) {
  const toast = useToast()
  const ownActionAt = useOwnActionClock()
  const detector = useRef(initialDetector())
  const [gate] = useState(createAlertGate)
  const timer = useRef(null)
  const hinted = useRef(false)
  const latest = useRef({ settings, toast })
  const [announcement, setAnnouncement] = useState('')
  const [excitedAt, setExcitedAt] = useState(0)

  useEffect(() => { latest.current = { settings, toast } })
  useEffect(() => armAudioUnlock(), [])
  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    const alert = (count) => {
      const { settings: s, toast: t } = latest.current
      let text = alertText(count)
      const quietHere = s.backgroundOnly && typeof document !== 'undefined' && !document.hidden
      if (!s.muted && !quietHere && playSound(s.sound, s.volume) === 'blocked' && !hinted.current) {
        hinted.current = true
        text = `${text}. ${UNLOCK_HINT}`
      }
      t.info(text)
      setAnnouncement(text)
      setExcitedAt(Date.now())
    }
    const handle = (answer) => {
      if (answer?.play) alert(answer.play)
      else if (answer?.wait && !timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null
          handle(gate.flush(Date.now()))
        }, answer.wait)
      }
    }
    const now = Date.now()
    const { state, fresh } = detectNew(detector.current, notifications, { me, now, ownActionAt: ownActionAt.current })
    detector.current = state
    if (fresh.length) handle(gate.offer(fresh.length, now))
  }, [notifications, me, ownActionAt, gate])

  return { announcement, excitedAt }
}

/** "(3) Scout" in the browser tab while notifications are unread; the plain title otherwise or when switched off. */
export function useTitleBadge(count, enabled) {
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = enabled && count > 0 ? `(${count}) ${base}` : base
  }, [count, enabled])
  useEffect(() => () => { document.title = document.title.replace(/^\(\d+\)\s*/, '') }, [])
}
