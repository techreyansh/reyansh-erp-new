import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  IconButton, Badge, Menu, Box, Typography, Tooltip, Chip, Divider,
  ListItemButton, ListItemText, useTheme,
} from "@mui/material";
import { NotificationsOutlined } from "@mui/icons-material";
import { useAuth } from "../../context/AuthContext";
import { listMyTasks, isTaskOverdue } from "../../services/taskService";
import { listMyCrmNotifications, markCrmNotificationsRead } from "../../services/crmPipelineService";

const REFRESH_MS = 60 * 1000;
const MAX = 6;
const NEW_WINDOW_DAYS = 3;

const atMidnight = (v) => { const d = new Date(v); d.setHours(0, 0, 0, 0); return d; };
function isDueToday(t) {
  if (!t?.due_date || t.task_status === "completed") return false;
  return atMidnight(t.due_date).getTime() === atMidnight(new Date()).getTime();
}
function isNewlyAssigned(t) {
  if (t?.task_status !== "pending" || !t?.created_at) return false;
  return new Date(t.created_at).getTime() >= Date.now() - NEW_WINDOW_DAYS * 86400000;
}
const isActionableTask = (t) => t && t.task_status !== "completed" && (isTaskOverdue(t) || isDueToday(t) || isNewlyAssigned(t));
function classifyTask(t) { if (isTaskOverdue(t)) return "overdue"; if (isDueToday(t)) return "today"; return "new"; }
const fmtDate = (v) => { if (!v) return ""; const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

/**
 * Unified notification bell: Tasks (from taskService) + CRM assignments
 * (crm_notification). One badge = actionable tasks + unread CRM; the menu has
 * a Tasks section and a CRM section. Replaces the separate TaskBell + CrmBell.
 */
export default function NotificationBell() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [anchorEl, setAnchorEl] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [crm, setCrm] = useState([]);

  const subtleHoverBg = theme.palette.mode === "dark" ? "rgba(148,163,184,0.12)" : theme.palette.grey[100];

  const loadAll = useCallback(async () => {
    if (!user?.email) { setTasks([]); setCrm([]); return; }
    const [t, c] = await Promise.all([
      listMyTasks(user.email).catch(() => null),
      listMyCrmNotifications().catch(() => null),
    ]);
    if (Array.isArray(t)) setTasks(t);
    if (Array.isArray(c)) setCrm(c);
  }, [user?.email]);

  useEffect(() => {
    if (!user?.email) { setTasks([]); setCrm([]); return undefined; }
    let active = true;
    const run = () => loadAll();
    run();
    const id = setInterval(() => { if (active) run(); }, REFRESH_MS);
    return () => { active = false; clearInterval(id); };
  }, [user?.email, loadAll]);

  const actionableTasks = useMemo(() => {
    const order = { overdue: 0, today: 1, new: 2 };
    return tasks.filter(isActionableTask).sort((a, b) => order[classifyTask(a)] - order[classifyTask(b)]);
  }, [tasks]);
  const crmUnread = useMemo(() => crm.filter((n) => !n.read_at).length, [crm]);
  const total = actionableTasks.length + crmUnread;
  const open = Boolean(anchorEl);

  const handleOpen = (e) => {
    setAnchorEl(e.currentTarget);
    loadAll();
    if (crmUnread > 0) {
      markCrmNotificationsRead().catch(() => {});
      setCrm((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    }
  };
  const close = () => setAnchorEl(null);
  const go = (path) => { close(); navigate(path); };

  const taskChip = {
    overdue: { label: "Overdue", color: theme.palette.error.main, bg: theme.palette.error.lighter },
    today: { label: "Due today", color: theme.palette.warning.main, bg: theme.palette.warning.lighter },
    new: { label: "New", color: theme.palette.info.main, bg: theme.palette.info.lighter },
  };

  return (
    <>
      <Tooltip title="Notifications" placement="bottom">
        <IconButton color="inherit" size="small" onClick={handleOpen}
          aria-label={total > 0 ? `Notifications, ${total} need attention` : "Notifications"}
          sx={{ color: theme.palette.text.secondary, "&:hover": { backgroundColor: subtleHoverBg, color: theme.palette.text.primary } }}>
          <Badge color="error" badgeContent={total} invisible={total === 0} overlap="circular"
            sx={{ "& .MuiBadge-badge": { fontSize: "0.65rem", height: 16, minWidth: 16 } }}>
            <NotificationsOutlined sx={{ fontSize: 20 }} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu anchorEl={anchorEl} open={open} onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{ sx: { mt: 1, width: 360, maxWidth: "92vw", borderRadius: 2, border: `1px solid ${theme.palette.divider}`, boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)" } }}>

        {/* Tasks */}
        <Box sx={{ px: 2, py: 1.25, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Tasks</Typography>
          {actionableTasks.length > 0 && <Chip label={actionableTasks.length} size="small" sx={{ height: 20, fontWeight: 700, color: theme.palette.error.main, backgroundColor: theme.palette.error.lighter }} />}
        </Box>
        <Divider />
        {actionableTasks.length === 0 ? (
          <Box sx={{ px: 2, py: 2, textAlign: "center" }}><Typography variant="caption" color="text.secondary">No tasks need attention.</Typography></Box>
        ) : (
          <Box sx={{ maxHeight: 200, overflow: "auto", py: 0.5 }}>
            {actionableTasks.slice(0, MAX).map((t) => {
              const ch = taskChip[classifyTask(t)];
              return (
                <ListItemButton key={t.id} onClick={() => go("/my-tasks")} sx={{ px: 2, py: 1, alignItems: "flex-start", "&:hover": { backgroundColor: subtleHoverBg } }}>
                  <ListItemText
                    primary={<Typography variant="body2" sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || "Untitled task"}</Typography>}
                    secondary={<Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                      <Chip label={ch.label} size="small" sx={{ height: 18, fontSize: "0.65rem", fontWeight: 700, color: ch.color, backgroundColor: ch.bg, "& .MuiChip-label": { px: 0.75 } }} />
                      <Typography component="span" variant="caption" color="text.secondary">{fmtDate(t.due_date)}</Typography>
                    </Box>} />
                </ListItemButton>
              );
            })}
          </Box>
        )}

        {/* CRM assignments */}
        <Box sx={{ px: 2, py: 1.25, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>CRM assignments</Typography>
        </Box>
        <Divider />
        {crm.length === 0 ? (
          <Box sx={{ px: 2, py: 2, textAlign: "center" }}><Typography variant="caption" color="text.secondary">Nothing assigned to you yet.</Typography></Box>
        ) : (
          <Box sx={{ maxHeight: 200, overflow: "auto", py: 0.5 }}>
            {crm.slice(0, MAX).map((n) => (
              <ListItemButton key={n.id} onClick={() => go("/crm/worklist")} sx={{ px: 2, py: 1, alignItems: "flex-start", "&:hover": { backgroundColor: subtleHoverBg } }}>
                <ListItemText
                  primary={<Typography variant="body2" sx={{ fontWeight: n.read_at ? 500 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title || "CRM update"}</Typography>}
                  secondary={<Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                    <Chip label={n.type === "next_action_assigned" ? "Assigned" : n.type === "collection_assigned" ? "Collection" : "Collaborating"} size="small" color={n.type === "next_action_assigned" ? "primary" : "default"} sx={{ height: 18, fontSize: "0.65rem", fontWeight: 700, "& .MuiChip-label": { px: 0.75 } }} />
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.body || ""} {fmtDate(n.created_at) && `· ${fmtDate(n.created_at)}`}</Typography>
                  </Box>} />
              </ListItemButton>
            ))}
          </Box>
        )}

        <Divider />
        <Box sx={{ p: 1, display: "flex", gap: 1 }}>
          <ListItemButton onClick={() => go("/my-tasks")} sx={{ justifyContent: "center", borderRadius: 1.5, py: 0.75 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: theme.palette.primary.main }}>All tasks</Typography>
          </ListItemButton>
          <ListItemButton onClick={() => go("/crm/worklist")} sx={{ justifyContent: "center", borderRadius: 1.5, py: 0.75 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: theme.palette.primary.main }}>Daily Worklist</Typography>
          </ListItemButton>
        </Box>
      </Menu>
    </>
  );
}
