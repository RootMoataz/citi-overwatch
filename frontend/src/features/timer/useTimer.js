import { useEffect, useMemo, useState } from 'react'
import { useCurrentTimer } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import { can } from '../../lib/permissions.js'
import { clockOffset, elapsedSeconds, reachedLimits, worstLevel } from './timerClock.js'

/** The signed-in person's running timer (null when none), ticking once a second while it runs, with its limits
 * (level and the limits reached so far, on the server's clock) and their timer hours not submitted yet.
 * Only people who keep a timesheet ask the server at all. */
export function useTimer() {
  const { user } = useSession()
  const enabled = can(user, 'timer.use')
  const current = useCurrentTimer(enabled)
  const timer = current.data?.timer ?? null
  // dataUpdatedAt is this device's clock when the server's `now` arrived.
  const offset = useMemo(() => clockOffset(current.data?.now, current.dataUpdatedAt),
    [current.data, current.dataUpdatedAt])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!timer) return undefined
    const first = setTimeout(() => setNow(Date.now()), 0) // catch up at once when a timer starts
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [timer])
  const limits = timer ? current.data?.limits ?? [] : []
  const serverNow = now + offset
  return {
    enabled,
    timer,
    elapsed: timer ? elapsedSeconds(timer.started_at, offset, now) : 0,
    stopped: current.data?.stopped ?? null,
    limits,
    level: timer ? worstLevel(limits, serverNow) : 'ok',
    reached: timer ? reachedLimits(limits, serverNow) : [],
    unsubmitted: current.data?.unsubmitted ?? [],
    isLoading: current.isLoading,
  }
}
