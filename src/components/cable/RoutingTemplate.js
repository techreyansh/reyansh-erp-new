// Routing Templates (Wave 3) — named, editable stage sequences the planner can
// pick. The engine's auto-routing math is unchanged; this is a stored default.
import React from "react";
import { Stack, Chip, Typography } from "@mui/material";
import { RouteRounded, ArrowRightRounded } from "@mui/icons-material";
import MasterScreen from "./masters/MasterScreen";
import RowsEditor from "./masters/RowsEditor";
import { makeMaster } from "../../services/refMasterService";

const STAGES = [
  { value: "bunching", label: "Bunching" }, { value: "core", label: "Core" },
  { value: "laying", label: "Laying" }, { value: "sheathing", label: "Sheathing" },
  { value: "cutting", label: "Cutting" },
];
const STAGE_COLOR = { bunching: "#6366f1", core: "#0ea5e9", laying: "#f59e0b", sheathing: "#10b981", cutting: "#a855f7" };
const service = makeMaster("routing_template", { codeField: "code", orderBy: "code", copyCols: ["name", "description", "steps", "is_active"] });

const StepChips = ({ steps }) => (
  <Stack direction="row" spacing={0.25} alignItems="center" flexWrap="wrap" useFlexGap>
    {(steps || []).map((s, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ArrowRightRounded fontSize="small" sx={{ color: "text.disabled" }} />}
        <Chip size="small" label={s.stage} sx={{ textTransform: "capitalize", bgcolor: `${STAGE_COLOR[s.stage] || "#888"}22`, color: STAGE_COLOR[s.stage], fontWeight: 700 }} />
      </React.Fragment>
    ))}
    {(!steps || steps.length === 0) && <Typography variant="caption" color="text.secondary">no steps</Typography>}
  </Stack>
);

export default function RoutingTemplate() {
  return (
    <MasterScreen
      tableName="routing_template" title="Routing Template" subtitle="reusable stage sequences"
      icon={RouteRounded} service={service} codeField="code" nameField="name"
      searchFields={["code", "name", "description"]}
      sortOptions={[{ value: "code", label: "Code", compare: (a, b) => String(a.code).localeCompare(String(b.code)) }]}
      emptyForm={{ code: "", name: "", description: "", steps: [{ stage: "core" }], is_active: true }}
      formFields={[
        { key: "code", label: "Code", sm: 4 },
        { key: "name", label: "Name", sm: 8 },
        { key: "description", label: "Description", type: "textarea", sm: 12 },
        { key: "steps", label: "Stages (in run order)", type: "custom", sm: 12,
          render: (v, onChange) => <RowsEditor value={v} onChange={onChange} label="Stages (in run order)" addLabel="Add stage"
            columns={[{ key: "stage", label: "Stage", type: "select", options: STAGES, width: 180, flex: 1 }]} newRow={{ stage: "core" }} /> },
      ]}
      renderCardBody={(r) => <StepChips steps={r.steps} />}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "steps", label: "Routing", render: (r) => <StepChips steps={r.steps} /> },
      ]}
    />
  );
}
