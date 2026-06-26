// Scoring transparency — click your performance score, see exactly how every
// point was earned. Pure presentation over the perf_person_week_score breakdown.
// "No hidden scoring logic."
import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, Typography,
  Table, TableHead, TableBody, TableRow, TableCell, Chip, LinearProgress, Button, Divider,
} from '@mui/material';

const LABELS = {
  work_completed: 'Work Completed',
  on_time: 'On Time',
  checklist: 'Checklist',
  workflow: 'Workflow',
  production: 'Production',
};
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function evidence(key, v) {
  switch (key) {
    case 'work_completed': return `${n(v.done)} of ${n(v.due)} tasks completed`;
    case 'on_time': return `${n(v.on_time)} task${n(v.on_time) === 1 ? '' : 's'} completed on time`;
    case 'checklist': return `${n(v.ok)} of ${n(v.due)} checklist items on schedule`;
    case 'workflow': return `${n(v.ok)} of ${n(v.due)} workflow steps done on time`;
    case 'production': return `${n(v.stages)} stages · ${n(v.output)} good / ${n(v.scrap)} scrap`;
    default: return '';
  }
}

export default function ScoreBreakdownDialog({ open, onClose, score, onOpenFull }) {
  const cats = (score && score.categories) || {};
  const order = ['work_completed', 'on_time', 'checklist', 'workflow', 'production'];
  const active = order
    .map((key) => ({ key, ...(cats[key] || {}) }))
    .filter((c) => c.pct != null);
  const totalWeight = active.reduce((s, c) => s + n(c.weight), 0);
  // Each active category contributes (weight / totalWeight) × pct to the final
  // score (categories with no activity this week are renormalized out).
  const withContribution = active.map((c) => ({
    ...c,
    contribution: totalWeight > 0 ? Math.round((n(c.weight) / totalWeight) * n(c.pct)) : 0,
  }));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>How your score is calculated</DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h3" sx={{ fontWeight: 800 }}>{score?.score != null ? Math.round(n(score.score)) : '—'}</Typography>
          <Typography variant="body2" color="text.secondary">/ 100</Typography>
          {score?.band && <Chip size="small" label={String(score.band).replace(/_/g, ' ')} sx={{ textTransform: 'capitalize' }} />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Your score is the weighted average of the categories below that have activity this
          week — all from your actual ERP work, no manual scoring. Categories with nothing due
          this week are left out (renormalized), so you're only judged on what you had to do.
        </Typography>

        {active.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No scored activity this week yet.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Category</TableCell>
                <TableCell>Evidence</TableCell>
                <TableCell align="right">Score</TableCell>
                <TableCell align="right">Weight</TableCell>
                <TableCell align="right">Points</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {withContribution.map((c) => (
                <TableRow key={c.key} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{LABELS[c.key] || c.key}</TableCell>
                  <TableCell><Typography variant="caption" color="text.secondary">{evidence(c.key, c)}</Typography></TableCell>
                  <TableCell align="right">
                    <Stack alignItems="flex-end">
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{Math.round(n(c.pct))}%</Typography>
                      <LinearProgress variant="determinate" value={Math.min(100, n(c.pct))} sx={{ width: 56, height: 4, borderRadius: 2, mt: 0.25 }} />
                    </Stack>
                  </TableCell>
                  <TableCell align="right"><Typography variant="caption" color="text.secondary">{Math.round((n(c.weight) / (totalWeight || 1)) * 100)}%</Typography></TableCell>
                  <TableCell align="right"><Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main' }}>+{c.contribution}</Typography></TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4} sx={{ fontWeight: 700, borderBottom: 'none' }}>Total</TableCell>
                <TableCell align="right" sx={{ borderBottom: 'none' }}>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>{withContribution.reduce((s, c) => s + c.contribution, 0)}</Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
        {score?.manager_remarks && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary"><b>Manager note:</b> {score.manager_remarks}</Typography>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {onOpenFull && <Button onClick={onOpenFull} sx={{ mr: 'auto' }}>Full performance page →</Button>}
        <Button variant="contained" onClick={onClose}>Got it</Button>
      </DialogActions>
    </Dialog>
  );
}
