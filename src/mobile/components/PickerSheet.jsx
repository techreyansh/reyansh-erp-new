// Bottom-sheet single-select picker. Big rows, searchable, thumb-reachable.
import React, { useMemo, useState } from 'react';
import {
  Drawer, Box, List, ListItemButton, ListItemText, TextField, Typography,
  InputAdornment, ListItemIcon,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CheckIcon from '@mui/icons-material/Check';

export default function PickerSheet({
  open,
  onClose,
  title = 'Select',
  options = [],
  value,
  onSelect,
  getLabel = (o) => (o && o.label != null ? o.label : String(o)),
  getValue = (o) => (o && o.value != null ? o.value : o),
  searchable = true,
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q) return options;
    const needle = q.toLowerCase();
    return options.filter((o) => String(getLabel(o)).toLowerCase().includes(needle));
  }, [q, options, getLabel]);

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '75vh' } }}
    >
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Box sx={{ width: 40, height: 4, bgcolor: 'divider', borderRadius: 2, mx: 'auto', mb: 1.5 }} />
        <Typography variant="h6" sx={{ fontWeight: 700, mb: searchable ? 1.5 : 0 }}>{title}</Typography>
        {searchable && (
          <TextField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            fullWidth
            size="small"
            InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon /></InputAdornment>) }}
          />
        )}
      </Box>
      <List sx={{ overflowY: 'auto' }}>
        {filtered.map((o, i) => {
          const v = getValue(o);
          const selected = v === value;
          return (
            <ListItemButton
              key={`${v}-${i}`}
              selected={selected}
              onClick={() => { onSelect?.(v, o); onClose?.(); }}
              sx={{ minHeight: 56 }}
            >
              {selected && (<ListItemIcon sx={{ minWidth: 36 }}><CheckIcon color="primary" /></ListItemIcon>)}
              <ListItemText primary={getLabel(o)} primaryTypographyProps={{ fontWeight: selected ? 700 : 500 }} />
            </ListItemButton>
          );
        })}
        {filtered.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>No matches</Box>
        )}
      </List>
    </Drawer>
  );
}
