import { useMemo, useState } from 'react'
import { Box, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TableSortLabel,
  Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useMediaQuery } from 'react-responsive'
import { DESKTOP_QUERY } from '../lib/responsive.js'
import { CardList } from './ResponsiveTable.jsx'

const TOTAL_ID = '__total__'

function compare(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' })
}

/** Rows sorted by a column's `sortValue`. Array sort is stable, so equal values keep their input order either way. */
function sortRows(rows, columns, sort) {
  const column = columns.find((c) => c.key === sort?.key)
  if (!column?.sortValue) return rows
  const sign = sort.dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => sign * compare(column.sortValue(a), column.sortValue(b)))
}

function CardLine({ label, value, main }) {
  if (main) return <Typography component="div" sx={{ fontWeight: 600, mb: 0.5 }}>{value}</Typography>
  return (
    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', alignItems: 'baseline', py: 0.25 }}>
      <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{label}:</Typography>
      <Typography variant="body2" component="span" sx={{ textAlign: 'right' }}>{value}</Typography>
    </Box>
  )
}

/**
 * A table on MUI `Table`; stacked cards (via `CardList`) below 900 px. Sorts on the client unless `serverSort`
 * (then the caller owns the order). `pagination.page` is zero-based, as in `TablePagination`.
 */
export default function DataTable({ ariaLabel, columns, rows, getRowId = (r) => r.id, sort, defaultSort, onSortChange,
  serverSort = false, visibleKeys, onRowOpen, selectedId, rowTone, totalRow, renderCard, loading = false, skeletonRows = 5,
  empty, pagination }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [ownSort, setOwnSort] = useState(defaultSort)
  const active = sort ?? ownSort
  const shown = useMemo(() => (visibleKeys ? columns.filter((c) => visibleKeys.includes(c.key)) : columns), [columns, visibleKeys])
  const ordered = useMemo(() => (serverSort ? rows : sortRows(rows, columns, active)), [rows, columns, active, serverSort])

  const changeSort = (column) => {
    const next = { key: column.key, dir: active?.key === column.key && active.dir === 'asc' ? 'desc' : 'asc' }
    if (sort === undefined) setOwnSort(next)
    onSortChange?.(next)
  }

  if (!loading && rows.length === 0 && empty) return empty

  const pager = pagination ? (
    <TablePagination component="div" count={pagination.total} page={pagination.page} rowsPerPage={pagination.pageSize}
      rowsPerPageOptions={[pagination.pageSize]} onPageChange={(_e, page) => pagination.onPageChange(page)} />
  ) : null

  if (!desktop) {
    const cardRows = totalRow ? [...ordered, { [TOTAL_ID]: true }] : ordered
    const card = (row) => {
      if (row[TOTAL_ID]) {
        return shown.filter((c) => totalRow[c.key] != null).map((c, i) => (
          <CardLine key={c.key} label={c.cardLabel ?? c.header} value={totalRow[c.key]} main={i === 0} />))
      }
      return renderCard ? renderCard(row) : shown.map((c, i) => (
        <CardLine key={c.key} label={c.cardLabel ?? c.header} value={c.render(row)} main={i === 0} />))
    }
    return (
      <>
        <CardList rows={cardRows} renderCard={card} ariaLabel={ariaLabel} loading={loading}
          onRowClick={onRowOpen && ((row) => { if (!row[TOTAL_ID]) onRowOpen(row) })}
          getRowId={(row) => (row[TOTAL_ID] ? TOTAL_ID : getRowId(row))} />
        {pager}
      </>
    )
  }

  return (
    <Box>
      <TableContainer>
        <Table size="small" aria-label={ariaLabel}>
          <TableHead>
            <TableRow>
              {shown.map((c) => {
                const sorted = active?.key === c.key
                const ariaSort = sorted ? (active.dir === 'desc' ? 'descending' : 'ascending') : 'none'
                return (
                  <TableCell key={c.key} align={c.align} aria-sort={c.sortable ? ariaSort : undefined}
                    sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {c.sortable ? (
                      <TableSortLabel active={sorted} direction={sorted ? active.dir : 'asc'} onClick={() => changeSort(c)}>
                        {c.header}
                      </TableSortLabel>
                    ) : c.header}
                    {c.info ? (
                      <Tooltip title={c.info}>
                        <Box component="span" tabIndex={0} role="img" aria-label={c.info} sx={{ ml: 0.5, cursor: 'help' }}>ⓘ</Box>
                      </Tooltip>
                    ) : null}
                  </TableCell>
                )
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading
              ? Array.from({ length: skeletonRows }, (_, i) => (
                <TableRow key={i}>{shown.map((c) => <TableCell key={c.key}><Skeleton /></TableCell>)}</TableRow>
              ))
              : ordered.map((row) => {
                const id = getRowId(row)
                const tone = rowTone?.(row)
                const selected = selectedId != null && selectedId === id
                return (
                  <TableRow key={id} hover={Boolean(onRowOpen)} onClick={onRowOpen ? () => onRowOpen(row) : undefined}
                    aria-current={selected ? 'true' : undefined} selected={selected}
                    sx={(theme) => ({ cursor: onRowOpen ? 'pointer' : 'default',
                      ...(tone === 'warning' ? { bgcolor: alpha(theme.palette.warning.main, 0.1) } : null) })}>
                    {shown.map((c) => <TableCell key={c.key} align={c.align}>{c.render(row)}</TableCell>)}
                  </TableRow>
                )
              })}
            {!loading && totalRow ? (
              <TableRow sx={{ '& > *': { fontWeight: 700, borderTop: 2, borderColor: 'divider' } }}>
                {shown.map((c, i) => (i === 0
                  ? <TableCell key={c.key} component="th" scope="row">{totalRow[c.key]}</TableCell>
                  : <TableCell key={c.key} align={c.align}>{totalRow[c.key]}</TableCell>))}
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      {pager}
    </Box>
  )
}
