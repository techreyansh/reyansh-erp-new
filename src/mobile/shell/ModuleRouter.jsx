// Renders a single module: a screen list when no screen is selected, then the
// active screen component. Driven entirely by the (already access-filtered)
// module descriptor — no per-module wiring in the shell.
import React, { useMemo } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Box, List, ListItemButton, ListItemText, Typography, Card } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { moduleRegistry, visibleModules, findModule } from '../core/moduleRegistry';
import * as api from '../core/api/client';

export default function ModuleRouter({ access, caps }) {
  const { moduleKey, screenKey } = useParams();
  const navigate = useNavigate();

  const visible = useMemo(() => visibleModules(moduleRegistry, access, caps), [access, caps]);
  const mod = findModule(visible, moduleKey);

  // Module not visible to this user (or doesn't exist) → bounce home.
  if (!mod) return <Navigate to="/app" replace />;

  if (!screenKey) {
    return (
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>{mod.title}</Typography>
        <Card sx={{ borderRadius: 2 }}>
          <List disablePadding>
            {(mod.screens || []).map((s) => (
              <ListItemButton
                key={s.key}
                onClick={() => navigate(`/app/${mod.key}/${s.key}`)}
                sx={{ minHeight: 60 }}
              >
                <ListItemText primary={s.title} primaryTypographyProps={{ fontWeight: 600 }} />
                <ChevronRightIcon color="action" />
              </ListItemButton>
            ))}
            {(mod.screens || []).length === 0 && (
              <Box sx={{ p: 3, color: 'text.secondary' }}>No screens available.</Box>
            )}
          </List>
        </Card>
      </Box>
    );
  }

  const screen = (mod.screens || []).find((s) => s.key === screenKey);
  if (!screen) return <Navigate to={`/app/${mod.key}`} replace />;

  const ScreenComponent = screen.component;
  return <ScreenComponent api={api} module={mod} access={access} caps={caps} />;
}
