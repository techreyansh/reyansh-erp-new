/**
 * LegacyBomImporter — one-time guided importer for the PPC module.
 *
 * Pulls the legacy BOM source bundle (ppc_legacy_bom_source RPC), parses it
 * CLIENT-SIDE into an editable preview (Products, Materials, BOM links, Opening
 * stock), surfaces "needs review" warnings without blocking, and on confirm
 * builds a deduped payload and calls ppc_import_bom (idempotent).
 *
 * Rows carry a stable internal rowId assigned at parse time. BOM links store the
 * parent/component rowId (NOT the editable code) so renaming a code in the
 * Products/Materials tables flows automatically into the built payload's
 * parent_code / component_code.
 *
 * Admin / one-time tool: density + clarity over polish.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CloseRounded,
  WarningAmberRounded,
  MoveToInboxOutlined,
} from '@mui/icons-material';
import ppcService, { ITEM_TYPES } from '../../services/ppcService';

// ---------------------------------------------------------------------------
// constants / helpers
// ---------------------------------------------------------------------------
const ALLOWED_ITEM_TYPES = ['cable', 'power_cord', 'harness', 'component', 'raw_material'];
const MAX_CODE_LEN = 20;

let rowSeq = 0;
const nextRowId = () => `r${++rowSeq}`;

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

/** Is this code likely a description-as-code (needs review)? */
function codeNeedsReview(code) {
  const c = (code || '').trim();
  if (!c) return true;
  if (/\s/.test(c)) return true;
  if (c.length > MAX_CODE_LEN) return true;
  return false;
}

/** Split "WP001 - 6 AMP HOLLOW" → { code, name } on the FIRST ' - '. */
function splitRawMaterial(raw) {
  const r = (raw || '').trim();
  const idx = r.indexOf(' - ');
  if (idx === -1) return { code: r, name: r };
  return { code: r.slice(0, idx).trim(), name: r.slice(idx + 3).trim() };
}

const ReviewChip = ({ reason }) => (
  <Tooltip title={reason || 'Needs review — please check this value before importing'}>
    <Chip
      size="small"
      color="warning"
      variant="outlined"
      icon={<WarningAmberRounded sx={{ fontSize: 16 }} />}
      label="Review"
      sx={{ fontWeight: 700, height: 22 }}
    />
  </Tooltip>
);

// ---------------------------------------------------------------------------
// parse the legacy source bundle into editable table state
// ---------------------------------------------------------------------------
function parseSource(source) {
  const boms = Array.isArray(source?.boms) ? source.boms : [];
  const issues = Array.isArray(source?.issues) ? source.issues : [];

  // GLOBAL item dedupe by final code. We key the working maps on code, but each
  // row also gets a stable rowId so edits don't break the BOM-link join.
  const productsByCode = new Map(); // code -> productRow
  const materialsByCode = new Map(); // code -> materialRow
  const links = []; // { rowId, parentRowId, componentRowId, qty_per, scrap_pct }

  boms.forEach((bom) => {
    // ---- product ----
    const pCode = (bom.product_code || '').trim();
    const pName = (bom.product_description || '').trim() || pCode;
    let product = productsByCode.get(pCode);
    if (!product) {
      product = {
        rowId: nextRowId(),
        code: pCode,
        name: pName,
        item_type: 'power_cord',
        uom: 'PCS',
      };
      productsByCode.set(pCode, product);
    }

    // ---- materials (cable + moulding), deduped WITHIN this BOM by code ----
    const rawMaterials = [
      ...(Array.isArray(bom.cable_materials) ? bom.cable_materials : []),
      ...(Array.isArray(bom.moulding_materials) ? bom.moulding_materials : []),
    ];
    const seenInBom = new Set();

    rawMaterials.forEach((m) => {
      const { code: mCode, name: mName } = splitRawMaterial(m?.rawMaterial);
      if (seenInBom.has(mCode)) return; // first occurrence wins within the BOM
      seenInBom.add(mCode);

      const qtyPer =
        parseFloat(m?.qtyPerPc) || parseFloat(m?.totalQty) || 0;
      const uom = (m?.units && String(m.units).trim()) || 'PCS';

      let material = materialsByCode.get(mCode);
      if (!material) {
        material = {
          rowId: nextRowId(),
          code: mCode,
          name: mName || mCode,
          item_type: 'raw_material',
          uom,
        };
        materialsByCode.set(mCode, material);
      }

      links.push({
        rowId: nextRowId(),
        parentRowId: product.rowId,
        componentRowId: material.rowId,
        qty_per: qtyPer,
        scrap_pct: 0,
      });
    });
  });

  // ---- opening stock: flatten issue details, first occurrence's balanceQty ----
  // issues come newest-first → first occurrence per itemCode wins.
  const stockByCode = new Map();
  issues.forEach((issue) => {
    const details = Array.isArray(issue?.details) ? issue.details : [];
    details.forEach((d) => {
      const code = (d?.itemCode || '').trim();
      if (!code || stockByCode.has(code)) return;
      // Only include materials that exist in the parsed items.
      if (!materialsByCode.has(code)) return;
      stockByCode.set(code, {
        rowId: nextRowId(),
        code,
        on_hand: Number(d?.balanceQty) || 0,
        location: (d?.location && String(d.location).trim()) || 'Store',
      });
    });
  });

  return {
    products: Array.from(productsByCode.values()),
    materials: Array.from(materialsByCode.values()),
    links,
    stock: Array.from(stockByCode.values()),
    bomCount: boms.length,
  };
}

