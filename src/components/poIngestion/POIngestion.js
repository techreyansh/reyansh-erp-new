import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Chip,
  Stack,
  useTheme,
} from '@mui/material';
import {
  ShoppingCart as SOIcon,
  TrendingUp as TrendingUpIcon,
  Assignment as AssignmentIcon,
  AutoAwesome as AutoAwesomeIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import SalesOrderForm from './POForm';
import SalesOrderList from './POList';
import AIPurchaseOrderUpload from './AIPurchaseOrderUpload';

const HOW_IT_WORKS = [
  {
    title: 'Generates Bill of Materials',
    description: 'Auto-builds the BOM from product specs and requirements.',
    icon: <AssignmentIcon />,
    color: 'primary',
  },
  {
    title: 'Creates workflow tasks',
    description: 'Assigns and tracks progress across the production flow.',
    icon: <TrendingUpIcon />,
    color: 'success',
  },
  {
    title: 'Routes to Store Manager',
    description: 'Initiates the workflow with the first task assignment.',
    icon: <SOIcon />,
    color: 'info',
  },
  {
    title: 'Archives documents',
    description: 'Stores supporting files for a complete audit trail.',
    icon: <StorageIcon />,
    color: 'warning',
  },
];

const SalesOrderIngestion = () => {
  const theme = useTheme();
  const [salesFlowData, setSalesFlowData] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [formKey, setFormKey] = useState(0);

  const handleSalesOrderCreated = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  // AI extracted a PO → feed it into the form's existing prefill path and remount.
  const handleAIApply = (po) => {
    if (!po) return;
    const payload = {
      salesFlowData: { LogId: po.po_number || 'AI-PO', CompanyName: po.buyer_name || '', leadDetails: {} },
      newClient: {
        clientCode: po.buyer_name || '',
        products: (po.line_items || []).map((li) => ({
          productCode: li.product_code || '',
          productName: li.description || '',
          quantity: Number(li.quantity) || 1,
          price: Number(li.unit_price) || 0,
        })),
      },
    };
    try { sessionStorage.setItem('salesFlowForSO', JSON.stringify(payload)); } catch (e) { /* ignore */ }
    setFormKey((k) => k + 1);
  };

  // Refresh the list when returning from a dispatch operation.
  useEffect(() => {
    const checkDispatchCompletion = () => {
      const dispatchCompleted = sessionStorage.getItem('dispatchCompleted');
      if (dispatchCompleted) {
        setRefreshTrigger((prev) => prev + 1);
        sessionStorage.removeItem('dispatchCompleted');
      }
    };
    checkDispatchCompletion();
    const handleVisibilityChange = () => {
      if (!document.hidden) checkDispatchCompletion();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Pre-populate from Sales Flow hand-off, if present.
  useEffect(() => {
    const salesFlowForSO = sessionStorage.getItem('salesFlowForSO');
    if (salesFlowForSO) {
      try {
        setSalesFlowData(JSON.parse(salesFlowForSO));
      } catch (err) {
        console.error('Error parsing sales flow data:', err);
      }
    }
  }, []);

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Hero */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, sm: 3.5 },
          mb: 3,
          borderRadius: 3,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
          background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 58%, ${theme.palette.info.main} 130%)`,
        }}
      >
        <Box sx={{ position: 'absolute', top: -60, right: -40, width: 220, height: 220, bgcolor: 'rgba(255,255,255,0.08)', borderRadius: '50%' }} />
        <Box sx={{ position: 'relative' }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ p: 1.5, borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.18)', display: 'flex' }}>
              <SOIcon sx={{ fontSize: 30 }} />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
                Sales Order Ingestion
              </Typography>
              <Typography variant="body1" sx={{ opacity: 0.9, mt: 0.25 }}>
                Streamline order creation with automated BOM generation and workflow management.
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mt: 2.5 }} flexWrap="wrap" useFlexGap>
            {[
              { icon: <TrendingUpIcon sx={{ fontSize: 18 }} />, label: 'Automated BOM Generation' },
              { icon: <AssignmentIcon sx={{ fontSize: 18 }} />, label: 'Workflow Integration' },
              { icon: <AutoAwesomeIcon sx={{ fontSize: 18 }} />, label: 'Smart Processing' },
            ].map((c) => (
              <Chip
                key={c.label}
                icon={c.icon}
                label={c.label}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.16)',
                  color: '#fff',
                  fontWeight: 600,
                  '& .MuiChip-icon': { color: '#fff' },
                }}
              />
            ))}
          </Stack>

          {salesFlowData && (
            <Stack spacing={1} sx={{ mt: 2.5 }}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip label="Sales Flow Data" color="success" size="small" sx={{ fontWeight: 700 }} />
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  Pre-populated from Sales Flow · Log ID {salesFlowData.salesFlowData?.LogId}
                </Typography>
              </Stack>
              {salesFlowData.newClient && (
                <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip label="New Client Created" size="small" sx={{ fontWeight: 700, bgcolor: 'rgba(255,255,255,0.22)', color: '#fff' }} />
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Client {salesFlowData.newClient.clientCode} · {salesFlowData.newClient.products?.length || 0} products
                  </Typography>
                </Stack>
              )}
            </Stack>
          )}
        </Box>
      </Paper>

      {/* AI PO capture */}
      <AIPurchaseOrderUpload onApply={handleAIApply} />

      {/* Form */}
      <Box sx={{ mb: 3 }}>
        <SalesOrderForm key={formKey} onSalesOrderCreated={handleSalesOrderCreated} />
      </Box>

      {/* List */}
      <Box sx={{ mb: 3 }}>
        <SalesOrderList refreshTrigger={refreshTrigger} />
      </Box>

      {/* How it works */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 2.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover', color: 'primary.main', display: 'flex' }}>
            <AutoAwesomeIcon />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              How it works
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Every submitted sales order runs through these automated steps.
            </Typography>
          </Box>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
          }}
        >
          {HOW_IT_WORKS.map((item, index) => (
            <Box
              key={item.title}
              sx={{
                position: 'relative',
                p: 2,
                borderRadius: 2,
                border: 1,
                borderColor: 'divider',
                transition: 'all 0.2s ease',
                '&:hover': { borderColor: `${item.color}.main`, transform: 'translateY(-2px)', boxShadow: 1 },
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: `${item.color}.main`, color: '#fff', display: 'flex' }}>
                  {item.icon}
                </Box>
                <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.disabled', letterSpacing: '0.08em' }}>
                  STEP {index + 1}
                </Typography>
              </Stack>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                {item.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                {item.description}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>
    </Container>
  );
};

export default SalesOrderIngestion;
