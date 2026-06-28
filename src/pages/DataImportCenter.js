import React, { useState } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, Chip, Divider, useTheme,
} from "@mui/material";
import { UploadFileOutlined, GridOnOutlined } from "@mui/icons-material";
import { DATASETS_BY_MODULE } from "../services/bulkImport/registry";
import BulkImportDialog from "../components/common/BulkImport/BulkImportDialog";

const MODULE_LABELS = {
  crm: "CRM",
  inventory: "Inventory",
  production: "Production",
};

/**
 * Central hub for Excel template import/export across the ERP. Each dataset is a
 * card with a "Download template + Upload" action; the same capability is also
 * embedded as a button on the relevant screens.
 */
export default function DataImportCenter() {
  const theme = useTheme();
  const [active, setActive] = useState(null); // dataset object

  const modules = Object.keys(DATASETS_BY_MODULE);

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <GridOnOutlined sx={{ color: theme.palette.primary.main, fontSize: 30 }} />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Data Import Center</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Download an Excel template, fill it fast, and upload it back — or download with current data to bulk-edit. Matched rows update; new rows are created.
      </Typography>

      {modules.map((mod) => (
        <Box key={mod} sx={{ mb: 3 }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>{MODULE_LABELS[mod] || mod}</Typography>
          <Divider sx={{ mb: 1.5 }} />
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3,1fr)" } }}>
            {DATASETS_BY_MODULE[mod].map((d) => (
              <Card key={d.key} variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{d.label}</Typography>
                    <Chip size="small" label={`${d.columns.length} cols`} sx={{ height: 20 }} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5, minHeight: 32 }}>
                    Match by {(d.columns.find((c) => c.key === d.matchKey) || {}).label || d.matchKey}. Upsert on re-upload.
                  </Typography>
                  <Button fullWidth size="small" variant="contained" startIcon={<UploadFileOutlined />} onClick={() => setActive(d)}>
                    Template / Upload
                  </Button>
                </CardContent>
              </Card>
            ))}
          </Box>
        </Box>
      ))}

      {active && (
        <BulkImportDialog dataset={active} open={!!active} onClose={() => setActive(null)} />
      )}
    </Box>
  );
}
