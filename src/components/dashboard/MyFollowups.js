import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import {
  CheckCircleOutline,
  EventNoteOutlined,
  EventRepeatOutlined,
  SwapHorizOutlined,
} from "@mui/icons-material";
import {
  completeFollowup,
  getCompany,
  getMyFollowups,
  moveFollowupStage,
  rescheduleFollowup,
  STAGES,
  STAGE_LABELS,
} from "../../services/crmPipelineService";
import Client360 from "../crm/Client360";

const CRM_PATH = "/crm-pipeline";

/** Normalize a date value to a YYYY-MM-DD string for <input type="date">. */
function toDateInput(dateValue) {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

/** Local-midnight copy of a date (string or Date). */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Human-relative day label: "3 days ago" / "Today" / "in 2 days". */
function relativeDay(dateValue) {
  const today = startOfDay(new Date());
  const target = startOfDay(dateValue);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  return `in ${diff} days`;
}

function FollowupRow({ item, accent, onOpen, onDone, onReschedule, onStage, busy }) {
  const stageLabel = item.stage ? STAGE_LABELS[item.stage] || item.stage : null;
  const canStage = item.kind === "action" || !!item.pipelineId;
  // Stop the row's click-to-open from firing when using an action button.
  const guard = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 1,
        px: 1.25,
        py: 0.9,
        borderRadius: 1.5,
        cursor: "pointer",
        transition: "background-color 0.15s ease",
        "&:hover": { bgcolor: alpha(accent, 0.08) },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ minWidth: 0 }} noWrap>
          <Box component="span" sx={{ fontWeight: 700 }}>
            {item.company}
          </Box>
          <Box component="span" sx={{ color: "text.secondary" }}>
            {" · "}
            {item.label}
          </Box>
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
          <Typography variant="caption" sx={{ color: accent, fontWeight: 600 }}>
            {relativeDay(item.date)}
          </Typography>
          {stageLabel && (
            <Chip
              label={stageLabel}
              size="small"
              sx={{
                height: 18,
                fontSize: "0.62rem",
                fontWeight: 600,
                color: "text.secondary",
                bgcolor: "action.hover",
              }}
            />
          )}
        </Stack>
      </Box>

      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }}>
        {busy ? (
          <CircularProgress size={18} sx={{ mx: 1, color: accent }} />
        ) : (
          <>
            <Tooltip title="Mark done">
              <IconButton
                size="small"
                aria-label="Mark follow-up done"
                onClick={guard(onDone)}
                sx={{ color: "success.main", "&:hover": { bgcolor: (t) => alpha(t.palette.success.main, 0.12) } }}
              >
                <CheckCircleOutline fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reschedule">
              <IconButton
                size="small"
                aria-label="Reschedule follow-up"
                onClick={guard(onReschedule)}
                sx={{ color: "info.main", "&:hover": { bgcolor: (t) => alpha(t.palette.info.main, 0.12) } }}
              >
                <EventRepeatOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
            {canStage && (
              <Tooltip title="Change stage">
                <IconButton
                  size="small"
                  aria-label="Change pipeline stage"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStage(e.currentTarget);
                  }}
                  sx={{ color: "text.secondary", "&:hover": { bgcolor: "action.hover" } }}
                >
                  <SwapHorizOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}

function FollowupGroup({ emoji, title, items, accent, onOpen, onDone, onReschedule, onStage, busyId }) {
  if (!items.length) return null;
  return (
    <Box>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5, px: 1.25 }}>
        <Box component="span" sx={{ fontSize: "0.9rem", lineHeight: 1 }}>
          {emoji}
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: accent, letterSpacing: "0.02em" }}>
          {title}
        </Typography>
        <Chip
          label={items.length}
          size="small"
          sx={{
            height: 18,
            minWidth: 18,
            fontSize: "0.62rem",
            fontWeight: 700,
            color: accent,
            bgcolor: alpha(accent, 0.12),
          }}
        />
      </Stack>
      <Stack spacing={0.25}>
        {items.map((it) => {
          const rowKey = `${it.kind}-${it.id}`;
          return (
            <FollowupRow
              key={rowKey}
              item={it}
              accent={accent}
              onOpen={() => onOpen(it)}
              onDone={() => onDone(it)}
              onReschedule={() => onReschedule(it)}
              onStage={(anchorEl) => onStage(it, anchorEl)}
              busy={busyId === rowKey}
            />
          );
        })}
      </Stack>
    </Box>
  );
}

