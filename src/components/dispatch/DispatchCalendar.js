// Dispatch calendar — month grid with dispatch plans on their dispatch_date.
// Customers appear against dates so management reads future dispatch load.
import React, { useState, useMemo } from 'react';
import { Box, Stack, Typography, IconButton, Chip, Tooltip, useTheme, alpha } from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PRIORITY_COLOR = { critical: 'error', high: 'warning', medium: 'primary', low: 'default' };
const inrC = (v) => { const n = Number(v) || 0; return n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n / 1000)}k`; };
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default function DispatchCalendar({ plans, onOpen }) {
  const theme = useTheme();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const byDate = useMemo(() => {
    const m = {};
    (plans || []).forEach((p) => { if (p.dispatch_date) (m[p.dispatch_date] ||= []).push(p); });
    return m;
  }, [plans]);

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const startDow = (first.getDay() + 6) % 7; // Monday=0
    const days = new Date(year, month + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < startDow; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, month]);

  const prev = () => { const m = month - 1; if (m < 0) { setMonth(11); setYear((y) => y - 1); } else setMonth(m); };
  const next = () => { const m = month + 1; if (m > 11) { setMonth(0); setYear((y) => y + 1); } else setMonth(m); };
  const isToday = (d) => d && year === now.getFullYear() && month === now.getMonth() && d === now.getDate();
  const monthName = new Date(year, month, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <IconButton size="small" onClick={prev}><ChevronLeft /></IconButton>
        <Typography variant="subtitle1" fontWeight={800} sx={{ minWidth: 160, textAlign: 'center' }}>{monthName}</Typography>
        <IconButton size="small" onClick={next}><ChevronRight /></IconButton>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">{(plans || []).filter((p) => { const dt = new Date(p.dispatch_date); return dt.getFullYear() === year && dt.getMonth() === month; }).length} dispatches this month</Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 0.5 }}>
        {DOW.map((d) => <Typography key={d} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textAlign: 'center', py: 0.5 }}>{d}</Typography>)}
        {cells.map((d, i) => {
          const key = d ? ymd(year, month, d) : null;
          const items = (d && byDate[key]) || [];
          return (
            <Box key={i} sx={{
              minHeight: 92, p: 0.5, borderRadius: 1, border: `1px solid ${theme.palette.divider}`,
              bgcolor: d ? (isToday(d) ? alpha(theme.palette.primary.main, 0.08) : 'background.paper') : 'transparent',
              opacity: d ? 1 : 0,
            }}>
              {d && (
                <>
                  <Typography variant="caption" sx={{ fontWeight: isToday(d) ? 800 : 600, color: isToday(d) ? 'primary.main' : 'text.secondary' }}>{d}</Typography>
                  <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                    {items.slice(0, 3).map((p) => (
                      <Tooltip key={p.id} title={`${p.company_name} · ${p.total_qty} units · ${inrC(p.total_value)} · ${p.status}`}>
                        <Chip size="small" label={p.company_name} onClick={() => onOpen?.(p)}
                          color={PRIORITY_COLOR[p.priority] || 'default'}
                          sx={{ height: 18, fontSize: 10, justifyContent: 'flex-start', cursor: 'pointer', '& .MuiChip-label': { px: 0.75 } }} />
                      </Tooltip>
                    ))}
                    {items.length > 3 && <Typography variant="caption" color="text.secondary">+{items.length - 3} more</Typography>}
                  </Stack>
                </>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
