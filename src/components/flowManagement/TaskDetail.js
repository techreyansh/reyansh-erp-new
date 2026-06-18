import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Button, 
  Typography, 
  Box, 
  Grid, 
  Divider, 
  Chip,
  TextField,
  Paper,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Tooltip,
  Tab,
  Tabs,
  Alert,
  CircularProgress
} from '@mui/material';
import { 
  ArrowForward, 
  Close, 
  Upload, 
  Description, 
  Info, 
  Timeline,
  Schedule,
  Assignment,
  Business,
  Build,
  CheckCircle,
  Warning,
  Cable as CableIcon,
  LocalShipping,
  Inventory,
  Verified,
  PlayArrow,
  Analytics,
  Speed,
  TrendingUp,
  Assessment
} from '@mui/icons-material';
import StatusBadge from '../common/StatusBadge';
import { formatDate, formatDateTime, isOverdue } from '../../utils/dateUtils';
import { canAdvance } from '../../utils/statusUtils';
import { useAuth } from '../../context/AuthContext';
import CableProductionTaskDetail from './CableProductionTaskDetail';
import FlowNavigation from './FlowNavigation';
import config from '../../config/config';
import { getOrderedStageDueDates, formatDispatchDate, calculateStageDueDates } from '../../utils/backwardPlanning';
import { getStatusOnly } from '../../utils/statusDateUtils';
import sheetService from '../../services/sheetService';
import { getAllClients } from '../../services/clientService';

