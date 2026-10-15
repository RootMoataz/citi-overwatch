// CSV export built in the browser from data already on screen: UTF-8 with a BOM (so Excel reads accents),
// RFC 4180 quoting and CRLF line ends, and formula-injection protection for text cells.

export const BOM = '\uFEFF'

// A text cell starting with one of these could run as a formula in Excel, Sheets or LibreOffice.
const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]/

/** One cell. Numbers stay plain (negatives too), booleans read Yes/No, missing values are empty. */
export function csvCell(value) {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  let text = String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** columns: [{ header, value: (row) => cell }] → the whole file as a string (BOM, header row, one line per row). */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.header)), ...rows.map((row) => columns.map((c) => csvCell(c.value(row))))]
  return BOM + lines.map((cells) => cells.join(',')).join('\r\n') + '\r\n'
}

const pad = (n) => String(n).padStart(2, '0')

/** "projects" → "overwatch-projects-2026-10-15.csv" (the viewer's local date). */
export const csvFilename = (name, date = new Date()) =>
  `overwatch-${name}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`

/** Hand the file to the browser as a download. */
export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** A timestamp from the API (any offset) → ISO 8601 in UTC, e.g. "2026-10-15T03:07:08.338Z". */
export const utcIso = (value) => (value ? new Date(value).toISOString() : null)

/** Decimal strings from the API ("1200.50") → numbers for the file; anything else unchanged. */
export const num = (value) => (value == null || value === '' ? null : Number(value))
