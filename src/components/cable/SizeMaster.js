// Size Master (Wave 2) — standard conductor sizes + typical strand constructions.
import React from "react";
import { Stack, Chip } from "@mui/material";
import { StraightenRounded } from "@mui/icons-material";
import MasterScreen from "./masters/MasterScreen";
import { makeMaster } from "../../services/refMasterService";

const service = makeMaster("size_master", { codeField: "code", orderBy: "copper_area_sqmm", copyCols: ["copper_area_sqmm", "strand_construction", "label", "is_active"] });

export default function SizeMaster() {
  return (
    <MasterScreen
      tableName="size_master" title="Size Master" subtitle="conductor sizes & default strand constructions"
      icon={StraightenRounded} service={service} codeField="code" nameField="label"
      searchFields={["code", "label", "strand_construction"]}
      sortOptions={[
        { value: "area", label: "Size", compare: (a, b) => (a.copper_area_sqmm || 0) - (b.copper_area_sqmm || 0) },
        { value: "code", label: "Code", compare: (a, b) => String(a.code).localeCompare(String(b.code)) },
      ]}
      emptyForm={{ code: "", copper_area_sqmm: "", strand_construction: "", label: "", is_active: true }}
      formFields={[
        { key: "code", label: "Code", sm: 4 },
        { key: "copper_area_sqmm", label: "Copper area (mm²)", type: "number", sm: 4 },
        { key: "strand_construction", label: "Strand (e.g. 30/0.25)", sm: 4 },
        { key: "label", label: "Label", sm: 12 },
      ]}
      renderCardBody={(r) => (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`${r.copper_area_sqmm ?? "—"} mm²`} />
          {r.strand_construction && <Chip size="small" variant="outlined" label={r.strand_construction} />}
        </Stack>
      )}
      columns={[
        { key: "code", label: "Code" },
        { key: "copper_area_sqmm", label: "mm²" },
        { key: "strand_construction", label: "Strand" },
        { key: "label", label: "Label" },
      ]}
    />
  );
}
