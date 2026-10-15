import PersonAdd from '@mui/icons-material/PersonAddAlt'
import Search from '@mui/icons-material/Search'
import { Button, Checkbox, FormControlLabel, InputAdornment, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUsers } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import ResponsiveTable from '../../components/ResponsiveTable.jsx'
import { formatMoney, fullName } from '../../lib/format.js'
import CreateUserWizard from './CreateUserWizard.jsx'
import { AVATAR_SIZE } from '../../lib/avatarLook.js'

const ROLE = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }

export default function PeoplePage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t) }, [search])
  const users = useUsers({ q, role, archived: archived ? 'true' : '' })
  const rows = users.data?.items ?? []
  const columns = [
    { field: 'name', headerName: 'Name', flex: 1.2, minWidth: 160, valueGetter: (_, row) => fullName(row),
      renderCell: ({ row }) => <PersonWithAvatar person={{ id: row.id, name: fullName(row) }} /> },
    { field: 'username', headerName: 'Username', flex: 1, minWidth: 120 },
    { field: 'email', headerName: 'Email', flex: 1.4, minWidth: 180 },
    { field: 'role', headerName: 'Role', width: 110, valueFormatter: (v) => ROLE[v] ?? v },
    { field: 'job_title', headerName: 'Job title', flex: 1, minWidth: 140 },
    { field: 'salary', headerName: 'Salary', width: 120, valueFormatter: (v) => (v == null ? '—' : formatMoney(v)) },
  ]
  return (
    <>
      <PageHeader title="People" subtitle="Create accounts, set roles and salaries, and archive people who've left."
        actions={<Button variant="contained" startIcon={<PersonAdd />} onClick={() => setCreating(true)}>New account</Button>} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2, alignItems: { md: 'center' } }}>
          <TextField type="search" label="Search people" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ flex: 2 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }} />
          <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value)} sx={{ flex: 1 }}>
            <MenuItem value="">All roles</MenuItem>
            {Object.entries(ROLE).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
          </TextField>
          <FormControlLabel label="Archived" control={<Checkbox checked={archived} onChange={(e) => setArchived(e.target.checked)} />} />
        </Stack>
      </Paper>
      <ErrorAlert error={users.error} onRetry={() => users.refetch()} sx={{ mb: 2 }} />
      <ResponsiveTable ariaLabel="People" rows={rows} columns={columns} loading={users.isLoading}
        onRowClick={(row) => navigate(`/people/${row.id}`)}
        emptyState={users.isError ? null : <EmptyState title={archived ? 'No archived accounts' : 'Nobody matches'} />}
        renderCard={(row) => (
          <Stack sx={{ gap: 0.5 }}>
            <Typography variant="subtitle1" component="div"><PersonWithAvatar person={{ id: row.id, name: fullName(row) }} size={AVATAR_SIZE.row} link={false} /></Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{row.username} · {ROLE[row.role]} · {row.job_title || 'No title'}</Typography>
          </Stack>
        )} />
      {creating ? <CreateUserWizard onClose={() => setCreating(false)} onCreated={(u) => navigate(`/people/${u.id}`)} /> : null}
    </>
  )
}
