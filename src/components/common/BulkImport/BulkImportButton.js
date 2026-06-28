import React, { useState } from "react";
import { Button } from "@mui/material";
import { UploadFileOutlined } from "@mui/icons-material";
import { getDataset } from "../../../services/bulkImport/registry";
import BulkImportDialog from "./BulkImportDialog";

/**
 * Drop-in "Import from Excel" button for any registered dataset.
 * Usage: <BulkImportButton dataset="crm_prospects" onApplied={reload} />
 */
export default function BulkImportButton({ dataset: datasetKey, label, size = "small", variant = "outlined", onApplied, sx }) {
  const [open, setOpen] = useState(false);
  const dataset = getDataset(datasetKey);
  if (!dataset) return null;
  return (
    <>
      <Button size={size} variant={variant} startIcon={<UploadFileOutlined />} onClick={() => setOpen(true)} sx={sx}>
        {label || "Import from Excel"}
      </Button>
      <BulkImportDialog
        dataset={dataset}
        open={open}
        onClose={() => setOpen(false)}
        onApplied={(res) => { if (onApplied) onApplied(res); }}
      />
    </>
  );
}
