import React from 'react';
import { Alert, Box, Button, Card, CardContent, Container, Stack, Typography } from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionContext';

const reasonText = {
  not_found: 'Your email is not authorized for ERP access.',
  inactive: 'Your employee access is disabled.',
  rbac_load_failed: 'Access could not be verified. Please contact CEO/Admin.',
  unauthorized_route: 'You do not have permission to open this module.',
};

function AccessDenied() {
  const { signOut, user } = useAuth();
  const { reason } = usePermissions();

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Card elevation={3}>
        <CardContent>
          <Stack spacing={3} alignItems="center" textAlign="center">
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>
                Access Denied.
              </Typography>
              <Typography variant="h6" color="text.secondary">
                Please contact CEO/Admin.
              </Typography>
            </Box>

            <Alert severity="warning" sx={{ width: '100%', textAlign: 'left' }}>
              {reasonText[reason] || 'Your account does not have access to this ERP area.'}
              {user?.email ? ` Signed in as ${user.email}.` : ''}
            </Alert>

            <Button variant="contained" color="primary" onClick={() => void signOut()}>
              Logout
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}

export default AccessDenied;
