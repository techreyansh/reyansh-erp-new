import React, { useMemo } from "react";
import { Box, Paper, Typography, Avatar, Stack, Chip, useTheme, alpha } from "@mui/material";

/**
 * Reporting hierarchy / org chart. Builds parent→children from each employee's
 * `reporting_manager` (text = manager's name) matched to another employee's
 * full_name (or reporting_manager_id when present). Roots = no/unknown manager.
 */
function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function NodeCard({ emp, onOpen, theme }) {
  const active = emp.is_active !== false && !/inactive/i.test(emp.status || "");
  return (
    <Paper
      variant="outlined"
      onClick={() => onOpen?.(emp)}
      sx={{
        p: 1.25, borderRadius: 2, minWidth: 180, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 1.25,
        transition: "all .15s", "&:hover": { boxShadow: 3, borderColor: theme.palette.primary.main },
      }}
    >
      <Avatar src={emp.profile_photo || undefined} sx={{ width: 36, height: 36, fontSize: 14, bgcolor: "primary.main" }}>
        {initials(emp.full_name)}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{emp.full_name || emp.email}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {emp.designation || emp.department || "—"}
        </Typography>
      </Box>
      <Box sx={{ ml: "auto", width: 8, height: 8, borderRadius: "50%", bgcolor: active ? "success.main" : "text.disabled" }} />
    </Paper>
  );
}

function TreeNode({ node, childrenMap, onOpen, theme, depth = 0 }) {
  const kids = childrenMap.get(node._key) || [];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
      <NodeCard emp={node} onOpen={onOpen} theme={theme} />
      {kids.length > 0 && (
        <Box sx={{ pl: 3, mt: 1, ml: 1.5, borderLeft: `2px solid ${alpha(theme.palette.divider, 0.8)}`,
                   display: "flex", flexDirection: "column", gap: 1.25 }}>
          {kids.map((k) => (
            <TreeNode key={k._key} node={k} childrenMap={childrenMap} onOpen={onOpen} theme={theme} depth={depth + 1} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function EmployeeOrgChart({ employees = [], onOpenEmployee }) {
  const theme = useTheme();
  const { roots, childrenMap } = useMemo(() => {
    const list = (Array.isArray(employees) ? employees : []).map((e) => ({ ...e, _key: e.id || e.email }));
    const byName = new Map();
    const byEmail = new Map();
    list.forEach((e) => {
      if (e.full_name) byName.set(String(e.full_name).trim().toLowerCase(), e);
      if (e.email) byEmail.set(String(e.email).trim().toLowerCase(), e);
    });
    const cmap = new Map();
    const roots = [];
    list.forEach((e) => {
      const mgrRaw = String(e.reporting_manager || "").trim().toLowerCase();
      const mgr = e.reporting_manager_id
        ? list.find((x) => x.id === e.reporting_manager_id)
        : (byName.get(mgrRaw) || byEmail.get(mgrRaw));
      if (mgr && mgr._key !== e._key) {
        if (!cmap.has(mgr._key)) cmap.set(mgr._key, []);
        cmap.get(mgr._key).push(e);
      } else {
        roots.push(e);
      }
    });
    // CEO-ish roots first
    roots.sort((a, b) => (/(ceo|director|management)/i.test(b.designation || b.department || "") ? 1 : 0)
                        - (/(ceo|director|management)/i.test(a.designation || a.department || "") ? 1 : 0));
    return { roots, childrenMap: cmap };
  }, [employees]);

  if (!roots.length) {
    return (
      <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
        <Typography color="text.secondary">No reporting structure yet — set "Reporting manager" on employees to build the org chart.</Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Organization Chart</Typography>
        <Chip size="small" label={`${employees.length} people`} />
      </Stack>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 2, overflowX: "auto" }}>
        <Stack spacing={2.5}>
          {roots.map((r) => (
            <TreeNode key={r._key} node={r} childrenMap={childrenMap} onOpen={onOpenEmployee} theme={theme} />
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}
