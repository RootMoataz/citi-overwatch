import EditIcon from '@mui/icons-material/EditOutlined'
import MoreTime from '@mui/icons-material/MoreTimeOutlined'
import SyncProblem from '@mui/icons-material/SyncProblemOutlined'
import { Chip, Tooltip } from '@mui/material'
import Critical from '../../components/Critical.jsx'
import { HR_CHANGED } from '../../lib/labels.js'
import { EDITED, OVERTIME, isEdited, isHrChanged, isOvertime } from './entryCues.js'

const CHIP_SX = { height: 'auto', minHeight: 20, fontSize: '0.72rem', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.125 } }

/**
 * An entry's cues as chips beside its flags (see entryCues.js): "Overtime" (warning and bold; its tooltip and description are
 * the status line, "Pending (Overtime requested from …)"), "Edited", and the changed-after-HR chip. Each carries its
 * tone in `data-tone`; nothing when there's no cue.
 */
export default function EntryCueChips({ item }) {
  return (
    <>
      {isOvertime(item) ? (
        <Tooltip title={item.label} describeChild>
          <Chip size="small" variant="outlined" color="warning" data-tone="warning" icon={<MoreTime aria-hidden="true" />}
            label={<Critical>{OVERTIME}</Critical>} tabIndex={0} sx={CHIP_SX} />
        </Tooltip>
      ) : null}
      {isEdited(item) ? (
        <Chip size="small" variant="outlined" data-tone="neutral" icon={<EditIcon aria-hidden="true" />} label={EDITED}
          sx={CHIP_SX} />
      ) : null}
      {isHrChanged(item) ? (
        <Chip size="small" variant="outlined" color="warning" data-tone="warning" icon={<SyncProblem aria-hidden="true" />}
          label={HR_CHANGED} sx={CHIP_SX} />
      ) : null}
    </>
  )
}
