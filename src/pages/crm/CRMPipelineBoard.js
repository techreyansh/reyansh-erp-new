import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useSearchParams } from "react-router-dom";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import PersonIcon from "@mui/icons-material/Person";
import GroupIcon from "@mui/icons-material/Group";
import ScheduleIcon from "@mui/icons-material/Schedule";
import PlaceIcon from "@mui/icons-material/Place";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import CallIcon from "@mui/icons-material/Call";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import EmailIcon from "@mui/icons-material/Email";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import DescriptionIcon from "@mui/icons-material/Description";
import SummarizeIcon from "@mui/icons-material/Summarize";
import CrmReportDialog from "../../components/crm/CrmReportDialog";

import { inrCompact, inrFull } from "../../components/common/kit/format";
import {
  PROSPECT_STAGES,
  CLIENT_STAGES,
  CYCLE_STAGES,
  STAGE_LABELS,
  PROSPECT_STAGE_LABELS,
  CLIENT_STAGE_LABELS,
  CYCLE_STAGE_LABELS,
  ACTIVITY_TYPES,
  SOURCES,
  listProspects,
  listClients,
  listRecurring,
  listOrderCycles,
  getCompany,
  moveStage,
  moveProspectStage,
  updateClientStage,
  moveOrderCycle,
  addActivity,
  updateActivity,
  deleteActivity,
  markActivityComplete,
  duplicateActivity,
  listContacts,
  addContact,
  updateContact,
  deleteContact,
  convertToClient,
  assignOwner,
  addCompany,
  updateCompany,
  listAssignableUsers,
  getCurrentUserEmail,
  listAllCollaborators,
  addCollaborator,
  removeCollaborator,
} from "../../services/crmPipelineService";
import ppcService from "../../services/ppcService";

/* ----------------------------------------------------------------------- */
/* Helpers                                                                  */
/* ----------------------------------------------------------------------- */

const daysSince = (ts) => {
  if (!ts) return null;
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
};

const isPast = (dateStr) => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
};

const fmtDate = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtDateTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const initials = (email) => {
  if (!email) return "?";
  return String(email).trim().slice(0, 2).toUpperCase();
};

/* Build a lowercased email→user lookup map from the assignable-users list. */
const buildUserMap = (users) => {
  const map = new Map();
  (users || []).forEach((u) => {
    if (u && u.email) map.set(String(u.email).toLowerCase(), u);
  });
  return map;
};

/* Resolve an owner email to a human display name. Falls back to the email's
   local-part if the user isn't in the map (or the map hasn't loaded yet). */
const ownerLabel = (email, userMap) => {
  if (!email) return "";
  const u = userMap && userMap.get(String(email).toLowerCase());
  if (u && u.full_name) return u.full_name;
  return String(email).split("@")[0];
};

/* Label for an assignable user in the owner picker. */
const userOptionLabel = (u) => {
  if (!u) return "";
  if (u.full_name) {
    return u.department ? `${u.full_name} — ${u.department}` : u.full_name;
  }
  return u.email || "";
};

/* Small collaborator chips for cards: up to 3 names + "+N" overflow. Renders
   nothing when there are no collaborators. stopPropagation so a chip click does
   not bubble up to open the drawer. */
function CollaboratorChips({ emails, userMap }) {
  const list = emails || [];
  if (list.length === 0) return null;
  const shown = list.slice(0, 3);
  const extra = list.length - shown.length;
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      onClick={(e) => e.stopPropagation()}
    >
      {shown.map((email) => (
        <Chip
          key={email}
          size="small"
          variant="outlined"
          color="secondary"
          icon={<GroupIcon sx={{ fontSize: 12 }} />}
          label={ownerLabel(email, userMap)}
          sx={{ height: 20, maxWidth: 120, "& .MuiChip-label": { px: 0.5, fontSize: 10.5 } }}
        />
      ))}
      {extra > 0 && (
        <Chip
          size="small"
          variant="outlined"
          color="secondary"
          label={`+${extra}`}
          sx={{ height: 20, "& .MuiChip-label": { px: 0.5, fontSize: 10.5, fontWeight: 700 } }}
        />
      )}
    </Stack>
  );
}

/* Lightweight lead score derived purely from stage progression (no extra table).
   Earlier stages = colder, later stages = hotter. Returns a % plus a Hot/Warm/Cold band. */
const leadScoreForStage = (stageKey) => {
  const idx = PROSPECT_STAGES.findIndex((s) => s.key === stageKey);
  if (idx < 0) return null;
  const denom = Math.max(1, PROSPECT_STAGES.length - 1);
  const pct = Math.round((idx / denom) * 100);
  let band = "Cold";
  let color = "default";
  if (pct >= 66) {
    band = "Hot";
    color = "error";
  } else if (pct >= 33) {
    band = "Warm";
    color = "warning";
  } else {
    band = "Cold";
    color = "info";
  }
  return { pct, band, color };
};

/* ----------------------------------------------------------------------- */
/* Card component (shared shape for board columns)                          */
/* ----------------------------------------------------------------------- */

function PipelineCard({ company, onOpen, onMove, onDragStart, onDragEnd, stages, currentStageKey, userMap, collaborators }) {
  const theme = useTheme();
  const [moveAnchor, setMoveAnchor] = useState(null);
  // Tracks whether a drag just occurred so the trailing click doesn't open the drawer.
  const draggedRef = React.useRef(false);
  const days = daysSince(company.stage_entered_at);
  const overdue = isPast(company.next_action_date);
  const score = leadScoreForStage(company.prospect_stage || company.stage);

  return (
    <Paper
      variant="outlined"
      draggable
      onDragStart={(e) => {
        draggedRef.current = true;
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(company.id));
        } catch {
          /* some browsers restrict dataTransfer access */
        }
        onDragStart?.(company.id, company.prospect_stage ?? company.stage);
      }}
      onDragEnd={() => {
        onDragEnd?.();
        // Reset the guard just after the click would have fired.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onClick={() => {
        if (draggedRef.current) return; // ignore the click that follows a drag
        onOpen(company.id);
      }}
      sx={{
        p: 1.25,
        borderRadius: 2,
        cursor: "grab",
        "&:active": { cursor: "grabbing" },
        transition: "border-color .15s ease, box-shadow .15s ease",
        "&:hover": {
          borderColor: alpha(theme.palette.primary.main, 0.5),
          boxShadow: `0 6px 18px -12px ${alpha(theme.palette.primary.main, 0.6)}`,
        },
      }}
    >
      <Stack spacing={0.75}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
          {company.company_name}
        </Typography>

        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          onClick={(e) => e.stopPropagation()}
        >
          {company.owner_email ? (
            <Chip
              size="small"
              icon={<PersonIcon sx={{ fontSize: 14 }} />}
              label={ownerLabel(company.owner_email, userMap)}
              sx={{ height: 22, maxWidth: 140, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }}
            />
          ) : (
            <Chip
              size="small"
              label="Unassigned"
              color="warning"
              variant="outlined"
              sx={{ height: 22, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }}
            />
          )}
          <CollaboratorChips emails={collaborators} userMap={userMap} />
          {company.value != null && Number(company.value) > 0 && (
            <Chip
              size="small"
              label={inrCompact(company.value)}
              color="primary"
              variant="outlined"
              sx={{ height: 22, "& .MuiChip-label": { px: 0.75, fontSize: 11, fontWeight: 700 } }}
            />
          )}
          {company.city && (
            <Chip
              size="small"
              icon={<PlaceIcon sx={{ fontSize: 12 }} />}
              label={company.city}
              variant="outlined"
              sx={{ height: 22, maxWidth: 120, "& .MuiChip-label": { px: 0.5, fontSize: 11 } }}
            />
          )}
          {score && (
            <Tooltip title={`Lead score ${score.pct}% (by stage)`}>
              <Chip
                size="small"
                label={`${score.band} · ${score.pct}%`}
                color={score.color}
                sx={{ height: 22, "& .MuiChip-label": { px: 0.75, fontSize: 11, fontWeight: 700 } }}
              />
            </Tooltip>
          )}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Tooltip title="Days in current stage">
            <Stack direction="row" spacing={0.25} alignItems="center">
              <ScheduleIcon sx={{ fontSize: 14, color: "text.secondary" }} />
              <Typography variant="caption" color="text.secondary">
                {days == null ? "—" : `${days}d`}
              </Typography>
            </Stack>
          </Tooltip>
          {company.next_action_date && (
            <Typography
              variant="caption"
              sx={{ fontWeight: overdue ? 700 : 400 }}
              color={overdue ? "error.main" : "text.secondary"}
            >
              {fmtDate(company.next_action_date)}
            </Typography>
          )}
        </Stack>

        <Stack direction="row" spacing={0.5} alignItems="center">
          <Button
            size="small"
            variant="text"
            endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
            onClick={(e) => {
              e.stopPropagation();
              setMoveAnchor(e.currentTarget);
            }}
            sx={{ fontSize: 11, py: 0.25, minWidth: 0 }}
          >
            Move
          </Button>
        </Stack>
      </Stack>

      <StageMoveMenu
        anchorEl={moveAnchor}
        stages={stages}
        currentStageKey={currentStageKey}
        onClose={() => setMoveAnchor(null)}
        onPick={(toStage) => {
          setMoveAnchor(null);
          onMove(company.id, toStage);
        }}
      />
    </Paper>
  );
}

function StageMoveMenu({ anchorEl, stages, currentStageKey, onClose, onPick }) {
  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}>
      {stages.map((s) => (
        <MenuItem
          key={s.key}
          disabled={s.key === currentStageKey}
          onClick={() => onPick(s.key)}
          sx={{ fontSize: 13 }}
        >
          {s.label}
          {s.key === currentStageKey ? "  (current)" : ""}
        </MenuItem>
      ))}
    </Menu>
  );
}

/* ----------------------------------------------------------------------- */
/* Generic Kanban board                                                     */
/* ----------------------------------------------------------------------- */

