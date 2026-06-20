/**
 * PPC Foundation — Phase 1 Production Planning & Control module.
 *
 * Real, working module backed by the LIVE Supabase PPC tables / RPCs
 * (see src/services/ppcService.js). Tabs:
 *   1. Items & BOM      — item master + multi-level bill of materials editor
 *   2. Materials & Store — stock levels, reorder highlighting, low-stock summary
 *   3. MRP Run          — explode a finished item's requirements (killer feature)
 *   4. Lines & Machines — shop-floor masters
 *   5. Plant Dashboard  — real KPIs derived from the above
 *
 * Theme-tokenized (no hardcoded hex), responsive, loading skeletons + empty
 * states that guide the user to populate their own items/BOMs.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  AccountTreeOutlined,
  AddRounded,
  Inventory2Outlined,
  CalculateOutlined,
  PrecisionManufacturingOutlined,
  SpaceDashboardOutlined,
  DeleteOutlineRounded,
  EditOutlined,
  RefreshRounded,
  WarningAmberRounded,
  CheckCircleOutlineRounded,
  AssignmentOutlined,
  ViewKanbanOutlined,
  PlayArrowRounded,
  DoneRounded,
  CloseRounded,
  MoreVertRounded,
  AddBoxOutlined,
  TuneRounded,
  LocalShippingOutlined,
  HistoryRounded,
  AddShoppingCartOutlined,
  MoveToInboxOutlined,
} from '@mui/icons-material';
import ppcService, {
  ITEM_TYPES,
  FINISHED_TYPES,
  itemTypeLabel,
  QC_CHECK_TYPES,
  woStatusLabel,
  woStatusColor,
  STAGE_STATUS_COLOR,
} from '../../services/ppcService';
import { StatCard, GridBox, inrFull } from '../../components/common/kit';
import LegacyBomImporter from '../../components/ppc/LegacyBomImporter';

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function typeChipColor(type) {
  switch (type) {
    case 'cable':
      return 'info';
    case 'power_cord':
      return 'primary';
    case 'harness':
      return 'secondary';
    case 'component':
      return 'default';
    case 'raw_material':
      return 'warning';
    default:
      return 'default';
  }
}

/** ABC class (value criticality) → MUI chip color. */
function abcChipColor(cls) {
  switch (String(cls || '').toUpperCase()) {
    case 'A':
      return 'error';
    case 'B':
      return 'warning';
    case 'C':
      return 'default';
    default:
      return 'default';
  }
}

/** Two small chips: ABC (filled, color-coded) + XYZ (outlined). Shows "—" when unset. */
function ClassChips({ abc, xyz }) {
  if (!abc && !xyz) {
    return (
      <Typography variant="caption" color="text.disabled">
        —
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {abc ? (
        <Chip size="small" color={abcChipColor(abc)} label={String(abc).toUpperCase()} sx={{ height: 20, minWidth: 26, fontWeight: 700 }} />
      ) : null}
      {xyz ? (
        <Chip size="small" variant="outlined" label={String(xyz).toUpperCase()} sx={{ height: 20, minWidth: 26, fontWeight: 700 }} />
      ) : null}
    </Stack>
  );
}

function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
      {Icon && <Icon sx={{ fontSize: 48, color: 'text.disabled', mb: 1.5 }} />}
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {hint && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: 460, mx: 'auto' }}>
          {hint}
        </Typography>
      )}
      {action}
    </Box>
  );
}

