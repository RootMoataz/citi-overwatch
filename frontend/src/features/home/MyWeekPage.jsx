import { Grid, Skeleton, Stack } from '@mui/material'
import { flushSync } from 'react-dom'
import { useMediaQuery } from 'react-responsive'
import { useSearchParams } from 'react-router-dom'
import { useProfile, useProfileWeek } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import Reveal from '../../components/Reveal.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { mondayOfIso, nyMondayIso, nyTodayIso } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import TimerLimitBanner from '../timer/TimerLimitBanner.jsx'
import YourManagerCard from '../people/YourManagerCard.jsx'
import Claimable from './Claimable.jsx'
import MilestoneGroups, { COMING_ID } from './MilestoneGroups.jsx'
import WeekHoursCard from './WeekHoursCard.jsx'
import WeekPicker from './WeekPicker.jsx'
import YourFocusCard from './YourFocusCard.jsx'
import { groupMilestones } from './myWork.js'
import { useCollapsedSections } from './sectionState.js'

const NONE = []
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** The Monday of a typed ?week=, or the current week when it is missing, malformed or in the future. */
function shownWeek(asked, current) {
  if (!asked || !ISO.test(asked) || Number.isNaN(Date.parse(`${asked}T00:00:00Z`))) return current
  const monday = mondayOfIso(asked)
  return monday > current ? current : monday
}

/** An employee's home: their week and their work, not the managers' delivery dashboard. */
export default function MyWeekPage() {
  const { user } = useSession()
  const profile = useProfile(user.id)
  const sections = useCollapsedSections()
  const [params, setParams] = useSearchParams()
  const wide = useMediaQuery(DESKTOP_QUERY)
  const today = nyTodayIso()
  const current = nyMondayIso()
  const week = shownWeek(params.get('week'), current)
  const data = profile.data
  // The full profile carries the server's default week (the UTC one); use it only when that is the week shown.
  const fromProfile = data?.this_week?.week_start === week
  const weekly = useProfileWeek(user.id, week, Boolean(data) && !fromProfile)
  const hoursData = fromProfile ? data.this_week : weekly.data?.this_week
  const hoursLoading = !fromProfile && (weekly.isLoading || (weekly.isPlaceholderData && !weekly.error))
  const hoursError = fromProfile ? null : weekly.error
  const changeWeek = (next) => setParams((prev) => {
    const out = new URLSearchParams(prev)
    if (next === current) out.delete('week')
    else out.set('week', next)
    return out
  }, { replace: true })
  const groups = groupMilestones(data?.milestones, today)
  const comingUp = data?.coming_up ?? NONE

  // Open "Might come your way" now (not after the next paint), so the target is in the DOM to scroll to and focus.
  const reveal = (targetId, focusTarget) => {
    flushSync(() => sections.open('coming'))
    const target = document.getElementById(targetId)
    target?.scrollIntoView?.({ block: 'start' })
    focusTarget(target)?.focus()
  }
  const showComing = () => reveal(COMING_ID, (section) => section?.querySelector('h2 button'))
  const showPrediction = (id) => reveal(`${COMING_ID}-${id}`, (row) => row)

  const focus = data ? (
    <Reveal>
      <YourFocusCard groups={groups} comingUp={comingUp} today={today} sections={sections}
        onShowComing={showComing} onShowPrediction={showPrediction} />
    </Reveal>
  ) : profile.isLoading ? <Skeleton variant="rounded" height={240} /> : null
  const groupList = data ? <MilestoneGroups groups={groups} comingUp={comingUp} today={today} sections={sections} /> : null
  const hours = data ? (
    <Reveal index={1}>
      <WeekHoursCard week={week} current={current} data={hoursData} loading={hoursLoading} error={hoursError}
        onRetry={() => weekly.refetch()} open={sections.isOpen('week')} onToggle={() => sections.toggle('week')} />
    </Reveal>
  ) : profile.isLoading ? <Skeleton variant="rounded" height={240} /> : null
  const manager = data?.user?.manager
    ? <YourManagerCard manager={data.user.manager} collapsible stacked={wide} open={sections.isOpen('manager')}
      onToggle={() => sections.toggle('manager')} /> : null

  return (
    <>
      <PageHeader title="My week" subtitle={`Hello, ${user.first_name}. Your work and hours in one place.`}
        actions={<WeekPicker week={week} current={current} onChange={changeWeek} />} />
      <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} sx={{ mb: 2 }} />
      <TimerLimitBanner showUnsubmitted />
      {wide ? (
        <Grid container spacing={2}>
          <Grid size={8}>
            <Stack sx={{ gap: 2 }}>{focus}{groupList}<Claimable sections={sections} /></Stack>
          </Grid>
          <Grid size={4}>
            <Stack sx={{ gap: 2 }}>{hours}{manager}</Stack>
          </Grid>
        </Grid>
      ) : (
        <Stack sx={{ gap: 2 }}>{focus}{hours}{groupList}<Claimable sections={sections} />{manager}</Stack>
      )}
    </>
  )
}
