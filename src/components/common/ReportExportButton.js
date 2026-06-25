// Reusable export button — PDF / Excel / CSV / Print for any Report object.
import React, { useState } from 'react';
import { Button, Menu, MenuItem, ListItemIcon } from '@mui/material';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import PictureAsPdf from '@mui/icons-material/PictureAsPdf';
import GridOn from '@mui/icons-material/GridOn';
import Description from '@mui/icons-material/Description';
import Print from '@mui/icons-material/Print';
import { exportReport } from '../../services/reporting/reportEngine';

export default function ReportExportButton({ buildReport, label = 'Export', size = 'small', variant = 'outlined' }) {
  const [anchor, setAnchor] = useState(null);
  const run = (format) => {
    setAnchor(null);
    try { exportReport(buildReport(), format); } catch (e) { /* no-op */ }
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
    </>
  );
}
