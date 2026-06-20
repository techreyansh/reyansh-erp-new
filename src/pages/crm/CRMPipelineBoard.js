import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
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

import { inrCompact, inrFull } from "../../components/common/kit/format";
import {
  STAGES,
  CYCLE_STAGES,
  STAGE_LABELS,
  CYCLE_STAGE_LABELS,
  ACTIVITY_TYPES,
  SOURCES,
  listProspects,
  listRecurring,
  listOrderCycles,
  getCompany,
  moveStage,
  moveOrderCycle,
  addActivity,
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
  const idx = STAGES.findIndex((s) => s.key === stageKey);
  if (idx < 0) return null;
  const denom = Math.max(1, STAGES.length - 1);
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
  const score = leadScoreForStage(company.stage);

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
        onDragStart?.(company.id, company.stage);
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
    stage: STAGES[0].key,
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
        stage: form.stage,
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
            {STAGES.map((s) => (
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

function CompanyDrawer({ id, open, onClose, onChanged, users, userMap, collaborators, onCollaboratorsChanged }) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);

  // Editable fields
  const [editValue, setEditValue] = useState("");
  const [editNextAction, setEditNextAction] = useState("");
  const [editNextDate, setEditNextDate] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [savingDeal, setSavingDeal] = useState(false);

  // Imported CRM fields (editable)
  const [editIndustry, setEditIndustry] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editProductCategory, setEditProductCategory] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Activity form
  const [actType, setActType] = useState("note");
  const [actSubject, setActSubject] = useState("");
  const [actBody, setActBody] = useState("");
  const [actFollowUp, setActFollowUp] = useState("");
  const [savingAct, setSavingAct] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const d = await getCompany(id);
      setDetail(d);
      setEditValue(d.company?.value ?? "");
      setEditNextAction(d.company?.next_action ?? "");
      setEditNextDate(d.company?.next_action_date ?? "");
      setOwnerEmail(d.company?.owner_email ?? "");
      setEditIndustry(d.company?.industry ?? "");
      setEditCity(d.company?.city ?? "");
      setEditProductCategory(d.company?.product_category ?? "");
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

  const saveField = async (patch) => {
    try {
      await updateCompany(id, patch);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e?.message || "Update failed.");
    }
  };

  const saveDeal = async () => {
    setSavingDeal(true);
    await saveField({
      value: editValue === "" ? null : Number(editValue),
      next_action: editNextAction || null,
      next_action_date: editNextDate || null,
    });
    setSavingDeal(false);
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    await saveField({
      industry: editIndustry.trim() || null,
      city: editCity.trim() || null,
      product_category: editProductCategory.trim() || null,
    });
    setSavingProfile(false);
  };

  const [savingCollab, setSavingCollab] = useState(false);

  // Lowercased collaborator emails for this lead (from the board's collabMap).
  const collabEmails = useMemo(
    () => (collaborators || []).map((e) => String(e).toLowerCase()),
    [collaborators]
  );

  // Selected user objects for the multi-select value: resolve each collaborator
  // email to a known user, or fall back to a synthetic { email } so the chip
  // still renders a label.
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

  // Diff the new selection against the current collaborators and apply the
  // adds/removes, then refresh the board's collaborator map so chips update.
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

  // Assign / unassign the owner. Pass an email to assign, or null/"" to clear.
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
    } catch (e) {
      setErr(e?.message || "Failed to add activity.");
    } finally {
      setSavingAct(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: "100%", sm: 460 },
          maxWidth: "100%",
          top: { xs: 56, sm: 64 },
          height: { xs: "calc(100% - 56px)", sm: "calc(100% - 64px)" },
          overflowY: "auto",
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
              {company?.company_name || (loading ? "Loading…" : "Company")}
            </Typography>
            {company && (
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={STAGE_LABELS[company.stage] || company.stage}
                  color="primary"
                  sx={{ height: 22 }}
                />
                {company.customer_code && (
                  <Typography variant="caption" color="text.secondary">
                    {company.customer_code}
                  </Typography>
                )}
              </Stack>
            )}
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>

        {err && (
          <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setErr(null)}>
            {err}
          </Alert>
        )}

        {loading && !company ? (
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <Skeleton variant="rounded" height={80} />
            <Skeleton variant="rounded" height={120} />
            <Skeleton variant="rounded" height={120} />
          </Stack>
        ) : company ? (
          <Stack spacing={2.5} sx={{ mt: 2 }}>
            {/* Contact info */}
            <Box>
              <SectionTitle>Contact</SectionTitle>
              <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                <InfoRow label="Person" value={company.contact_person} />
                <InfoRow label="Phone" value={company.phone} />
                <InfoRow label="Email" value={company.email} />
                <InfoRow label="Source" value={company.source} />
              </Stack>
            </Box>

            <Divider />

            {/* Editable: imported company profile (industry / city / product) */}
            <Box>
              <SectionTitle>Company profile</SectionTitle>
              {(company.industry || company.city || company.product_category) && (
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  sx={{ mt: 0.75 }}
                  flexWrap="wrap"
                  useFlexGap
                >
                  {company.industry && (
                    <Chip
                      size="small"
                      label={company.industry}
                      variant="outlined"
                      sx={{ height: 22, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }}
                    />
                  )}
                  {company.city && (
                    <Chip
                      size="small"
                      icon={<PlaceIcon sx={{ fontSize: 14 }} />}
                      label={company.city}
                      variant="outlined"
                      sx={{ height: 22, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }}
                    />
                  )}
                  {company.product_category && (
                    <Chip
                      size="small"
                      label={company.product_category}
                      variant="outlined"
                      color="primary"
                      sx={{ height: 22, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }}
                    />
                  )}
                </Stack>
              )}
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <TextField
                  label="Industry"
                  size="small"
                  value={editIndustry}
                  onChange={(e) => setEditIndustry(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="City"
                  size="small"
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Product category"
                  size="small"
                  value={editProductCategory}
                  onChange={(e) => setEditProductCategory(e.target.value)}
                  fullWidth
                />
                <Button
                  variant="outlined"
                  size="small"
                  disabled={savingProfile}
                  onClick={saveProfile}
                  sx={{ alignSelf: "flex-start", px: 2.5 }}
                >
                  {savingProfile ? "Saving…" : "Save profile"}
                </Button>
              </Stack>
            </Box>

            <Divider />

            {/* Editable: value + next action + assign owner */}
            <Box>
              <SectionTitle>Deal & next action</SectionTitle>
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <TextField
                  label="Value (₹)"
                  type="number"
                  size="small"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Next action"
                  size="small"
                  value={editNextAction}
                  onChange={(e) => setEditNextAction(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Next action date"
                  type="date"
                  size="small"
                  value={editNextDate || ""}
                  onChange={(e) => setEditNextDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={savingDeal}
                  onClick={saveDeal}
                  sx={{ alignSelf: "flex-start", px: 2.5 }}
                >
                  {savingDeal ? "Saving…" : "Save changes"}
                </Button>

                <Divider sx={{ my: 0.5 }} />

                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  Owner
                </Typography>
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
                    String(o?.email || "").toLowerCase() ===
                    String(v?.email || "").toLowerCase()
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Owner"
                      placeholder="Unassigned"
                    />
                  )}
                />
                {ownerEmail && (
                  <Button
                    size="small"
                    variant="text"
                    color="inherit"
                    onClick={() => saveOwner(null)}
                    sx={{ alignSelf: "flex-start" }}
                  >
                    Unassign
                  </Button>
                )}

                <Divider sx={{ my: 0.5 }} />

                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  Collaborators (co-working)
                </Typography>
                <Autocomplete
                  multiple
                  size="small"
                  disabled={savingCollab}
                  options={users || []}
                  value={collabValue}
                  onChange={(_, v) => onChangeCollaborators(v)}
                  getOptionLabel={(o) => userOptionLabel(o)}
                  isOptionEqualToValue={(o, v) =>
                    String(o?.email || "").toLowerCase() ===
                    String(v?.email || "").toLowerCase()
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Collaborators"
                      placeholder="Add co-workers"
                    />
                  )}
                />
              </Stack>
            </Box>

            <Divider />

            {/* Activities */}
            <Box>
              <SectionTitle>Add activity</SectionTitle>
              <Stack spacing={1.25} sx={{ mt: 1 }}>
                <Stack direction="row" spacing={1}>
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
                  label="Note"
                  size="small"
                  value={actBody}
                  onChange={(e) => setActBody(e.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    label="Next follow-up"
                    type="date"
                    size="small"
                    value={actFollowUp}
                    onChange={(e) => setActFollowUp(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                  <Button variant="contained" size="small" onClick={submitActivity} disabled={savingAct}>
                    {savingAct ? "…" : "Log"}
                  </Button>
                </Stack>
              </Stack>

              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {detail.activities.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No activities yet.
                  </Typography>
                ) : (
                  detail.activities.map((a) => (
                    <Paper key={a.id} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Chip
                          size="small"
                          label={a.activity_type}
                          sx={{ height: 20, textTransform: "capitalize" }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {fmtDateTime(a.activity_at)}
                        </Typography>
                      </Stack>
                      {a.subject && (
                        <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
                          {a.subject}
                        </Typography>
                      )}
                      {a.body && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {a.body}
                        </Typography>
                      )}
                      {a.next_follow_up_date && (
                        <Typography variant="caption" color="primary.main" sx={{ display: "block", mt: 0.25 }}>
                          Follow up: {fmtDate(a.next_follow_up_date)}
                        </Typography>
                      )}
                    </Paper>
                  ))
                )}
              </Stack>
            </Box>

            <Divider />

            {/* Stage timeline */}
            <Box>
              <SectionTitle>Stage timeline</SectionTitle>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {detail.history.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No stage changes yet.
                  </Typography>
                ) : (
                  detail.history.map((h) => (
                    <Stack
                      key={h.id}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ fontSize: 13 }}
                    >
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          bgcolor: "primary.main",
                          flexShrink: 0,
                        }}
                      />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2">
                          {h.from_stage ? (STAGE_LABELS[h.from_stage] || h.from_stage) : "New"}
                          {"  →  "}
                          <strong>{STAGE_LABELS[h.to_stage] || h.to_stage}</strong>
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {h.moved_by_email || "—"} · {fmtDateTime(h.moved_at)}
                          {h.note ? ` · ${h.note}` : ""}
                        </Typography>
                      </Box>
                    </Stack>
                  ))
                )}
              </Stack>
            </Box>

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
                            <Chip
                              size="small"
                              label={CYCLE_STAGE_LABELS[oc.cycle_stage] || oc.cycle_stage}
                              sx={{ height: 20 }}
                            />
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
        ) : null}
      </Box>
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

