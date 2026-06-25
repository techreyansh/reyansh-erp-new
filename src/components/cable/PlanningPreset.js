// Planning Presets (Wave 4) — named option sets the Auto Planner applies in one
// click. The scheduling engine is unchanged; presets just preload its options.
import React from "react";
import { Stack, Chip } from "@mui/material";
import { TuneRounded } from "@mui/icons-material";
import MasterScreen from "./masters/MasterScreen";
import { makeMaster } from "../../services/refMasterService";

const PRIORITY = [{ value: "due_date", label: "Due date" }, { value: "manual", label: "Manual priority" }, { value: "created", label: "Created order" }];
const MODE = [{ value: "forward", label: "Forward" }, { value: "reverse", label: "Reverse (from due)" }];
const STOCK = [{ value: "ignore", label: "Ignore stock" }, { value: "warn", label: "Warn on shortage" }, { value: "block", label: "Block on shortage" }];
const SCOPE = [{ value: "pending", label: "Pending only" }, { value: "all", label: "All open" }];
const service = makeMaster("planning_preset", { codeField: "code", orderBy: "code", copyCols: ["name", "description", "priority", "mode", "batching", "batch_window", "check_stock", "scope", "is_active"] });

export default function PlanningPreset() {
  return (
    <MasterScreen
      tableName="planning_preset" title="Planning Preset" subtitle="one-click Auto-Planner option sets"
      icon={TuneRounded} service={service} codeField="code" nameField="name"
      searchFields={["code", "name", "description"]}
      filters={[{ key: "mode", label: "Mode", options: MODE, test: (r, v) => r.mode === v }]}
      sortOptions={[{ value: "code", label: "Code", compare: (a, b) => String(a.code).localeCompare(String(b.code)) }]}
      emptyForm={{ code: "", name: "", description: "", priority: "due_date", mode: "forward", batching: false, batch_window: 7, check_stock: "warn", scope: "pending", is_active: true }}
      formFields={[
        { key: "code", label: "Code", sm: 4 },
        { key: "name", label: "Name", sm: 8 },
        { key: "description", label: "Description", type: "textarea", sm: 12 },
        { key: "priority", label: "Priority", type: "select", options: PRIORITY, sm: 6 },
        { key: "mode", label: "Mode", type: "select", options: MODE, sm: 6 },
        { key: "check_stock", label: "Stock check", type: "select", options: STOCK, sm: 6 },
        { key: "scope", label: "Scope", type: "select", options: SCOPE, sm: 6 },
        { key: "batching", label: "Batch similar specs", type: "switch", sm: 6 },
        { key: "batch_window", label: "Batch window (days)", type: "number", sm: 6 },
      ]}
      renderCardBody={(r) => (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={(PRIORITY.find((p) => p.value === r.priority) || {}).label || r.priority} />
          <Chip size="small" variant="outlined" label={r.mode} sx={{ textTransform: "capitalize" }} />
          {r.batching && <Chip size="small" color="info" variant="outlined" label={`batch ${r.batch_window}d`} />}
          <Chip size="small" color={r.check_stock === "block" ? "error" : r.check_stock === "warn" ? "warning" : "default"} variant="outlined" label={r.check_stock} />
        </Stack>
      )}
      columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name" },
        { key: "priority", label: "Priority" },
        { key: "mode", label: "Mode" },
        { key: "batching", label: "Batch", render: (r) => (r.batching ? `${r.batch_window}d` : "—") },
        { key: "check_stock", label: "Stock" },
      ]}
    />
  );
}