const TaskDetail = ({ task, open, onClose, onAdvance, auditLog = [] }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [file, setFile] = useState(null);
  const [sheetData, setSheetData] = useState(null);
  const [loadingSheetData, setLoadingSheetData] = useState(false);
  const { user: currentUser } = useAuth();

  // Fetch data from Google Sheets when task is opened
  useEffect(() => {
    if (open && task) {
      fetchSheetData();
    }
  }, [open, task]);

  const fetchSheetData = async () => {
    if (!task) return;
    
    try {
      setLoadingSheetData(true);
      
      // Fetch dispatch data from Dispatches sheet
      let dispatchData = null;
      if (task.DispatchUniqueId || task.UniqueId) {
        const dispatches = await sheetService.getSheetData('Dispatches', true);
        dispatchData = dispatches.find(d => 
          d.DispatchUniqueId === task.DispatchUniqueId || 
          d.UniqueId === task.UniqueId
        );
      }

      // Fetch client and product data from Clients sheet
      let clientData = null;
      let productData = null;
      if (task.ClientCode) {
        const clients = await getAllClients(true);
        clientData = clients.find(c => c.clientCode === task.ClientCode);
        
        if (clientData && clientData.products && Array.isArray(clientData.products)) {
          productData = clientData.products.find(p => 
            (p.productCode || p.code) === task.ProductCode
          );
        }
      }

      setSheetData({
        dispatch: dispatchData,
        client: clientData,
        product: productData
      });
    } catch (error) {
      console.error('Error fetching sheet data:', error);
      setSheetData(null);
    } finally {
      setLoadingSheetData(false);
    }
  };
  
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };
  
  const handleAdvance = () => {
    onAdvance(task, file);
    onClose();
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };
  
  if (!task) return null;
  
  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="lg" 
      fullWidth
      scroll="paper"
      PaperProps={{ 
        sx: { 
          borderRadius: { xs: 0, sm: 3, md: 4 },
          border: '1px solid rgba(59, 130, 246, 0.15)',
          overflow: 'hidden',
          maxHeight: { xs: '100vh', sm: '90vh' },
          margin: { xs: 0, sm: 2 },
          width: { xs: '100%', sm: 'calc(100% - 32px)' },
          boxShadow: '0 20px 40px rgba(59, 130, 246, 0.12)',
          background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.95))',
          backdropFilter: 'blur(20px)'
        } 
      }}
    >
      <DialogTitle
        sx={{
          backgroundColor: 'primary.main',
          color: 'common.white',
          py: 2,
          px: 3,
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2
        }}>
          <Box>
            <Typography 
              variant="h6" 
              sx={{ 
                fontWeight: 600,
                fontSize: '1.1rem',
                mb: 0.5
              }}
            >
              {task.POId}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9, fontSize: '0.875rem' }}>
              {task.ProductCode || task.Name || 'Product Batch'}
            </Typography>
          </Box>
          <StatusBadge status={task.Status} />
        </Box>
      </DialogTitle>
      
      <Tabs 
        value={activeTab} 
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          px: { xs: 2, sm: 3 },
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'grey.100',
          minHeight: 56,
          '& .MuiTabs-indicator': {
            backgroundColor: 'primary.main',
            height: 2,
            borderRadius: '2px 2px 0 0'
          },
          '& .MuiTabs-flexContainer': {
            gap: 1
          }
        }}
      >
        <Tab 
          icon={<Info />} 
          label="Details" 
          iconPosition="start"
          sx={{
            color: 'text.secondary',
            fontWeight: 500,
            textTransform: 'none',
            padding: '12px 20px',
            minHeight: 56,
            fontSize: '0.875rem',
            '&.Mui-selected': {
              color: 'primary.main',
              fontWeight: 600
            },
            '&:hover': {
              color: 'primary.main',
              backgroundColor: 'rgba(25, 118, 210, 0.04)'
            }
          }}
        />
        <Tab 
          icon={<Timeline />} 
          label="Flow Progress" 
          iconPosition="start"
          sx={{
            color: 'text.secondary',
            fontWeight: 500,
            textTransform: 'none',
            padding: '12px 20px',
            minHeight: 56,
            fontSize: '0.875rem',
            '&.Mui-selected': {
              color: 'primary.main',
              fontWeight: 600
            },
            '&:hover': {
              color: 'primary.main',
              backgroundColor: 'rgba(25, 118, 210, 0.04)'
            }
          }}
        />
        {task.Status === config.statusCodes.CABLE_PRODUCTION && (
          <Tab 
            icon={<CableIcon />} 
            label="Cable Production" 
            iconPosition="start"
            sx={{
              color: 'text.secondary',
              fontWeight: 500,
              textTransform: 'none',
              padding: '12px 20px',
              minHeight: 56,
              fontSize: '0.875rem',
              '&.Mui-selected': {
                color: 'primary.main',
                fontWeight: 600
              },
              '&:hover': {
                color: 'primary.main',
                backgroundColor: 'rgba(25, 118, 210, 0.04)'
              }
            }}
          />
        )}
        <Tab 
          icon={<Timeline />} 
          label="History" 
          iconPosition="start"
          sx={{
            color: 'text.secondary',
            fontWeight: 500,
            textTransform: 'none',
            padding: '12px 20px',
            minHeight: 56,
            fontSize: '0.875rem',
            '&.Mui-selected': {
              color: 'primary.main',
              fontWeight: 600
            },
            '&:hover': {
              color: 'primary.main',
              backgroundColor: 'rgba(25, 118, 210, 0.04)'
            }
          }}
        />
        <Tab 
          icon={<Analytics />} 
          label="Analytics" 
          iconPosition="start"
          sx={{
            color: 'text.secondary',
            fontWeight: 500,
            textTransform: 'none',
            padding: '12px 20px',
            minHeight: 56,
            fontSize: '0.875rem',
            '&.Mui-selected': {
              color: 'primary.main',
              fontWeight: 600
            },
            '&:hover': {
              color: 'primary.main',
              backgroundColor: 'rgba(25, 118, 210, 0.04)'
            }
          }}
        />
      </Tabs>
      
      <DialogContent sx={{ 
        py: { xs: 2, sm: 3 }, 
        px: { xs: 2, sm: 3 }, 
        backgroundColor: 'rgba(248, 250, 252, 0.5)',
        position: 'relative'
      }}>
        {loadingSheetData && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
            <CircularProgress size={40} />
            <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
              Loading data from sheets...
            </Typography>
          </Box>
        )}
        {activeTab === 0 ? (
          <>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={4}>
                <Box sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.08)',
                    borderColor: 'primary.main'
                  }
                }}>
                  <Typography variant="caption" sx={{ 
                    display: 'block', 
                    mb: 1, 
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'text.secondary'
                  }}>
                    Client Code
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main', fontSize: '1rem' }}>
                    {task.ClientCode}
                  </Typography>
                  {sheetData?.client?.clientName && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', mt: 0.5, display: 'block' }}>
                      {sheetData.client.clientName}
                    </Typography>
                  )}
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={4}>
                <Box sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.08)',
                    borderColor: 'primary.main'
                  }
                }}>
                  <Typography variant="caption" sx={{ 
                    display: 'block', 
                    mb: 1, 
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'text.secondary'
                  }}>
                    Product Code
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main', fontSize: '1rem' }}>
                    {task.ProductCode}
                  </Typography>
                  {sheetData?.product?.productName && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', mt: 0.5, display: 'block' }}>
                      {sheetData.product.productName}
                    </Typography>
                  )}
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={4}>
                <Box sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.08)',
                    borderColor: 'primary.main'
                  }
                }}>
                  <Typography variant="caption" sx={{ 
                    display: 'block', 
                    mb: 1, 
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'text.secondary'
                  }}>
                    PO Name
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 500, color: 'text.primary', fontSize: '0.95rem' }}>
                    {task.Name || 'N/A'}
                  </Typography>
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={4}>
                <Box sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.08)',
                    borderColor: 'primary.main'
                  }
                }}>
                  <Typography variant="caption" sx={{ 
                    display: 'block', 
                    mb: 1, 
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'text.secondary'
                  }}>
                    Quantity
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: 'success.main', fontSize: '1rem' }}>
                    {task.Quantity?.toLocaleString() || '0'}
                  </Typography>
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={4}>
                <Box sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.08)',
                    borderColor: 'primary.main'
                  }
                }}>
                  <Typography variant="caption" sx={{ 
                    display: 'block', 
                    mb: 1, 
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'text.secondary'
                  }}>
                    Order Type
                  </Typography>
                  <Chip 
                    label={task.OrderType === 'CABLE_ONLY' ? 'Cable Only' : 'Power Cord'}
                    size="small"
                    sx={{
                      fontWeight: 600,
                      backgroundColor: task.OrderType === 'CABLE_ONLY' ? 'primary.light' : 'info.lighter',
                      color: task.OrderType === 'CABLE_ONLY' ? 'primary.main' : 'primary.main',
                      height: 24,
                      fontSize: '0.75rem'
                    }}
                  />
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={4}>
                <Box sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: isOverdue(task.DueDate) ? 'error.lighter' : 'divider',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    boxShadow: isOverdue(task.DueDate)
                      ? '0 4px 12px rgba(220, 38, 38, 0.12)'
                      : '0 4px 12px rgba(25, 118, 210, 0.08)',
                    borderColor: isOverdue(task.DueDate) ? 'error.main' : 'primary.main'
                  }
                }}>
                  <Typography variant="caption" sx={{ 
                    display: 'block', 
                    mb: 1, 
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'text.secondary'
                  }}>
                    Due Date
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="h6" sx={{
                      fontWeight: 600,
                      color: isOverdue(task.DueDate) ? 'error.main' : 'text.primary',
                      fontSize: '0.95rem'
                    }}>
                      {formatDate(task.DueDate)}
                    </Typography>
                    {isOverdue(task.DueDate) && (
                      <Chip 
                        label="OVERDUE" 
                        size="small" 
                        sx={{
                          fontWeight: 600,
                          height: 22,
                          fontSize: '0.7rem',
                          backgroundColor: 'error.lighter',
                          color: 'error.main'
                        }}
                      />
                    )}
                  </Box>
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={4}>
                <Box sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.08)',
                    borderColor: 'primary.main'
                  }
                }}>
                  <Typography variant="caption" sx={{ 
                    display: 'block', 
                    mb: 1, 
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'text.secondary'
                  }}>
                    Created By
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 500, color: 'text.primary', fontSize: '0.9rem' }}>
                    {task.CreatedBy?.split('@')[0] || task.CreatedBy || 'N/A'}
                  </Typography>
                </Box>
              </Grid>
              
              <Grid item xs={12} sm={6} md={4}>
                <Box sx={{
                  p: 2.5,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.08)',
                    borderColor: 'primary.main'
                  }
                }}>
                  <Typography variant="caption" sx={{ 
                    display: 'block', 
                    mb: 1, 
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'text.secondary'
                  }}>
                    Assigned To
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 500, color: 'text.primary', fontSize: '0.9rem' }}>
                    {task.AssignedTo?.split('@')[0] || task.AssignedTo || 'Unassigned'}
                  </Typography>
                </Box>
              </Grid>
              
              {task.Description && (
                <Grid item xs={12}>
                  <Paper 
                    elevation={0}
                    sx={{ 
                      p: 3, 
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid rgba(59, 130, 246, 0.1)',
                      borderRadius: 3,
                      backdropFilter: 'blur(10px)',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: '0 8px 20px rgba(25, 118, 210, 0.12)',
                        borderColor: 'primary.main',
                        backgroundColor: 'rgba(255, 255, 255, 1)'
                      }
                    }}
                  >
                    <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1, fontWeight: 600, fontSize: { xs: '0.8rem', sm: '0.875rem' } }}>
                      <Description sx={{ fontSize: 16, mr: 1, color: 'primary.main' }} />
                      Description
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 500, color: 'text.primary', fontSize: { xs: '0.9rem', sm: '1rem' } }}>
                      {task.Description}
                    </Typography>
                  </Paper>
                </Grid>
              )}
              
              {task.PODocumentId && (
                <Grid item xs={12}>
                  <Paper 
                    elevation={0}
                    sx={{ 
                      p: 3, 
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid rgba(59, 130, 246, 0.1)',
                      borderRadius: 3,
                      backdropFilter: 'blur(10px)',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: '0 8px 20px rgba(25, 118, 210, 0.12)',
                        borderColor: 'primary.main',
                        backgroundColor: 'rgba(255, 255, 255, 1)'
                      }
                    }}
                  >
                    <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1, fontWeight: 600, fontSize: { xs: '0.8rem', sm: '0.875rem' } }}>
                      <Description sx={{ fontSize: 16, mr: 1, color: 'primary.main' }} />
                      PO Document
                    </Typography>
                    <Button
                      variant="outlined"
                      startIcon={<Description />}
                      size="small"
                      sx={{ mt: 1 }}
                      // In a real app, this would link to the document
                      onClick={() => window.open(`https://drive.google.com/file/d/${task.PODocumentId}/view`, '_blank')}
                    >
                      View Document
                    </Button>
                  </Paper>
                </Grid>
              )}

              {/* Production Timeline - Show when dispatch date is scheduled */}
              {task.DispatchDate && task.Store1DueDate && (
                <Grid item xs={12}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: 3,
                      backgroundColor: 'rgba(76, 175, 80, 0.05)',
                      border: '2px solid rgba(76, 175, 80, 0.3)',
                      borderRadius: 3,
                      backdropFilter: 'blur(10px)',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: '0 12px 24px rgba(76, 175, 80, 0.2)',
                        borderColor: 'success.main',
                        backgroundColor: 'rgba(76, 175, 80, 0.08)'
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <LocalShipping sx={{ fontSize: 20, color: 'success.main' }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'success.main', fontSize: { xs: '0.9rem', sm: '1rem' } }}>
                        Production Timeline (Backward Planning)
                      </Typography>
                    </Box>
                    
                    <Alert severity="success" sx={{ mb: 2 }}>
                      <Typography variant="body2">
                        <strong>Dispatch Scheduled:</strong> {formatDispatchDate(task.DispatchDate)}
                      </Typography>
                    </Alert>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {(() => {
                        // Use sheet data if available, otherwise fall back to task data
                        const dispatchData = sheetData?.dispatch || {};
                        let dispatchDate = task.DispatchDate || dispatchData.DispatchDate;
                        
                        // Helper function to parse date from DD/MM/YYYY or other formats
                        const parseDispatchDate = (dateStr) => {
                          if (!dateStr) return null;
                          // Try parsing DD/MM/YYYY format first
                          if (typeof dateStr === 'string' && dateStr.includes('/')) {
                            const parts = dateStr.split('/');
                            if (parts.length === 3) {
                              // DD/MM/YYYY format
                              const day = parseInt(parts[0], 10);
                              const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
                              const year = parseInt(parts[2], 10);
                              const date = new Date(year, month, day);
                              if (!isNaN(date.getTime())) return date;
                            }
                          }
                          // Try standard Date parsing
                          const date = new Date(dateStr);
                          return !isNaN(date.getTime()) ? date : null;
                        };
                        
                        // Parse dispatch date
                        const parsedDispatchDate = parseDispatchDate(dispatchDate);
                        
                        // If we have a dispatch date, calculate missing dates
                        let calculatedDates = {};
                        if (parsedDispatchDate) {
                          try {
                            calculatedDates = calculateStageDueDates(parsedDispatchDate, task.OrderType || 'POWER_CORD', true);
                          } catch (error) {
                            console.error('Error calculating dates:', error);
                          }
                        }
                        
                        const dueDates = {
                          DispatchDate: dispatchDate || calculatedDates.DispatchDate,
                          Store1DueDate: task.Store1DueDate || dispatchData.Store1DueDate || calculatedDates.Store1DueDate,
                          CableProductionDueDate: task.CableProductionDueDate || dispatchData.CableProductionDueDate || calculatedDates.CableProductionDueDate,
                          Store2DueDate: task.Store2DueDate || dispatchData.Store2DueDate || calculatedDates.Store2DueDate,
                          MouldingDueDate: task.MouldingDueDate || dispatchData.MouldingDueDate || calculatedDates.MouldingDueDate,
                          FGSectionDueDate: task.FGSectionDueDate || dispatchData.FGSectionDueDate || calculatedDates.FGSectionDueDate
                        };
                        const orderedDates = getOrderedStageDueDates(dueDates);
                        
                        return orderedDates.map((stageInfo, index) => {
                          // Ensure we have a date to display
                          const displayDate = stageInfo.dueDate ? formatDispatchDate(stageInfo.dueDate) : 'N/A';
                          
                          return (
                          <Box
                            key={stageInfo.status}
                            sx={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              p: 1.5,
                              backgroundColor: task.Status === stageInfo.status
                                ? 'warning.lighter'
                                : index === orderedDates.length - 1
                                ? 'success.lighter'
                                : 'grey.50',
                              borderRadius: 1,
                              border: task.Status === stageInfo.status
                                ? '2px solid'
                                : '1px solid',
                              borderColor: task.Status === stageInfo.status
                                ? 'warning.main'
                                : index === orderedDates.length - 1
                                ? 'success.main'
                                : 'info.lighter',
                              transition: 'all 0.2s ease'
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              {task.Status === stageInfo.status && (
                                <PlayArrow sx={{ color: 'warning.main', fontSize: 20 }} />
                              )}
                              <Chip
                                label={stageInfo.label}
                                size="small"
                                sx={{
                                  backgroundColor: task.Status === stageInfo.status
                                    ? 'warning.main'
                                    : index === orderedDates.length - 1
                                    ? 'success.main'
                                    : 'primary.main',
                                  color: 'common.white',
                                  fontWeight: 600,
                                  minWidth: 45,
                                  fontSize: '0.75rem'
                                }}
                              />
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: task.Status === stageInfo.status ? 700 : 500,
                                  color: task.Status === stageInfo.status
                                    ? 'warning.main'
                                    : index === orderedDates.length - 1
                                    ? 'success.main'
                                    : 'text.primary',
                                  fontSize: { xs: '0.85rem', sm: '0.9rem' }
                                }}
                              >
                                {stageInfo.stage}
                              </Typography>
                            </Box>
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: { xs: '0.8rem', sm: '0.85rem' },
                                fontWeight: 600,
                                color: displayDate === 'N/A'
                                  ? 'text.disabled'
                                  : task.Status === stageInfo.status
                                  ? 'warning.main'
                                  : index === orderedDates.length - 1
                                  ? 'success.main'
                                  : 'primary.main',
                                backgroundColor: displayDate === 'N/A'
                                  ? 'grey.100'
                                  : task.Status === stageInfo.status
                                  ? 'common.white'
                                  : index === orderedDates.length - 1
                                  ? 'common.white'
                                  : 'info.lighter',
                                px: 1.5,
                                py: 0.5,
                                borderRadius: 1,
                                fontStyle: displayDate === 'N/A' ? 'italic' : 'normal'
                              }}
                            >
                              {displayDate}
                            </Typography>
                          </Box>
                        );
                        });
                      })()}
                    </Box>
                  </Paper>
                </Grid>
              )}
            </Grid>
            
            {/* Completion Summary for Completed Tasks */}
            {task.Status === 'COMPLETED' && (
              <Paper 
                elevation={0}
                sx={{ 
                  mt: { xs: 2, sm: 3 }, 
                  p: { xs: 2, sm: 2.5, md: 3 }, 
                  backgroundColor: 'rgba(76, 175, 80, 0.08)',
                  border: '2px solid rgba(76, 175, 80, 0.3)',
                  borderRadius: 3,
                  backdropFilter: 'blur(10px)',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: '0 12px 24px rgba(76, 175, 80, 0.2)',
                    borderColor: 'success.main',
                    backgroundColor: 'rgba(76, 175, 80, 0.12)'
                  }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <CheckCircle sx={{ color: 'success.main', fontSize: 24 }} />
                  <Typography
                    variant="h6"
                    sx={{
                      color: 'success.main',
                      fontWeight: 600,
                      fontSize: { xs: '1.1rem', sm: '1.25rem' }
                    }}
                  >
                    Task Completed Successfully
                  </Typography>
                </Box>
                
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="textSecondary" sx={{ fontWeight: 600 }}>
                      Completed Date
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 500, color: 'success.main' }}>
                      {task.CompletionDate ? formatDate(task.CompletionDate) : 'Date not recorded'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="textSecondary" sx={{ fontWeight: 600 }}>
                      Completed By
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 500, color: 'success.main' }}>
                      {task.AssignedTo || 'Unknown'}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            )}

            {/* Action Section */}
            {canAdvance(task.Status) && currentUser.email === task.AssignedTo && (
              <Paper 
                elevation={0}
                sx={{ 
                  mt: { xs: 2, sm: 3 }, 
                  p: { xs: 2, sm: 2.5, md: 3 }, 
                  backgroundColor: 'rgba(25, 118, 210, 0.03)',
                  border: '1px solid rgba(25, 118, 210, 0.15)',
                  borderRadius: 3,
                  backdropFilter: 'blur(10px)',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: '0 8px 20px rgba(25, 118, 210, 0.12)',
                    borderColor: 'primary.main',
                    backgroundColor: 'rgba(25, 118, 210, 0.05)'
                  }
                }}
              >
                <Typography
                  variant="h6"
                  sx={{
                    color: 'primary.main',
                    fontWeight: 600, 
                    mb: 2,
                    fontSize: { xs: '1.1rem', sm: '1.25rem' }
                  }}
                >
                  Task Actions
                </Typography>
                
                <Box>
                  <Box sx={{ 
                    display: 'flex', 
                    gap: { xs: 1, sm: 2 }, 
                    flexWrap: 'wrap',
                    flexDirection: { xs: 'column', sm: 'row' }
                  }}>
                    {canAdvance(task.Status) && (
                      <Box>
                        <input
                          type="file"
                          id="file-upload"
                          onChange={handleFileChange}
                          style={{ display: 'none' }}
                        />
                        <label htmlFor="file-upload">
                          <Button
                            variant="outlined"
                            component="span"
                            startIcon={<Upload />}
                            size="small"
                            sx={{
                              borderColor: 'primary.main',
                              color: 'primary.main',
                              '&:hover': {
                                borderColor: 'primary.dark',
                                backgroundColor: 'grey.50'
                              },
                              width: { xs: '100%', sm: 'auto' }
                            }}
                          >
                            Upload Document
                          </Button>
                        </label>
                        {file && (
                          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'primary.main' }}>
                            Selected: {file.name}
                          </Typography>
                        )}
                      </Box>
                    )}
                    
                    {canAdvance(task.Status) && (
                      <Button
                        variant="contained"
                        startIcon={<ArrowForward />}
                        onClick={handleAdvance}
                        size="small"
                        sx={{
                          backgroundColor: 'success.main',
                          '&:hover': { backgroundColor: 'success.dark' },
                          width: { xs: '100%', sm: 'auto' }
                        }}
                      >
                        Advance Task
                      </Button>
                    )}
                    
                  </Box>
                </Box>
              </Paper>
            )}
          </>
        ) : activeTab === 1 ? (
          <Paper 
            elevation={0}
            sx={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid rgba(25, 118, 210, 0.1)',
              borderRadius: 3,
              p: 4,
              textAlign: 'center',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                boxShadow: '0 8px 20px rgba(25, 118, 210, 0.12)',
                borderColor: 'primary.main'
              }
            }}
          >
            <Timeline sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
            <Typography variant="h5" sx={{ color: 'primary.main', fontWeight: 600, mb: 1 }}>
              Flow Progress
            </Typography>
            <Typography variant="h6" sx={{ color: 'text.secondary', fontWeight: 500, mb: 2 }}>
              Coming Soon
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.disabled', opacity: 0.8 }}>
              This feature is currently under development and will be available soon.
            </Typography>
          </Paper>
        ) : activeTab === 2 && task.Status === config.statusCodes.CABLE_PRODUCTION ? (
          <CableProductionTaskDetail task={task} />
        ) : activeTab === 3 ? (
          <Paper 
            elevation={0}
            sx={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid rgba(59, 130, 246, 0.1)',
              borderRadius: 3,
              p: 4,
              backdropFilter: 'blur(10px)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                boxShadow: '0 12px 24px rgba(59, 130, 246, 0.12)',
                borderColor: 'primary.main'
              }
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <Analytics sx={{ fontSize: 32, color: 'primary.main' }} />
              <Typography variant="h5" sx={{ color: 'primary.main', fontWeight: 600 }}>
                Task Analytics
              </Typography>
            </Box>
            
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6} md={3}>
                <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                  <Speed sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
                  <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 600 }}>
                    {task.Status === 'COMPLETED' ? '100%' : '75%'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Progress
                  </Typography>
                </Paper>
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.1)' }}>
                  <TrendingUp sx={{ fontSize: 32, color: 'success.main', mb: 1 }} />
                  <Typography variant="h6" sx={{ color: 'success.main', fontWeight: 600 }}>
                    {task.Quantity || 0}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Quantity
                  </Typography>
                </Paper>
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.1)' }}>
                  <Schedule sx={{ fontSize: 32, color: 'warning.main', mb: 1 }} />
                  <Typography variant="h6" sx={{ color: 'warning.main', fontWeight: 600 }}>
                    {task.DueDate ? new Date(task.DueDate).toLocaleDateString() : 'N/A'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Due Date
                  </Typography>
                </Paper>
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <Paper sx={{ p: 2, textAlign: 'center', backgroundColor: 'rgba(139, 92, 246, 0.05)', border: '1px solid rgba(139, 92, 246, 0.1)' }}>
                  <Assessment sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
                  <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 600 }}>
                    {task.Status}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Status
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
            
            <Box sx={{ mt: 3, p: 2, backgroundColor: 'rgba(248, 250, 252, 0.8)', borderRadius: 2 }}>
              <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 600, mb: 2 }}>
                Performance Metrics
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                • Task created: {task.CreatedDate ? new Date(task.CreatedDate).toLocaleDateString() : 'N/A'}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                • Assigned to: {task.AssignedTo || 'Unassigned'}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                • Client: {task.ClientCode}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                • Product: {task.ProductCode}
              </Typography>
            </Box>
          </Paper>
        ) : (
          <Paper 
            elevation={0}
            sx={{ 
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid rgba(59, 130, 246, 0.1)',
              borderRadius: 3,
              p: 4,
              textAlign: 'center',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                boxShadow: '0 12px 24px rgba(59, 130, 246, 0.12)',
                borderColor: 'primary.main'
              }
            }}
          >
            <Timeline sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
            <Typography variant="h5" sx={{ color: 'primary.main', fontWeight: 600, mb: 1 }}>
              History
            </Typography>
            <Typography variant="h6" sx={{ color: 'text.secondary', fontWeight: 500, mb: 2 }}>
              Coming Soon
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.disabled', opacity: 0.8 }}>
              This feature is currently under development and will be available soon.
            </Typography>
          </Paper>
        )}
      </DialogContent>
      
      <DialogActions sx={{ 
        p: { xs: 2, sm: 3 }, 
        backgroundColor: 'rgba(25, 118, 210, 0.02)',
        justifyContent: { xs: 'center', sm: 'flex-end' },
        borderTop: '1px solid rgba(25, 118, 210, 0.1)'
      }}>
        <Button 
          onClick={onClose}
          variant="outlined"
          size="medium"
          sx={{
            borderColor: 'rgba(25, 118, 210, 0.5)',
            color: 'primary.main',
            borderRadius: 2,
            fontWeight: 600,
            textTransform: 'none',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              borderColor: 'primary.main',
              backgroundColor: 'rgba(59, 130, 246, 0.08)',
              transform: 'translateY(-1px)',
              boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)'
            },
            minWidth: { xs: 120, sm: 'auto' },
            width: { xs: '100%', sm: 'auto' },
            maxWidth: { xs: 200, sm: 'none' }
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TaskDetail; 