// Reusable export button — PDF / Excel / CSV / Print for any Report object.
import React, { useState } from 'react';
import { Button, Menu, MenuItem, ListItemIcon, Snackbar, Alert } from '@mui/material';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import PictureAsPdf from '@mui/icons-material/PictureAsPdf';
import GridOn from '@mui/icons-material/GridOn';
import Description from '@mui/icons-material/Description';
import Print from '@mui/icons-material/Print';
import { exportReport } from '../../services/reporting/reportEngine';

export default function ReportExportButton({ buildReport, label = 'Export', size = 'small', variant = 'outlined', onError }) {
  const [anchor, setAnchor] = useState(null);
  const [err, setErr] = useState('');
  const run = (format) => {
    setAnchor(null);
    try {
      exportReport(buildReport(), format);
    } catch (e) {
      // Don't swallow: a malformed report otherwise produces no download with no signal.
      console.error('ReportExportButton: export failed', e);
      if (onError) onError(e);
      else setErr(`Couldn't export ${label} as ${format.toUpperCase()}. ${e?.message || ''}`.trim());
    }
  };
  const opts = [
    ['pdf', 'PDF', <PictureAsPdf fontSize="small" />],
    ['excel', 'Excel', <GridOn fontSize="small" />],
    ['csv', 'CSV', <Description fontSize="small" />],
    ['print', 'Print', <Print fontSize="small" />],
  ];
  return (
    <>
      <Button size={size} variant={variant} startIcon={<FileDownloadOutlined />} onClick={(e) => setAnchor(e.currentTarget)}>{label}</Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {opts.map(([fmt, lbl, icon]) => (
          <MenuItem key={fmt} onClick={() => run(fmt)}><ListItemIcon>{icon}</ListItemIcon>{lbl}</MenuItem>
        ))}
      </Menu>
      <Snackbar open={Boolean(err)} autoHideDuration={6000} onClose={() => setErr('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" variant="filled" onClose={() => setErr('')} sx={{ width: '100%' }}>{err}</Alert>
      </Snackbar>
    </>
  );
}
