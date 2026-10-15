import { Box, Tab, Tabs } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '../../auth/sessionContext.js'
import PageHeader from '../../components/PageHeader.jsx'
import { can } from '../../lib/permissions.js'
import LiveTimersCard from '../timer/LiveTimersCard.jsx'
import ApprovedTab from './ApprovedTab.jsx'
import ChangeRequests from './ChangeRequests.jsx'
import HrTab from './HrTab.jsx'
import ReviewTab from './ReviewTab.jsx'

const FILTERS = ['user', 'project', 'milestone']

/** Which tabs the viewer gets: managers review and see approved weeks; admins also submit to HR; executives only
 * read the HR submissions. */
function tabsFor(user) {
  const tabs = []
  if (can(user, 'approvals.view')) tabs.push({ value: 'review', label: 'To review' }, { value: 'approved', label: 'Approved' })
  if (can(user, 'hr.submit')) tabs.push({ value: 'hr', label: 'HR submission' })
  else if (can(user, 'hr.view')) tabs.push({ value: 'hr', label: 'HR submissions' })
  return tabs
}

const SUBTITLE = {
  manager: 'Review your people’s hours week by week and see what was approved.',
  admin: 'Review hours, see every approved week, and submit pay periods to HR.',
  executive: 'Pay periods admins have submitted to HR.',
}

/** The Timesheets area (was Approvals): who's running a timer right now (Live now), change requests on timer hours,
 * then the tabs. The tab lives in ?tab=, and alert links filter To review with ?user= etc. */
export default function TimesheetsPage() {
  const { user } = useSession()
  const [params, setParams] = useSearchParams()
  const tabs = tabsFor(user)
  const asked = params.get('tab')
  const tab = tabs.some((t) => t.value === asked) ? asked : tabs[0]?.value
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k)]).filter(([, v]) => v))
  const choose = (value) => setParams(value === tabs[0].value ? {} : { tab: value })
  return (
    <>
      <PageHeader title="Timesheets" subtitle={SUBTITLE[user?.role]} />
      <Box sx={{ mb: 2 }}><LiveTimersCard /></Box>
      {can(user, 'approvals.view') ? <ChangeRequests /> : null}
      <Tabs value={tab} onChange={(_, v) => choose(v)} sx={{ mb: 2 }} aria-label="Timesheets" variant="scrollable" allowScrollButtonsMobile>
        {tabs.map((t) => <Tab key={t.value} value={t.value} label={t.label} />)}
      </Tabs>
      {tab === 'review' ? <ReviewTab filters={filters} onClearFilters={() => setParams({})} /> : null}
      {tab === 'approved' ? <ApprovedTab /> : null}
      {tab === 'hr' ? <HrTab /> : null}
    </>
  )
}