// ---------------------------------------------------------------------------
// editable table cell helpers
// ---------------------------------------------------------------------------
const CodeField = ({ value, onChange, flagged }) => (
  <TextField
    size="small"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    error={flagged}
    sx={{ minWidth: 150 }}
    inputProps={{ style: { fontWeight: 600 } }}
  />
);

const TextCell = ({ value, onChange, minWidth = 200 }) => (
  <TextField
    size="small"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    fullWidth
    sx={{ minWidth }}
  />
);

const TypeSelect = ({ value, onChange }) => (
  <TextField select size="small" value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 150 }}>
    {ITEM_TYPES.filter((t) => ALLOWED_ITEM_TYPES.includes(t.value)).map((t) => (
      <MenuItem key={t.value} value={t.value}>
        {t.label}
      </MenuItem>
    ))}
  </TextField>
);

const NumberCell = ({ value, onChange, error, width = 110 }) => (
  <TextField
    size="small"
    type="number"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    error={error}
    sx={{ width }}
  />
);

// ---------------------------------------------------------------------------
// main importer (rendered inside the Dialog)
// ---------------------------------------------------------------------------
export default function LegacyBomImporter({ open, onClose, onImported, notify }) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [alreadyImported, setAlreadyImported] = useState(0);
  const [bomCount, setBomCount] = useState(0);

  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [links, setLinks] = useState([]);
  const [stock, setStock] = useState([]);

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // { items, boms, stock }

  // Load + parse on open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      setResult(null);
      try {
        const source = await ppcService.legacyBomSource();
        if (cancelled) return;
        const parsed = parseSource(source);
        setProducts(parsed.products);
        setMaterials(parsed.materials);
        setLinks(parsed.links);
        setStock(parsed.stock);
        setBomCount(parsed.bomCount);
        setAlreadyImported(Number(source?.already_imported) || 0);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e.message || String(e));
          if (notify) notify(e.message || 'Failed to load legacy BOMs', 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, notify]);

  // --- row edit helpers (keyed by stable rowId) ---
  const editRow = (setter) => (rowId, patch) =>
    setter((rows) => rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const editProduct = editRow(setProducts);
  const editMaterial = editRow(setMaterials);
  const editLink = editRow(setLinks);
  const editStock = editRow(setStock);

  // Resolve a rowId → its CURRENT edited code (across products + materials).
  const codeByRowId = useMemo(() => {
    const map = new Map();
    products.forEach((p) => map.set(p.rowId, p.code));
    materials.forEach((m) => map.set(m.rowId, m.code));
    return map;
  }, [products, materials]);

  const isEmpty = !loading && !loadError && bomCount === 0;

  // --- build deduped payload from CURRENT table state ---
  const buildPayload = () => {
    // items = products ∪ materials, deduped GLOBALLY by final (edited) code.
    const itemsByCode = new Map();
    const addItem = (row, defaultType) => {
      const code = (row.code || '').trim();
      if (!code) return;
      if (!itemsByCode.has(code)) {
        itemsByCode.set(code, {
          code,
          name: (row.name || '').trim() || code,
          item_type: row.item_type || defaultType,
          uom: (row.uom || '').trim() || 'PCS',
        });
      }
    };
    products.forEach((p) => addItem(p, 'power_cord'));
    materials.forEach((m) => addItem(m, 'raw_material'));

    // boms: resolve rowId → current code.
    const bomLinks = links
      .map((l) => ({
        parent_code: (codeByRowId.get(l.parentRowId) || '').trim(),
        component_code: (codeByRowId.get(l.componentRowId) || '').trim(),
        qty_per: parseFloat(l.qty_per) || 0,
        scrap_pct: parseFloat(l.scrap_pct) || 0,
      }))
      .filter((l) => l.parent_code && l.component_code);

    // stock: only codes that survive as items.
    const stockRows = stock
      .map((s) => ({
        code: (s.code || '').trim(),
        on_hand: Number(s.on_hand) || 0,
        location: (s.location || '').trim() || 'Store',
      }))
      .filter((s) => s.code && itemsByCode.has(s.code));

    return {
      items: Array.from(itemsByCode.values()),
      boms: bomLinks,
      stock: stockRows,
    };
  };

  const payloadCounts = useMemo(() => {
    if (loading || loadError || isEmpty) return { items: 0, boms: 0, stock: 0 };
    const p = buildPayload();
    return { items: p.items.length, boms: p.boms.length, stock: p.stock.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, materials, links, stock, codeByRowId, loading, loadError, isEmpty]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const payload = buildPayload();
      const res = await ppcService.importBom(payload);
      setResult(res);
      if (notify) {
        notify(
          `Imported: ${res.items} items, ${res.boms} BOM links, ${res.stock} stock rows`,
          'success'
        );
      }
      if (onImported) onImported(res);
    } catch (e) {
      if (notify) notify(e.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onClose={importing ? undefined : onClose} maxWidth={false} fullWidth
      PaperProps={{ sx: { width: '95vw', maxWidth: 1400, borderRadius: 2.5 } }}>
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <MoveToInboxOutlined color="primary" />
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Import legacy BOMs
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Review &amp; fix the parsed data below, then import. Re-running is safe — items are upserted, never duplicated.
            </Typography>
          </Box>
        </Stack>
        <IconButton
          onClick={onClose}
          disabled={importing}
          sx={{ position: 'absolute', right: 12, top: 12 }}
          aria-label="Close"
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <Divider />

      <DialogContent sx={{ bgcolor: 'grey.50' }}>
        {loading && (
          <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: 8 }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              Loading legacy BOMs…
            </Typography>
          </Stack>
        )}

        {!loading && loadError && (
          <Alert severity="error" sx={{ my: 2 }}>
            {loadError}
          </Alert>
        )}

        {isEmpty && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <MoveToInboxOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 1.5 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              No legacy BOMs found to import.
            </Typography>
          </Box>
        )}

        {!loading && !loadError && !isEmpty && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {/* Summary header */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Found {bomCount} legacy BOMs → {products.length} products,{' '}
                {materials.length} materials, {links.length} BOM links
              </Typography>
              {alreadyImported > 0 && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  PPC already has {alreadyImported} items — re-importing only updates/links, never duplicates.
                </Alert>
              )}
            </Box>

            {result && (
              <Alert severity="success" onClose={() => setResult(null)}>
                Imported: {result.items} items, {result.boms} BOM links, {result.stock} stock rows.
              </Alert>
            )}

            {/* Products */}
            <SectionTable
              title="Products"
              subtitle="Finished products parsed from each legacy BOM (default type: Power Cord)."
              countLabel={`${products.length}`}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={headRowSx}>
                    <TableCell>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>UoM</TableCell>
                    <TableCell align="center">Flag</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {products.map((p) => {
                    const flagged = codeNeedsReview(p.code);
                    return (
                      <TableRow key={p.rowId} hover>
                        <TableCell>
                          <CodeField value={p.code} flagged={flagged} onChange={(v) => editProduct(p.rowId, { code: v })} />
                        </TableCell>
                        <TableCell>
                          <TextCell value={p.name} onChange={(v) => editProduct(p.rowId, { name: v })} />
                        </TableCell>
                        <TableCell>
                          <TypeSelect value={p.item_type} onChange={(v) => editProduct(p.rowId, { item_type: v })} />
                        </TableCell>
                        <TableCell>
                          <TextCell value={p.uom} minWidth={90} onChange={(v) => editProduct(p.rowId, { uom: v })} />
                        </TableCell>
                        <TableCell align="center">{flagged ? <ReviewChip reason="Code looks like a description — please shorten / fix" /> : null}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionTable>

            {/* Materials */}
            <SectionTable
              title="Raw materials / components"
              subtitle="Deduped across all BOMs (default type: Raw Material)."
              countLabel={`${materials.length}`}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={headRowSx}>
                    <TableCell>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>UoM</TableCell>
                    <TableCell align="center">Flag</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {materials.map((m) => {
                    const flagged = codeNeedsReview(m.code);
                    return (
                      <TableRow key={m.rowId} hover>
                        <TableCell>
                          <CodeField value={m.code} flagged={flagged} onChange={(v) => editMaterial(m.rowId, { code: v })} />
                        </TableCell>
                        <TableCell>
                          <TextCell value={m.name} onChange={(v) => editMaterial(m.rowId, { name: v })} />
                        </TableCell>
                        <TableCell>
                          <TypeSelect value={m.item_type} onChange={(v) => editMaterial(m.rowId, { item_type: v })} />
                        </TableCell>
                        <TableCell>
                          <TextCell value={m.uom} minWidth={90} onChange={(v) => editMaterial(m.rowId, { uom: v })} />
                        </TableCell>
                        <TableCell align="center">{flagged ? <ReviewChip reason="Code looks like a description — please shorten / fix" /> : null}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionTable>

            {/* BOM links */}
            <SectionTable
              title="BOM links"
              subtitle="One row per (product, material). Parent/component reflect your code edits above automatically."
              countLabel={`${links.length}`}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={headRowSx}>
                    <TableCell>Parent code</TableCell>
                    <TableCell>Component code</TableCell>
                    <TableCell align="right">Qty / unit</TableCell>
                    <TableCell align="right">Scrap %</TableCell>
                    <TableCell align="center">Flag</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {links.map((l) => {
                    const parentCode = codeByRowId.get(l.parentRowId) || '';
                    const componentCode = codeByRowId.get(l.componentRowId) || '';
                    const qtyZero = (parseFloat(l.qty_per) || 0) === 0;
                    return (
                      <TableRow key={l.rowId} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{parentCode || <em>—</em>}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{componentCode || <em>—</em>}</TableCell>
                        <TableCell align="right">
                          <NumberCell value={l.qty_per} error={qtyZero} onChange={(v) => editLink(l.rowId, { qty_per: v })} />
                        </TableCell>
                        <TableCell align="right">
                          <NumberCell value={l.scrap_pct} onChange={(v) => editLink(l.rowId, { scrap_pct: v })} />
                        </TableCell>
                        <TableCell align="center">{qtyZero ? <ReviewChip reason="Qty per unit is 0 — set a quantity" /> : null}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionTable>

            {/* Opening stock */}
            {stock.length > 0 && (
              <SectionTable
                title="Opening stock"
                subtitle="On-hand balances pulled from the latest issue records."
                countLabel={`${stock.length}`}
              >
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={headRowSx}>
                      <TableCell>Code</TableCell>
                      <TableCell align="right">On hand</TableCell>
                      <TableCell>Location</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {stock.map((s) => (
                      <TableRow key={s.rowId} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{s.code}</TableCell>
                        <TableCell align="right">
                          <NumberCell value={s.on_hand} onChange={(v) => editStock(s.rowId, { on_hand: v })} />
                        </TableCell>
                        <TableCell>
                          <TextCell value={s.location} minWidth={140} onChange={(v) => editStock(s.rowId, { location: v })} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </SectionTable>
            )}
          </Stack>
        )}
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={importing} color="inherit">
          {result ? 'Done' : 'Cancel'}
        </Button>
        {!isEmpty && (
          <Button
            variant="contained"
            onClick={handleImport}
            disabled={loading || importing || !!loadError}
            startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <MoveToInboxOutlined />}
          >
            {importing
              ? 'Importing…'
              : `Import ${payloadCounts.items} items + ${payloadCounts.boms} links`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// section wrapper — titled, scrollable table panel
// ---------------------------------------------------------------------------
function SectionTable({ title, subtitle, countLabel, children }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Chip size="small" label={countLabel} sx={{ fontWeight: 700 }} />
      </Stack>
      <Divider />
      <TableContainer sx={{ maxHeight: 320, bgcolor: 'background.paper' }}>{children}</TableContainer>
    </Paper>
  );
}
