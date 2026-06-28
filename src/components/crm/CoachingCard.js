import React, { useEffect, useState } from "react";
import { Card, CardContent, Stack, Typography, Chip, Box, Divider, useTheme, alpha } from "@mui/material";
import {
  TipsAndUpdatesOutlined, RecordVoiceOverOutlined, ShieldOutlined, ScheduleOutlined,
} from "@mui/icons-material";
import { listPlaybook } from "../../services/crmCoachingService";

// Module-level cache so many cards on a board don't each refetch the playbook.
let _cache = null;
function loadOnce() {
  if (!_cache) _cache = listPlaybook();
  return _cache;
}
/** Reset the cache after an edit/import so cards pick up new content. */
export function refreshCoachingCache() { _cache = null; }

const CHANNEL_LABEL = { call: "Call", whatsapp: "WhatsApp", email: "Email" };

/**
 * Coaching card: "what to say & when" for an account's current stage.
 * props: { scope: 'prospect'|'client', stageKey, dense }
 * Renders nothing if there's no playbook row for the stage.
 */
export default function CoachingCard({ scope, stageKey, dense = false }) {
  const theme = useTheme();
  const [row, setRow] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!scope || !stageKey) { setRow(null); return undefined; }
    loadOnce().then((rows) => {
      if (!alive) return;
      const hit = (rows || []).find((r) => r.scope === scope && r.stage_key === stageKey) || null;
      setRow(hit);
    });
    return () => { alive = false; };
  }, [scope, stageKey]);

  if (!row) return null;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: alpha(theme.palette.success.main, 0.4), bgcolor: alpha(theme.palette.success.main, 0.04) }}>
      <CardContent sx={{ p: dense ? 1.5 : 2, "&:last-child": { pb: dense ? 1.5 : 2 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <TipsAndUpdatesOutlined fontSize="small" sx={{ color: theme.palette.success.main }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Coaching — what to do now</Typography>
          {row.channel && <Chip size="small" variant="outlined" label={CHANNEL_LABEL[row.channel] || row.channel} sx={{ height: 20 }} />}
        </Stack>

        {row.recommended_action && (
          <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
            <ScheduleOutlined fontSize="small" sx={{ color: "text.secondary", mt: "2px" }} />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.recommended_action}</Typography>
              {row.sla_days != null && (
                <Chip size="small" color="warning" variant="outlined" label={`Follow up within ${row.sla_days} day${row.sla_days === 1 ? "" : "s"}`} sx={{ height: 18, mt: 0.5 }} />
              )}
            </Box>
          </Stack>
        )}

        {row.talk_track && (
          <>
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" alignItems="flex-start" spacing={1}>
              <RecordVoiceOverOutlined fontSize="small" sx={{ color: "text.secondary", mt: "2px" }} />
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: "block" }}>What to say</Typography>
                <Typography variant="body2">{row.talk_track}</Typography>
              </Box>
            </Stack>
          </>
        )}

        {row.objection_prompt && (
          <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mt: 1 }}>
            <ShieldOutlined fontSize="small" sx={{ color: "text.secondary", mt: "2px" }} />
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: "block" }}>If they object</Typography>
              <Typography variant="body2" color="text.secondary">{row.objection_prompt}</Typography>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
