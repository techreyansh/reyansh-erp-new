// Reusable change-history drawer for any master record. Shows who/when/action
// and a field-level Old → New diff from master_audit_log. (UX overhaul Wave 0.)
import React, { useEffect, useState } from "react";
import {
  Drawer, Box, Stack, Typography, IconButton, Chip, Divider, CircularProgress, Tooltip,
} from "@mui/material";
import { CloseRounded, HistoryRounded } from "@mui/icons-material";
import { listAudit, diffRows } from "../../../services/masterAuditService";

const ACTION_COLOR = { insert: "success", update: "info", archive: "warning", restore: "info", delete: "error" };
const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const val = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

export default function MasterHistoryDrawer({ open, onClose, tableName, recordId, title }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!open || !recordId) return;
    let active = true;
    setLoading(true);
    listAudit(tableName, recordId).then((r) => { if (active) { setRows(r); setLoading(false); } });
    return () => { active = false; };
  }, [open, tableName, recordId]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <HistoryRounded color="action" />
            <Box>
              <Typography sx={{ fontWeight: 800 }}>Change history</Typography>
              {title && <Typography variant="caption" color="text.secondary">{title}</Typography>}
            </Box>
          </Stack>
          <IconButton onClick={onClose} size="small"><CloseRounded /></IconButton>
        </Stack>
        <Divider sx={{ mb: 1.5 }} />
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress size={24} /></Box>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
            No changes recorded yet.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {rows.map((r) => {
              const changes = r.action === "update" ? diffRows(r.old_value, r.new_value).slice(0, 8) : [];
              return (
                <Box key={r.id} sx={{ borderLeft: 3, borderColor: `${ACTION_COLOR[r.action] || "grey"}.main`, pl: 1.5, py: 0.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                    <Chip size="small" color={ACTION_COLOR[r.action] || "default"} label={r.action} />
                    <Typography variant="caption" color="text.secondary">{fmt(r.changed_at)}</Typography>
                    {r.changed_by_email && <Typography variant="caption" color="text.secondary">· {r.changed_by_email}</Typography>}
                  </Stack>
                  {r.reason && <Typography variant="caption" sx={{ display: "block", fontStyle: "italic", mt: 0.25 }}>“{r.reason}”</Typography>}
                  {changes.length > 0 && (
                    <Box sx={{ mt: 0.5 }}>
                      {changes.map((c) => (
                        <Typography key={c.field} variant="caption" sx={{ display: "block" }}>
                          <b>{c.field}</b>: <Tooltip title="old"><span style={{ opacity: 0.7 }}>{val(c.from)}</span></Tooltip> → {val(c.to)}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}