function KanbanColumn({ stage, items, theme, renderCard, onDropCard }) {
  const total = items.reduce((sum, it) => sum + (Number(it.value || it.amount) || 0), 0);
  const [isOver, setIsOver] = useState(false);
  return (
    <Box
      onDragOver={(e) => {
        if (!onDropCard) return;
        e.preventDefault(); // allow the drop
        try {
          e.dataTransfer.dropEffect = "move";
        } catch {
          /* noop */
        }
        if (!isOver) setIsOver(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the column (not a child).
        if (!e.currentTarget.contains(e.relatedTarget)) setIsOver(false);
      }}
      onDrop={(e) => {
        if (!onDropCard) return;
        e.preventDefault();
        setIsOver(false);
        onDropCard(stage.key);
      }}
      sx={{
        minWidth: 280,
        width: 280,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        bgcolor: isOver
          ? alpha(theme.palette.primary.main, 0.1)
          : alpha(theme.palette.text.primary, 0.03),
        outline: isOver ? `2px dashed ${alpha(theme.palette.primary.main, 0.5)}` : "none",
        outlineOffset: -2,
        transition: "background-color .15s ease",
        borderRadius: 2,
        p: 1,
        maxHeight: "100%",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1, px: 0.5 }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
            {stage.label}
          </Typography>
          <Chip
            size="small"
            label={items.length}
            sx={{ height: 18, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }}
          />
        </Stack>
        {total > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {inrCompact(total)}
          </Typography>
        )}
      </Stack>
      <Stack spacing={1} sx={{ overflowY: "auto", flex: 1, pr: 0.5 }}>
        {items.length === 0 ? (
          <Box
            sx={{
              py: 3,
              textAlign: "center",
              color: "text.disabled",
              fontSize: 12,
              border: `1px dashed ${alpha(theme.palette.text.primary, 0.15)}`,
              borderRadius: 1.5,
            }}
          >
            Empty
          </Box>
        ) : (
          items.map((it) => <Box key={it.id}>{renderCard(it)}</Box>)
        )}
      </Stack>
    </Box>
  );
}

function BoardSkeleton() {
  return (
    <Stack direction="row" spacing={1.5} sx={{ overflowX: "auto", pb: 1 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Box key={i} sx={{ minWidth: 280, width: 280 }}>
          <Skeleton variant="text" width={120} height={28} />
          <Skeleton variant="rounded" height={90} sx={{ mb: 1, borderRadius: 2 }} />
          <Skeleton variant="rounded" height={90} sx={{ borderRadius: 2 }} />
        </Box>
      ))}
    </Stack>
  );
}

/* ----------------------------------------------------------------------- */
/* Add company dialog                                                       */
/* ----------------------------------------------------------------------- */

