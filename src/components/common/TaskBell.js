import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  IconButton,
  Badge,
  Menu,
  Box,
  Typography,
  Tooltip,
  Chip,
  Divider,
  ListItemButton,
  ListItemText,
  useTheme,
} from "@mui/material";
import { NotificationsOutlined } from "@mui/icons-material";
import { useAuth } from "../../context/AuthContext";
import { listMyTasks, isTaskOverdue } from "../../services/taskService";

const REFRESH_MS = 60 * 1000;
const MAX_ITEMS = 8;
/** A pending task counts as "new" if it was assigned within this many days. */
const NEW_WINDOW_DAYS = 3;

/** Normalize a task to a YYYY-MM-DD-comparable Date at local midnight. */
function atMidnight(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isDueToday(task) {
  if (!task?.due_date) return false;
  if (task.task_status === "completed") return false;
  const due = atMidnight(task.due_date);
  const today = atMidnight(new Date());
  return due.getTime() === today.getTime();
}

function isNewlyAssigned(task) {
  if (task?.task_status !== "pending") return false;
  if (!task?.created_at) return false;
  const created = new Date(task.created_at).getTime();
  const cutoff = Date.now() - NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return created >= cutoff;
}

/** An actionable task: not completed AND (overdue OR due today OR newly-assigned pending). */
function isActionable(task) {
  if (!task || task.task_status === "completed") return false;
  return isTaskOverdue(task) || isDueToday(task) || isNewlyAssigned(task);
}

/** Classify for the chip. Overdue takes priority, then due-today, then new. */
function classify(task) {
  if (isTaskOverdue(task)) return "overdue";
  if (isDueToday(task)) return "today";
  return "new";
}

function formatDueDate(value) {
  if (!value) return "No due date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No due date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TaskBell = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [anchorEl, setAnchorEl] = useState(null);
  const [tasks, setTasks] = useState([]);

  const subtleHoverBg =
    theme.palette.mode === "dark" ? "rgba(148, 163, 184, 0.12)" : theme.palette.grey[100];

  const loadTasks = useCallback(async () => {
    if (!user?.email) {
      setTasks([]);
      return;
    }
    try {
      const data = await listMyTasks(user.email);
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("TaskBell: could not load tasks", err);
      }
    }
  }, [user?.email]);

  // Load on mount (and whenever the user changes), then poll every 60s.
  useEffect(() => {
    if (!user?.email) {
      setTasks([]);
      return undefined;
    }
    let active = true;
    const run = async () => {
      const data = await listMyTasks(user.email).catch((err) => {
        if (process.env.NODE_ENV === "development") {
          console.warn("TaskBell: could not load tasks", err);
        }
        return null;
      });
      if (active && Array.isArray(data)) setTasks(data);
    };
    run();
    const id = setInterval(run, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [user?.email]);

  const actionable = useMemo(() => tasks.filter(isActionable), [tasks]);

  // Sort: overdue first, then due-today, then new. Within a bucket, soonest due first.
  const sorted = useMemo(() => {
    const order = { overdue: 0, today: 1, new: 2 };
    return [...actionable].sort((a, b) => {
      const ka = order[classify(a)];
      const kb = order[classify(b)];
      if (ka !== kb) return ka - kb;
      const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return da - db;
    });
  }, [actionable]);

  const count = actionable.length;
  const open = Boolean(anchorEl);

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget);
    // Refresh on open so the menu reflects the latest state.
    loadTasks();
  };
  const handleClose = () => setAnchorEl(null);

  const goToTasks = () => {
    handleClose();
    navigate("/my-tasks");
  };

  const chipStyles = {
    overdue: {
      label: "Overdue",
      color: theme.palette.error.main,
      bg: theme.palette.error.lighter,
    },
    today: {
      label: "Due today",
      color: theme.palette.warning.main,
      bg: theme.palette.warning.lighter,
    },
    new: {
      label: "New",
      color: theme.palette.info.main,
      bg: theme.palette.info.lighter,
    },
  };

  return (
    <>
      <Tooltip title="Task notifications" placement="bottom">
        <IconButton
          color="inherit"
          size="small"
          onClick={handleOpen}
          aria-label={
            count > 0
              ? `Task notifications, ${count} need attention`
              : "Task notifications"
          }
          sx={{
            color: theme.palette.text.secondary,
            "&:hover": {
              backgroundColor: subtleHoverBg,
              color: theme.palette.text.primary,
            },
          }}
        >
          <Badge
            color="error"
            badgeContent={count}
            invisible={count === 0}
            overlap="circular"
            sx={{
              "& .MuiBadge-badge": {
                fontSize: "0.65rem",
                height: 16,
                minWidth: 16,
              },
            }}
          >
            <NotificationsOutlined sx={{ fontSize: 20 }} />
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
            mt: 1,
            width: 340,
            maxWidth: "90vw",
            boxShadow:
              "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            borderRadius: 2,
            border: `1px solid ${theme.palette.divider}`,
          },
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: theme.palette.text.primary }}>
            Tasks needing attention
          </Typography>
          {count > 0 && (
            <Chip
              label={count}
              size="small"
              sx={{
                height: 20,
                fontSize: "0.7rem",
                fontWeight: 700,
                color: theme.palette.error.main,
                backgroundColor: theme.palette.error.lighter,
              }}
            />
          )}
        </Box>
        <Divider />

        {sorted.length === 0 ? (
          <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
            <NotificationsOutlined
              sx={{ fontSize: 36, color: theme.palette.text.disabled, mb: 1 }}
            />
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
              No tasks need attention.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ maxHeight: 360, overflow: "auto", py: 0.5 }}>
            {sorted.slice(0, MAX_ITEMS).map((task) => {
              const kind = classify(task);
              const chip = chipStyles[kind];
              return (
                <ListItemButton
                  key={task.id}
                  onClick={goToTasks}
                  sx={{
                    px: 2,
                    py: 1,
                    alignItems: "flex-start",
                    "&:hover": { backgroundColor: subtleHoverBg },
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 500,
                          color: theme.palette.text.primary,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {task.title || "Untitled task"}
                      </Typography>
                    }
                    secondary={
                      <Box
                        component="span"
                        sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}
                      >
                        <Chip
                          label={chip.label}
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: "0.65rem",
                            fontWeight: 700,
                            color: chip.color,
                            backgroundColor: chip.bg,
                            "& .MuiChip-label": { px: 0.75 },
                          }}
                        />
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{ color: theme.palette.text.secondary }}
                        >
                          {formatDueDate(task.due_date)}
                        </Typography>
                      </Box>
                    }
                    disableTypography={false}
                  />
                </ListItemButton>
              );
            })}
          </Box>
        )}

        <Divider />
        <Box sx={{ p: 1 }}>
          <ListItemButton
            onClick={goToTasks}
            sx={{
              justifyContent: "center",
              borderRadius: 1.5,
              py: 1,
              "&:hover": { backgroundColor: subtleHoverBg },
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: theme.palette.primary.main }}
            >
              View all tasks
            </Typography>
          </ListItemButton>
        </Box>
      </Menu>
    </>
  );
};

export default TaskBell;