function InfoRow({ label, value }) {
  return (
    <Stack direction="row" spacing={1} justifyContent="space-between">
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500, textAlign: "right", wordBreak: "break-word" }}>
        {value || "—"}
      </Typography>
    </Stack>
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

  // View is driven by the URL (?view=prospects | ?view=recurring) so the two CRM
  // nav links deep-link straight to the right pipeline. Default 'prospects'.
  const urlView = searchParams.get("view") === "recurring" ? "recurring" : "prospects";
  const view = urlView; // 'prospects' (New Customers) | 'recurring' (Repeat Customers)

  const setView = useCallback(
    (next) => {
      if (!next || next === view) return;
      const params = new URLSearchParams(searchParams);
      params.set("view", next);
      setSearchParams(params, { replace: true });
    },
    [view, searchParams, setSearchParams]
  );
  const [scope, setScope] = useState("my"); // 'my' | 'all'
  const [search, setSearch] = useState("");

  const [currentEmail, setCurrentEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [prospects, setProspects] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  // Flat list of { pipeline_id, email } collaborator rows (co-working leads).
  const [collaboratorRows, setCollaboratorRows] = useState([]);

  const [addOpen, setAddOpen] = useState(false);
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
      const [p, r, c, email, users, collabs] = await Promise.all([
        listProspects(),
        listRecurring(),
        listOrderCycles(),
        getCurrentUserEmail(),
        listAssignableUsers(),
        listAllCollaborators(),
      ]);
      setProspects(p);
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
      return String(row.company_name || "").toLowerCase().includes(q);
    },
    [search]
  );

  const filteredProspects = useMemo(
    () => prospects.filter((r) => matchesScope(r) && matchesSearch(r)),
    [prospects, matchesScope, matchesSearch]
  );

  const prospectsByStage = useMemo(() => {
    const map = {};
    STAGES.forEach((s) => (map[s.key] = []));
    filteredProspects.forEach((r) => {
      if (!map[r.stage]) map[r.stage] = [];
      map[r.stage].push(r);
    });
    return map;
  }, [filteredProspects]);

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

  // Move a prospect, then prompt to log the move + plan a next action.
  const handleMoveStage = async (id, toStage) => {
    const company = prospects.find((p) => p.id === id);
    if (company && company.stage === toStage) return; // no-op
    try {
      await moveStage(id, toStage, null);
      await loadAll();
      setPendingMove({
        kind: "prospect",
        id,
        companyName: company?.company_name || "Company",
        toStage,
        stageLabel: STAGE_LABELS[toStage] || toStage,
      });
    } catch (e) {
      setErr(e?.message || "Move failed.");
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
            {view === "recurring" ? "Repeat Customer Pipeline" : "New Customer Pipeline"}
          </Typography>
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => v && setView(v)}
          >
            <ToggleButton value="prospects">New Customers</ToggleButton>
            <ToggleButton value="recurring">Repeat Customers</ToggleButton>
          </ToggleButtonGroup>

          <ToggleButtonGroup
            size="small"
            exclusive
            value={scope}
            onChange={(_, v) => v && setScope(v)}
          >
            <ToggleButton value="my">My pipeline</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>

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
        ) : (
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
        )}
      </Box>

      <AddCompanyDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAddCompany}
        currentEmail={currentEmail}
      />

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
      {STAGES.map((stage) => (
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
              stages={STAGES}
              currentStageKey={company.stage}
              userMap={userMap}
              collaborators={(collabMap && collabMap.get(company.id)) || []}
            />
          )}
        />
      ))}
    </Box>
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
