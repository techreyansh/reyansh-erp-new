// Role-filtered Home: a tile grid built from visibleModules(registry, access, caps).
// Adding a module.js to the registry adds a tile here with zero edits.
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Card, CardActionArea, Typography, Avatar } from '@mui/material';
import AppsIcon from '@mui/icons-material/Apps';
import { moduleRegistry, visibleModules } from '../core/moduleRegistry';

export default function Home({ access, caps }) {
  const navigate = useNavigate();
  const modules = useMemo(
    () => visibleModules(moduleRegistry, access, caps),
    [access, caps]
  );

  if (modules.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
        <AppsIcon sx={{ fontSize: 48, opacity: 0.4 }} />
        <Typography sx={{ mt: 2 }}>No modules available for your role yet.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5 }}>
      {modules.map((m) => (
        <Card key={m.key} sx={{ borderRadius: 3 }}>
          <CardActionArea
            onClick={() => navigate(`/app/${m.key}`)}
            sx={{ p: 2, height: 130, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between' }}
          >
            <Avatar sx={{ bgcolor: m.color || 'primary.main', width: 44, height: 44 }}>
              {m.icon || <AppsIcon />}
            </Avatar>
            <Box>
              <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>{m.title}</Typography>
              <Typography variant="caption" color="text.secondary">
                {(m.screens || []).length} screen{(m.screens || []).length === 1 ? '' : 's'}
              </Typography>
            </Box>
          </CardActionArea>
        </Card>
      ))}
    </Box>
  );
}
