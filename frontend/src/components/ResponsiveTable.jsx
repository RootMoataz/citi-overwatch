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
          disableRowSelectionOnClick density="compact" aria-label={ariaLabel} getRowHeight={() => "auto"}
          disableVirtualization={import.meta.env.MODE === "test"}
          initialState={{ pagination: { paginationModel: { pageSize } } }} pageSizeOptions={[10, 25, 50]}
          onRowClick={onRowClick ? (params) => onRowClick(params.row) : undefined}
          sx={{ bgcolor: 'background.paper', '& .MuiDataGrid-row': { cursor: onRowClick ? 'pointer' : 'default' },
            // Auto-height rows: centre every cell's content and give it a little air.
            '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center', py: 0.75, minWidth: 0 } }} />
      </Box>
    )
  }

  return <CardList rows={rows} renderCard={renderCard} onRowClick={onRowClick} getRowId={getRowId} ariaLabel={ariaLabel}
    loading={loading} />
}

/**
 * The phone layout: one tappable card per row (a plain card when there is no row click). `renderCardActions(row)`
 * (optional) adds controls such as a "⋯" beside the tappable area, never inside it, so no button nests in a button.
 */
export function CardList({ rows, renderCard, onRowClick, getRowId, ariaLabel, loading = false, isRowClickable, getRowProps,
  renderCardActions }) {
  if (loading) {
    return <Stack sx={{ gap: 1 }}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={88} />)}</Stack>
  }
  return (
    <Stack component="ul" aria-label={ariaLabel} sx={{ gap: 1, listStyle: 'none', p: 0, m: 0 }}>
      {rows.map((row) => {
        const { sx: cardSx, ...liProps } = getRowProps?.(row) ?? {}
        const clickable = onRowClick && (isRowClickable ? isRowClickable(row) : true)
        const body = clickable ? (
          <CardActionArea onClick={(e) => { if (e.currentTarget.contains(e.target)) onRowClick(row) }}><CardContent>{renderCard(row)}</CardContent></CardActionArea>
        ) : <CardContent>{renderCard(row)}</CardContent>
        const actions = renderCardActions?.(row)
        return (
          <li key={getRowId ? getRowId(row) : row.id} {...liProps}>
            <Card sx={cardSx}>
              {actions ? (
                <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>{body}</Box>
                  <Box sx={{ flexShrink: 0, pt: 1, pr: 1 }}>{actions}</Box>
                </Box>
              ) : body}
            </Card>
          </li>
        )
      })}
    </Stack>
  )
}
