import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Card, CardActionArea, CardContent, Chip, Container, Grid, IconButton, InputAdornment,
  Paper, Stack, TextField, Typography, alpha, useTheme, Popper, ClickAwayListener, List,
  ListItemButton, ListItemText, Divider, CircularProgress, Avatar, Button, Skeleton,
} from '@mui/material';
import {
  SearchOutlined, ArrowBackOutlined, OpenInNewOutlined, StorageRounded, HubOutlined,
  // category icons
  HandshakeOutlined as Handshake, Inventory2Outlined as Inventory2, GroupsOutlined as Groups,
  FactoryOutlined as Factory, TuneOutlined as Tune,
  // entity icons
  BusinessOutlined as Business, PersonSearchOutlined as PersonSearch, LocalShippingOutlined as LocalShipping,
  CableOutlined as Cable, SettingsInputComponentOutlined as SettingsInputComponent, AccountTreeOutlined as AccountTree,
  Inventory as Inventory, BadgeOutlined as Badge, AdminPanelSettingsOutlined as AdminPanelSettings,
  PrecisionManufacturingOutlined as PrecisionManufacturing, PowerOutlined as Power, CategoryOutlined as Category,
  StraightenOutlined as Straighten,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { MASTER_CATEGORIES, MASTER_ENTITIES, getEntity } from '../../config/masterDataConfig';
import masterDataService from '../../services/masterDataService';
import MasterDataGrid from './MasterDataGrid';

const ICONS = {
  Handshake, Inventory2, Groups, Factory, Tune,
  Business, PersonSearch, LocalShipping, Cable, SettingsInputComponent, AccountTree,
  Inventory, Badge, AdminPanelSettings, PrecisionManufacturing, Power, Category, Straighten,
};
const Icon = ({ name, ...props }) => {
  const C = ICONS[name] || StorageRounded;
  return <C {...props} />;
};

const MasterDataHub = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [counts, setCounts] = useState({});
  const [countsLoading, setCountsLoading] = useState(true);
  const [active, setActive] = useState(null); // entity key for inline detail
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searchReady, setSearchReady] = useState(false);
  const searchAnchor = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await masterDataService.counts(); // also primes the search cache
        if (alive) { setCounts(c); setSearchReady(true); }
      } finally { if (alive) setCountsLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!searchReady) return;
    setResults(masterDataService.search(q));
  }, [q, searchReady]);

  const activeEntity = active ? getEntity(active) : null;

  const openEntity = (entity) => {
    if (entity.managerRoute && !entity.table) { navigate(entity.managerRoute); return; }
    if (entity.managerRoute) { navigate(entity.managerRoute); return; }
    setActive(entity.key); // inline-managed
  };

  const onResultClick = (r) => {
    setQ('');
    if (r.managerRoute) navigate(r.managerRoute);
    else setActive(r.entityKey);
  };

  const grouped = useMemo(
    () => MASTER_CATEGORIES.map((cat) => ({ cat, items: MASTER_ENTITIES.filter((e) => e.category === cat.key) })),
    [],
  );
  const totalRecords = useMemo(() => Object.values(counts).reduce((a, b) => a + (b || 0), 0), [counts]);

  // ---------------- Inline detail view ----------------
  if (activeEntity) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
        <Box sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 70%)`, color: '#fff', px: { xs: 2, sm: 3 }, py: 2.5 }}>
          <Container maxWidth="xl" disableGutters>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <IconButton onClick={() => setActive(null)} sx={{ color: '#fff' }}><ArrowBackOutlined /></IconButton>
              <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.18)' }}><Icon name={activeEntity.icon} /></Avatar>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.1 }}>{activeEntity.label}</Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>{activeEntity.description}</Typography>
              </Box>
            </Stack>
          </Container>
        </Box>
        <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: 3 }}>
          <MasterDataGrid entity={activeEntity} />
        </Container>
      </Box>
    );
  }

  // ---------------- Catalog view ----------------
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      <Box sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 60%, ${theme.palette.primary.light} 130%)`, color: '#fff', px: { xs: 2, sm: 3 }, py: { xs: 3, md: 4 } }}>
        <Container maxWidth="xl" disableGutters>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
            <HubOutlined sx={{ fontSize: 30 }} />
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.03em' }}>Master Data</Typography>
            <Chip label="Restricted" size="small" sx={{ bgcolor: 'rgba(255,255,255,0.18)', color: '#fff', fontWeight: 700 }} />
          </Stack>
          <Typography variant="body1" sx={{ opacity: 0.92, maxWidth: 760 }}>
            The single source of truth the whole ERP cross-references. Manage every master record in one place —
            {countsLoading ? ' loading…' : ` ${totalRecords.toLocaleString()} records across ${MASTER_ENTITIES.filter((e) => e.table).length} datasets.`}
          </Typography>

          {/* Cross-reference search */}
          <Box ref={searchAnchor} sx={{ mt: 2.5, maxWidth: 640 }}>
            <TextField
              fullWidth value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cross-reference anything — client, vendor, product, employee, code…"
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchOutlined sx={{ color: 'text.secondary' }} /></InputAdornment>,
                endAdornment: !searchReady ? <InputAdornment position="end"><CircularProgress size={16} /></InputAdornment> : null,
                sx: { bgcolor: '#fff', borderRadius: 2 },
              }}
            />
            <Popper open={results.length > 0 && q.trim().length >= 2} anchorEl={searchAnchor.current} placement="bottom-start" style={{ zIndex: 1300, width: searchAnchor.current?.clientWidth }}>
              <ClickAwayListener onClickAway={() => setResults([])}>
                <Paper elevation={8} sx={{ mt: 0.5, borderRadius: 2, maxHeight: 380, overflow: 'auto' }}>
                  <List dense disablePadding>
                    {results.map((r, i) => (
                      <React.Fragment key={`${r.entityKey}-${r.id}`}>
                        {i > 0 && <Divider component="li" />}
                        <ListItemButton onClick={() => onResultClick(r)}>
                          <Avatar sx={{ width: 30, height: 30, mr: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }}>
                            <Icon name={r.icon} fontSize="small" />
                          </Avatar>
                          <ListItemText
                            primary={<Typography variant="body2" fontWeight={600} noWrap>{r.title}{r.code ? ` · ${r.code}` : ''}</Typography>}
                            secondary={`${r.entityLabel}${r.subtitle ? ` — ${r.subtitle}` : ''}`}
                          />
                          {r.managerRoute && <OpenInNewOutlined fontSize="small" sx={{ color: 'text.disabled' }} />}
                        </ListItemButton>
                      </React.Fragment>
                    ))}
                  </List>
                </Paper>
              </ClickAwayListener>
            </Popper>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: 3 }}>
        {grouped.map(({ cat, items }) => (
          <Box key={cat.key} sx={{ mb: 4 }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
              <Icon name={cat.icon} sx={{ color: 'primary.main' }} />
              <Typography variant="h6" fontWeight={800}>{cat.label}</Typography>
              <Typography variant="body2" color="text.secondary">· {cat.hint}</Typography>
            </Stack>
            <Grid container spacing={2}>
              {items.map((e) => {
                const count = counts[e.key];
                const linksOut = !!e.managerRoute;
                return (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={e.key}>
                    <Card variant="outlined" sx={{ borderRadius: 2.5, height: '100%', transition: 'box-shadow .15s, border-color .15s', '&:hover': { boxShadow: 4, borderColor: 'primary.main' } }}>
                      <CardActionArea onClick={() => openEntity(e)} sx={{ height: '100%', p: 0.5 }}>
                        <CardContent>
                          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                            <Avatar variant="rounded" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main' }}>
                              <Icon name={e.icon} />
                            </Avatar>
                            {countsLoading && e.table ? <Skeleton width={34} /> : (
                              e.table ? (
                                <Typography variant="h5" fontWeight={800} color="text.primary">{count ?? '—'}</Typography>
                              ) : null
                            )}
                          </Stack>
                          <Typography variant="subtitle1" fontWeight={800} sx={{ lineHeight: 1.2 }}>{e.label}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, minHeight: 40 }}>{e.description}</Typography>
                          <Box sx={{ mt: 1 }}>
                            {linksOut ? (
                              <Chip size="small" icon={<OpenInNewOutlined sx={{ fontSize: '14px !important' }} />} label="Open manager"
                                    sx={{ fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main' }} />
                            ) : (
                              <Chip size="small" label="Manage here" sx={{ fontWeight: 700, bgcolor: alpha(theme.palette.success.main, 0.12), color: 'success.main' }} />
                            )}
                          </Box>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        ))}

        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, mt: 2, display: 'flex', gap: 2, alignItems: 'center', bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
          <StorageRounded color="primary" />
          <Box>
            <Typography variant="subtitle2" fontWeight={800}>One master, referenced everywhere</Typography>
            <Typography variant="body2" color="text.secondary">
              Records here are linked by their codes (ClientCode, VendorCode, ProductCode, EmployeeCode…) across orders, purchases, production and dispatch.
              Keep this clean and the whole ERP stays consistent. Access is limited to administrators.
            </Typography>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default MasterDataHub;