function AddCompanyDialog({ open, onClose, onSubmit, currentEmail }) {
  const empty = {
    company_name: "",
    contact_person: "",
    phone: "",
    email: "",
    source: "",
    value: "",
    stage: PROSPECT_STAGES[0].key,
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.company_name.trim()) {
      setErr("Company name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSubmit({
        company_name: form.company_name.trim(),
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        source: form.source || null,
        value: form.value === "" ? null : Number(form.value),
        prospect_stage: form.stage,
        account_type: "prospect",
        kind: "prospect",
        owner_email: currentEmail || null,
        is_active: true,
      });
      setForm(empty);
      onClose();
    } catch (e) {
      setErr(e?.message || "Failed to add company.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Add company</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField
            label="Company name"
            value={form.company_name}
            onChange={set("company_name")}
            required
            fullWidth
            autoFocus
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Contact person" value={form.contact_person} onChange={set("contact_person")} fullWidth />
            <TextField label="Phone" value={form.phone} onChange={set("phone")} fullWidth />
          </Stack>
          <TextField label="Email" type="email" value={form.email} onChange={set("email")} fullWidth />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label="Source" value={form.source} onChange={set("source")} fullWidth>
              <MenuItem value="">—</MenuItem>
              {SOURCES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Value (₹)"
              type="number"
              value={form.value}
              onChange={set("value")}
              fullWidth
            />
          </Stack>
          <TextField select label="Stage" value={form.stage} onChange={set("stage")} fullWidth>
            {PROSPECT_STAGES.map((s) => (
              <MenuItem key={s.key} value={s.key}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Add company"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------- */
/* Log & plan next-action dialog (shown after a stage move)                 */
/* ----------------------------------------------------------------------- */

function LogNextActionDialog({ open, move, onClose, onSaved, onError }) {
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset the form whenever a new move opens the dialog.
  useEffect(() => {
    if (open) {
      setNote("");
      setNextAction("");
      setNextDate("");
      setSaving(false);
    }
  }, [open, move]);

  if (!move) return null;

  const stageLabel = move.stageLabel || move.toStage;

  const save = async () => {
    setSaving(true);
    try {
      // 1) Log an activity for the move (prospects only — order cycles have no
      //    crm_pipeline_activity row, so we skip it for the recurring view).
      if (move.kind === "prospect") {
        const subject = note.trim() || `Moved to ${stageLabel}`;
        await addActivity({
          pipeline_id: move.id,
          activity_type: note.trim() ? "note" : "meeting",
          subject,
          body: note.trim() || null,
          activity_at: new Date().toISOString(),
          next_follow_up_date: nextDate || null,
        });
        // 2) Save the planned next action so it surfaces on "My Follow-ups".
        if (nextAction.trim() || nextDate) {
          await updateCompany(move.id, {
            next_action: nextAction.trim() || null,
            next_action_date: nextDate || null,
          });
        }
      }
      onSaved?.();
    } catch (e) {
      onError?.(e?.message || "Failed to save activity / next action.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        Log &amp; plan next action
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {move.companyName} → {stageLabel}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {move.kind !== "prospect" && (
            <Alert severity="info">
              Stage updated. Activity logging is available on prospect cards.
            </Alert>
          )}
          <TextField
            label="What happened? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            autoFocus
            disabled={move.kind !== "prospect"}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Next action"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              fullWidth
              disabled={move.kind !== "prospect"}
            />
            <TextField
              label="Due date"
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
              disabled={move.kind !== "prospect"}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Skip
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || move.kind !== "prospect"}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------- */
/* Company drawer                                                           */
/* ----------------------------------------------------------------------- */

/* ----------------------------------------------------------------------- */
/* Activity helpers (type colors + follow-up status)                        */
/* ----------------------------------------------------------------------- */

const ACTIVITY_TYPE_LABELS = ACTIVITY_TYPES.reduce((acc, t) => {
  acc[t.key] = t.label;
  return acc;
}, {});

// Per-type accent palettes (resolved against the live theme at render time).
const activityTypeColor = (theme, type) => {
  const p = theme.palette;
  const map = {
    call: p.info?.main,
    email: p.primary?.main,
    meeting: p.secondary?.main,
    note: p.text?.secondary,
    sample: p.warning?.main,
    quotation: p.success?.main,
    whatsapp: "#25D366",
  };
  return map[type] || p.primary?.main;
};

// Classify an activity for its status chip. Overdue/Due-today are derived from
// the follow-up date when the activity is still open.
const activityStatus = (a) => {
  if (a?.status === "completed") return "completed";
  if (a?.status === "cancelled") return "cancelled";
  const d = a?.next_follow_up_date;
  if (d) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(d);
    due.setHours(0, 0, 0, 0);
    if (due < today) return "overdue";
    if (due.getTime() === today.getTime()) return "due_today";
  }
  return "open";
};

const STATUS_META = {
  completed: { label: "Completed", color: "success" },
  overdue: { label: "Overdue", color: "error" },
  due_today: { label: "Due today", color: "warning" },
  open: { label: "Open", color: "default" },
  cancelled: { label: "Cancelled", color: "default" },
};

/* ----------------------------------------------------------------------- */
/* A single activity timeline card (with inline editor + per-card actions)  */
/* ----------------------------------------------------------------------- */

function ActivityCard({ activity, userMap, onChanged, onError, onNotify }) {
  const theme = useTheme();
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [rescheduleAnchor, setRescheduleAnchor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Inline-edit draft state.
  const [eType, setEType] = useState(activity.activity_type || "note");
  const [eSubject, setESubject] = useState(activity.subject || "");
  const [eBody, setEBody] = useState(activity.body || "");
  const [eFollowUp, setEFollowUp] = useState(activity.next_follow_up_date || "");
  const [eOutcome, setEOutcome] = useState(activity.outcome || "");
  const [rDate, setRDate] = useState(activity.next_follow_up_date || "");

  const status = activityStatus(activity);
  const meta = STATUS_META[status] || STATUS_META.open;
  const accent = activityTypeColor(theme, activity.activity_type);
  const isCompleted = activity.status === "completed";

  const closeMenu = () => setMenuAnchor(null);

  const beginEdit = () => {
    setEType(activity.activity_type || "note");
    setESubject(activity.subject || "");
    setEBody(activity.body || "");
    setEFollowUp(activity.next_follow_up_date || "");
    setEOutcome(activity.outcome || "");
    setEditing(true);
    closeMenu();
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await updateActivity(activity.id, {
        activity_type: eType,
        subject: eSubject.trim() || null,
        body: eBody.trim() || null,
        next_follow_up_date: eFollowUp || null,
        outcome: eOutcome.trim() || null,
      });
      setEditing(false);
      await onChanged?.();
      onNotify?.("Activity updated.", "success");
    } catch (e) {
      onError?.(e?.message || "Failed to update activity.");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await deleteActivity(activity.id);
      setConfirmDelete(false);
      await onChanged?.();
      onNotify?.("Activity deleted.", "success");
    } catch (e) {
      onError?.(e?.message || "Failed to delete activity.");
    } finally {
      setBusy(false);
    }
  };

  const toggleComplete = async () => {
    closeMenu();
    setBusy(true);
    try {
      await markActivityComplete(activity.id, !isCompleted);
      await onChanged?.();
      onNotify?.(isCompleted ? "Marked as open." : "Marked complete.", "success");
    } catch (e) {
      onError?.(e?.message || "Failed to update status.");
    } finally {
      setBusy(false);
    }
  };

  const doReschedule = async () => {
    setBusy(true);
    try {
      await updateActivity(activity.id, { next_follow_up_date: rDate || null });
      setRescheduleAnchor(null);
      await onChanged?.();
      onNotify?.("Follow-up rescheduled.", "success");
    } catch (e) {
      onError?.(e?.message || "Failed to reschedule.");
    } finally {
      setBusy(false);
    }
  };

  const doDuplicate = async () => {
    closeMenu();
    setBusy(true);
    try {
      await duplicateActivity(activity);
      await onChanged?.();
      onNotify?.("Activity duplicated.", "success");
    } catch (e) {
      onError?.(e?.message || "Failed to duplicate.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: 2,
        borderLeft: `3px solid ${accent}`,
        opacity: isCompleted ? 0.78 : 1,
        position: "relative",
      }}
    >
      {editing ? (
        <Stack spacing={1.25}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              select
              label="Type"
              size="small"
              value={eType}
              onChange={(e) => setEType(e.target.value)}
              sx={{ minWidth: 130 }}
            >
              {ACTIVITY_TYPES.map((t) => (
                <MenuItem key={t.key} value={t.key}>
                  {t.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Subject"
              size="small"
              value={eSubject}
              onChange={(e) => setESubject(e.target.value)}
              fullWidth
            />
          </Stack>
          <TextField
            label="Notes"
            size="small"
            value={eBody}
            onChange={(e) => setEBody(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              label="Follow-up date"
              type="date"
              size="small"
              value={eFollowUp || ""}
              onChange={(e) => setEFollowUp(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="Outcome"
              size="small"
              value={eOutcome}
              onChange={(e) => setEOutcome(e.target.value)}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" color="inherit" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="small" variant="contained" onClick={saveEdit} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flexWrap: "wrap" }} useFlexGap>
              <Chip
                size="small"
                label={ACTIVITY_TYPE_LABELS[activity.activity_type] || activity.activity_type}
                sx={{
                  height: 20,
                  fontWeight: 700,
                  color: accent,
                  bgcolor: alpha(accent, 0.12),
                  "& .MuiChip-label": { px: 0.9, fontSize: 11 },
                }}
              />
              <Chip
                size="small"
                label={meta.label}
                color={meta.color}
                variant={meta.color === "default" ? "outlined" : "filled"}
                sx={{ height: 20, "& .MuiChip-label": { px: 0.9, fontSize: 11, fontWeight: 600 } }}
              />
            </Stack>
            <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)} disabled={busy}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Stack>

          {activity.subject && (
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, mt: 0.5, textDecoration: isCompleted ? "line-through" : "none", cursor: "pointer" }}
              onClick={beginEdit}
            >
              {activity.subject}
            </Typography>
          )}
          {activity.body && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                mt: 0.25,
              }}
            >
              {activity.body}
            </Typography>
          )}
          {activity.outcome && (
            <Typography variant="caption" sx={{ display: "block", mt: 0.25, fontStyle: "italic" }} color="text.secondary">
              Outcome: {activity.outcome}
            </Typography>
          )}

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.6 }} flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">
              by {ownerLabel(activity.owner_email, userMap)} · {fmtDateTime(activity.activity_at)}
            </Typography>
            {activity.next_follow_up_date && (
              <Chip
                size="small"
                icon={<ScheduleIcon sx={{ fontSize: 13 }} />}
                label={fmtDate(activity.next_follow_up_date)}
                variant="outlined"
                color={status === "overdue" ? "error" : status === "due_today" ? "warning" : "default"}
                sx={{ height: 20, "& .MuiChip-label": { px: 0.6, fontSize: 11 } }}
              />
            )}
          </Stack>
        </>
      )}

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={beginEdit} sx={{ fontSize: 13 }}>
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem onClick={toggleComplete} sx={{ fontSize: 13 }}>
          <CheckCircleIcon fontSize="small" sx={{ mr: 1 }} /> {isCompleted ? "Mark open" : "Mark complete"}
        </MenuItem>
        <MenuItem
          onClick={(e) => {
            setRDate(activity.next_follow_up_date || "");
            setRescheduleAnchor(e.currentTarget);
            closeMenu();
          }}
          sx={{ fontSize: 13 }}
        >
          <EventRepeatIcon fontSize="small" sx={{ mr: 1 }} /> Reschedule
        </MenuItem>
        <MenuItem onClick={doDuplicate} sx={{ fontSize: 13 }}>
          <ContentCopyIcon fontSize="small" sx={{ mr: 1 }} /> Duplicate
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setConfirmDelete(true);
            closeMenu();
          }}
          sx={{ fontSize: 13, color: "error.main" }}
        >
          <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>

      {/* Reschedule popover (quick date) */}
      <Menu
        anchorEl={rescheduleAnchor}
        open={Boolean(rescheduleAnchor)}
        onClose={() => setRescheduleAnchor(null)}
      >
        <Box sx={{ p: 1.5, width: 220 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            Reschedule follow-up
          </Typography>
          <TextField
            type="date"
            size="small"
            value={rDate || ""}
            onChange={(e) => setRDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
            sx={{ mt: 1 }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.25 }}>
            <Button size="small" color="inherit" onClick={() => setRescheduleAnchor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="small" variant="contained" onClick={doReschedule} disabled={busy}>
              Save
            </Button>
          </Stack>
        </Box>
      </Menu>

      {/* Delete confirm */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete activity?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This will remove the activity. A copy is kept in the change history.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirmDelete(false)} disabled={busy}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={doDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

/* ----------------------------------------------------------------------- */
/* A "+ Add {field}" affordance for empty editable fields                   */
/* ----------------------------------------------------------------------- */

function EditableField({ label, value, onSave, type = "text", multiline = false, helper, display, allowClear = true }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);

  const begin = () => {
    setDraft(value ?? "");
    setEditing(true);
  };
  const commit = async () => {
    setBusy(true);
    try {
      const trimmed = String(draft).trim();
      await onSave(trimmed === "" ? null : trimmed);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Clear ${label.toLowerCase()}?`)) return;
    setBusy(true);
    try {
      await onSave(null);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <Stack direction="row" spacing={0.75} alignItems="flex-start">
        <TextField
          label={label}
          size="small"
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          multiline={multiline}
          minRows={multiline ? 2 : undefined}
          autoFocus
          fullWidth
          InputLabelProps={type === "date" ? { shrink: true } : undefined}
        />
        <Button size="small" variant="contained" onClick={commit} disabled={busy} sx={{ mt: 0.25, minWidth: 0, px: 1.5 }}>
          {busy ? "…" : "Save"}
        </Button>
        <Button size="small" color="inherit" onClick={() => setEditing(false)} disabled={busy} sx={{ mt: 0.25, minWidth: 0, px: 1 }}>
          ✕
        </Button>
      </Stack>
    );
  }

  if (value === null || value === undefined || value === "") {
    return (
      <Box>
        <Button
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 16 }} />}
          onClick={begin}
          sx={{ justifyContent: "flex-start", color: "text.secondary", textTransform: "none", px: 0.5 }}
        >
          Add {label.toLowerCase()}
        </Button>
        {helper && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            {helper}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: "break-word" }}>
          {display != null ? display : value}
        </Typography>
        {helper && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            {helper}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
        <IconButton size="small" onClick={begin} disabled={busy}>
          <EditIcon sx={{ fontSize: 15 }} />
        </IconButton>
        {allowClear && (
          <Tooltip title={`Clear ${label.toLowerCase()}`}>
            <IconButton size="small" onClick={clear} disabled={busy} sx={{ color: "text.disabled" }}>
              <DeleteOutlineIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}

function CompanyDrawer({ id, open, onClose, onChanged, users, userMap, collaborators, onCollaboratorsChanged }) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [err, setErr] = useState(null);
  const [snack, setSnack] = useState(null);

  // Owner state (kept for the picker).
  const [ownerEmail, setOwnerEmail] = useState("");

  // Header menu + busy flags.
  const [headerMenu, setHeaderMenu] = useState(null);
  const [stageAnchor, setStageAnchor] = useState(null);
  const [converting, setConverting] = useState(false);

  // Contacts + edit-company dialogs.
  const [contactDialog, setContactDialog] = useState(null); // null | "new" | contact object
  const [editDialog, setEditDialog] = useState(false);

  // Compact composer state.
  const [actType, setActType] = useState("note");
  const [actSubject, setActSubject] = useState("");
  const [actBody, setActBody] = useState("");
  const [actFollowUp, setActFollowUp] = useState("");
  const [savingAct, setSavingAct] = useState(false);

  const notify = useCallback((message, severity = "info") => {
    setSnack({ message, severity });
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const d = await getCompany(id);
      setDetail(d);
      setOwnerEmail(d.company?.owner_email ?? "");
      const c = await listContacts(id);
      setContacts(c || []);
    } catch (e) {
      setErr(e?.message || "Failed to load company.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (open && id) load();
  }, [open, id, load]);

  const company = detail?.company;
  const isProspect =
    company &&
    (company.account_type === "prospect" ||
      (company.account_type == null && company.kind !== "recurring"));
  const isClient = company && company.account_type === "client";

  const saveField = async (patch) => {
    try {
      await updateCompany(id, patch);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e?.message || "Update failed.");
    }
  };

  const reloadContacts = useCallback(async () => {
    try {
      const c = await listContacts(id);
      setContacts(c || []);
    } catch (e) {
      setErr(e?.message || "Failed to reload contacts.");
    }
  }, [id]);

  const handleDeleteContact = async (contact) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete contact ${contact.full_name || ""}?`)) return;
    try {
      await deleteContact(contact.id);
      await reloadContacts();
      onChanged?.();
      notify("Contact deleted.", "success");
    } catch (e) {
      setErr(e?.message || "Failed to delete contact.");
    }
  };

  const [savingCollab, setSavingCollab] = useState(false);

  const collabEmails = useMemo(
    () => (collaborators || []).map((e) => String(e).toLowerCase()),
    [collaborators]
  );

  const collabValue = useMemo(
    () =>
      collabEmails.map(
        (email) =>
          (userMap && userMap.get(email)) || {
            email,
            full_name: null,
            department: null,
          }
      ),
    [collabEmails, userMap]
  );

  const onChangeCollaborators = async (selected) => {
    const nextEmails = (selected || [])
      .map((u) => String(u?.email || "").toLowerCase())
      .filter(Boolean);
    const prevSet = new Set(collabEmails);
    const nextSet = new Set(nextEmails);
    const toAdd = nextEmails.filter((e) => !prevSet.has(e));
    const toRemove = collabEmails.filter((e) => !nextSet.has(e));
    if (toAdd.length === 0 && toRemove.length === 0) return;
    setSavingCollab(true);
    try {
      await Promise.all([
        ...toAdd.map((e) => addCollaborator(id, e)),
        ...toRemove.map((e) => removeCollaborator(id, e)),
      ]);
      await onCollaboratorsChanged?.();
    } catch (e) {
      setErr(e?.message || "Failed to update collaborators.");
    } finally {
      setSavingCollab(false);
    }
  };

  const saveOwner = async (email) => {
    const next = email == null ? "" : String(email).trim();
    setOwnerEmail(next);
    try {
      await assignOwner(id, next || null);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e?.message || "Assign failed.");
    }
  };

  const submitActivity = async () => {
    if (!actSubject.trim() && !actBody.trim()) {
      setErr("Add a subject or note for the activity.");
      return;
    }
    setSavingAct(true);
    setErr(null);
    try {
      await addActivity({
        pipeline_id: id,
        activity_type: actType,
        subject: actSubject.trim() || null,
        body: actBody.trim() || null,
        next_follow_up_date: actFollowUp || null,
      });
      setActSubject("");
      setActBody("");
      setActFollowUp("");
      setActType("note");
      await load();
      onChanged?.();
      notify("Activity logged.", "success");
    } catch (e) {
      setErr(e?.message || "Failed to add activity.");
    } finally {
      setSavingAct(false);
    }
  };

  // Quick action helpers.
  const digits = (s) => String(s || "").replace(/[^\d+]/g, "");
  const phone = company?.phone || (contacts.find((c) => c.is_primary) || contacts[0] || {}).phone;
  const email = company?.email || (contacts.find((c) => c.is_primary) || contacts[0] || {}).email;

  const quickNote = () => {
    setActType("note");
    setActSubject("");
    setActBody("");
    document.getElementById("crm-activity-composer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const quickFollowUp = () => {
    setActType("call");
    setActFollowUp(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    document.getElementById("crm-activity-composer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleConvert = async () => {
    setHeaderMenu(null);
    setConverting(true);
    try {
      await convertToClient(id, null);
      await load();
      onChanged?.();
      notify("Converted to client.", "success");
    } catch (e) {
      setErr(e?.message || "Failed to convert to client.");
    } finally {
      setConverting(false);
    }
  };

  const moveToStage = async (toStage) => {
    setStageAnchor(null);
    setHeaderMenu(null);
    try {
      if (company?.kind === "recurring") {
        await moveStage(id, toStage, null);
      } else if (isProspect) {
        await moveProspectStage(id, toStage);
      } else {
        await updateClientStage(id, toStage);
      }
      await load();
      onChanged?.();
      notify("Stage updated.", "success");
    } catch (e) {
      setErr(e?.message || "Failed to move stage.");
    }
  };

  // Follow-up summary counts (from activities).
  const followCounts = useMemo(() => {
    const acts = detail?.activities || [];
    let open = 0;
    let dueToday = 0;
    let overdue = 0;
    let completed = 0;
    acts.forEach((a) => {
      const s = activityStatus(a);
      if (s === "completed") completed += 1;
      else if (s === "overdue") overdue += 1;
      else if (s === "due_today") dueToday += 1;
      else if (a.next_follow_up_date) open += 1;
    });
    return { open, dueToday, overdue, completed };
  }, [detail]);

  const stageChip = company
    ? (isProspect
        ? company.prospect_stage || company.stage
        : company.client_stage || company.stage)
    : null;
  const stageChipLabel =
    PROSPECT_STAGE_LABELS[stageChip] ||
    CLIENT_STAGE_LABELS[stageChip] ||
    STAGE_LABELS[stageChip] ||
    CYCLE_STAGE_LABELS[stageChip] ||
    stageChip;

  const QuickAction = ({ icon, label, onClick, href, color = "default", disabled }) => (
    <Tooltip title={label}>
      <span>
        <IconButton
          size="small"
          onClick={onClick}
          href={href}
          component={href ? "a" : "button"}
          disabled={disabled}
          color={color}
          sx={{ border: 1, borderColor: "divider", borderRadius: 1.5 }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: "100%", sm: 560, md: 920 },
          maxWidth: "100%",
          top: { xs: 56, sm: 64 },
          height: { xs: "calc(100% - 56px)", sm: "calc(100% - 64px)" },
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* ---------------- HEADER ---------------- */}
      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
                {company?.company_name || (loading ? "Loading…" : "Company")}
              </Typography>
              {company && (
                <Tooltip title="Edit details">
                  <IconButton size="small" onClick={() => setEditDialog(true)} sx={{ p: 0.25 }}>
                    <EditIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              )}
              {company && stageChipLabel && (
                <Chip size="small" label={stageChipLabel} color="primary" sx={{ height: 22 }} />
              )}
              {company && !isProspect && (
                <Chip size="small" label="Client" color="success" variant="outlined" sx={{ height: 22 }} />
              )}
            </Stack>
            {company && (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mt: 0.5 }}
                flexWrap="wrap"
                useFlexGap
                divider={<Box sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: "text.disabled" }} />}
              >
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <PersonIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography variant="caption" color="text.secondary">
                    {ownerLabel(company.owner_email, userMap) || "Unassigned"}
                  </Typography>
                </Stack>
                {company.contact_person && (
                  <Typography variant="caption" color="text.secondary">
                    {company.contact_person}
                  </Typography>
                )}
                {phone && (
                  <Typography variant="caption" color="text.secondary">
                    {phone}
                  </Typography>
                )}
                {email && (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {email}
                  </Typography>
                )}
                {company.city && (
                  <Typography variant="caption" color="text.secondary">
                    {company.city}
                  </Typography>
                )}
                {company.industry && (
                  <Typography variant="caption" color="text.secondary">
                    {company.industry}
                  </Typography>
                )}
              </Stack>
            )}
          </Box>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {company && (
              <IconButton size="small" onClick={(e) => setHeaderMenu(e.currentTarget)}>
                <MoreVertIcon />
              </IconButton>
            )}
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Stack>
        </Stack>

        {/* Quick actions */}
        {company && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
            <QuickAction
              icon={<CallIcon fontSize="small" />}
              label="Call"
              href={phone ? `tel:${digits(phone)}` : undefined}
              disabled={!phone}
              color="info"
            />
            <QuickAction
              icon={<WhatsAppIcon fontSize="small" />}
              label="WhatsApp"
              href={phone ? `https://wa.me/${digits(phone).replace(/^\+/, "")}` : undefined}
              disabled={!phone}
            />
            <QuickAction
              icon={<EmailIcon fontSize="small" />}
              label="Email"
              href={email ? `mailto:${email}` : undefined}
              disabled={!email}
              color="primary"
            />
            <QuickAction icon={<NoteAddIcon fontSize="small" />} label="Add note" onClick={quickNote} />
            <QuickAction icon={<EventAvailableIcon fontSize="small" />} label="Schedule follow-up" onClick={quickFollowUp} />
            <QuickAction
              icon={<RequestQuoteIcon fontSize="small" />}
              label="Create quotation"
              onClick={() => notify("Quotation builder coming soon.", "info")}
            />
            {isProspect && (
              <Tooltip title="Convert to client">
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    startIcon={<HowToRegIcon fontSize="small" />}
                    onClick={handleConvert}
                    disabled={converting}
                    sx={{ ml: "auto" }}
                  >
                    {converting ? "Converting…" : "Convert to client"}
                  </Button>
                </span>
              </Tooltip>
            )}
          </Stack>
        )}
      </Box>

      {err && (
        <Alert severity="error" sx={{ m: 1.5, mb: 0 }} onClose={() => setErr(null)}>
          {err}
        </Alert>
      )}

      {/* ---------------- BODY (side-panel layout) ---------------- */}
      {loading && !company ? (
        <Box sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Skeleton variant="rounded" height={80} />
            <Skeleton variant="rounded" height={120} />
            <Skeleton variant="rounded" height={200} />
          </Stack>
        </Box>
      ) : company ? (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            overflow: { xs: "auto", md: "hidden" },
          }}
        >
          {/* LEFT PANEL (~30%) */}
          <Box
            sx={{
              width: { xs: "100%", md: "32%" },
              borderRight: { md: 1 },
              borderColor: { md: "divider" },
              p: 2,
              overflowY: { md: "auto" },
            }}
          >
            <Stack spacing={2.5}>
              {/* Company information */}
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <SectionTitle>Company information</SectionTitle>
                  <Button
                    size="small"
                    startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                    onClick={() => setEditDialog(true)}
                    sx={{ textTransform: "none", minWidth: 0 }}
                  >
                    Edit details
                  </Button>
                </Stack>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  <EditableField
                    label="Company name"
                    value={company.company_name}
                    allowClear={false}
                    onSave={(v) => saveField({ company_name: v })}
                  />
                  <EditableField label="Phone" value={company.phone} onSave={(v) => saveField({ phone: v })} />
                  <EditableField label="Email" type="email" value={company.email} onSave={(v) => saveField({ email: v })} />
                  <EditableField label="Industry" value={company.industry} onSave={(v) => saveField({ industry: v })} />
                  <EditableField label="City" value={company.city} onSave={(v) => saveField({ city: v })} />
                  <EditableField
                    label="Product category"
                    value={company.product_category}
                    onSave={(v) => saveField({ product_category: v })}
                  />
                  <EditableField
                    label="Business type"
                    value={company.business_type}
                    onSave={(v) => saveField({ business_type: v })}
                  />
                  <EditableField label="Website" value={company.website} onSave={(v) => saveField({ website: v })} />
                  <EditableField label="GSTIN" value={company.gstin} onSave={(v) => saveField({ gstin: v })} />
                  <EditableField label="PAN" value={company.pan} onSave={(v) => saveField({ pan: v })} />
                  <EditableField
                    label="Payment terms"
                    value={company.payment_terms}
                    onSave={(v) => saveField({ payment_terms: v })}
                  />
                  <EditableField
                    label="Credit limit (₹)"
                    type="number"
                    value={company.credit_limit ?? null}
                    display={company.credit_limit != null ? inrCompact(company.credit_limit) : null}
                    onSave={(v) => saveField({ credit_limit: v == null || v === "" ? null : Number(v) })}
                  />
                  <EditableField
                    label="Credit period (days)"
                    type="number"
                    value={company.credit_period ?? null}
                    onSave={(v) => saveField({ credit_period: v == null || v === "" ? null : Number(v) })}
                  />
                  <EditableField
                    label="Delivery terms"
                    value={company.delivery_terms}
                    onSave={(v) => saveField({ delivery_terms: v })}
                  />
                  <EditableField
                    label="Lead source"
                    value={company.lead_source}
                    onSave={(v) => saveField({ lead_source: v })}
                  />
                  <EditableField
                    label="Rating"
                    type="number"
                    value={company.rating ?? null}
                    helper="1–5"
                    onSave={(v) => saveField({ rating: v == null || v === "" ? null : Number(v) })}
                  />
                  {isClient && (
                    <EditableField
                      label="Annual potential (₹)"
                      type="number"
                      value={company.annual_potential ?? null}
                      display={
                        company.annual_potential != null
                          ? inrCompact(company.annual_potential)
                          : null
                      }
                      helper="Estimated total yearly spend this customer could give us — drives share-of-wallet."
                      onSave={(v) =>
                        saveField({
                          annual_potential:
                            v == null || v === "" ? null : Number(v),
                        })
                      }
                    />
                  )}
                  {isProspect && (
                    <>
                      <EditableField
                        label="Probability (%)"
                        type="number"
                        value={company.probability ?? null}
                        onSave={(v) => saveField({ probability: v == null || v === "" ? null : Number(v) })}
                      />
                      <EditableField
                        label="Expected value (₹)"
                        type="number"
                        value={company.expected_value ?? null}
                        display={company.expected_value != null ? inrCompact(company.expected_value) : null}
                        onSave={(v) => saveField({ expected_value: v == null || v === "" ? null : Number(v) })}
                      />
                    </>
                  )}
                </Stack>
              </Box>

              <Divider />

              {/* Contacts */}
              <Box>
                <SectionTitle>Contacts</SectionTitle>
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {contacts.length === 0 && company.contact_person && (
                    <Paper variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {company.contact_person}
                      </Typography>
                      {(company.phone || company.email) && (
                        <Typography variant="caption" color="text.secondary">
                          {[company.phone, company.email].filter(Boolean).join(" · ")}
                        </Typography>
                      )}
                    </Paper>
                  )}
                  {contacts.map((c) => (
                    <Paper key={c.id} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {c.full_name || "—"}
                            </Typography>
                            {c.is_primary && (
                              <Chip size="small" label="Primary" color="primary" sx={{ height: 18, "& .MuiChip-label": { px: 0.7, fontSize: 10 } }} />
                            )}
                          </Stack>
                          {(c.designation || c.department) && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                              {[c.designation, c.department].filter(Boolean).join(" · ")}
                            </Typography>
                          )}
                          {(c.phone || c.email) && (
                            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                              {[c.phone, c.email].filter(Boolean).join(" · ")}
                            </Typography>
                          )}
                        </Box>
                        <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                          <IconButton size="small" onClick={() => setContactDialog(c)}>
                            <EditIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                          <IconButton size="small" onClick={() => handleDeleteContact(c)} sx={{ color: "text.disabled" }}>
                            <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Stack>
                      </Stack>
                    </Paper>
                  ))}
                  <Button
                    size="small"
                    startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                    onClick={() => setContactDialog("new")}
                    sx={{ justifyContent: "flex-start", color: "text.secondary", textTransform: "none", px: 0.5 }}
                  >
                    Add contact
                  </Button>
                </Stack>
              </Box>

              <Divider />

              {/* Documents (stub) */}
              <Box>
                <SectionTitle>Documents</SectionTitle>
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <DescriptionIcon sx={{ fontSize: 14 }} /> No documents yet.
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                    onClick={() => notify("Document upload coming soon.", "info")}
                    sx={{ justifyContent: "flex-start", color: "text.secondary", textTransform: "none", px: 0.5 }}
                  >
                    Add document
                  </Button>
                </Stack>
              </Box>

              <Divider />

              {/* Owner + collaborators */}
              <Box>
                <SectionTitle>Ownership</SectionTitle>
                <Stack spacing={1.25} sx={{ mt: 1 }}>
                  <Autocomplete
                    size="small"
                    options={users || []}
                    value={
                      ownerEmail
                        ? (userMap && userMap.get(String(ownerEmail).toLowerCase())) || {
                            email: ownerEmail,
                            full_name: null,
                            department: null,
                          }
                        : null
                    }
                    onChange={(_, v) => saveOwner(v ? v.email : null)}
                    getOptionLabel={(o) => userOptionLabel(o)}
                    isOptionEqualToValue={(o, v) =>
                      String(o?.email || "").toLowerCase() === String(v?.email || "").toLowerCase()
                    }
                    renderInput={(params) => <TextField {...params} label="Owner" placeholder="Unassigned" />}
                  />
                  {ownerEmail && (
                    <Button size="small" variant="text" color="inherit" onClick={() => saveOwner(null)} sx={{ alignSelf: "flex-start" }}>
                      Unassign
                    </Button>
                  )}
                  <Autocomplete
                    multiple
                    size="small"
                    disabled={savingCollab}
                    options={users || []}
                    value={collabValue}
                    onChange={(_, v) => onChangeCollaborators(v)}
                    getOptionLabel={(o) => userOptionLabel(o)}
                    isOptionEqualToValue={(o, v) =>
                      String(o?.email || "").toLowerCase() === String(v?.email || "").toLowerCase()
                    }
                    renderInput={(params) => <TextField {...params} label="Collaborators" placeholder="Add co-workers" />}
                  />
                </Stack>
              </Box>

              {/* Stage timeline (kept) */}
              {detail.history && detail.history.length > 0 && (
                <>
                  <Divider />
                  <Box>
                    <SectionTitle>Stage timeline</SectionTitle>
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {detail.history.map((h) => (
                        <Stack key={h.id} direction="row" spacing={1} alignItems="flex-start" sx={{ fontSize: 13 }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main", flexShrink: 0, mt: 0.5 }} />
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2">
                              {h.from_stage
                                ? PROSPECT_STAGE_LABELS[h.from_stage] ||
                                  CLIENT_STAGE_LABELS[h.from_stage] ||
                                  STAGE_LABELS[h.from_stage] ||
                                  h.from_stage
                                : "New"}
                              {"  →  "}
                              <strong>
                                {PROSPECT_STAGE_LABELS[h.to_stage] ||
                                  CLIENT_STAGE_LABELS[h.to_stage] ||
                                  STAGE_LABELS[h.to_stage] ||
                                  h.to_stage}
                              </strong>
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {ownerLabel(h.moved_by_email, userMap) || "—"} · {fmtDateTime(h.moved_at)}
                              {h.note ? ` · ${h.note}` : ""}
                            </Typography>
                          </Box>
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                </>
              )}

              {/* Order cycles (recurring only) */}
              {company.kind === "recurring" && (
                <>
                  <Divider />
                  <Box>
                    <SectionTitle>Order cycles</SectionTitle>
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {detail.orderCycles.length === 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          No order cycles.
                        </Typography>
                      ) : (
                        detail.orderCycles.map((oc) => (
                          <Paper key={oc.id} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {oc.order_number || oc.order_ref || "—"}
                              </Typography>
                              <Chip size="small" label={CYCLE_STAGE_LABELS[oc.cycle_stage] || oc.cycle_stage} sx={{ height: 20 }} />
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {inrFull(oc.amount)} · {fmtDate(oc.order_date)}
                            </Typography>
                          </Paper>
                        ))
                      )}
                    </Stack>
                  </Box>
                </>
              )}
            </Stack>
          </Box>

          {/* RIGHT PANEL (~70%) — activity timeline */}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              p: 2,
              overflowY: { md: "auto" },
              bgcolor: (t) => alpha(t.palette.text.primary, 0.015),
            }}
          >
            {/* Follow-up summary */}
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={`Open ${followCounts.open}`} variant="outlined" />
              <Chip size="small" label={`Due today ${followCounts.dueToday}`} color="warning" variant={followCounts.dueToday ? "filled" : "outlined"} />
              <Chip size="small" label={`Overdue ${followCounts.overdue}`} color="error" variant={followCounts.overdue ? "filled" : "outlined"} />
              <Chip size="small" label={`Completed ${followCounts.completed}`} color="success" variant={followCounts.completed ? "filled" : "outlined"} />
            </Stack>

            {/* Compact composer */}
            <Paper id="crm-activity-composer" variant="outlined" sx={{ p: 1.5, borderRadius: 2, mb: 2 }}>
              <Stack spacing={1.25}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <TextField
                    select
                    label="Type"
                    size="small"
                    value={actType}
                    onChange={(e) => setActType(e.target.value)}
                    sx={{ minWidth: 130 }}
                  >
                    {ACTIVITY_TYPES.map((t) => (
                      <MenuItem key={t.key} value={t.key}>
                        {t.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Subject"
                    size="small"
                    value={actSubject}
                    onChange={(e) => setActSubject(e.target.value)}
                    fullWidth
                  />
                </Stack>
                <TextField
                  label="Notes"
                  size="small"
                  value={actBody}
                  onChange={(e) => setActBody(e.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    label="Follow-up date"
                    type="date"
                    size="small"
                    value={actFollowUp}
                    onChange={(e) => setActFollowUp(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                  <Button variant="contained" size="small" onClick={submitActivity} disabled={savingAct} sx={{ whiteSpace: "nowrap" }}>
                    {savingAct ? "Saving…" : "Save activity"}
                  </Button>
                </Stack>
              </Stack>
            </Paper>

            {/* Timeline */}
            <SectionTitle>Activity timeline</SectionTitle>
            <Stack spacing={1.25} sx={{ mt: 1 }}>
              {detail.activities.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  No activities yet. Log the first interaction above.
                </Typography>
              ) : (
                detail.activities.map((a) => (
                  <ActivityCard
                    key={a.id}
                    activity={a}
                    userMap={userMap}
                    onChanged={load}
                    onError={(m) => setErr(m)}
                    onNotify={notify}
                  />
                ))
              )}
            </Stack>
          </Box>
        </Box>
      ) : null}

      {/* Header overflow menu: stage move + create work order */}
      <Menu anchorEl={headerMenu} open={Boolean(headerMenu)} onClose={() => setHeaderMenu(null)}>
        <MenuItem
          onClick={() => {
            setHeaderMenu(null);
            setEditDialog(true);
          }}
          sx={{ fontSize: 13 }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit details
        </MenuItem>
        <MenuItem onClick={(e) => setStageAnchor(e.currentTarget)} sx={{ fontSize: 13 }}>
          <ArrowForwardIcon fontSize="small" sx={{ mr: 1 }} /> Move stage
        </MenuItem>
        {isProspect && (
          <MenuItem onClick={handleConvert} disabled={converting} sx={{ fontSize: 13 }}>
            <HowToRegIcon fontSize="small" sx={{ mr: 1 }} /> Convert to client
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setHeaderMenu(null);
            notify("Open a recurring order cycle to create a work order.", "info");
          }}
          sx={{ fontSize: 13 }}
        >
          <PrecisionManufacturingIcon fontSize="small" sx={{ mr: 1 }} /> Create work order
        </MenuItem>
      </Menu>

      <StageMoveMenu
        anchorEl={stageAnchor}
        stages={
          company?.kind === "recurring"
            ? CYCLE_STAGES
            : isProspect
            ? PROSPECT_STAGES
            : CLIENT_STAGES
        }
        currentStageKey={
          company?.kind === "recurring"
            ? company?.stage
            : isProspect
            ? company?.prospect_stage
            : company?.client_stage
        }
        onClose={() => setStageAnchor(null)}
        onPick={(toStage) => moveToStage(toStage)}
      />

      <ContactDialog
        open={Boolean(contactDialog)}
        contact={contactDialog === "new" ? null : contactDialog}
        onClose={() => setContactDialog(null)}
        onSaved={async (msg) => {
          setContactDialog(null);
          await reloadContacts();
          onChanged?.();
          notify(msg, "success");
        }}
        onError={(m) => setErr(m)}
        addContact={(payload) => addContact(id, payload)}
        updateContact={updateContact}
      />

      {company && (
        <EditCompanyDialog
          open={editDialog}
          company={company}
          isProspect={isProspect}
          isClient={isClient}
          onClose={() => setEditDialog(false)}
          onSaved={async () => {
            setEditDialog(false);
            await load();
            onChanged?.();
            notify("Company details updated.", "success");
          }}
          onError={(m) => setErr(m)}
        />
      )}

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {snack ? (
          <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} sx={{ width: "100%" }}>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Drawer>
  );
}

function SectionTitle({ children }) {
  return (
    <Typography
      variant="caption"
      sx={{ fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "text.secondary" }}
    >
      {children}
    </Typography>
  );
}

/* ----------------------------------------------------------------------- */
/* Add / edit contact dialog                                                */
/* ----------------------------------------------------------------------- */

function ContactDialog({ open, contact, onClose, onSaved, onError, addContact, updateContact }) {
  const empty = {
    full_name: "",
    designation: "",
    department: "",
    phone: "",
    email: "",
    is_primary: false,
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (contact) {
      setForm({
        full_name: contact.full_name || "",
        designation: contact.designation || "",
        department: contact.department || "",
        phone: contact.phone || "",
        email: contact.email || "",
        is_primary: !!contact.is_primary,
      });
    } else {
      setForm(empty);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.full_name.trim()) {
      onError?.("Contact name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        full_name: form.full_name.trim(),
        designation: form.designation.trim() || null,
        department: form.department.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        is_primary: form.is_primary,
      };
      if (contact) {
        await updateContact(contact.id, payload);
        await onSaved?.("Contact updated.");
      } else {
        await addContact(payload);
        await onSaved?.("Contact added.");
      }
    } catch (e) {
      onError?.(e?.message || "Failed to save contact.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Full name" value={form.full_name} onChange={set("full_name")} required fullWidth autoFocus />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Designation" value={form.designation} onChange={set("designation")} fullWidth />
            <TextField label="Department" value={form.department} onChange={set("department")} fullWidth />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Phone" value={form.phone} onChange={set("phone")} fullWidth />
            <TextField label="Email" type="email" value={form.email} onChange={set("email")} fullWidth />
          </Stack>
          <FormControlLabel
            control={
              <Checkbox
                checked={form.is_primary}
                onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))}
              />
            }
            label="Primary contact"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : contact ? "Save" : "Add contact"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------- */
/* Edit company dialog — comprehensive single edit surface                  */
/* ----------------------------------------------------------------------- */

const RATING_OPTIONS = ["1", "2", "3", "4", "5"];

function EditCompanyDialog({ open, company, isProspect, isClient, onClose, onSaved, onError }) {
  const str = (v) => (v == null ? "" : String(v));
  const buildForm = (c) => ({
    company_name: str(c.company_name),
    phone: str(c.phone),
    email: str(c.email),
    industry: str(c.industry),
    city: str(c.city),
    product_category: str(c.product_category),
    business_type: str(c.business_type),
    website: str(c.website),
    gstin: str(c.gstin),
    pan: str(c.pan),
    payment_terms: str(c.payment_terms),
    credit_limit: str(c.credit_limit),
    credit_period: str(c.credit_period),
    delivery_terms: str(c.delivery_terms),
    lead_source: str(c.lead_source),
    rating: str(c.rating),
    prospect_stage: str(c.prospect_stage),
    client_stage: str(c.client_stage),
    annual_potential: str(c.annual_potential),
    probability: str(c.probability),
    expected_value: str(c.expected_value),
  });

  const [form, setForm] = useState(() => buildForm(company || {}));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && company) setForm(buildForm(company));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, company]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.company_name.trim()) {
      onError?.("Company name is required.");
      return;
    }
    setSaving(true);
    try {
      const textVal = (v) => {
        const t = String(v).trim();
        return t === "" ? null : t;
      };
      const numVal = (v) => {
        const t = String(v).trim();
        return t === "" ? null : Number(t);
      };
      const patch = {
        company_name: form.company_name.trim(),
        phone: textVal(form.phone),
        email: textVal(form.email),
        industry: textVal(form.industry),
        city: textVal(form.city),
        product_category: textVal(form.product_category),
        business_type: textVal(form.business_type),
        website: textVal(form.website),
        gstin: textVal(form.gstin),
        pan: textVal(form.pan),
        payment_terms: textVal(form.payment_terms),
        credit_limit: numVal(form.credit_limit),
        credit_period: numVal(form.credit_period),
        delivery_terms: textVal(form.delivery_terms),
        lead_source: textVal(form.lead_source),
        rating: numVal(form.rating),
      };
      if (isProspect) {
        if (form.prospect_stage) patch.prospect_stage = form.prospect_stage;
        patch.probability = numVal(form.probability);
        patch.expected_value = numVal(form.expected_value);
      }
      if (isClient) {
        if (form.client_stage) patch.client_stage = form.client_stage;
        patch.annual_potential = numVal(form.annual_potential);
      }
      await updateCompany(company.id, patch);
      await onSaved?.();
    } catch (e) {
      onError?.(e?.message || "Failed to update company.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle sx={{ fontWeight: 700 }}>Edit company</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
          <Box>
            <SectionTitle>Company</SectionTitle>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Company name" value={form.company_name} onChange={set("company_name")} required fullWidth />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Phone" value={form.phone} onChange={set("phone")} fullWidth />
                <TextField label="Email" type="email" value={form.email} onChange={set("email")} fullWidth />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Industry" value={form.industry} onChange={set("industry")} fullWidth />
                <TextField label="City" value={form.city} onChange={set("city")} fullWidth />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Product category" value={form.product_category} onChange={set("product_category")} fullWidth />
                <TextField label="Business type" value={form.business_type} onChange={set("business_type")} fullWidth />
              </Stack>
              <TextField label="Website" value={form.website} onChange={set("website")} fullWidth />
            </Stack>
          </Box>

          <Box>
            <SectionTitle>Tax &amp; terms</SectionTitle>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="GSTIN" value={form.gstin} onChange={set("gstin")} fullWidth />
                <TextField label="PAN" value={form.pan} onChange={set("pan")} fullWidth />
              </Stack>
              <TextField label="Payment terms" value={form.payment_terms} onChange={set("payment_terms")} fullWidth />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField label="Credit limit (₹)" type="number" value={form.credit_limit} onChange={set("credit_limit")} fullWidth />
                <TextField label="Credit period (days)" type="number" value={form.credit_period} onChange={set("credit_period")} fullWidth />
              </Stack>
              <TextField label="Delivery terms" value={form.delivery_terms} onChange={set("delivery_terms")} fullWidth />
            </Stack>
          </Box>

          <Box>
            <SectionTitle>Commercial</SectionTitle>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField select label="Lead source" value={form.lead_source} onChange={set("lead_source")} fullWidth>
                  <MenuItem value="">—</MenuItem>
                  {SOURCES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField select label="Rating" value={form.rating} onChange={set("rating")} fullWidth>
                  <MenuItem value="">—</MenuItem>
                  {RATING_OPTIONS.map((r) => (
                    <MenuItem key={r} value={r}>
                      {r}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              {isProspect && (
                <>
                  <TextField select label="Stage" value={form.prospect_stage} onChange={set("prospect_stage")} fullWidth>
                    {PROSPECT_STAGES.map((s) => (
                      <MenuItem key={s.key} value={s.key}>
                        {s.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField label="Probability (%)" type="number" value={form.probability} onChange={set("probability")} fullWidth />
                    <TextField label="Expected value (₹)" type="number" value={form.expected_value} onChange={set("expected_value")} fullWidth />
                  </Stack>
                </>
              )}
              {isClient && (
                <>
                  <TextField select label="Stage" value={form.client_stage} onChange={set("client_stage")} fullWidth>
                    {CLIENT_STAGES.map((s) => (
                      <MenuItem key={s.key} value={s.key}>
                        {s.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField label="Annual potential (₹)" type="number" value={form.annual_potential} onChange={set("annual_potential")} fullWidth />
                </>
              )}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------- */
/* Create work order dialog (links a recurring order to a PPC work order)   */
/* ----------------------------------------------------------------------- */

function CreateWorkOrderDialog({ open, onClose, cycle, onCreated, onError }) {
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [item, setItem] = useState(null);
  const [qty, setQty] = useState("1");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      setLoadingItems(true);
      setErr(null);
      try {
        const list = await ppcService.listItems();
        if (active) setItems(Array.isArray(list) ? list : []);
      } catch (e) {
        if (active) setErr(e?.message || "Failed to load items.");
      } finally {
        if (active) setLoadingItems(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  // Reset transient form state whenever the dialog re-opens.
  useEffect(() => {
    if (open) {
      setItem(null);
      setQty("1");
      setDue("");
      setErr(null);
    }
  }, [open]);

  const submit = async () => {
    if (!item?.id) {
      setErr("Select an item for the work order.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const result = await ppcService.createWorkOrderForCustomer({
        itemId: item.id,
        qty: qty === "" ? 1 : Number(qty),
        lineId: null,
        due: due || null,
        customerCode: cycle.customer_code || null,
        customerName: cycle.company_name || cycle.customer_code || null,
        orderNumber: cycle.order_number || cycle.order_ref || null,
        orderCycleId: cycle.id,
      });
      onCreated?.(result);
      onClose();
    } catch (e) {
      const msg = e?.message || "Failed to create work order.";
      setErr(msg);
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Create work order</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <Typography variant="caption" color="text.secondary">
            {cycle.company_name || cycle.customer_code || "Customer"} ·{" "}
            {cycle.order_number || cycle.order_ref || "—"}
          </Typography>
          <Autocomplete
            options={items}
            loading={loadingItems}
            value={item}
            onChange={(_, v) => setItem(v)}
            getOptionLabel={(o) => (o ? `${o.code} — ${o.name}` : "")}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Item"
                required
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingItems ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Quantity"
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputProps={{ min: 1 }}
              fullWidth
            />
            <TextField
              label="Due date"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving || !item}>
          {saving ? "Creating…" : "Create work order"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ----------------------------------------------------------------------- */
/* Recurring order-cycle card                                               */
/* ----------------------------------------------------------------------- */

function OrderCycleCard({ cycle, onMove, theme, onNotify, onDragStart, onDragEnd, userMap, collaborators }) {
  const [moveAnchor, setMoveAnchor] = useState(null);
  const [woDialogOpen, setWoDialogOpen] = useState(false);
  const [workOrders, setWorkOrders] = useState([]);
  const days = daysSince(cycle.stage_entered_at);
  const hasCycleId = Boolean(cycle.id);

  const loadWorkOrders = useCallback(async () => {
    if (!cycle.id) return;
    try {
      const list = await ppcService.listWorkOrdersForOrderCycle(cycle.id);
      setWorkOrders(Array.isArray(list) ? list : []);
    } catch (e) {
      onNotify?.(e?.message || "Failed to load work orders.", "error");
    }
  }, [cycle.id, onNotify]);

  // Lazily fetch linked work orders on mount of each card.
  useEffect(() => {
    loadWorkOrders();
  }, [loadWorkOrders]);

  return (
    <Paper
      variant="outlined"
      draggable
      onDragStart={(e) => {
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(cycle.id));
        } catch {
          /* noop */
        }
        onDragStart?.(cycle.id, cycle.cycle_stage);
      }}
      onDragEnd={() => onDragEnd?.()}
      sx={{
        p: 1.25,
        borderRadius: 2,
        cursor: "grab",
        "&:active": { cursor: "grabbing" },
      }}
    >
      <Stack spacing={0.5}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
          {cycle.company_name || cycle.customer_code}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {cycle.order_number || cycle.order_ref || "—"}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {cycle.amount != null && (
            <Chip
              size="small"
              label={inrCompact(cycle.amount)}
              color="primary"
              variant="outlined"
              sx={{ height: 22, "& .MuiChip-label": { px: 0.75, fontSize: 11, fontWeight: 700 } }}
            />
          )}
          <Chip
            size="small"
            icon={<ScheduleIcon sx={{ fontSize: 14 }} />}
            label={days == null ? "—" : `${days}d`}
            sx={{ height: 22, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }}
          />
          <CollaboratorChips emails={collaborators} userMap={userMap} />
        </Stack>

        {/* Linked work orders */}
        {workOrders.length > 0 ? (
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
            {workOrders.map((wo) => (
              <Chip
                key={wo.id}
                size="small"
                variant="outlined"
                color="secondary"
                label={`${wo.wo_number} · ${wo.status}`}
                sx={{ height: 20, "& .MuiChip-label": { px: 0.75, fontSize: 10.5 } }}
              />
            ))}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.disabled">
            No work order yet
          </Typography>
        )}

        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="caption" color="text.secondary">
            {fmtDate(cycle.order_date)}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Tooltip title={hasCycleId ? "Create work order" : "Save the order first"}>
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  disabled={!hasCycleId}
                  onClick={() => setWoDialogOpen(true)}
                >
                  <PrecisionManufacturingIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              size="small"
              variant="text"
              endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
              onClick={(e) => setMoveAnchor(e.currentTarget)}
              sx={{ fontSize: 11, py: 0.25, minWidth: 0 }}
            >
              Move
            </Button>
          </Stack>
        </Stack>
      </Stack>
      <StageMoveMenu
        anchorEl={moveAnchor}
        stages={CYCLE_STAGES}
        currentStageKey={cycle.cycle_stage}
        onClose={() => setMoveAnchor(null)}
        onPick={(toStage) => {
          setMoveAnchor(null);
          onMove(cycle.id, toStage);
        }}
      />
      {hasCycleId && (
        <CreateWorkOrderDialog
          open={woDialogOpen}
          onClose={() => setWoDialogOpen(false)}
          cycle={cycle}
          onCreated={(result) => {
            onNotify?.(
              result?.wo_number
                ? `Work order ${result.wo_number} created`
                : "Work order created",
              "success"
            );
            loadWorkOrders();
          }}
          onError={(msg) => onNotify?.(msg, "error")}
        />
      )}
    </Paper>
  );
}

/* ----------------------------------------------------------------------- */
/* Main board                                                               */
/* ----------------------------------------------------------------------- */

export default function CRMPipelineBoard() {
  const theme = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  // View is driven by the URL so the two CRM nav links deep-link straight to the
  // right mode. ?view=prospects → Prospects kanban; ?view=clients (or the legacy
  // ?view=recurring) → Clients table. Default 'prospects'.
  const rawView = searchParams.get("view");
  const view =
    rawView === "clients" || rawView === "recurring" ? "clients" : "prospects";

  const setView = useCallback(
    (next) => {
      if (!next || next === view) return;
      const params = new URLSearchParams(searchParams);
      params.set("view", next);
      setSearchParams(params, { replace: true });
    },
    [view, searchParams, setSearchParams]
  );

  // Within the Clients view: 'accounts' (table) | 'cycles' (order-cycle kanban).
  const [clientTab, setClientTab] = useState("accounts");

  const [scope, setScope] = useState("my"); // 'my' | 'all'
  const [search, setSearch] = useState("");
  // Client-stage filter (Clients table). "" = all stages.
  const [clientStageFilter, setClientStageFilter] = useState("");

  const [currentEmail, setCurrentEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [prospects, setProspects] = useState([]);
  const [clients, setClients] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  // Flat list of { pipeline_id, email } collaborator rows (co-working leads).
  const [collaboratorRows, setCollaboratorRows] = useState([]);

  const [addOpen, setAddOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [drawerId, setDrawerId] = useState(null);
  const [snack, setSnack] = useState(null); // { message, severity }

  // Drag-and-drop: stash the card currently being dragged ({ id, stage }).
  const dragRef = React.useRef(null);
  // After a successful stage move we prompt for an activity + next action.
  const [pendingMove, setPendingMove] = useState(null);

  const notify = useCallback((message, severity = "info") => {
    setSnack({ message, severity });
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [p, cl, r, c, email, users, collabs] = await Promise.all([
        listProspects(),
        listClients(),
        listRecurring(),
        listOrderCycles(),
        getCurrentUserEmail(),
        listAssignableUsers(),
        listAllCollaborators(),
      ]);
      setProspects(p);
      setClients(cl);
      setRecurring(r);
      setCycles(c);
      setCurrentEmail(email);
      setAssignableUsers(users);
      setCollaboratorRows(collabs);
    } catch (e) {
      setErr(e?.message || "Failed to load pipeline.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Lowercased email→user map for name lookups (display) and picker value.
  const userMap = useMemo(() => buildUserMap(assignableUsers), [assignableUsers]);

  // pipeline_id → [lowercased collaborator emails]. Empty map is fine; cards and
  // scope checks simply find no collaborators.
  const collabMap = useMemo(() => {
    const map = new Map();
    (collaboratorRows || []).forEach((row) => {
      if (!row || row.pipeline_id == null || !row.email) return;
      const key = row.pipeline_id;
      const email = String(row.email).toLowerCase();
      const arr = map.get(key);
      if (arr) arr.push(email);
      else map.set(key, [email]);
    });
    return map;
  }, [collaboratorRows]);

  // Re-fetch just the collaborator rows after an add/remove so chips update
  // without reloading the whole board.
  const refreshCollaborators = useCallback(async () => {
    const collabs = await listAllCollaborators();
    setCollaboratorRows(collabs);
  }, []);

  const matchesScope = useCallback(
    (row) => {
      if (scope === "all") return true;
      if (!currentEmail) return true;
      // 'my' scope: a rep sees rows they own plus unassigned (claimable) leads.
      const owner = row?.owner_email;
      if (owner === currentEmail || owner == null || owner === "") return true;
      // …and co-worked leads where the rep is a collaborator.
      const collabs = collabMap.get(row?.id) || [];
      return collabs.includes(String(currentEmail).toLowerCase());
    },
    [scope, currentEmail, collabMap]
  );

  const matchesSearch = useCallback(
    (row) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [row.company_name, row.customer_code, row.city, row.gstin]
        .some((f) => String(f || "").toLowerCase().includes(q));
    },
    [search]
  );

  const filteredProspects = useMemo(
    () => prospects.filter((r) => matchesScope(r) && matchesSearch(r)),
    [prospects, matchesScope, matchesSearch]
  );

  const prospectsByStage = useMemo(() => {
    const map = {};
    PROSPECT_STAGES.forEach((s) => (map[s.key] = []));
    filteredProspects.forEach((r) => {
      const key = r.prospect_stage || PROSPECT_STAGES[0].key;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    return map;
  }, [filteredProspects]);

  // Clients: scope + search + client_stage filter, for the table view.
  const filteredClients = useMemo(
    () =>
      clients.filter(
        (r) =>
          matchesScope(r) &&
          matchesSearch(r) &&
          (!clientStageFilter || r.client_stage === clientStageFilter)
      ),
    [clients, matchesScope, matchesSearch, clientStageFilter]
  );

  // Recurring: order cycles filtered by scope + search (match against company_name).
  const filteredCycles = useMemo(
    () => cycles.filter((c) => matchesScope(c) && matchesSearch(c)),
    [cycles, matchesScope, matchesSearch]
  );

  const cyclesByStage = useMemo(() => {
    const map = {};
    CYCLE_STAGES.forEach((s) => (map[s.key] = []));
    filteredCycles.forEach((c) => {
      if (!map[c.cycle_stage]) map[c.cycle_stage] = [];
      map[c.cycle_stage].push(c);
    });
    return map;
  }, [filteredCycles]);

  const recurringCustomers = useMemo(
    () => recurring.filter((r) => matchesScope(r) && matchesSearch(r)),
    [recurring, matchesScope, matchesSearch]
  );

  // Move a prospect to a new prospect_stage, then prompt to log the move + plan a
  // next action. Uses the direct prospect_stage mover (not the legacy RPC).
  const handleMoveStage = async (id, toStage) => {
    const company = prospects.find((p) => p.id === id);
    if (company && company.prospect_stage === toStage) return; // no-op
    try {
      await moveProspectStage(id, toStage);
      await loadAll();
      setPendingMove({
        kind: "prospect",
        id,
        companyName: company?.company_name || "Company",
        toStage,
        stageLabel: PROSPECT_STAGE_LABELS[toStage] || toStage,
      });
    } catch (e) {
      setErr(e?.message || "Move failed.");
    }
  };

  // Change a client's client_stage inline from the table.
  const handleClientStageChange = async (id, toStage) => {
    const client = clients.find((c) => c.id === id);
    if (client && client.client_stage === toStage) return; // no-op
    try {
      await updateClientStage(id, toStage);
      await loadAll();
      notify("Client stage updated.", "success");
    } catch (e) {
      setErr(e?.message || "Failed to update client stage.");
    }
  };

  const handleMoveCycle = async (id, toStage) => {
    const cycle = cycles.find((c) => c.id === id);
    if (cycle && cycle.cycle_stage === toStage) return; // no-op
    try {
      await moveOrderCycle(id, toStage, null);
      await loadAll();
      setPendingMove({
        kind: "recurring",
        id,
        companyName: cycle?.company_name || cycle?.customer_code || "Customer",
        toStage,
        stageLabel: CYCLE_STAGE_LABELS[toStage] || toStage,
      });
    } catch (e) {
      setErr(e?.message || "Move failed.");
    }
  };

  // Native drag handlers shared by both boards.
  const handleDragStart = useCallback((id, stage) => {
    dragRef.current = { id, stage };
  }, []);
  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  // A card was dropped onto a column. Only move if the stage actually changed.
  const handleDropProspect = useCallback(
    (toStage) => {
      const dragged = dragRef.current;
      dragRef.current = null;
      if (!dragged || dragged.stage === toStage) return;
      handleMoveStage(dragged.id, toStage);
    },
    [handleMoveStage]
  );

  const handleDropCycle = useCallback(
    (toStage) => {
      const dragged = dragRef.current;
      dragRef.current = null;
      if (!dragged || dragged.stage === toStage) return;
      handleMoveCycle(dragged.id, toStage);
    },
    [handleMoveCycle]
  );

  const handleAddCompany = async (payload) => {
    await addCompany(payload);
    await loadAll();
  };

  return (
    <Container maxWidth={false} sx={{ py: 2, height: "calc(100vh - 64px)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        alignItems={{ md: "center" }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TrendingUpIcon color="primary" />
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
            {view === "clients" ? "Client Management" : "Prospect Management"}
          </Typography>
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => v && setView(v)}
          >
            <ToggleButton value="prospects">Prospects</ToggleButton>
            <ToggleButton value="clients">Clients</ToggleButton>
          </ToggleButtonGroup>

          {view === "clients" && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={clientTab}
              onChange={(_, v) => v && setClientTab(v)}
            >
              <ToggleButton value="accounts">Accounts table</ToggleButton>
              <ToggleButton value="cycles">Order cycles</ToggleButton>
            </ToggleButtonGroup>
          )}

          <ToggleButtonGroup
            size="small"
            exclusive
            value={scope}
            onChange={(_, v) => v && setScope(v)}
          >
            <ToggleButton value="my">My pipeline</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>

          {view === "clients" && clientTab === "accounts" && (
            <TextField
              select
              size="small"
              label="Client stage"
              value={clientStageFilter}
              onChange={(e) => setClientStageFilter(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All stages</MenuItem>
              {CLIENT_STAGES.map((s) => (
                <MenuItem key={s.key} value={s.key}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            size="small"
            placeholder="Search company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 200 }}
          />

          <Button
            variant="outlined"
            color="primary"
            startIcon={<SummarizeIcon />}
            onClick={() => setReportOpen(true)}
          >
            Generate CRM Report
          </Button>

          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
            Add company
          </Button>
        </Stack>
      </Stack>

      {err && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setErr(null)}>
          {err}
        </Alert>
      )}

      {/* Board area */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <BoardSkeleton />
        ) : view === "prospects" ? (
          <ProspectsBoard
            theme={theme}
            byStage={prospectsByStage}
            onOpen={(id) => setDrawerId(id)}
            onMove={handleMoveStage}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDropCard={handleDropProspect}
            empty={filteredProspects.length === 0}
            scope={scope}
            userMap={userMap}
            collabMap={collabMap}
          />
        ) : clientTab === "cycles" ? (
          <RecurringView
            theme={theme}
            cyclesByStage={cyclesByStage}
            customers={recurringCustomers}
            cycles={filteredCycles}
            onMove={handleMoveCycle}
            onOpen={(id) => setDrawerId(id)}
            onNotify={notify}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDropCard={handleDropCycle}
            userMap={userMap}
            collabMap={collabMap}
          />
        ) : (
          <ClientsTable
            theme={theme}
            clients={filteredClients}
            scope={scope}
            userMap={userMap}
            onOpen={(id) => setDrawerId(id)}
            onStageChange={handleClientStageChange}
          />
        )}
      </Box>

      <AddCompanyDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAddCompany}
        currentEmail={currentEmail}
      />

      <CrmReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />

      <CompanyDrawer
        id={drawerId}
        open={Boolean(drawerId)}
        onClose={() => setDrawerId(null)}
        onChanged={loadAll}
        users={assignableUsers}
        userMap={userMap}
        collaborators={drawerId ? collabMap.get(drawerId) || [] : []}
        onCollaboratorsChanged={refreshCollaborators}
      />

      <LogNextActionDialog
        open={Boolean(pendingMove)}
        move={pendingMove}
        onClose={() => setPendingMove(null)}
        onSaved={async () => {
          setPendingMove(null);
          await loadAll();
          notify("Activity logged & next action planned.", "success");
        }}
        onError={(msg) => setErr(msg)}
      />

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={5000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {snack ? (
          <Alert
            severity={snack.severity}
            variant="filled"
            onClose={() => setSnack(null)}
            sx={{ width: "100%" }}
          >
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Container>
  );
}

function ProspectsBoard({ theme, byStage, onOpen, onMove, onDragStart, onDragEnd, onDropCard, empty, scope, userMap, collabMap }) {
  if (empty) {
    return (
      <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          No prospects {scope === "my" ? "assigned to you" : "yet"}
        </Typography>
        <Typography variant="body2">
          Add a company or switch to the "All" view to see more.
        </Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ display: "flex", gap: 1.5, overflowX: "auto", height: "100%", pb: 1 }}>
      {PROSPECT_STAGES.map((stage) => (
        <KanbanColumn
          key={stage.key}
          stage={stage}
          items={byStage[stage.key] || []}
          theme={theme}
          onDropCard={onDropCard}
          renderCard={(company) => (
            <PipelineCard
              company={company}
              onOpen={onOpen}
              onMove={onMove}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              stages={PROSPECT_STAGES}
              currentStageKey={company.prospect_stage}
              userMap={userMap}
              collaborators={(collabMap && collabMap.get(company.id)) || []}
            />
          )}
        />
      ))}
    </Box>
  );
}

/* ----------------------------------------------------------------------- */
/* Clients table (dense, scannable) — the Client Management mode            */
/* ----------------------------------------------------------------------- */

/* Inline client-stage picker rendered as a chip-styled Select in the table. */
function ClientStageSelect({ row, onStageChange }) {
  const value = row.client_stage || "";
  return (
    <Select
      size="small"
      variant="standard"
      disableUnderline
      value={value}
      displayEmpty
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onStageChange(row.id, e.target.value);
      }}
      renderValue={(v) => (
        <Chip
          size="small"
          label={CLIENT_STAGE_LABELS[v] || "Set stage"}
          color={v ? "primary" : "default"}
          variant={v ? "filled" : "outlined"}
          sx={{ height: 22, "& .MuiChip-label": { px: 0.9, fontSize: 11, fontWeight: 600 } }}
        />
      )}
      sx={{ "& .MuiSelect-select": { py: 0, pr: "20px !important" } }}
    >
      {CLIENT_STAGES.map((s) => (
        <MenuItem key={s.key} value={s.key} sx={{ fontSize: 13 }}>
          {s.label}
        </MenuItem>
      ))}
    </Select>
  );
}

function ClientsTable({ theme, clients, scope, userMap, onOpen, onStageChange }) {
  if (!clients || clients.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          No clients {scope === "my" ? "assigned to you" : "yet"}
        </Typography>
        <Typography variant="body2">
          Convert a prospect or switch to the "All" view to see more.
        </Typography>
      </Box>
    );
  }

  const headSx = {
    fontWeight: 700,
    fontSize: 12,
    color: "text.secondary",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
    bgcolor: alpha(theme.palette.text.primary, 0.03),
  };
  const cellSx = { fontSize: 13, whiteSpace: "nowrap" };

  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{ height: "100%", borderRadius: 2, overflow: "auto" }}
    >
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={headSx}>Code</TableCell>
            <TableCell sx={headSx}>Company</TableCell>
            <TableCell sx={headSx}>Industry</TableCell>
            <TableCell sx={headSx}>City</TableCell>
            <TableCell sx={headSx}>GST</TableCell>
            <TableCell sx={headSx}>Salesperson</TableCell>
            <TableCell sx={headSx}>Payment terms</TableCell>
            <TableCell sx={{ ...headSx, textAlign: "right" }}>Credit limit</TableCell>
            <TableCell sx={headSx}>Client stage</TableCell>
            <TableCell sx={headSx}>Last contact</TableCell>
            <TableCell sx={{ ...headSx, textAlign: "right" }}>Value</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {clients.map((c) => (
            <TableRow
              key={c.id}
              hover
              onClick={() => onOpen(c.id)}
              sx={{ cursor: "pointer" }}
            >
              <TableCell sx={{ ...cellSx, fontWeight: 600 }}>
                {c.customer_code || "—"}
              </TableCell>
              <TableCell sx={{ ...cellSx, fontWeight: 700 }}>
                {c.company_name || "—"}
              </TableCell>
              <TableCell sx={cellSx}>{c.industry || "—"}</TableCell>
              <TableCell sx={cellSx}>{c.city || "—"}</TableCell>
              <TableCell sx={cellSx}>{c.gstin || "—"}</TableCell>
              <TableCell sx={cellSx}>
                {ownerLabel(c.owner_email, userMap) || "Unassigned"}
              </TableCell>
              <TableCell sx={cellSx}>{c.payment_terms || "—"}</TableCell>
              <TableCell sx={{ ...cellSx, textAlign: "right" }}>
                {c.credit_limit != null && c.credit_limit !== ""
                  ? inrFull(c.credit_limit)
                  : "—"}
              </TableCell>
              <TableCell sx={cellSx}>
                <ClientStageSelect row={c} onStageChange={onStageChange} />
              </TableCell>
              <TableCell sx={cellSx}>{fmtDate(c.last_contact_date)}</TableCell>
              <TableCell sx={{ ...cellSx, textAlign: "right", fontWeight: 600 }}>
                {(() => {
                  const v = c.total_value != null ? c.total_value : c.value;
                  return v != null && Number(v) > 0 ? inrFull(v) : "—";
                })()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function RecurringView({ theme, cyclesByStage, customers, cycles, onMove, onOpen, onNotify, onDragStart, onDragEnd, onDropCard, userMap, collabMap }) {
  const cycleCount = cycles.length;

  // Cycles live in a separate table keyed by customer_code; map that back to the
  // owning recurring pipeline row's id so we can look up its collaborators.
  const pipelineIdByCustomerCode = useMemo(() => {
    const map = new Map();
    (customers || []).forEach((c) => {
      if (c && c.customer_code) map.set(c.customer_code, c.id);
    });
    return map;
  }, [customers]);

  const collabsForCycle = useCallback(
    (cycle) => {
      if (!collabMap || !cycle?.customer_code) return [];
      const pid = pipelineIdByCustomerCode.get(cycle.customer_code);
      return (pid && collabMap.get(pid)) || [];
    },
    [collabMap, pipelineIdByCustomerCode]
  );
  return (
    <Stack spacing={2} sx={{ height: "100%" }}>
      {/* Per-customer summary */}
      {customers.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Recurring customers ({customers.length})
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0,1fr))", md: "repeat(3, minmax(0,1fr))" },
              gap: 1.5,
            }}
          >
            {customers.map((c) => (
              <Paper
                key={c.id}
                variant="outlined"
                onClick={() => onOpen(c.id)}
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  cursor: "pointer",
                  "&:hover": { borderColor: alpha(theme.palette.primary.main, 0.5) },
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
                  {c.company_name}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  {c.customer_code && (
                    <Typography variant="caption" color="text.secondary">
                      {c.customer_code}
                    </Typography>
                  )}
                  {c.owner_email && (
                    <Chip size="small" label={ownerLabel(c.owner_email, userMap)} sx={{ height: 20 }} />
                  )}
                  <CollaboratorChips emails={collabMap && collabMap.get(c.id)} userMap={userMap} />
                </Stack>
              </Paper>
            ))}
          </Box>
        </Box>
      )}

      {/* Order-cycle kanban */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Order cycles ({cycleCount})
        </Typography>
        {cycleCount === 0 ? (
          <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
            <Typography variant="body2">No active order cycles.</Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", gap: 1.5, overflowX: "auto", pb: 1 }}>
            {CYCLE_STAGES.map((stage) => (
              <KanbanColumn
                key={stage.key}
                stage={stage}
                items={cyclesByStage[stage.key] || []}
                theme={theme}
                onDropCard={onDropCard}
                renderCard={(cycle) => (
                  <OrderCycleCard
                    cycle={cycle}
                    onMove={onMove}
                    theme={theme}
                    onNotify={onNotify}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    userMap={userMap}
                    collaborators={collabsForCycle(cycle)}
                  />
                )}
              />
            ))}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
