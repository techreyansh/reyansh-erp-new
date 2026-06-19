import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import { EventNoteOutlined } from "@mui/icons-material";
import { getMyFollowups, STAGE_LABELS } from "../../services/crmPipelineService";

const CRM_PATH = "/crm-pipeline";

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

function FollowupRow({ item, accent, onOpen }) {
  const stageLabel = item.stage ? STAGE_LABELS[item.stage] || item.stage : null;
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
    </Box>
  );
}

function FollowupGroup({ emoji, title, items, accent, onOpen }) {
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
        {items.map((it) => (
          <FollowupRow key={`${it.kind}-${it.id}`} item={it} accent={accent} onOpen={onOpen} />
        ))}
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
          <FollowupGroup emoji="🔴" title="Overdue" items={data.overdue} accent={accents.overdue} onOpen={openCrm} />
          <FollowupGroup emoji="🟡" title="Today" items={data.today} accent={accents.today} onOpen={openCrm} />
          <FollowupGroup
            emoji="🔵"
            title="Upcoming (next 7 days)"
            items={data.upcoming}
            accent={accents.upcoming}
            onOpen={openCrm}
          />
        </Stack>
      )}
    </Paper>
  );
}

export default MyFollowups;
