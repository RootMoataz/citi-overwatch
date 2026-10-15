import FileDownload from '@mui/icons-material/FileDownloadOutlined'
import { Button } from '@mui/material'
import { csvFilename, downloadCsv, toCsv } from '../lib/csv.js'

/**
 * Downloads `rows` (what the table shows, filters applied) as scout-<name>-<date>.csv.
 * `columns` are [{ header, value: (row) => cell }]: readable headers, ISO dates and plain numbers (no $ or %).
 */
export default function ExportCsvButton({ name, columns, rows, sx }) {
  const empty = !rows?.length
  return (
    <Button size="small" variant="outlined" startIcon={<FileDownload />} disabled={empty} sx={sx}
      title={empty ? 'Nothing to export' : `Download ${rows.length} rows as a CSV file`}
      onClick={() => downloadCsv(csvFilename(name), toCsv(columns, rows))}>
      Export CSV
    </Button>
  )
}
