// Material Master (Wave 2) — raw-material reference for cables (copper, PVC…).
import React from "react";
import { Stack, Chip, Typography } from "@mui/material";
import { ScienceRounded } from "@mui/icons-material";
import MasterScreen from "./masters/MasterScreen";
import { makeMaster } from "../../services/refMasterService";

const TYPES = [
  { value: "conductor", label: "Conductor" },
  { value: "insulation", label: "Insulation" },
  { value: "sheath", label: "Sheath" },
  { value: "filler", label: "Filler" },
  { value: "other", label: "Other" },
];
const TYPE_COLOR = { conductor: "warning", insulation: "info", sheath: "success", filler: "default", other: "default" };
const service = makeMaster("material_master", { codeField: "code", orderBy: "code", copyCols: ["name", "material_type", "uom", "density", "default_unit_cost", "notes", "is_active"] });

export default function MaterialMaster() {
  return (
    <MasterScreen
      tableName="material_master" title="Material Master" subtitle="copper, PVC compounds & other raw materials"
      icon={ScienceRounded} service={service} codeField="code" nameField="name"
      searchFields={["code", "name", "material_type"]}
      filters={[{ key: "material_type", label: "Type", options: TYPES, test: (r, v) => r.material_type === v }]}
      sortOptions={[
        { value: "code", label: "Code", compare: (a, b) => String(a.code).localeCompare(String(b.code)) },
        { value: "type", label: "Type", compare: (a, b) => String(a.material_type).localeCompare(String(b.material_type)) },
      ]}
      emptyForm={{ code: "", name: "", material_type: "other", uom: "kg", density: "", default_unit_cost: "", notes: "", is_active: true }}
      formFields={[
        { key: "code", label: "Code", sm: 4 },
        { key: "name", label: "Name", sm: 8 },
        { key: "material_type", label: "Type", type: "select", options: TYPES, sm: 4 },
        { key: "uom", label: "UoM", sm: 4 },
        { key: "density", label: "Density (g/cc)", type: "number", sm: 4 },
        { key: "default_unit_cost", label: "Unit cost (₹)", type: "number", sm: 6 },
        { key: "notes", label: "Notes", type: "textarea", sm: 12 },
      ]}
      renderCardBody={(r) => (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" color={TYPE_COLOR[r.material_type] || "default"} label={r.material_type} sx={{ textTransform: "capitalize" }} />
          {r.density && <Typography variant="caption" color="text.secondary">{r.density} g/cc</Typography>}
          {r.default_unit_cost ? <Typography variant="caption" color="text.secondary">· ₹{Number(r.default_unit_cost).toLocaleString("en-IN")}/{r.uom || "kg"}</Typography> : null}
        </Stack>
      )}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "material_type", label: "Type", render: (r) => <Chip size="small" color={TYPE_COLOR[r.material_type] || "default"} label={r.material_type} sx={{ textTransform: "capitalize" }} /> },
        { key: "uom", label: "UoM" },
        { key: "default_unit_cost", label: "₹/unit", render: (r) => (r.default_unit_cost ? `₹${Number(r.default_unit_cost).toLocaleString("en-IN")}` : "—") },
      ]}
    />
  );
}