/**
 * "My Follow-ups" — surfaces the caller's planned CRM next-actions on the home
 * page so they can triage without opening the pipeline. Self-empties when there
 * is nothing scheduled, so it is safe to always render.
 */
function MyFollowups({ email }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Inline-action state.
  const [busyId, setBusyId] = useState(null);
  const [snack, setSnack] = useState(null); // { severity, message }
  const [reschedule, setReschedule] = useState(null); // { item, value }
  const [stageMenu, setStageMenu] = useState(null); // { item, anchorEl }
  const [selected, setSelected] = useState(null); // account row to open in the 360 drawer

  const rowKey = (it) => `${it.kind}-${it.id}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMyFollowups(email || "");
      setData(result);
    } catch (e) {
      // Degrade silently — the widget simply stays empty if CRM is unavailable.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    load();
  }, [load]);

  const openCrm = useCallback(() => navigate(CRM_PATH), [navigate]);

  // Open the company's full 360 profile right here — no jumping to the pipeline
  // and re-searching. Fetch the full account row first so operational tabs
  // (orders/invoices keyed by customer_code) load. Falls back to the pipeline
  // only if the follow-up has no linked account.
  const openCompany = useCallback(
    async (item) => {
      if (!item?.pipelineId) {
        navigate(CRM_PATH);
        return;
      }
      setBusyId(rowKey(item));
      try {
        const res = await getCompany(item.pipelineId);
        setSelected(res?.company || { id: item.pipelineId, company_name: item.company });
      } catch (e) {
        // Couldn't load the account — still open with what we have.
        setSelected({ id: item.pipelineId, company_name: item.company });
      } finally {
        setBusyId(null);
      }
    },
    [navigate],
  );

  // Run an action against the CRM, then refresh + toast the outcome.
  const runAction = useCallback(
    async (item, fn, successMessage) => {
      setBusyId(rowKey(item));
      try {
        await fn();
        const result = await getMyFollowups(email || "");
        setData(result);
        setSnack({ severity: "success", message: successMessage });
      } catch (e) {
        setSnack({ severity: "error", message: e?.message || "Action failed. Please try again." });
      } finally {
        setBusyId(null);
      }
    },
    [email],
  );

  const handleDone = useCallback(
    (item) => runAction(item, () => completeFollowup(item), "Follow-up marked done."),
    [runAction],
  );

  const openReschedule = useCallback((item) => {
    setReschedule({ item, value: toDateInput(item.date) });
  }, []);

  const confirmReschedule = useCallback(async () => {
    if (!reschedule?.value) return;
    const { item, value } = reschedule;
    setReschedule(null);
    await runAction(item, () => rescheduleFollowup(item, value), "Follow-up rescheduled.");
  }, [reschedule, runAction]);

  const openStageMenu = useCallback((item, anchorEl) => {
    setStageMenu({ item, anchorEl });
  }, []);

  const handleMoveStage = useCallback(
    async (toStage) => {
      const item = stageMenu?.item;
      setStageMenu(null);
      if (!item) return;
      await runAction(
        item,
        () => moveFollowupStage(item, toStage),
        `Moved to ${STAGE_LABELS[toStage] || toStage}.`,
      );
    },
    [stageMenu, runAction],
  );

  const accents = useMemo(
    () => ({
      overdue: theme.palette.error.main,
      today: theme.palette.warning.main,
      upcoming: theme.palette.info.main,
    }),
    [theme],
  );

  const total = data?.counts?.total || 0;

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 }, height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <EventNoteOutlined sx={{ fontSize: 20, color: "primary.main" }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            My Follow-ups
          </Typography>
          {!loading && total > 0 && (
            <Chip
              label={total}
              size="small"
              sx={{
                height: 20,
                fontWeight: 700,
                fontSize: "0.65rem",
                color: "primary.main",
                bgcolor: alpha(theme.palette.primary.main, 0.12),
              }}
            />
          )}
        </Stack>
        <Typography
          variant="caption"
          onClick={openCrm}
          sx={{ color: "primary.main", fontWeight: 700, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
        >
          Open pipeline
        </Typography>
      </Stack>

      {loading ? (
        <Stack spacing={1} sx={{ px: 1.25 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={36} />
          ))}
        </Stack>
      ) : total === 0 ? (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", py: 3, px: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            No follow-ups scheduled — plan next actions in the Sales Pipeline.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          <FollowupGroup
            emoji="🔴"
            title="Overdue"
            items={data.overdue}
            accent={accents.overdue}
            onOpen={openCompany}
            onDone={handleDone}
            onReschedule={openReschedule}
            onStage={openStageMenu}
            busyId={busyId}
          />
          <FollowupGroup
            emoji="🟡"
            title="Today"
            items={data.today}
            accent={accents.today}
            onOpen={openCompany}
            onDone={handleDone}
            onReschedule={openReschedule}
            onStage={openStageMenu}
            busyId={busyId}
          />
          <FollowupGroup
            emoji="🔵"
            title="Upcoming (next 7 days)"
            items={data.upcoming}
            accent={accents.upcoming}
            onOpen={openCompany}
            onDone={handleDone}
            onReschedule={openReschedule}
            onStage={openStageMenu}
            busyId={busyId}
          />
        </Stack>
      )}

      {/* Reschedule dialog */}
      <Dialog open={!!reschedule} onClose={() => setReschedule(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Reschedule follow-up</DialogTitle>
        <DialogContent>
          {reschedule && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {reschedule.item.company} · {reschedule.item.label}
            </Typography>
          )}
          <TextField
            type="date"
            label="New date"
            value={reschedule?.value || ""}
            onChange={(e) => setReschedule((r) => (r ? { ...r, value: e.target.value } : r))}
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Typography
            variant="button"
            onClick={() => setReschedule(null)}
            sx={{ color: "text.secondary", cursor: "pointer", px: 1, "&:hover": { color: "text.primary" } }}
          >
            Cancel
          </Typography>
          <Typography
            variant="button"
            onClick={confirmReschedule}
            sx={{
              color: reschedule?.value ? "primary.main" : "text.disabled",
              cursor: reschedule?.value ? "pointer" : "default",
              px: 1,
              "&:hover": { textDecoration: reschedule?.value ? "underline" : "none" },
            }}
          >
            Save
          </Typography>
        </DialogActions>
      </Dialog>

      {/* Stage menu */}
      <Menu
        open={!!stageMenu}
        anchorEl={stageMenu?.anchorEl || null}
        onClose={() => setStageMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {STAGES.map((s) => (
          <MenuItem
            key={s.key}
            selected={stageMenu?.item?.stage === s.key}
            onClick={() => handleMoveStage(s.key)}
            sx={{ fontSize: "0.8rem", fontWeight: stageMenu?.item?.stage === s.key ? 700 : 400 }}
          >
            {s.label}
          </MenuItem>
        ))}
      </Menu>

      {/* Full company 360 — opens directly from a follow-up, no pipeline detour */}
      {selected && (
        <Client360
          account={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
          notify={(message, severity = "success") => setSnack({ severity, message })}
        />
      )}

      {/* Outcome toast */}
      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {snack ? (
          <Alert onClose={() => setSnack(null)} severity={snack.severity} variant="filled" sx={{ width: "100%" }}>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Paper>
  );
}

export default MyFollowups;
