// Compact feed of recent submissions/entries so the operator sees what they just did.
import React from 'react';
import { Box, List, ListItem, ListItemText, Typography, Chip, Divider } from '@mui/material';

export default function RecentFeed({ items = [], title = 'Recent', emptyText = 'Nothing yet.' }) {
  return (
    <Box>
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, color: 'text.secondary' }}>
          {title}
        </Typography>
      )}
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{emptyText}</Typography>
      ) : (
        <List dense disablePadding>
          {items.map((it, i) => (
            <React.Fragment key={it.id || it.key || i}>
              <ListItem
                disableGutters
                secondaryAction={
                  it.status ? (
                    <Chip
                      size="small"
                      label={it.status}
                      color={it.status === 'sent' ? 'success' : it.status === 'failed' ? 'error' : 'warning'}
                      variant="outlined"
                    />
                  ) : null
                }
              >
                <ListItemText
                  primary={it.primary || it.title || it.label}
                  secondary={it.secondary || it.subtitle || it.time}
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
              </ListItem>
              {i < items.length - 1 && <Divider component="li" />}
            </React.Fragment>
          ))}
        </List>
      )}
    </Box>
  );
}
