import MilestonePendingHours from '../approvals/MilestonePendingHours.jsx'
import MilestonesTab from './MilestonesTab.jsx'

/** Milestones tab; managers also see each milestone's pending hours and their budget impact. */
export default function MilestonesWithHours(props) {
  return <MilestonesTab {...props}
    extra={props.manage ? (m) => <MilestonePendingHours milestone={m} /> : undefined} />
}
