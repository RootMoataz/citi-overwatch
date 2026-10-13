import { Box, Card, CardActionArea, CardContent, Skeleton, Stack } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import { useMediaQuery } from 'react-responsive'
import { DESKTOP_QUERY } from '../lib/responsive.js'


/** A data grid on desktop; stacked, tappable cards on phones (React Responsive picks). */
export default function ResponsiveTable({ rows, columns, renderCard, loading = false, onRowClick, emptyState,
  getRowId, pageSize = 25, ariaLabel }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)

  if (!loading && rows.length === 0 && emptyState) return emptyState

  if (desktop) {
    return (
      <Box sx={{ width: '100%' }}>
        <DataGrid rows={rows} columns={columns} loading={loading} getRowId={getRowId} autoHeight
          disableRowSelectionOnClick density="compact" aria-label={ariaLabel}
          initialState={{ pagination: { paginationModel: { pageSize } } }} pageSizeOptions={[10, 25, 50]}
          onRowClick={onRowClick ? (params) => onRowClick(params.row) : undefined}
          sx={{ bgcolor: 'background.paper', '& .MuiDataGrid-row': { cursor: onRowClick ? 'pointer' : 'default' } }} />
      </Box>
    )
  }

  if (loading) {
    return <Stack sx={{ gap: 1 }}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={88} />)}</Stack>
  }
  return (
    <Stack component="ul" aria-label={ariaLabel} sx={{ gap: 1, listStyle: 'none', p: 0, m: 0 }}>
      {rows.map((row) => (
        <li key={getRowId ? getRowId(row) : row.id}>
          <Card>
            {onRowClick ? (
              <CardActionArea onClick={() => onRowClick(row)}><CardContent>{renderCard(row)}</CardContent></CardActionArea>
            ) : <CardContent>{renderCard(row)}</CardContent>}
          </Card>
        </li>
      ))}
    </Stack>
  )
}