function TableSkeleton({ cols = 5, rows = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          <TableCell colSpan={cols}>
            <Skeleton variant="rounded" height={28} />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

const headRowSx = {
  '& th': {
    bgcolor: 'grey.50',
    fontWeight: 700,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: 'text.secondary',
    whiteSpace: 'nowrap',
  },
};

// ===========================================================================
// TAB 1 — Items & BOM
// ===========================================================================
function ItemsBomTab({ items, loading, error, reloadItems, notify }) {
  const [selectedId, setSelectedId] = useState(null);
  const [itemDialog, setItemDialog] = useState(null); // null | {} (new) | item (edit)
  const [saving, setSaving] = useState(false);
  const [importerOpen, setImporterOpen] = useState(false);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) || null, [items, selectedId]);

  const blankItem = { code: '', name: '', item_type: 'component', uom: 'nos', unit_cost: '', notes: '' };
  const [form, setForm] = useState(blankItem);

  const openNew = () => {
    setForm(blankItem);
    setItemDialog({});
  };
  const openEdit = (item) => {
    setForm({
      code: item.code || '',
      name: item.name || '',
      item_type: item.item_type || 'component',
      uom: item.uom || 'nos',
      unit_cost: item.unit_cost ?? '',
      notes: item.notes || '',
    });
    setItemDialog(item);
  };

  const saveItem = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      notify('Code and name are required.', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (itemDialog && itemDialog.id) {
        await ppcService.updateItem(itemDialog.id, form);
        notify('Item updated.', 'success');
      } else {
        const created = await ppcService.createItem(form);
        if (created?.id) setSelectedId(created.id);
        notify('Item created.', 'success');
      }
      setItemDialog(null);
      await reloadItems();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item) => {
    try {
      if (item.is_active) await ppcService.deactivateItem(item.id);
      else await ppcService.activateItem(item.id);
      await reloadItems();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.4fr) minmax(0, 1fr)' },
        alignItems: 'start',
      }}
    >
      {/* Items table */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Item Master
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Finished products, sub-assemblies, components & raw materials
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<MoveToInboxOutlined />}
              onClick={() => setImporterOpen(true)}
            >
              Import legacy BOMs
            </Button>
            <Button variant="contained" size="small" startIcon={<AddRounded />} onClick={openNew}>
              New item
            </Button>
          </Stack>
        </Stack>
        <Divider />
        {error && (
          <Alert severity="error" sx={{ borderRadius: 0 }}>
            {error}
          </Alert>
        )}
        <TableContainer sx={{ maxHeight: 540 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={headRowSx}>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>UoM</TableCell>
                <TableCell align="right">Unit Cost</TableCell>
                <TableCell align="center">Active</TableCell>
                <TableCell align="right">Edit</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && <TableSkeleton cols={7} />}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ p: 0, border: 0 }}>
                    <EmptyState
                      icon={Inventory2Outlined}
                      title="No items yet"
                      hint="Add your first item — a finished cable, a power cord, a sub-assembly, or a raw material. Then build its BOM on the right."
                      action={
                        <Button variant="contained" startIcon={<AddRounded />} onClick={openNew}>
                          Add your first item
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                items.map((item) => (
                  <TableRow
                    key={item.id}
                    hover
                    selected={item.id === selectedId}
                    onClick={() => setSelectedId(item.id)}
                    sx={{ cursor: 'pointer', opacity: item.is_active ? 1 : 0.55 }}
                  >
                    <TableCell sx={{ fontWeight: 600 }}>{item.code}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={itemTypeLabel(item.item_type)} color={typeChipColor(item.item_type)} variant="outlined" sx={{ fontWeight: 600 }} />
                    </TableCell>
                    <TableCell>{item.uom}</TableCell>
                    <TableCell align="right">{inrFull(item.unit_cost)}</TableCell>
                    <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                      <Switch size="small" checked={!!item.is_active} onChange={() => toggleActive(item)} />
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <IconButton size="small" onClick={() => openEdit(item)}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* BOM editor */}
      <BomEditor selected={selected} items={items} notify={notify} />

      {/* Legacy BOM importer */}
      <LegacyBomImporter
        open={importerOpen}
        onClose={() => setImporterOpen(false)}
        onImported={reloadItems}
        notify={notify}
      />

      {/* Item dialog */}
      <Dialog open={!!itemDialog} onClose={() => setItemDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{itemDialog && itemDialog.id ? 'Edit item' : 'New item'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                fullWidth
                required
                helperText="Unique"
              />
              <TextField
                select
                label="Type"
                value={form.item_type}
                onChange={(e) => setForm({ ...form, item_type: e.target.value })}
                fullWidth
              >
                {ITEM_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Unit of measure" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} fullWidth helperText="e.g. nos, mtr, kg" />
              <TextField label="Unit cost (₹)" type="number" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} fullWidth />
            </Stack>
            <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemDialog(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={saveItem} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : null}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function BomEditor({ selected, items, notify }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState(null); // null | {} | line
  const [saving, setSaving] = useState(false);

  const blankLine = { component_item_id: '', qty_per: '1', scrap_pct: '0', sequence: '', notes: '' };
  const [form, setForm] = useState(blankLine);

  const load = useCallback(async () => {
    if (!selected) {
      setLines([]);
      return;
    }
    setLoading(true);
    try {
      const data = await ppcService.listBomForParent(selected.id);
      setLines(data);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [selected, notify]);

  useEffect(() => {
    load();
  }, [load]);

  // candidate components = every other item (a component can itself have a BOM → multi-level)
  const componentOptions = useMemo(
    () => items.filter((i) => !selected || i.id !== selected.id),
    [items, selected]
  );

  const openNew = () => {
    setForm({ ...blankLine, sequence: String((lines.length + 1) * 10) });
    setDialog({});
  };
  const openEdit = (line) => {
    setForm({
      component_item_id: line.component_item_id,
      qty_per: String(line.qty_per ?? ''),
      scrap_pct: String(line.scrap_pct ?? ''),
      sequence: String(line.sequence ?? ''),
      notes: line.notes || '',
    });
    setDialog(line);
  };

  const save = async () => {
    if (!form.component_item_id) {
      notify('Pick a component.', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (dialog && dialog.id) {
        await ppcService.updateBomLine(dialog.id, {
          component_item_id: form.component_item_id,
          qty_per: form.qty_per,
          scrap_pct: form.scrap_pct,
          sequence: form.sequence,
          notes: form.notes,
        });
      } else {
        await ppcService.addBomLine({ ...form, parent_item_id: selected.id });
      }
      setDialog(null);
      await load();
      notify('BOM saved.', 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (line) => {
    try {
      await ppcService.deleteBomLine(line.id);
      await load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
            Bill of Materials
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {selected ? `Components of ${selected.code} · ${selected.name}` : 'Select an item to edit its BOM'}
          </Typography>
        </Box>
        {selected && (
          <Button variant="outlined" size="small" startIcon={<AddRounded />} onClick={openNew}>
            Add
          </Button>
        )}
      </Stack>
      <Divider />

      {!selected ? (
        <EmptyState icon={AccountTreeOutlined} title="No item selected" hint="Click an item on the left to view and edit its bill of materials." />
      ) : (
        <>
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={headRowSx}>
                  <TableCell>Component</TableCell>
                  <TableCell align="right">Qty / unit</TableCell>
                  <TableCell align="right">Scrap %</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && <TableSkeleton cols={4} rows={3} />}
                {!loading && lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ p: 0, border: 0 }}>
                      <EmptyState
                        icon={AccountTreeOutlined}
                        title="No components yet"
                        hint="Add the materials and sub-assemblies that go into this item."
                        action={
                          <Button variant="contained" startIcon={<AddRounded />} onClick={openNew}>
                            Add component
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  lines.map((line) => (
                    <TableRow key={line.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {line.component?.code || '—'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {line.component?.name}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {num(line.qty_per)} {line.component?.uom || ''}
                      </TableCell>
                      <TableCell align="right">{num(line.scrap_pct)}%</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEdit(line)}>
                          <EditOutlined fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => remove(line)}>
                          <DeleteOutlineRounded fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary">
              BOMs are multi-level: any component above can itself have its own BOM, so MRP explodes the full tree.
            </Typography>
          </Box>
        </>
      )}

      {/* BOM line dialog */}
      <Dialog open={!!dialog} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog && dialog.id ? 'Edit BOM line' : 'Add component'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              select
              label="Component"
              value={form.component_item_id}
              onChange={(e) => setForm({ ...form, component_item_id: e.target.value })}
              fullWidth
              required
            >
              {componentOptions.map((i) => (
                <MenuItem key={i.id} value={i.id}>
                  {i.code} — {i.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Qty per unit" type="number" value={form.qty_per} onChange={(e) => setForm({ ...form, qty_per: e.target.value })} fullWidth />
              <TextField label="Scrap %" type="number" value={form.scrap_pct} onChange={(e) => setForm({ ...form, scrap_pct: e.target.value })} fullWidth />
              <TextField label="Sequence" type="number" value={form.sequence} onChange={(e) => setForm({ ...form, sequence: e.target.value })} fullWidth />
            </Stack>
            <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : null}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

// ===========================================================================
// TAB 2 — Materials & Store
// ===========================================================================
/** Stock transaction type → MUI chip color + human label. */
const STOCK_TXN_META = {
  receipt: { color: 'success', label: 'Receipt' },
  receive: { color: 'success', label: 'Receipt' },
  issue: { color: 'error', label: 'Issue' },
  dispatch: { color: 'error', label: 'Dispatch' },
  adjust: { color: 'warning', label: 'Adjust' },
  adjustment: { color: 'warning', label: 'Adjust' },
};

function stockTxnColor(type) {
  return STOCK_TXN_META[String(type || '').toLowerCase()]?.color || 'default';
}
function stockTxnLabel(type) {
  return STOCK_TXN_META[String(type || '').toLowerCase()]?.label || String(type || '—').replace(/_/g, ' ');
}

/** Per-row actions menu for the stock table (Receive / Adjust / Dispatch / History). */
function StockRowMenu({ row, onReceive, onAdjust, onDispatch, onHistory }) {
  const [anchor, setAnchor] = useState(null);
  const close = () => setAnchor(null);
  const pick = (fn) => () => {
    close();
    fn(row);
  };
  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreVertRounded fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <MenuItem onClick={pick(onReceive)}>
          <ListItemIcon>
            <AddBoxOutlined fontSize="small" color="success" />
          </ListItemIcon>
          <ListItemText>Receive</ListItemText>
        </MenuItem>
        <MenuItem onClick={pick(onAdjust)}>
          <ListItemIcon>
            <TuneRounded fontSize="small" color="warning" />
          </ListItemIcon>
          <ListItemText>Adjust</ListItemText>
        </MenuItem>
        <MenuItem onClick={pick(onDispatch)}>
          <ListItemIcon>
            <LocalShippingOutlined fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Dispatch</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={pick(onHistory)}>
          <ListItemIcon>
            <HistoryRounded fontSize="small" />
          </ListItemIcon>
          <ListItemText>History</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

/** Stock-movement history drawer for a single item. */
function StockHistoryDrawer({ row, onClose, notify }) {
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const itemId = row?.item_id;

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      setTxns(await ppcService.listStockTransactions(itemId));
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [itemId, notify]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Drawer anchor="right" open={!!row} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 480, md: 560 }, maxWidth: '100%' } }}>
      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
              Stock history
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {row?.item?.code || '—'} · {row?.item?.name || ''}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseRounded fontSize="small" />
          </IconButton>
        </Stack>
        <Divider sx={{ mb: 2 }} />
        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: '70vh' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={headRowSx}>
                  <TableCell>When</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Δ Qty</TableCell>
                  <TableCell align="right">On hand</TableCell>
                  <TableCell>Notes / By</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && <TableSkeleton cols={5} rows={4} />}
                {!loading && txns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                      No stock movements recorded yet.
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  txns.map((t) => {
                    const delta = num(t.quantity_delta);
                    return (
                      <TableRow key={t.id} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(t.created_at)}</TableCell>
                        <TableCell>
                          <Chip size="small" color={stockTxnColor(t.transaction_type)} label={stockTxnLabel(t.transaction_type)} sx={{ fontWeight: 600, textTransform: 'capitalize' }} />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: delta < 0 ? 'error.main' : delta > 0 ? 'success.main' : 'text.secondary' }}>
                          {delta > 0 ? `+${delta}` : delta}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {num(t.on_hand_after)}
                        </TableCell>
                        <TableCell>
                          {t.notes && (
                            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                              {t.notes}
                            </Typography>
                          )}
                          {t.created_by_email && (
                            <Typography variant="caption" color="text.secondary">
                              {t.created_by_email}
                            </Typography>
                          )}
                          {!t.notes && !t.created_by_email && '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>
    </Drawer>
  );
}

function MaterialsTab({ items, notify }) {
  const theme = useTheme();
  const [stock, setStock] = useState([]);
  const [low, setLow] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [saving, setSaving] = useState(false);
  // stock-movement dialogs (each holds the target stock row, or null)
  const [receiveRow, setReceiveRow] = useState(null);
  const [adjustRow, setAdjustRow] = useState(null);
  const [dispatchRow, setDispatchRow] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);
  const [moving, setMoving] = useState(false);
  const [classifying, setClassifying] = useState(false);

  const blankReceive = { qty: '', vendorName: '', vendorCode: '', unitCost: '', reference: '', note: '' };
  const blankAdjust = { newQty: '', reason: '' };
  const blankDispatch = { qty: '', customer: '', reference: '' };
  const [receiveForm, setReceiveForm] = useState(blankReceive);
  const [adjustForm, setAdjustForm] = useState(blankAdjust);
  const [dispatchForm, setDispatchForm] = useState(blankDispatch);

  const blank = { item_id: '', on_hand: '0', reorder_point: '0', safety_stock: '0', lead_time_days: '0', location: '' };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([ppcService.listStock(), ppcService.lowStock()]);
      setStock(s);
      setLow(l);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const stockedItemIds = useMemo(() => new Set(stock.map((s) => s.item_id)), [stock]);
  const itemsWithoutStock = useMemo(() => items.filter((i) => !stockedItemIds.has(i.id)), [items, stockedItemIds]);

  const openNew = () => {
    setForm({ ...blank, item_id: itemsWithoutStock[0]?.id || '' });
    setDialog({});
  };
  const openEdit = (row) => {
    setForm({
      item_id: row.item_id,
      on_hand: String(row.on_hand ?? '0'),
      reorder_point: String(row.reorder_point ?? '0'),
      safety_stock: String(row.safety_stock ?? '0'),
      lead_time_days: String(row.lead_time_days ?? '0'),
      location: row.location || '',
    });
    setDialog(row);
  };

  const save = async () => {
    if (!form.item_id) {
      notify('Pick an item.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await ppcService.upsertStock(form);
      setDialog(null);
      await load();
      notify('Stock saved.', 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const recompute = async () => {
    setClassifying(true);
    try {
      const count = await ppcService.recomputeClassification();
      await load();
      notify(`Classified ${num(count)} items`, 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setClassifying(false);
    }
  };

  // --- stock-movement openers ---
  const openReceive = (row) => {
    setReceiveForm(blankReceive);
    setReceiveRow(row);
  };
  const openAdjust = (row) => {
    setAdjustForm({ newQty: String(row.on_hand ?? '0'), reason: '' });
    setAdjustRow(row);
  };
  const openDispatch = (row) => {
    setDispatchForm(blankDispatch);
    setDispatchRow(row);
  };

  // --- stock-movement submits ---
  const submitReceive = async () => {
    if (!receiveRow) return;
    if (!(Number(receiveForm.qty) > 0)) {
      notify('Enter a quantity greater than 0.', 'warning');
      return;
    }
    setMoving(true);
    try {
      const res = await ppcService.receiveStock(receiveRow.item_id, receiveForm);
      setReceiveRow(null);
      await load();
      notify(`Received ${num(receiveForm.qty)} — on hand ${num(res?.on_hand)}`, 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setMoving(false);
    }
  };

  const submitAdjust = async () => {
    if (!adjustRow) return;
    if (!(Number(adjustForm.newQty) >= 0) || adjustForm.newQty === '') {
      notify('Enter a valid on-hand quantity (0 or more).', 'warning');
      return;
    }
    setMoving(true);
    try {
      const res = await ppcService.adjustStock(adjustRow.item_id, adjustForm.newQty, adjustForm.reason);
      setAdjustRow(null);
      await load();
      notify(`Adjusted — on hand ${num(res?.on_hand)}`, 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setMoving(false);
    }
  };

  const submitDispatch = async () => {
    if (!dispatchRow) return;
    if (!(Number(dispatchForm.qty) > 0)) {
      notify('Enter a quantity greater than 0.', 'warning');
      return;
    }
    setMoving(true);
    try {
      const res = await ppcService.dispatchStock(dispatchRow.item_id, dispatchForm);
      setDispatchRow(null);
      await load();
      notify(`Dispatched ${num(dispatchForm.qty)} — on hand ${num(res?.on_hand)}`, 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setMoving(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Materials & Store
          </Typography>
          <Typography variant="caption" color="text.secondary">
            On-hand stock, reorder points & lead times
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            icon={<WarningAmberRounded />}
            color={low.length ? 'error' : 'success'}
            variant={low.length ? 'filled' : 'outlined'}
            label={loading ? 'Low stock…' : `${low.length} low / reorder`}
            sx={{ fontWeight: 700 }}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={classifying ? <CircularProgress size={16} /> : <TuneRounded />}
            onClick={recompute}
            disabled={classifying || loading || stock.length === 0}
          >
            Recompute ABC/XYZ
          </Button>
          <Button variant="contained" size="small" startIcon={<AddRounded />} onClick={openNew} disabled={itemsWithoutStock.length === 0}>
            Set stock
          </Button>
        </Stack>
      </Stack>
      <Divider />
      <TableContainer sx={{ maxHeight: 560 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={headRowSx}>
              <TableCell>Code</TableCell>
              <TableCell>Name</TableCell>
              <TableCell align="right">On hand</TableCell>
              <TableCell align="right">Reorder pt</TableCell>
              <TableCell align="right">Safety</TableCell>
              <TableCell align="right">Lead (d)</TableCell>
              <TableCell align="center">ABC/XYZ</TableCell>
              <TableCell>Location</TableCell>
              <TableCell align="center">Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && <TableSkeleton cols={10} />}
            {!loading && stock.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} sx={{ p: 0, border: 0 }}>
                  <EmptyState
                    icon={Inventory2Outlined}
                    title="No stock records yet"
                    hint={
                      items.length
                        ? "Use 'Set stock' to record on-hand quantity and reorder points for your items."
                        : 'Add items in the Items & BOM tab first, then set their stock here.'
                    }
                    action={
                      items.length ? (
                        <Button variant="contained" startIcon={<AddRounded />} onClick={openNew} disabled={itemsWithoutStock.length === 0}>
                          Set stock for an item
                        </Button>
                      ) : null
                    }
                  />
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              stock.map((row) => {
                const reorder = num(row.on_hand) <= num(row.reorder_point);
                return (
                  <TableRow
                    key={row.id}
                    hover
                    sx={reorder ? { bgcolor: theme.palette.error.lighter || `${theme.palette.error.main}14` } : undefined}
                  >
                    <TableCell sx={{ fontWeight: 600 }}>{row.item?.code || '—'}</TableCell>
                    <TableCell>{row.item?.name || '—'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {num(row.on_hand)}
                    </TableCell>
                    <TableCell align="right">{num(row.reorder_point)}</TableCell>
                    <TableCell align="right">{num(row.safety_stock)}</TableCell>
                    <TableCell align="right">{num(row.lead_time_days)}</TableCell>
                    <TableCell align="center">
                      <ClassChips abc={row.abc_class} xyz={row.xyz_class} />
                    </TableCell>
                    <TableCell>{row.location || '—'}</TableCell>
                    <TableCell align="center">
                      {reorder ? (
                        <Chip size="small" color="error" label="Reorder" sx={{ fontWeight: 700 }} />
                      ) : (
                        <Chip size="small" color="success" variant="outlined" label="OK" sx={{ fontWeight: 600 }} />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                        <Tooltip title="Edit stock levels">
                          <IconButton size="small" onClick={() => openEdit(row)}>
                            <EditOutlined fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <StockRowMenu
                          row={row}
                          onReceive={openReceive}
                          onAdjust={openAdjust}
                          onDispatch={openDispatch}
                          onHistory={setHistoryRow}
                        />
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!dialog} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{dialog && dialog.id ? 'Edit stock' : 'Set stock'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              select
              label="Item"
              value={form.item_id}
              onChange={(e) => setForm({ ...form, item_id: e.target.value })}
              fullWidth
              required
              disabled={!!(dialog && dialog.id)}
            >
              {(dialog && dialog.id ? items : itemsWithoutStock).map((i) => (
                <MenuItem key={i.id} value={i.id}>
                  {i.code} — {i.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="On hand" type="number" value={form.on_hand} onChange={(e) => setForm({ ...form, on_hand: e.target.value })} fullWidth />
              <TextField label="Reorder point" type="number" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })} fullWidth />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Safety stock" type="number" value={form.safety_stock} onChange={(e) => setForm({ ...form, safety_stock: e.target.value })} fullWidth />
              <TextField label="Lead time (days)" type="number" value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })} fullWidth />
            </Stack>
            <TextField label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : null}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Receive dialog */}
      <Dialog open={!!receiveRow} onClose={() => setReceiveRow(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Receive stock
          {receiveRow ? ` — ${receiveRow.item?.code || ''}` : ''}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {receiveRow?.item?.name} · current on hand {num(receiveRow?.on_hand)} {receiveRow?.item?.uom || ''}
            </Typography>
            <TextField
              label="Quantity received"
              type="number"
              value={receiveForm.qty}
              onChange={(e) => setReceiveForm({ ...receiveForm, qty: e.target.value })}
              fullWidth
              required
              autoFocus
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Vendor name" value={receiveForm.vendorName} onChange={(e) => setReceiveForm({ ...receiveForm, vendorName: e.target.value })} fullWidth />
              <TextField label="Vendor code" value={receiveForm.vendorCode} onChange={(e) => setReceiveForm({ ...receiveForm, vendorCode: e.target.value })} fullWidth />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Unit cost (₹)" type="number" value={receiveForm.unitCost} onChange={(e) => setReceiveForm({ ...receiveForm, unitCost: e.target.value })} fullWidth />
              <TextField label="Reference" value={receiveForm.reference} onChange={(e) => setReceiveForm({ ...receiveForm, reference: e.target.value })} fullWidth helperText="PO / GRN no." />
            </Stack>
            <TextField label="Note" value={receiveForm.note} onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })} fullWidth multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReceiveRow(null)} disabled={moving}>
            Cancel
          </Button>
          <Button variant="contained" color="success" onClick={submitReceive} disabled={moving} startIcon={moving ? <CircularProgress size={16} color="inherit" /> : <AddBoxOutlined />}>
            Receive
          </Button>
        </DialogActions>
      </Dialog>

      {/* Adjust dialog */}
      <Dialog open={!!adjustRow} onClose={() => setAdjustRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          Adjust stock
          {adjustRow ? ` — ${adjustRow.item?.code || ''}` : ''}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Set the corrected on-hand quantity (e.g. after a cycle count). Current {num(adjustRow?.on_hand)} {adjustRow?.item?.uom || ''}.
            </Typography>
            <TextField
              label="New on-hand qty"
              type="number"
              value={adjustForm.newQty}
              onChange={(e) => setAdjustForm({ ...adjustForm, newQty: e.target.value })}
              fullWidth
              required
              autoFocus
            />
            <TextField label="Reason" value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} fullWidth multiline minRows={2} helperText="Why is this adjustment needed?" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdjustRow(null)} disabled={moving}>
            Cancel
          </Button>
          <Button variant="contained" color="warning" onClick={submitAdjust} disabled={moving} startIcon={moving ? <CircularProgress size={16} color="inherit" /> : <TuneRounded />}>
            Adjust
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dispatch dialog */}
      <Dialog open={!!dispatchRow} onClose={() => setDispatchRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          Dispatch stock
          {dispatchRow ? ` — ${dispatchRow.item?.code || ''}` : ''}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {dispatchRow?.item?.name} · available {num(dispatchRow?.on_hand)} {dispatchRow?.item?.uom || ''}
            </Typography>
            <TextField
              label="Quantity to dispatch"
              type="number"
              value={dispatchForm.qty}
              onChange={(e) => setDispatchForm({ ...dispatchForm, qty: e.target.value })}
              fullWidth
              required
              autoFocus
            />
            <TextField label="Customer" value={dispatchForm.customer} onChange={(e) => setDispatchForm({ ...dispatchForm, customer: e.target.value })} fullWidth />
            <TextField label="Reference" value={dispatchForm.reference} onChange={(e) => setDispatchForm({ ...dispatchForm, reference: e.target.value })} fullWidth helperText="DC / invoice no." />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDispatchRow(null)} disabled={moving}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={submitDispatch} disabled={moving} startIcon={moving ? <CircularProgress size={16} color="inherit" /> : <LocalShippingOutlined />}>
            Dispatch
          </Button>
        </DialogActions>
      </Dialog>

      {/* History drawer */}
      {historyRow && <StockHistoryDrawer row={historyRow} notify={notify} onClose={() => setHistoryRow(null)} />}
    </Paper>
  );
}

// ===========================================================================
// TAB 3 — MRP Run
// ===========================================================================
function MrpTab({ items, notify }) {
  const navigate = useNavigate();
  const finished = useMemo(() => items.filter((i) => FINISHED_TYPES.includes(i.item_type) && i.is_active), [items]);
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('100');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  // Navigate to the purchase-flow Raise Indent page, pre-filling from a shortage row.
  // Same { inventoryPrefill } shape the RaiseIndent page already consumes.
  const raiseIndent = (l) =>
    navigate('/purchase-flow/raise-indent', {
      state: {
        inventoryPrefill: {
          itemCode: l.code,
          itemName: l.name,
          qty: l.shortage ?? l.suggest_purchase,
          vendorCode: null,
          vendorName: null,
        },
      },
    });

  useEffect(() => {
    if (!itemId && finished.length) setItemId(finished[0].id);
  }, [finished, itemId]);

  const run = async () => {
    setRunning(true);
    try {
      const data = await ppcService.runMrp(itemId, qty);
      setResult(data);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const lines = result?.lines || [];
  const purchaseLines = lines.filter((l) => l.suggest_purchase);

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 } }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
          Material Requirements Planning
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Pick a finished product and quantity to explode its full BOM against current stock.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }} sx={{ mt: 2 }}>
          <TextField select label="Finished product" value={itemId} onChange={(e) => setItemId(e.target.value)} sx={{ minWidth: 260, flex: 1 }} disabled={!finished.length}>
            {finished.map((i) => (
              <MenuItem key={i.id} value={i.id}>
                {i.code} — {i.name} ({itemTypeLabel(i.item_type)})
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Quantity" type="number" value={qty} onChange={(e) => setQty(e.target.value)} sx={{ width: { xs: '100%', sm: 160 } }} />
          <Button variant="contained" size="large" startIcon={running ? <CircularProgress size={18} color="inherit" /> : <CalculateOutlined />} onClick={run} disabled={!itemId || running}>
            Run MRP
          </Button>
        </Stack>
        {!finished.length && (
          <Alert severity="info" sx={{ mt: 2 }}>
            No finished products yet. Add a cable, power cord, or harness item (with a BOM) in the Items & BOM tab.
          </Alert>
        )}
      </Paper>

      {result && (
        <>
          {/* Headline */}
          <GridBox min={220}>
            <StatCard label="Build Quantity" value={num(result.qty)} sub="Units to produce" icon={PrecisionManufacturingOutlined} />
            <StatCard
              label="Total Est. Cost"
              value={inrFull(result.total_est_cost)}
              sub="Materials at unit cost"
              icon={CalculateOutlined}
            />
            <StatCard
              label="Shortages"
              value={num(result.shortage_count)}
              sub={num(result.shortage_count) ? 'Items short of stock' : 'Fully covered'}
              icon={WarningAmberRounded}
            />
          </GridBox>

          {/* Requirements table */}
          <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Material Requirements
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Exploded BOM vs. on-hand stock
              </Typography>
            </Box>
            <Divider />
            <TableContainer sx={{ maxHeight: 480 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={headRowSx}>
                    <TableCell>Code</TableCell>
                    <TableCell>Material</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell align="right">Required</TableCell>
                    <TableCell align="right">On hand</TableCell>
                    <TableCell align="right">Shortage</TableCell>
                    <TableCell align="right">Est. cost</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                        No requirements — this item has no BOM. Add components in the Items & BOM tab.
                      </TableCell>
                    </TableRow>
                  )}
                  {lines.map((l) => {
                    const short = num(l.shortage) > 0;
                    return (
                      <TableRow key={l.item_id} hover sx={short ? { bgcolor: (t) => t.palette.error.lighter || `${t.palette.error.main}14` } : undefined}>
                        <TableCell sx={{ fontWeight: 600 }}>{l.code}</TableCell>
                        <TableCell>{l.name}</TableCell>
                        <TableCell>
                          <Chip size="small" label={itemTypeLabel(l.item_type)} color={typeChipColor(l.item_type)} variant="outlined" />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {num(l.required)} {l.uom}
                        </TableCell>
                        <TableCell align="right">{num(l.on_hand)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: short ? 'error.main' : 'success.main' }}>
                          {short ? num(l.shortage) : 0}
                        </TableCell>
                        <TableCell align="right">{inrFull(l.est_cost)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Purchase suggestions */}
          <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden', borderColor: purchaseLines.length ? 'warning.main' : 'divider' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1.5 }}>
              {purchaseLines.length ? <WarningAmberRounded color="warning" /> : <CheckCircleOutlineRounded color="success" />}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Purchase Suggestions
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {purchaseLines.length ? 'Raise indents for the materials below' : 'No purchasing needed — stock covers this build'}
                </Typography>
              </Box>
              {purchaseLines.length > 0 && (
                <Button
                  variant="contained"
                  size="small"
                  color="warning"
                  startIcon={<AddShoppingCartOutlined />}
                  onClick={() => raiseIndent(purchaseLines[0])}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  Raise indents
                </Button>
              )}
            </Stack>
            {purchaseLines.length > 0 && (
              <>
                <Divider />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={headRowSx}>
                        <TableCell>Code</TableCell>
                        <TableCell>Material</TableCell>
                        <TableCell align="right">Shortage to buy</TableCell>
                        <TableCell align="right">Reorder pt</TableCell>
                        <TableCell align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {purchaseLines.map((l) => (
                        <TableRow key={l.item_id} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{l.code}</TableCell>
                          <TableCell>{l.name}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700, color: 'warning.dark' }}>
                            {num(l.shortage)} {l.uom}
                          </TableCell>
                          <TableCell align="right">{num(l.reorder_point)}</TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<AddShoppingCartOutlined />}
                              onClick={() => raiseIndent(l)}
                              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                            >
                              Raise Indent
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}

// ===========================================================================
// TAB 4 — Lines & Machines
// ===========================================================================
const MACHINE_STATUSES = ['idle', 'running', 'maintenance', 'down'];

function machineStatusColor(status) {
  switch (String(status).toLowerCase()) {
    case 'running':
      return 'success';
    case 'maintenance':
      return 'warning';
    case 'down':
      return 'error';
    default:
      return 'default';
  }
}

function LinesMachinesTab({ notify }) {
  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lineDialog, setLineDialog] = useState(null);
  const [machineDialog, setMachineDialog] = useState(null);
  const [saving, setSaving] = useState(false);

  const blankLine = { name: '', line_type: '', sequence: '' };
  const blankMachine = { name: '', machine_type: '', line_id: '', status: 'idle' };
  const [lineForm, setLineForm] = useState(blankLine);
  const [machineForm, setMachineForm] = useState(blankMachine);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, m] = await Promise.all([ppcService.listLines(), ppcService.listMachines()]);
      setLines(l);
      setMachines(m);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const saveLine = async () => {
    if (!lineForm.name.trim()) {
      notify('Line name required.', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (lineDialog && lineDialog.id) await ppcService.updateLine(lineDialog.id, lineForm);
      else await ppcService.createLine(lineForm);
      setLineDialog(null);
      await load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveMachine = async () => {
    if (!machineForm.name.trim()) {
      notify('Machine name required.', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (machineDialog && machineDialog.id) await ppcService.updateMachine(machineDialog.id, machineForm);
      else await ppcService.createMachine(machineForm);
      setMachineDialog(null);
      await load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) minmax(0,1.4fr)' }, alignItems: 'start' }}>
      {/* Lines */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Production Lines
          </Typography>
          <Button variant="contained" size="small" startIcon={<AddRounded />} onClick={() => { setLineForm(blankLine); setLineDialog({}); }}>
            Line
          </Button>
        </Stack>
        <Divider />
        <TableContainer sx={{ maxHeight: 480 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={headRowSx}>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Seq</TableCell>
                <TableCell align="center">Active</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && <TableSkeleton cols={5} rows={3} />}
              {!loading && lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ p: 0, border: 0 }}>
                    <EmptyState icon={PrecisionManufacturingOutlined} title="No lines yet" hint="Add your production lines (e.g. Cable Line 1, Molding Line A)." />
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                lines.map((l) => (
                  <TableRow key={l.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{l.name}</TableCell>
                    <TableCell>{l.line_type || '—'}</TableCell>
                    <TableCell align="right">{num(l.sequence)}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" color={l.is_active ? 'success' : 'default'} variant="outlined" label={l.is_active ? 'Yes' : 'No'} />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => { setLineForm({ name: l.name || '', line_type: l.line_type || '', sequence: String(l.sequence ?? '') }); setLineDialog(l); }}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Machines */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Machines
          </Typography>
          <Button variant="contained" size="small" startIcon={<AddRounded />} onClick={() => { setMachineForm({ ...blankMachine, line_id: lines[0]?.id || '' }); setMachineDialog({}); }}>
            Machine
          </Button>
        </Stack>
        <Divider />
        <TableContainer sx={{ maxHeight: 480 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={headRowSx}>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Line</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && <TableSkeleton cols={5} rows={3} />}
              {!loading && machines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ p: 0, border: 0 }}>
                    <EmptyState icon={PrecisionManufacturingOutlined} title="No machines yet" hint="Add machines and assign each to a line." />
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                machines.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{m.name}</TableCell>
                    <TableCell>{m.machine_type || '—'}</TableCell>
                    <TableCell>{m.line?.name || '—'}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" color={machineStatusColor(m.status)} label={m.status || 'idle'} sx={{ fontWeight: 600, textTransform: 'capitalize' }} />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => { setMachineForm({ name: m.name || '', machine_type: m.machine_type || '', line_id: m.line_id || '', status: m.status || 'idle' }); setMachineDialog(m); }}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Line dialog */}
      <Dialog open={!!lineDialog} onClose={() => setLineDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{lineDialog && lineDialog.id ? 'Edit line' : 'New line'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Name" value={lineForm.name} onChange={(e) => setLineForm({ ...lineForm, name: e.target.value })} fullWidth required />
            <TextField label="Line type" value={lineForm.line_type} onChange={(e) => setLineForm({ ...lineForm, line_type: e.target.value })} fullWidth helperText="e.g. cable, molding" />
            <TextField label="Sequence" type="number" value={lineForm.sequence} onChange={(e) => setLineForm({ ...lineForm, sequence: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLineDialog(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={saveLine} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : null}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Machine dialog */}
      <Dialog open={!!machineDialog} onClose={() => setMachineDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{machineDialog && machineDialog.id ? 'Edit machine' : 'New machine'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Name" value={machineForm.name} onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })} fullWidth required />
            <TextField label="Machine type" value={machineForm.machine_type} onChange={(e) => setMachineForm({ ...machineForm, machine_type: e.target.value })} fullWidth />
            <TextField select label="Line" value={machineForm.line_id} onChange={(e) => setMachineForm({ ...machineForm, line_id: e.target.value })} fullWidth>
              <MenuItem value="">— Unassigned —</MenuItem>
              {lines.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="Status" value={machineForm.status} onChange={(e) => setMachineForm({ ...machineForm, status: e.target.value })} fullWidth>
              {MACHINE_STATUSES.map((s) => (
                <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMachineDialog(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={saveMachine} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : null}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ===========================================================================
// TAB 5 — Plant Dashboard
// ===========================================================================
function PlantDashboardTab({ items, itemsLoading, notify }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [stock, setStock] = useState([]);
  const [low, setLow] = useState([]);
  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l, ln, mc] = await Promise.all([
        ppcService.listStock(),
        ppcService.lowStock(),
        ppcService.listLines(),
        ppcService.listMachines(),
      ]);
      setStock(s);
      setLow(l);
      setLines(ln);
      setMachines(mc);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const finishedCount = items.filter((i) => FINISHED_TYPES.includes(i.item_type)).length;
  const materialValue = stock.reduce((sum, s) => sum + num(s.on_hand) * num(s.item?.unit_cost), 0);
  const machinesByStatus = useMemo(() => {
    const m = new Map();
    machines.forEach((mc) => {
      const k = String(mc.status || 'idle').toLowerCase();
      m.set(k, (m.get(k) || 0) + 1);
    });
    return Array.from(m.entries());
  }, [machines]);

  const busy = loading || itemsLoading;

  const cards = [
    { label: 'Total Items', value: items.length, sub: 'In the item master', icon: Inventory2Outlined, accent: theme.palette.primary.main },
    { label: 'Finished Products', value: finishedCount, sub: 'Cable / power cord / harness', icon: PrecisionManufacturingOutlined, accent: theme.palette.info.main },
    { label: 'Low Stock', value: low.length, sub: 'At / below reorder point', icon: WarningAmberRounded, accent: theme.palette.error.main },
    { label: 'Material Value', value: inrFull(materialValue), sub: 'On-hand × unit cost', icon: CalculateOutlined, accent: theme.palette.success.main },
    { label: 'Production Lines', value: lines.length, sub: `${machines.length} machines`, icon: SpaceDashboardOutlined, accent: theme.palette.primary.dark },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Plant Dashboard
        </Typography>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={load} disabled={busy} size="small">
              {busy ? <CircularProgress size={18} /> : <RefreshRounded />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <GridBox min={220}>
        {cards.map((c) => (
          <StatCard key={c.label} {...c} loading={busy} />
        ))}
      </GridBox>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1.3fr) minmax(0,1fr)' }, alignItems: 'start' }}>
        {/* Materials needing reorder */}
        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Materials Needing Reorder
            </Typography>
            <Typography variant="caption" color="text.secondary">
              On-hand at or below reorder point
            </Typography>
          </Box>
          <Divider />
          <TableContainer sx={{ maxHeight: 360 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={headRowSx}>
                  <TableCell>Code</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">On hand</TableCell>
                  <TableCell align="right">Reorder pt</TableCell>
                  <TableCell align="right">Shortage</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {busy && <TableSkeleton cols={6} rows={4} />}
                {!busy && low.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: 'success.main' }}>
                      <CheckCircleOutlineRounded sx={{ verticalAlign: 'middle', mr: 0.5 }} /> All stock above reorder levels.
                    </TableCell>
                  </TableRow>
                )}
                {!busy &&
                  low.map((r) => (
                    <TableRow key={r.item_id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell align="right">{num(r.on_hand)}</TableCell>
                      <TableCell align="right">{num(r.reorder_point)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>
                        {num(r.shortage)}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AddShoppingCartOutlined />}
                          onClick={() =>
                            navigate('/purchase-flow/raise-indent', {
                              state: {
                                inventoryPrefill: {
                                  itemCode: r.code,
                                  itemName: r.name,
                                  qty: r.shortage ?? r.suggest_purchase,
                                  vendorCode: null,
                                  vendorName: null,
                                },
                              },
                            })
                          }
                          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                        >
                          Indent
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        {/* Machines by status */}
        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Machines by Status
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Current shop-floor state
            </Typography>
          </Box>
          <Divider />
          <Stack divider={<Divider />}>
            {busy && [0, 1, 2].map((i) => (
              <Box key={i} sx={{ px: 2, py: 1.25 }}>
                <Skeleton variant="rounded" height={24} />
              </Box>
            ))}
            {!busy && machinesByStatus.length === 0 && (
              <Box sx={{ px: 2, py: 4, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">No machines added yet.</Typography>
              </Box>
            )}
            {!busy &&
              machinesByStatus.map(([status, count]) => (
                <Stack key={status} direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25 }}>
                  <Chip size="small" color={machineStatusColor(status)} label={status} sx={{ fontWeight: 600, textTransform: 'capitalize' }} />
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    {count}
                  </Typography>
                </Stack>
              ))}
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}

// ===========================================================================
// TAB 6 — Work Orders (shop-floor execution: 4 M's)
// ===========================================================================
function qcResultColor(result) {
  switch (result) {
    case 'pass':
      return 'success';
    case 'fail':
      return 'error';
    default:
      return 'default';
  }
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}

/** Per-stage Start/Done capture dialog (output + scrap). */
function StageActionDialog({ open, stage, action, onClose, onConfirm, busy }) {
  const [output, setOutput] = useState('');
  const [scrap, setScrap] = useState('');

  useEffect(() => {
    if (open) {
      setOutput(stage?.output_qty != null ? String(stage.output_qty) : '');
      setScrap(stage?.scrap_qty != null ? String(stage.scrap_qty) : '');
    }
  }, [open, stage]);

  const targetStatus = action === 'start' ? 'running' : 'done';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {action === 'start' ? 'Start stage' : 'Complete stage'}
        {stage ? ` — ${stage.stage_name}` : ''}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {action === 'start'
              ? 'Mark this stage as running. Record output so far (optional).'
              : 'Mark this stage as done and record its good output and scrap.'}
          </Typography>
          <Stack direction="row" spacing={2}>
            <TextField label="Output qty" type="number" value={output} onChange={(e) => setOutput(e.target.value)} fullWidth />
            <TextField label="Scrap qty" type="number" value={scrap} onChange={(e) => setScrap(e.target.value)} fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={action === 'start' ? 'primary' : 'success'}
          onClick={() => onConfirm(targetStatus, output, scrap)}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : action === 'start' ? <PlayArrowRounded /> : <DoneRounded />}
        >
          {action === 'start' ? 'Start' : 'Mark done'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function WorkOrderDrawer({ woId, machines, onClose, notify, onChanged }) {
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stageAction, setStageAction] = useState(null); // { stage, action }
  const [busy, setBusy] = useState(false);
  // QC add form
  const blankQc = { stageId: '', checkType: QC_CHECK_TYPES[0], result: 'pass', value: '' };
  const [qcForm, setQcForm] = useState(blankQc);
  const [issueQty, setIssueQty] = useState({}); // materialId -> string

  const load = useCallback(async () => {
    if (!woId) return;
    setLoading(true);
    try {
      const data = await ppcService.getWorkOrder(woId);
      setWo(data);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [woId, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmStage = async (status, output, scrap) => {
    setBusy(true);
    try {
      await ppcService.advanceStage(stageAction.stage.id, status, output, scrap);
      setStageAction(null);
      await load();
      onChanged?.();
      notify('Stage updated.', 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const updateStageField = async (stage, patch) => {
    try {
      await ppcService.updateStage(stage.id, patch);
      await load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const issue = async (mat) => {
    const qty = issueQty[mat.id];
    const remaining = num(mat.qty_required) - num(mat.qty_issued);
    const amount = qty != null && qty !== '' ? Number(qty) : remaining;
    if (!amount || amount <= 0) {
      notify('Enter a quantity to issue.', 'warning');
      return;
    }
    try {
      await ppcService.issueMaterial(mat.id, amount);
      setIssueQty((p) => ({ ...p, [mat.id]: '' }));
      await load();
      onChanged?.();
      notify('Material issued — stock decremented.', 'success');
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const addQc = async () => {
    try {
      await ppcService.recordQc({
        woId,
        stageId: qcForm.stageId || null,
        checkType: qcForm.checkType,
        result: qcForm.result,
        value: qcForm.value,
      });
      setQcForm(blankQc);
      await load();
      notify('QC check recorded.', 'success');
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <Drawer anchor="right" open={!!woId} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 560, md: 640 }, maxWidth: '100%' } }}>
      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
              {loading ? 'Loading…' : wo?.wo_number || 'Work order'}
            </Typography>
            {wo && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {wo.item?.code} · {wo.item?.name} · Qty {num(wo.qty)} {wo.item?.uom || ''}
              </Typography>
            )}
            {wo && wo.source_kind === 'crm_order' && (
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5 }}>
                <Chip size="small" color="secondary" label="CRM" sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
                <Typography variant="caption" color="text.secondary" noWrap>
                  Customer: {wo.customer_name || wo.customer_code || '—'}
                  {wo.source_order_number ? ` · Order: ${wo.source_order_number}` : ''}
                </Typography>
              </Stack>
            )}
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {wo && <Chip size="small" color={woStatusColor(wo.status)} label={woStatusLabel(wo.status)} sx={{ fontWeight: 700 }} />}
            <IconButton onClick={onClose} size="small">
              <CloseRounded fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 2 }} />

        {loading ? (
          <Stack spacing={1.5}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" height={64} />
            ))}
          </Stack>
        ) : !wo ? (
          <EmptyState icon={AssignmentOutlined} title="Work order not found" />
        ) : (
          <Stack spacing={2.5}>
            {/* Summary */}
            <GridBox min={150}>
              <StatCard label="Planned" value={num(wo.qty)} sub="Units to build" icon={AssignmentOutlined} />
              <StatCard label="Produced" value={num(wo.produced_qty)} sub="Good units" icon={CheckCircleOutlineRounded} />
              <StatCard label="Scrap" value={num(wo.scrap_qty)} sub="Rejected units" icon={WarningAmberRounded} />
            </GridBox>

            {/* STAGES — Machine (4M), Man, Method */}
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.25 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Routing stages
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  4 M&apos;s: Machine · Man (operator) · Method (sheet) — Start / Done capture output &amp; scrap
                </Typography>
              </Box>
              <Divider />
              {wo.stages.length === 0 ? (
                <EmptyState icon={PrecisionManufacturingOutlined} title="No stages" hint="This work order has no routing stages." />
              ) : (
                <Stack divider={<Divider />}>
                  {wo.stages.map((st) => (
                    <Box key={st.id} sx={{ px: 2, py: 1.5 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                            {num(st.sequence)}. {st.stage_name}
                          </Typography>
                          <Chip size="small" color={STAGE_STATUS_COLOR[st.status] || 'default'} label={st.status} sx={{ fontWeight: 600, textTransform: 'capitalize' }} />
                        </Stack>
                        <Stack direction="row" spacing={0.5}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PlayArrowRounded />}
                            disabled={st.status === 'done'}
                            onClick={() => setStageAction({ stage: st, action: 'start' })}
                          >
                            Start
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            startIcon={<DoneRounded />}
                            disabled={st.status === 'done'}
                            onClick={() => setStageAction({ stage: st, action: 'done' })}
                          >
                            Done
                          </Button>
                        </Stack>
                      </Stack>
                      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1fr) minmax(0,1fr)' } }}>
                        <TextField
                          select
                          size="small"
                          label="Machine"
                          value={st.machine_id || ''}
                          onChange={(e) => updateStageField(st, { machine_id: e.target.value || null })}
                          fullWidth
                        >
                          <MenuItem value="">— Unassigned —</MenuItem>
                          {machines.map((m) => (
                            <MenuItem key={m.id} value={m.id}>
                              {m.name}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          label="Operator"
                          value={st.operator_name || ''}
                          onChange={(e) => setWo((p) => ({ ...p, stages: p.stages.map((s) => (s.id === st.id ? { ...s, operator_name: e.target.value } : s)) }))}
                          onBlur={(e) => updateStageField(st, { operator_name: e.target.value || null })}
                          fullWidth
                        />
                        <TextField
                          size="small"
                          label="Method sheet"
                          value={st.method_sheet || ''}
                          onChange={(e) => setWo((p) => ({ ...p, stages: p.stages.map((s) => (s.id === st.id ? { ...s, method_sheet: e.target.value } : s)) }))}
                          onBlur={(e) => updateStageField(st, { method_sheet: e.target.value || null })}
                          fullWidth
                          sx={{ gridColumn: { sm: '1 / -1' } }}
                        />
                      </Box>
                      {(num(st.output_qty) > 0 || num(st.scrap_qty) > 0) && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                          Output {num(st.output_qty)} · Scrap {num(st.scrap_qty)}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              )}
            </Paper>

            {/* MATERIALS — the 4th M */}
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.25 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Material (issue to job)
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Issuing decrements store stock
                </Typography>
              </Box>
              <Divider />
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={headRowSx}>
                      <TableCell>Item</TableCell>
                      <TableCell align="right">Required</TableCell>
                      <TableCell align="right">Issued</TableCell>
                      <TableCell align="right">Issue</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {wo.materials.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                          No material lines for this work order.
                        </TableCell>
                      </TableRow>
                    )}
                    {wo.materials.map((mat) => {
                      const fully = num(mat.qty_issued) >= num(mat.qty_required);
                      return (
                        <TableRow key={mat.id} hover>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {mat.item?.code || '—'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {mat.item?.name}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            {num(mat.qty_required)} {mat.item?.uom || ''}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700, color: fully ? 'success.main' : 'text.primary' }}>
                            {num(mat.qty_issued)}
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                              <TextField
                                size="small"
                                type="number"
                                placeholder={String(Math.max(0, num(mat.qty_required) - num(mat.qty_issued)))}
                                value={issueQty[mat.id] ?? ''}
                                onChange={(e) => setIssueQty((p) => ({ ...p, [mat.id]: e.target.value }))}
                                sx={{ width: 90 }}
                              />
                              <Button size="small" variant="outlined" onClick={() => issue(mat)} disabled={fully}>
                                Issue
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            {/* QC */}
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.25 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Quality checks
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Record continuity, hi-pot, tensile and other checks
                </Typography>
              </Box>
              <Divider />
              <Box sx={{ px: 2, py: 1.5, display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0,1fr))' }, alignItems: 'center' }}>
                <TextField select size="small" label="Stage" value={qcForm.stageId} onChange={(e) => setQcForm({ ...qcForm, stageId: e.target.value })} fullWidth>
                  <MenuItem value="">— Whole WO —</MenuItem>
                  {wo.stages.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.stage_name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField select size="small" label="Check type" value={qcForm.checkType} onChange={(e) => setQcForm({ ...qcForm, checkType: e.target.value })} fullWidth>
                  {QC_CHECK_TYPES.map((c) => (
                    <MenuItem key={c} value={c} sx={{ textTransform: 'capitalize' }}>
                      {c.replace(/_/g, ' ')}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField select size="small" label="Result" value={qcForm.result} onChange={(e) => setQcForm({ ...qcForm, result: e.target.value })} fullWidth>
                  <MenuItem value="pass">Pass</MenuItem>
                  <MenuItem value="fail">Fail</MenuItem>
                  <MenuItem value="pending">Pending</MenuItem>
                </TextField>
                <Stack direction="row" spacing={1}>
                  <TextField size="small" label="Measured value" value={qcForm.value} onChange={(e) => setQcForm({ ...qcForm, value: e.target.value })} fullWidth />
                  <Button variant="contained" startIcon={<AddRounded />} onClick={addQc} sx={{ whiteSpace: 'nowrap' }}>
                    Add
                  </Button>
                </Stack>
              </Box>
              <Divider />
              <TableContainer sx={{ maxHeight: 220 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={headRowSx}>
                      <TableCell>Check</TableCell>
                      <TableCell>Result</TableCell>
                      <TableCell>Value</TableCell>
                      <TableCell>When</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {wo.qc.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                          No QC checks recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {wo.qc.map((q) => (
                      <TableRow key={q.id} hover>
                        <TableCell sx={{ textTransform: 'capitalize' }}>{String(q.check_type || '').replace(/_/g, ' ')}</TableCell>
                        <TableCell>
                          <Chip size="small" color={qcResultColor(q.result)} label={q.result} sx={{ fontWeight: 600, textTransform: 'capitalize' }} />
                        </TableCell>
                        <TableCell>{q.measured_value || '—'}</TableCell>
                        <TableCell>{fmtDate(q.checked_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>
        )}
      </Box>

      <StageActionDialog
        open={!!stageAction}
        stage={stageAction?.stage}
        action={stageAction?.action}
        busy={busy}
        onClose={() => setStageAction(null)}
        onConfirm={confirmStage}
      />
    </Drawer>
  );
}

/**
 * Lazy kitting-readiness cell for a WO row. Nothing fires on mount — the user
 * clicks "Check" (or it is reused after the drawer opens) to call woShortage.
 * `state` is the cached shortage rows for this WO (undefined = not checked).
 */
function MaterialsReadinessCell({ state, loading, onCheck, onView }) {
  if (loading) {
    return <CircularProgress size={16} />;
  }
  if (!state) {
    return (
      <Button size="small" variant="text" startIcon={<Inventory2Outlined fontSize="small" />} onClick={onCheck} sx={{ textTransform: 'none' }}>
        Check
      </Button>
    );
  }
  const shortCount = state.filter((r) => num(r.shortfall) > 0).length;
  return shortCount > 0 ? (
    <Chip
      size="small"
      color="error"
      icon={<WarningAmberRounded />}
      label={`${shortCount} short`}
      onClick={onView}
      sx={{ fontWeight: 700, cursor: 'pointer' }}
    />
  ) : (
    <Chip
      size="small"
      color="success"
      variant="outlined"
      icon={<CheckCircleOutlineRounded />}
      label="Ready"
      onClick={onView}
      sx={{ fontWeight: 600, cursor: 'pointer' }}
    />
  );
}

/** Drawer listing the kitting shortfall (required / issued / on-hand / short) for one WO. */
function ShortfallDrawer({ wo, rows, onClose }) {
  const list = rows || [];
  const shortCount = list.filter((r) => num(r.shortfall) > 0).length;
  return (
    <Drawer anchor="right" open={!!wo} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 520, md: 620 }, maxWidth: '100%' } }}>
      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
              Material shortfall
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {wo?.wo_number} · {wo?.item?.code || ''} {wo?.item?.name ? `· ${wo.item.name}` : ''}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseRounded fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          {shortCount > 0 ? (
            <Chip size="small" color="error" icon={<WarningAmberRounded />} label={`${shortCount} item${shortCount === 1 ? '' : 's'} short`} sx={{ fontWeight: 700 }} />
          ) : (
            <Chip size="small" color="success" variant="outlined" icon={<CheckCircleOutlineRounded />} label="Fully kitted" sx={{ fontWeight: 700 }} />
          )}
        </Stack>
        <Divider sx={{ mb: 2 }} />
        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: '70vh' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={headRowSx}>
                  <TableCell>Code</TableCell>
                  <TableCell>Material</TableCell>
                  <TableCell align="right">Required</TableCell>
                  <TableCell align="right">Issued</TableCell>
                  <TableCell align="right">On hand</TableCell>
                  <TableCell align="right">Shortfall</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                      No material lines for this work order.
                    </TableCell>
                  </TableRow>
                )}
                {list.map((r) => {
                  const short = num(r.shortfall) > 0;
                  return (
                    <TableRow key={r.item_id} hover sx={short ? { bgcolor: (t) => t.palette.error.lighter || `${t.palette.error.main}14` } : undefined}>
                      <TableCell sx={{ fontWeight: 600 }}>{r.code || '—'}</TableCell>
                      <TableCell>{r.name || '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        {num(r.qty_required)} {r.uom || ''}
                      </TableCell>
                      <TableCell align="right">{num(r.qty_issued)}</TableCell>
                      <TableCell align="right">{num(r.on_hand)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: short ? 'error.main' : 'success.main' }}>
                        {short ? num(r.shortfall) : 0}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>
    </Drawer>
  );
}

function WorkOrdersTab({ items, notify }) {
  const finished = useMemo(() => items.filter((i) => FINISHED_TYPES.includes(i.item_type) && i.is_active), [items]);
  const [wos, setWos] = useState([]);
  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openWoId, setOpenWoId] = useState(null);
  // Status filter: 'open' hides completed (done) WOs, 'done' shows only completed, 'all' shows everything.
  const [statusFilter, setStatusFilter] = useState('open');
  // lazy kitting shortfall: per-WO cache + in-flight set + open drawer WO
  const [shortageByWo, setShortageByWo] = useState({});
  const [shortageLoading, setShortageLoading] = useState({});
  const [shortfallWo, setShortfallWo] = useState(null);

  const blank = { itemId: '', qty: '100', lineId: '', due: '' };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, l, m] = await Promise.all([ppcService.listWorkOrders(), ppcService.listLines(), ppcService.listMachines()]);
      setWos(w);
      setLines(l);
      setMachines(m);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setForm({ ...blank, itemId: finished[0]?.id || '' });
    setDialogOpen(true);
  };

  const create = async () => {
    if (!form.itemId) {
      notify('Pick a finished product.', 'warning');
      return;
    }
    setCreating(true);
    try {
      const res = await ppcService.createWorkOrder({ itemId: form.itemId, qty: form.qty, lineId: form.lineId, due: form.due, stages: null });
      setDialogOpen(false);
      await load();
      if (res?.id) setOpenWoId(res.id);
      notify(`Work order ${res?.wo_number || ''} created.`, 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  // Lazily fetch (or refresh) the kitting shortfall for one WO. Caches the result.
  const checkShortage = useCallback(
    async (woId) => {
      if (!woId || shortageLoading[woId]) return [];
      setShortageLoading((m) => ({ ...m, [woId]: true }));
      try {
        const rows = await ppcService.woShortage(woId);
        setShortageByWo((m) => ({ ...m, [woId]: rows }));
        return rows;
      } catch (e) {
        notify(e.message, 'error');
        return [];
      } finally {
        setShortageLoading((m) => ({ ...m, [woId]: false }));
      }
    },
    [shortageLoading, notify]
  );

  // Open the shortfall drawer — uses cached rows if present, else fetches first.
  const viewShortfall = useCallback(
    async (wo) => {
      setShortfallWo(wo);
      if (!shortageByWo[wo.id]) await checkShortage(wo.id);
    },
    [shortageByWo, checkShortage]
  );

  // Apply the status filter. 'done' is treated as completed; null status is treated as open.
  const visibleWos = useMemo(() => {
    if (statusFilter === 'all') return wos;
    if (statusFilter === 'done') return wos.filter((wo) => wo.status === 'done');
    // 'open' — everything that isn't completed (cancelled is also hidden here).
    return wos.filter((wo) => wo.status !== 'done' && wo.status !== 'cancelled');
  }, [wos, statusFilter]);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Work Orders
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Release jobs to the floor — click a WO to run its stages, issue material &amp; record QC
          </Typography>
        </Box>
        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={statusFilter}
            onChange={(_e, v) => v && setStatusFilter(v)}
            aria-label="Work order status filter"
          >
            <ToggleButton value="open" sx={{ textTransform: 'none' }}>
              Open
            </ToggleButton>
            <ToggleButton value="done" sx={{ textTransform: 'none' }}>
              Done
            </ToggleButton>
            <ToggleButton value="all" sx={{ textTransform: 'none' }}>
              All
            </ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" size="small" startIcon={<AddRounded />} onClick={openNew} disabled={!finished.length}>
            New work order
          </Button>
        </Stack>
      </Stack>
      <Divider />
      <TableContainer sx={{ maxHeight: 600 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={headRowSx}>
              <TableCell>WO #</TableCell>
              <TableCell>Item</TableCell>
              <TableCell>Customer / Order</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell>Line</TableCell>
              <TableCell align="center">Status</TableCell>
              <TableCell align="center">Materials</TableCell>
              <TableCell>Due</TableCell>
              <TableCell align="right">Produced / Scrap</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && <TableSkeleton cols={9} />}
            {!loading && wos.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} sx={{ p: 0, border: 0 }}>
                  <EmptyState
                    icon={AssignmentOutlined}
                    title="No work orders yet — create one"
                    hint={
                      finished.length
                        ? 'Release a job for a finished cable, power cord, or harness. Stages and material lines are generated automatically.'
                        : 'Add a finished product (cable / power cord / harness) in the Items & BOM tab first.'
                    }
                    action={
                      finished.length ? (
                        <Button variant="contained" startIcon={<AddRounded />} onClick={openNew}>
                          New work order
                        </Button>
                      ) : null
                    }
                  />
                </TableCell>
              </TableRow>
            )}
            {!loading && wos.length > 0 && visibleWos.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                  {statusFilter === 'done'
                    ? 'No completed work orders yet.'
                    : 'No open work orders — switch the filter to “All” or “Done” to see completed jobs.'}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              visibleWos.map((wo) => (
                <TableRow key={wo.id} hover sx={{ cursor: 'pointer' }} onClick={() => setOpenWoId(wo.id)}>
                  <TableCell sx={{ fontWeight: 700 }}>{wo.wo_number}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {wo.item?.code || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {wo.item?.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {wo.source_kind === 'crm_order' ? (
                      <Stack spacing={0.25}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {wo.customer_name || wo.customer_code || '—'}
                        </Typography>
                        {wo.source_order_number && (
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Chip size="small" color="secondary" label="CRM" sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {wo.source_order_number}
                            </Typography>
                          </Stack>
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{num(wo.qty)}</TableCell>
                  <TableCell>{wo.line?.name || '—'}</TableCell>
                  <TableCell align="center">
                    <Chip size="small" color={woStatusColor(wo.status)} label={woStatusLabel(wo.status)} sx={{ fontWeight: 700 }} />
                  </TableCell>
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    <MaterialsReadinessCell
                      state={shortageByWo[wo.id]}
                      loading={!!shortageLoading[wo.id]}
                      onCheck={() => checkShortage(wo.id)}
                      onView={() => viewShortfall(wo)}
                    />
                  </TableCell>
                  <TableCell>{fmtDate(wo.due_date)}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" component="span" sx={{ fontWeight: 700, color: 'success.main' }}>
                      {num(wo.produced_qty)}
                    </Typography>{' '}
                    /{' '}
                    <Typography variant="body2" component="span" sx={{ fontWeight: 700, color: num(wo.scrap_qty) ? 'error.main' : 'text.secondary' }}>
                      {num(wo.scrap_qty)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* New work order dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New work order</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField select label="Finished product" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })} fullWidth required>
              {finished.map((i) => (
                <MenuItem key={i.id} value={i.id}>
                  {i.code} — {i.name} ({itemTypeLabel(i.item_type)})
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Quantity" type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} fullWidth />
              <TextField select label="Line (optional)" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} fullWidth>
                <MenuItem value="">— Auto / unassigned —</MenuItem>
                {lines.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField label="Due date (optional)" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} />
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Routing stages and material requirements are generated automatically from the item&apos;s BOM.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button variant="contained" onClick={create} disabled={creating} startIcon={creating ? <CircularProgress size={16} /> : null}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {openWoId && (
        <WorkOrderDrawer woId={openWoId} machines={machines} notify={notify} onChanged={load} onClose={() => setOpenWoId(null)} />
      )}

      {shortfallWo && (
        <ShortfallDrawer wo={shortfallWo} rows={shortageByWo[shortfallWo.id]} onClose={() => setShortfallWo(null)} />
      )}
    </Paper>
  );
}

// ===========================================================================
// TAB 7 — Shop Floor (live board)
// ===========================================================================
const BOARD_COLUMNS = ['planned', 'released', 'in_progress', 'qc'];

function ShopFloorTab({ notify }) {
  const [board, setBoard] = useState([]);
  const [lines, setLines] = useState([]);
  const [lineId, setLineId] = useState('');
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(null); // stage id being advanced

  const loadLines = useCallback(async () => {
    try {
      setLines(await ppcService.listLines());
    } catch (e) {
      notify(e.message, 'error');
    }
  }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await ppcService.shopfloor(lineId));
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [lineId, notify]);

  useEffect(() => {
    loadLines();
  }, [loadLines]);
  useEffect(() => {
    load();
  }, [load]);

  /** Find the running (or first pending) stage of a WO from its nested stages. */
  const currentStage = (wo) => {
    const stages = wo.stages || [];
    return stages.find((s) => s.status === 'running') || stages.find((s) => s.status === 'pending') || null;
  };

  const advance = async (stage) => {
    if (!stage) return;
    setAdvancing(stage.id);
    try {
      const next = stage.status === 'running' ? 'done' : 'running';
      await ppcService.advanceStage(stage.id, next, stage.output_qty || 0, stage.scrap_qty || 0);
      await load();
      notify(`Stage ${next === 'done' ? 'completed' : 'started'}.`, 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setAdvancing(null);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map(BOARD_COLUMNS.map((c) => [c, []]));
    board.forEach((wo) => {
      const k = BOARD_COLUMNS.includes(wo.status) ? wo.status : 'planned';
      map.get(k).push(wo);
    });
    return map;
  }, [board]);

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Shop Floor
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Live board of active work orders — advance the current stage in one click
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField select size="small" label="Line" value={lineId} onChange={(e) => setLineId(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All lines</MenuItem>
              {lines.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </TextField>
            <Tooltip title="Refresh">
              <span>
                <IconButton onClick={load} disabled={loading} size="small">
                  {loading ? <CircularProgress size={18} /> : <RefreshRounded />}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Paper>

      {!loading && board.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 2.5 }}>
          <EmptyState
            icon={ViewKanbanOutlined}
            title="No active work orders"
            hint="Release a work order from the Work Orders tab and it will appear here as it moves through the floor."
          />
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0,1fr))', lg: 'repeat(4, minmax(0,1fr))' }, alignItems: 'start' }}>
          {BOARD_COLUMNS.map((col) => {
            const cards = grouped.get(col) || [];
            return (
              <Paper key={col} variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden', bgcolor: 'action.hover' }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 1 }}>
                  <Chip size="small" color={woStatusColor(col)} label={woStatusLabel(col)} sx={{ fontWeight: 700 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    {cards.length}
                  </Typography>
                </Stack>
                <Divider />
                <Stack spacing={1.25} sx={{ p: 1.25, minHeight: 80 }}>
                  {loading && [0, 1].map((i) => <Skeleton key={i} variant="rounded" height={92} />)}
                  {!loading && cards.length === 0 && (
                    <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center', py: 2 }}>
                      —
                    </Typography>
                  )}
                  {!loading &&
                    cards.map((wo) => {
                      const st = currentStage(wo);
                      return (
                        <Paper key={wo.id} variant="outlined" sx={{ borderRadius: 2, p: 1.25, bgcolor: 'background.paper' }}>
                          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                            <Typography variant="body2" sx={{ fontWeight: 800 }}>
                              {wo.wo_number}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {fmtDate(wo.due_date)}
                            </Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                            {wo.item_code || wo.item?.code || ''} {wo.item_name || wo.item?.name || ''}
                          </Typography>
                          {(wo.line_name || wo.line?.name) && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                              Line: {wo.line_name || wo.line?.name}
                            </Typography>
                          )}
                          <Divider sx={{ my: 0.75 }} />
                          {st ? (
                            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="caption" color="text.secondary">
                                  Current stage
                                </Typography>
                                <Stack direction="row" spacing={0.5} alignItems="center">
                                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                                    {st.stage_name}
                                  </Typography>
                                  <Chip size="small" color={STAGE_STATUS_COLOR[st.status] || 'default'} label={st.status} sx={{ height: 18, fontSize: 10, fontWeight: 600, textTransform: 'capitalize' }} />
                                </Stack>
                              </Box>
                              <Button
                                size="small"
                                variant="contained"
                                color={st.status === 'running' ? 'success' : 'primary'}
                                onClick={() => advance(st)}
                                disabled={advancing === st.id}
                                startIcon={advancing === st.id ? <CircularProgress size={14} color="inherit" /> : st.status === 'running' ? <DoneRounded /> : <PlayArrowRounded />}
                                sx={{ whiteSpace: 'nowrap' }}
                              >
                                {st.status === 'running' ? 'Done' : 'Start'}
                              </Button>
                            </Stack>
                          ) : (
                            <Typography variant="caption" color="text.disabled">
                              No pending stage
                            </Typography>
                          )}
                        </Paper>
                      );
                    })}
                </Stack>
              </Paper>
            );
          })}
        </Box>
      )}
    </Stack>
  );
}

// ===========================================================================
// Shell
// ===========================================================================
const TABS = [
  { key: 'items', label: 'Items & BOM', icon: <AccountTreeOutlined fontSize="small" /> },
  { key: 'store', label: 'Materials & Store', icon: <Inventory2Outlined fontSize="small" /> },
  { key: 'mrp', label: 'MRP Run', icon: <CalculateOutlined fontSize="small" /> },
  { key: 'lines', label: 'Lines & Machines', icon: <PrecisionManufacturingOutlined fontSize="small" /> },
  { key: 'dashboard', label: 'Plant Dashboard', icon: <SpaceDashboardOutlined fontSize="small" /> },
  { key: 'workorders', label: 'Work Orders', icon: <AssignmentOutlined fontSize="small" /> },
  { key: 'shopfloor', label: 'Shop Floor', icon: <ViewKanbanOutlined fontSize="small" /> },
];

export default function PPCFoundation() {
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState(null);
  const [toast, setToast] = useState(null); // { message, severity }

  const notify = useCallback((message, severity = 'info') => {
    setToast({ message, severity });
  }, []);

  const reloadItems = useCallback(async () => {
    setItemsLoading(true);
    setItemsError(null);
    try {
      const data = await ppcService.listItems();
      setItems(data);
    } catch (e) {
      setItemsError(e.message);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadItems();
  }, [reloadItems]);

  return (
    <Container maxWidth="xl" sx={{ mt: { xs: 2, md: 3 }, mb: { xs: 4, md: 8 }, px: { xs: 1.5, sm: 2 } }}>
      {/* Header banner */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: 2.5,
          borderRadius: 3,
          color: 'primary.contrastText',
          background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 60%, ${theme.palette.info.main} 130%)`,
        }}
      >
        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
          Production Planning & Control
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.85 }}>
          Items & multi-level BOMs, store stock, material requirements planning, and shop-floor masters.
        </Typography>
      </Paper>

      {/* Tabs */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, mb: 2.5 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ px: 1 }}
        >
          {TABS.map((t) => (
            <Tab key={t.key} icon={t.icon} iconPosition="start" label={t.label} sx={{ minHeight: 56, textTransform: 'none', fontWeight: 600 }} />
          ))}
        </Tabs>
      </Paper>

      {/* Tab panels */}
      {tab === 0 && (
        <ItemsBomTab items={items} loading={itemsLoading} error={itemsError} reloadItems={reloadItems} notify={notify} />
      )}
      {tab === 1 && <MaterialsTab items={items} notify={notify} />}
      {tab === 2 && <MrpTab items={items} notify={notify} />}
      {tab === 3 && <LinesMachinesTab notify={notify} />}
      {tab === 4 && <PlantDashboardTab items={items} itemsLoading={itemsLoading} notify={notify} />}
      {tab === 5 && <WorkOrdersTab items={items} notify={notify} />}
      {tab === 6 && <ShopFloorTab notify={notify} />}

      {/* inline toast */}
      {toast && (
        <Box sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: (t) => t.zIndex.snackbar }}>
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ boxShadow: 6 }}>
            {toast.message}
          </Alert>
        </Box>
      )}
    </Container>
  );
}
