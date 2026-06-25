// Colour Master (Wave 2) — was a hardcoded list, now a maintainable master.
import React from "react";
import { Stack, Box, Typography } from "@mui/material";
import { PaletteRounded } from "@mui/icons-material";
import MasterScreen from "./masters/MasterScreen";
import { makeMaster } from "../../services/refMasterService";

const service = makeMaster("colour_master", { codeField: "code", orderBy: "sort_order", copyCols: ["name", "hex", "sort_order", "is_active"] });
const Swatch = ({ hex }) => <Box sx={{ width: 18, height: 18, borderRadius: "50%", bgcolor: hex || "#888", border: "1px solid", borderColor: "divider" }} />;

export default function ColourMaster() {
  return (
    <MasterScreen
      tableName="colour_master" title="Colour Master" subtitle="core & sheath colours used across cables"
      icon={PaletteRounded} service={service} codeField="code" nameField="name"
      searchFields={["code", "name", "hex"]}
      sortOptions={[
        { value: "sort_order", label: "Order", compare: (a, b) => (a.sort_order || 0) - (b.sort_order || 0) },
        { value: "name", label: "Name", compare: (a, b) => String(a.name).localeCompare(String(b.name)) },
      ]}
      emptyForm={{ code: "", name: "", hex: "#3b82f6", sort_order: 0, is_active: true }}
      formFields={[
        { key: "code", label: "Code", sm: 4 },
        { key: "name", label: "Name", sm: 8 },
        { key: "hex", label: "Hex colour", sm: 6 },
        { key: "sort_order", label: "Sort order", type: "number", sm: 6 },
      ]}
      renderCardBody={(r) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <Swatch hex={r.hex} />
          <Typography variant="body2" color="text.secondary">{r.hex || "—"}</Typography>
        </Stack>
      )}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "hex", label: "Colour", render: (r) => <Stack direction="row" spacing={1} alignItems="center"><Swatch hex={r.hex} /><span>{r.hex || "—"}</span></Stack> },
        { key: "sort_order", label: "Order" },
      ]}
    />
  );
}
