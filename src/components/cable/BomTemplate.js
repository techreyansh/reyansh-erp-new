// BOM Templates (Wave 3) — named, editable material line-sets. The engine's MRP
// math (estimateRM) is unchanged; this is a stored, maintainable BOM reference.
import React from "react";
import { Stack, Chip, Typography } from "@mui/material";
import { AccountTreeRounded } from "@mui/icons-material";
import MasterScreen from "./masters/MasterScreen";
import RowsEditor from "./masters/RowsEditor";
import { makeMaster } from "../../services/refMasterService";

const KINDS = [
  { value: "conductor", label: "Conductor" }, { value: "insulation", label: "Insulation" },
  { value: "sheath", label: "Sheath" }, { value: "filler", label: "Filler" }, { value: "other", label: "Other" },
];
const BASIS = [{ value: "per_meter", label: "Per meter" }, { value: "per_piece", label: "Per piece" }];
const service = makeMaster("bom_template", { codeField: "code", orderBy: "code", copyCols: ["name", "basis", "lines", "is_active"] });

const LineChips = ({ lines }) => (
  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
    {(lines || []).map((l, i) => (
      <Chip key={i} size="small" variant="outlined" label={`${l.material_code || "?"}${l.qty_per_meter ? ` · ${l.qty_per_meter}` : ""}`} />
    ))}
    {(!lines || lines.length === 0) && <Typography variant="caption" color="text.secondary">no lines</Typography>}
  </Stack>
);

export default function BomTemplate() {
  return (
    <MasterScreen
      tableName="bom_template" title="BOM Template" subtitle="reusable material line-sets"
      icon={AccountTreeRounded} service={service} codeField="code" nameField="name"
      searchFields={["code", "name"]}
      filters={[{ key: "basis", label: "Basis", options: BASIS, test: (r, v) => r.basis === v }]}
      sortOptions={[{ value: "code", label: "Code", compare: (a, b) => String(a.code).localeCompare(String(b.code)) }]}
      emptyForm={{ code: "", name: "", basis: "per_meter", lines: [{ material_code: "CO001", kind: "conductor", qty_per_meter: "" }], is_active: true }}
      formFields={[
        { key: "code", label: "Code", sm: 4 },
        { key: "name", label: "Name", sm: 5 },
        { key: "basis", label: "Basis", type: "select", options: BASIS, sm: 3 },
        { key: "lines", label: "Material lines", type: "custom", sm: 12,
          render: (v, onChange) => <RowsEditor value={v} onChange={onChange} label="Material lines" addLabel="Add material"
            columns={[
              { key: "material_code", label: "Material code", width: 140 },
              { key: "kind", label: "Kind", type: "select", options: KINDS, width: 150 },
              { key: "qty_per_meter", label: "Qty / unit (kg)", type: "number", width: 130 },
            ]} newRow={{ material_code: "", kind: "conductor", qty_per_meter: "" }} /> },
      ]}
      renderCardBody={(r) => (
        <Stack spacing={0.5}>
          <Chip size="small" label={r.basis === "per_piece" ? "Per piece" : "Per meter"} sx={{ alignSelf: "flex-start" }} />
          <LineChips lines={r.lines} />
        </Stack>
      )}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "basis", label: "Basis" },
        { key: "lines", label: "Materials", render: (r) => <LineChips lines={r.lines} /> },
      ]}
    />
  );
}
