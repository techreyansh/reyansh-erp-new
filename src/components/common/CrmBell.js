import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  IconButton, Badge, Menu, Box, Typography, Tooltip, Chip, Divider,
  ListItemButton, ListItemText, useTheme,
} from "@mui/material";
import { GroupAddOutlined } from "@mui/icons-material";
import { useAuth } from "../../context/AuthContext";
import { listMyCrmNotifications, markCrmNotificationsRead } from "../../services/crmPipelineService";

const REFRESH_MS = 60 * 1000;
const MAX_ITEMS = 10;

function formatWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * CRM accountability bell: in-app notifications when you're made the action
 * owner of a next action, or added as a collaborator. Sits beside TaskBell.
 */
const CrmBell = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [anchorEl, setAnchorEl] = useState(null);
  const [items, setItems] = useState([]);

  const subtleHoverBg =
    theme.palette.mode === "dark" ? "rgba(148, 163, 184, 0.12)" : theme.palette.grey[100];

  const load = useCallback(async () => {
    if (!user?.email) { setItems([]); return; }
    const data = await listMyCrmNotifications().catch(() => null);
    if (Array.isArray(data)) setItems(data);
  }, [user?.email]);

  useEffect(() => {
    if (!user?.email) { setItems([]); return undefined; }
    let active = true;
    const run = async () => {
      const data = await listMyCrmNotifications().catch(() => null);
      if (active && Array.isArray(data)) setItems(data);
    };
    run();
    const id = setInterval(run, REFRESH_MS);
    return () => { active = false; clearInterval(id); };
  }, [user?.email]);

  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  const open = Boolean(anchorEl);

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget);
    load();
    // Mark all read on open, optimistically clear the badge.
    if (unread > 0) {
      markCrmNotificationsRead().catch(() => {});
      setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    }
  };
  const handleClose = () => setAnchorEl(null);
  const goToWorklist = () => { handleClose(); navigate("/crm/worklist"); };

  return (
    <>
      <Tooltip title="CRM assignments" placement="bottom">
        <IconButton
          color="inherit"
          size="small"
          onClick={handleOpen}
          aria-label={unread > 0 ? `CRM assignments, ${unread} new` : "CRM assignments"}
          sx={{
            color: theme.palette.text.secondary,
            "&:hover": { backgroundColor: subtleHoverBg, color: theme.palette.text.primary },
          }}
        >
          <Badge
            color="error"
            badgeContent={unread}
            invisible={unread === 0}
            overlap="circular"
            sx={{ "& .MuiBadge-badge": { fontSize: "0.65rem", height: 16, minWidth: 16 } }}
          >
            <GroupAddOutlined sx={{ fontSize: 20 }} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            mt: 1, width: 340, maxWidth: "90vw",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
            borderRadius: 2, border: `1px solid ${theme.palette.divider}`,
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>CRM assignments</Typography>
        </Box>
        <Divider />

        {items.length === 0 ? (
          <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
            <GroupAddOutlined sx={{ fontSize: 36, color: theme.palette.text.disabled, mb: 1 }} />
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
              Nothing assigned to you yet.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ maxHeight: 360, overflow: "auto", py: 0.5 }}>
            {items.slice(0, MAX_ITEMS).map((n) => (
              <ListItemButton
                key={n.id}
                onClick={goToWorklist}
                sx={{ px: 2, py: 1, alignItems: "flex-start", "&:hover": { backgroundColor: subtleHoverBg } }}
              >
                <ListItemText
                  primary={
                    <Typography variant="body2" sx={{ fontWeight: n.read_at ? 500 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {n.title || "CRM update"}
                    </Typography>
                  }
                  secondary={
                    <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                      <Chip
                        label={n.type === "next_action_assigned" ? "Assigned" : "Collaborating"}
                        size="small"
                        sx={{ height: 18, fontSize: "0.65rem", fontWeight: 700, "& .MuiChip-label": { px: 0.75 } }}
                        color={n.type === "next_action_assigned" ? "primary" : "default"}
                      />
                      <Typography component="span" variant="caption" sx={{ color: theme.palette.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {n.body || ""} {formatWhen(n.created_at) && `· ${formatWhen(n.created_at)}`}
                      </Typography>
                    </Box>
                  }
                />
              </ListItemButton>
            ))}
          </Box>
        )}

        <Divider />
        <Box sx={{ p: 1 }}>
          <ListItemButton onClick={goToWorklist} sx={{ justifyContent: "center", borderRadius: 1.5, py: 1, "&:hover": { backgroundColor: subtleHoverBg } }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: theme.palette.primary.main }}>
              Go to Daily Worklist
            </Typography>
          </ListItemButton>
        </Box>
      </Menu>
    </>
  );
};

export default CrmBell;
