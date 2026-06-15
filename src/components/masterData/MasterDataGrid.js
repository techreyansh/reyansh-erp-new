import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, TextField, Tooltip, Typography,
  Snackbar,
} from '@mui/material';
import {
  AddOutlined, EditOutlined, DeleteOutline, SearchOutlined, RefreshOutlined, SaveOutlined,
} from '@mui/icons-material';
import masterDataService, { dataFields } from '../../services/masterDataService';
import { pickField } from '../../config/masterDataConfig';

const prettify = (k) => k
  .replace(/_/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\b\w/g, (c) => c.toUpperCase());

const isNumericish = (v) => v !== '' && v !== null && v !== undefined && !Number.isNaN(Number(v)) && typeof v !== 'boolean';

/**
 * Generic master-data grid: list / search / add / edit / delete over any table.
 * Display columns come from entity.columns or are inferred from the data; the
 * add/edit form fields adapt to the row being edited (and entity.addFields for new).
 */
const MasterDataGrid = ({ entity }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [rpp, setRpp] = useState(10);
  const [dialog, setDialog] = useState(null); // { mode: 'add'|'edit', row, form }
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await masterDataService.listEntity(entity.table)); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [entity.table]);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo(() => {
    if (entity.columns?.length) return entity.columns;
    const seen = [];
    for (const r of rows.slice(0, 25)) {
      for (const k of dataFields(r)) if (!seen.includes(k)) seen.push(k);
    }
    return seen.slice(0, 6);
  }, [entity.columns, rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => dataFields(r).some((k) => String(r[k] ?? '').toLowerCase().includes(s)));
  }, [rows, q]);

  const paged = filtered.slice(page * rpp, page * rpp + rpp);

  const openAdd = () => {
    const fields = entity.addFields?.length ? entity.addFields : (columns.length ? columns : ['Name', 'Code']);
    setDialog({ mode: 'add', row: null, form: Object.fromEntries(fields.map((f) => [f, ''])) });
  };
  const openEdit = (row) => {
    const fields = dataFields(row);
    setDialog({ mode: 'edit', row, form: Object.fromEntries(fields.map((f) => [f, row[f] ?? ''])) });
  };

  const setFormField = (k, v) => setDialog((d) => ({ ...d, form: { ...d.form, [k]: v } }));

  const save = async () => {
    setSaving(true); setError(null);
    try {
      // Coerce numeric-looking values back to numbers so they store cleanly.
      const payload = {};
      for (const [k, v] of Object.entries(dialog.form)) {
        payload[k] = (typeof v === 'string' && isNumericish(v) && v.trim() !== '') ? Number(v) : v;
      }
      if (dialog.mode === 'add') {
        await masterDataService.createRow(entity.table, payload);
        setToast('Record added.');
      } else {
        await masterDataService.updateRow(entity.table, dialog.row.id, payload);
        setToast('Record updated.');
      }
      masterDataService.invalidate(entity.table);
      setDialog(null);
      await load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const doDelete = async () => {
    const row = confirmDel; setConfirmDel(null);
    try {
      await masterDataService.deleteRow(entity.table, row.id);
      masterDataService.invalidate(entity.table);
      setToast('Record deleted.');
      await load();
    } catch (e) { setError(e.message); }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 2 }}>
        <TextField
          size="small" placeholder={`Search ${entity.label.toLowerCase()}…`} value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> }}
          sx={{ width: { xs: '100%', sm: 320 } }}
        />
        <Stack direction="row" spacing={1}>
          <Tooltip title="Reload"><IconButton onClick={load}><RefreshOutlined /></IconButton></Tooltip>
          <Button variant="contained" startIcon={<AddOutlined />} onClick={openAdd}>Add</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ '& th': { bgcolor: 'grey.100', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'text.secondary', whiteSpace: 'nowrap' } }}>
                    {columns.map((c) => <TableCell key={c}>{prettify(c)}</TableCell>)}
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paged.map((r) => (
                    <TableRow key={r.id} hover>
                      {columns.map((c) => (
                        <TableCell key={c} sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(r[c] ?? '')}
                        </TableCell>
                      ))}
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEdit(r)}><EditOutlined fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => setConfirmDel(r)}><DeleteOutline fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {paged.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={columns.length + 1} sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                        {rows.length === 0 ? 'No records yet — click "Add" to create the first one.' : 'No match for your search.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div" count={filtered.length} page={page} rowsPerPage={rpp}
              onPageChange={(e, p) => setPage(p)}
              onRowsPerPageChange={(e) => { setRpp(parseInt(e.target.value, 10)); setPage(0); }}
              rowsPerPageOptions={[10, 25, 50]}
            />
          </>
        )}
      </Paper>

      {/* Add / Edit dialog */}
      <Dialog open={!!dialog} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>
          {dialog?.mode === 'add' ? `Add ${entity.label}` : `Edit ${entity.label}`}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {dialog && Object.keys(dialog.form).map((k) => (
              <TextField
                key={k} label={prettify(k)} value={dialog.form[k] ?? ''} fullWidth size="small"
                onChange={(e) => setFormField(k, e.target.value)}
                multiline={String(dialog.form[k] ?? '').length > 60}
              />
            ))}
            {dialog && Object.keys(dialog.form).length === 0 && (
              <Typography variant="body2" color="text.secondary">No editable fields detected for this record.</Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving}
                  startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlined />}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDel} onClose={() => setConfirmDel(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Delete record?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This permanently removes <strong>{confirmDel ? (pickField(confirmDel, entity.title) || pickField(confirmDel, entity.code) || 'this record') : ''}</strong> from {entity.label}.
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Other parts of the ERP may reference this record. Make sure it isn't in use.
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirmDel(null)}>Cancel</Button>
          <Button variant="contained" color="error" startIcon={<DeleteOutline />} onClick={doDelete}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={2800} onClose={() => setToast(null)} message={toast}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
};

export default MasterDataGrid;
