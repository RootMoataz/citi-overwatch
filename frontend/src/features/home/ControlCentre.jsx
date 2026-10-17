import Apartment from '@mui/icons-material/ApartmentOutlined'
import Groups from '@mui/icons-material/GroupsOutlined'
import History from '@mui/icons-material/HistoryOutlined'
import Inventory from '@mui/icons-material/Inventory2Outlined'
import PostAdd from '@mui/icons-material/PostAddOutlined'
import { Box, Card, CardActionArea, Skeleton, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { useArchive, useDepartments, useRequests, useUsers } from '../../api/queries.js'
import CountUp from '../../components/CountUp.jsx'
import Reveal from '../../components/Reveal.jsx'

function Tile({ to, label, icon, query, count, hint, tone, index }) {
  const number = query && !query.isLoading && !query.error ? count(query.data) : null
  const value = query ? (query.isLoading ? <Skeleton width={32} /> : query.error ? '—' : <CountUp value={number} />) : null
  return (
    <Reveal as="li" index={index}>
      <Card sx={{ height: '100%' }}>
        <CardActionArea component={RouterLink} to={to} sx={{ height: '100%', p: 2, display: 'flex', alignItems: 'flex-start',
          justifyContent: 'flex-start' }}>
          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'flex-start', width: '100%' }}>
            <Box aria-hidden sx={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 1.5, flexShrink: 0,
              bgcolor: 'action.selected', color: 'primary.main' }}>{icon}</Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>{label}</Typography>
              {value !== null ? (
                <Typography variant="h2" component="p" sx={{ color: tone && number ? `${tone}.main` : 'text.primary' }}>{value}</Typography>
              ) : null}
              {hint ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>{hint}</Typography> : null}
            </Box>
          </Stack>
        </CardActionArea>
      </Card>
    </Reveal>
  )
}

/** Admin shortcuts: how many people, departments, open requests and archived items, each a link to its page. */
export default function ControlCentre() {
  const people = useUsers({})
  const departments = useDepartments()
  const requests = useRequests('pending')
  const archive = useArchive()
  return (
    <Box component="ul" aria-label="Admin shortcuts" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 2,
      gridTemplateColumns: { xs: 'repeat(auto-fill, minmax(150px, 1fr))', sm: 'repeat(auto-fill, minmax(190px, 1fr))' } }}>
      <Tile index={0} to="/people" label="People" icon={<Groups />} query={people} count={(d) => d.total ?? d.items.length} hint="Active accounts" />
      <Tile index={1} to="/departments" label="Departments" icon={<Apartment />} query={departments} count={(d) => d.items.length} />
      <Tile index={2} to="/requests" label="Open project requests" icon={<PostAdd />} query={requests} count={(d) => d.length}
        tone="warning" hint="Waiting for a decision" />
      <Tile index={3} to="/archive" label="Archive" icon={<Inventory />} query={archive} count={(d) => d.items.length} hint="Restorable items" />
      <Tile index={4} to="/audit" label="Audit log" icon={<History />} hint="Who changed what, and when" />
    </Box>
  )
}
