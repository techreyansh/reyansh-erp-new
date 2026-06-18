import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Card, CardContent, Typography, Chip, Stack, Button, Divider,
  CircularProgress, LinearProgress, Tooltip, alpha,
} from '@mui/material';
import {
  ShieldOutlined, EventAvailableOutlined, ArrowForwardOutlined, FiberManualRecord,
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import {
  getScorecardByEmail, getMyOpenActions, subscribeScorecard,
} from '../../services/accountabilityService';

const BAND_LABEL = { GREEN: 'On track', AMBER: 'Watch', RED: 'At risk' };

/**
 * Live accountability snapshot for one employee, shown on their dashboard.
 * Resolves the person by `email`, streams score changes over Supabase realtime,
 * and surfaces their open action items. Editing KPIs anywhere updates this live.
 */
const AccountabilityWidget = ({ email }) => {
  const theme = useTheme();
  const BAND = {
    GREEN: theme.palette.success.main,
    AMBER: theme.palette.warning.main,
    RED: theme.palette.error.main,
  };
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const empIdRef = useRef(null);

  const load = useCallback(async (showSpinner = true) => {
    if (!email) { setLoading(false); return; }
    if (showSpinner) setLoading(true);
    try {
      const res = await getScorecardByEmail(email);
      setData(res);
      const empId = res.registered ? res.scorecard?.employee_id : null;
      empIdRef.current = empId;
      setActions(empId ? await getMyOpenActions(empId) : []);
    } catch {
      setData({ registered: false });
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { load(); }, [load]);

  // Live: re-pull when this employee's scorecard row changes server-side.
  useEffect(() => {
    if (!data?.registered || !empIdRef.current) return undefined;
    setLive(true);
    const unsub = subscribeScorecard(empIdRef.current, () => load(false));
    return () => { setLive(false); unsub?.(); };
  }, [data?.registered, load]);

  if (loading) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <CircularProgress size={28} />
        </CardContent>
      </Card>
    );
  }

  const sc = data?.registered ? data.scorecard : null;
  const score = sc?.final_score_pct;
  const band = sc?.band;
  const color = BAND[band] || theme.palette.text.secondary;

  return (
    <Card sx={{ height: '100%', borderTop: `4px solid ${color}` }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShieldOutlined fontSize="small" /> Accountability
          </Typography>
          {live && (
            <Tooltip title="Live — updates the moment your scorecard changes">
              <Chip
                size="small" icon={<FiberManualRecord sx={{ fontSize: '10px !important' }} />} label="Live"
                sx={(theme) => ({ height: 22, fontWeight: 700, color: 'success.main', bgcolor: alpha(theme.palette.success.main, 0.12),
                      '& .MuiChip-icon': { color: theme.palette.success.main } })}
              />
            </Tooltip>
          )}
        </Stack>

        {!data?.registered ? (
          <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
            <ShieldOutlined sx={{ fontSize: 40, opacity: 0.3, mb: 1 }} />
            <Typography variant="body2">Not on the accountability register yet.</Typography>
            <Button size="small" sx={{ mt: 1 }} endIcon={<ArrowForwardOutlined />} onClick={() => navigate('/accountability')}>
              Set up scorecard
            </Button>
          </Box>
        ) : (
          <>
            <Stack direction="row" alignItems="baseline" spacing={1.5}>
              <Typography variant="h3" sx={{ fontWeight: 800, color, lineHeight: 1 }}>
                {score != null ? `${score}%` : '—'}
              </Typography>
              {band && (
                <Chip label={BAND_LABEL[band] || band} size="small"
                      sx={{ fontWeight: 700, color, bgcolor: alpha(color, 0.14) }} />
              )}
            </Stack>
            <LinearProgress
              variant="determinate" value={Math.min(Number(score) || 0, 100)}
              sx={{ mt: 1.5, height: 8, borderRadius: 4, bgcolor: alpha(color, 0.12),
                    '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 4 } }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              {sc?.employee?.role?.name ? `${sc.employee.role.name} · ` : ''}
              this week's weighted score
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <EventAvailableOutlined fontSize="small" color="primary" />
              <Typography variant="subtitle2" fontWeight={700}>My action items</Typography>
              {actions.length > 0 && (
                <Chip size="small" label={actions.length} color="warning" sx={{ height: 20 }} />
              )}
            </Stack>
            {actions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No open actions — keep it that way.</Typography>
            ) : (
              <Stack spacing={1}>
                {actions.slice(0, 3).map((a) => (
                  <Box key={a.id} sx={{ p: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" fontWeight={600} noWrap>{a.title}</Typography>
                    <Typography variant="caption" color="text.secondary">Due {a.due_date} · {a.status}</Typography>
                  </Box>
                ))}
              </Stack>
            )}

            <Button fullWidth variant="outlined" sx={{ mt: 2 }} endIcon={<ArrowForwardOutlined />}
                    onClick={() => navigate('/accountability')}>
              Open my scorecard
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AccountabilityWidget;
