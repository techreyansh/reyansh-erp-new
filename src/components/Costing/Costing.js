import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Grid,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Snackbar,
  Alert,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
  Pagination,
  Stack,
  alpha,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  PaidOutlined,
  ReceiptLongOutlined,
  TrendingUpRounded,
  CableOutlined,
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import costingService from '../../services/costingService';
import { StatCard } from '../common/kit';

const Costing = () => {
  const theme = useTheme();
  const [costingEntries, setCostingEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  
  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  
  // Form state
  const [formData, setFormData] = useState({
    specifications: '',
    cuStrands: '',
    gauge: '',
    innerOD: '',
    bunch: '',
    noOfCores: '',
    roundOD: '',
    flatB: '',
    flatW: '',
    laying: '',
    labourOnWire: 12,
    lengthReq: '',
    type: 'Wire',
    plugCost: '',
    terminalAccCost: '',
    enquiryBy: 'CEO',
    company: '',
    remarks: ''
  });

  // Settings state
  const [settings, setSettings] = useState({
    copperRate: 700,
    pvcRate: 100,
    labourOnWire: 12
  });

  useEffect(() => {
    fetchCostingEntries();
  }, []);

  const fetchCostingEntries = async () => {
    try {
      setLoading(true);
      const data = await costingService.getAllCostingEntries();
      setCostingEntries(Array.isArray(data) ? data : []);
    } catch (error) {
      setSnackbar({ 
        open: true, 
        message: 'Error fetching costing entries: ' + error.message, 
        severity: 'error' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (field, value) => {
    const newFormData = { ...formData, [field]: value };
    
    // Auto-calculate bunch based on copper strands
    if (field === 'cuStrands') {
      const cuStrands = parseFloat(value) || 0;
      if (cuStrands > 24) {
        newFormData.bunch = '3';
      } else {
        newFormData.bunch = '0';
      }
    }
    
    // Auto-calculate laying based on number of cores
    if (field === 'noOfCores') {
      const noOfCores = parseFloat(value) || 0;
      if (noOfCores > 2) {
        newFormData.laying = '1';
      } else {
        newFormData.laying = '0';
      }
    }
    
    // Auto-increment gauge by 0.003 for calculations
    if (field === 'gauge') {
      const gauge = parseFloat(value) || 0;
      if (gauge > 0) {
        newFormData.gaugeForCalculation = (gauge + 0.003).toFixed(3);
      }
    }
    
    // Auto-increment dimensions by 0.5 for calculations
    if (field === 'innerOD') {
      const innerOD = parseFloat(value) || 0;
      if (innerOD > 0) {
        newFormData.innerODForCalculation = (innerOD + 0.5).toFixed(2);
      }
    }
    
    if (field === 'roundOD') {
      const roundOD = parseFloat(value) || 0;
      if (roundOD > 0) {
        newFormData.roundODForCalculation = (roundOD + 0.5).toFixed(2);
      }
    }
    
    if (field === 'flatB') {
      const flatB = parseFloat(value) || 0;
      if (flatB > 0) {
        newFormData.flatBForCalculation = (flatB + 0.5).toFixed(2);
      }
    }
    
    if (field === 'flatW') {
      const flatW = parseFloat(value) || 0;
      if (flatW > 0) {
        newFormData.flatWForCalculation = (flatW + 0.5).toFixed(2);
      }
    }
    
    // Auto-calculate copper weight using formula: 0.703*D2*D2*C2+F2*G2
    // Use incremented gauge for calculation if available
    if (field === 'cuStrands' || field === 'gauge' || field === 'noOfCores' || field === 'bunch') {
      const cuStrands = parseFloat(newFormData.cuStrands) || 0;
      const gauge = parseFloat(newFormData.gaugeForCalculation || newFormData.gauge) || 0;
      const noOfCores = parseFloat(newFormData.noOfCores) || 0;
      const bunch = parseFloat(newFormData.bunch) || 0;
      
      if (cuStrands > 0 && gauge > 0 && noOfCores > 0 && bunch >= 0) {
        const copperWeight = 0.703 * gauge * gauge * cuStrands + bunch * noOfCores;
        newFormData.copperWeight = copperWeight.toFixed(2);
      }
    }
    
    setFormData(newFormData);
  };

  const handleSettingsChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  // Live cost breakdown — recomputes as the user types in the entry form.
  const liveCost = useMemo(() => {
    try {
      return costingService.calculateValues({
        ...formData,
        copperRate: settings.copperRate,
        pvcRate: settings.pvcRate,
        labourOnWire: settings.labourOnWire,
      });
    } catch (e) {
      return null;
    }
  }, [formData, settings]);

  // Default order: newest costing entries first.
  const sortedEntries = useMemo(() => {
    const arr = Array.isArray(costingEntries) ? costingEntries : [];
    return [...arr].sort((a, b) => {
      const da = new Date(a.Date || a.date || 0).getTime();
      const db = new Date(b.Date || b.date || 0).getTime();
      return (db || 0) - (da || 0);
    });
  }, [costingEntries]);

  const handleSubmit = async () => {
    try {
      // Use incremented values for saving
      const dataToSubmit = {
        ...formData,
        gauge: formData.gaugeForCalculation || formData.gauge,
        innerOD: formData.innerODForCalculation || formData.innerOD,
        roundOD: formData.roundODForCalculation || formData.roundOD,
        flatB: formData.flatBForCalculation || formData.flatB,
        flatW: formData.flatWForCalculation || formData.flatW,
        ...settings
      };
      const result = await costingService.addCostingEntry(dataToSubmit);
      
      setSnackbar({ 
        open: true, 
        message: result.message, 
        severity: 'success' 
      });
      
      setOpenDialog(false);
      setFormData({
        specifications: '',
        cuStrands: '',
        gauge: '',
        innerOD: '',
        bunch: '',
        noOfCores: '',
        roundOD: '',
        flatB: '',
        flatW: '',
        laying: '',
        labourOnWire: settings.labourOnWire,
        lengthReq: '',
        type: 'Wire',
        plugCost: '',
        terminalAccCost: '',
        enquiryBy: 'CEO',
        company: '',
        remarks: ''
      });
      
      fetchCostingEntries();
    } catch (error) {
      setSnackbar({ 
        open: true, 
        message: 'Error adding costing entry: ' + error.message, 
        severity: 'error' 
      });
    }
  };

  const handleInitializeSheet = async () => {
    try {
      await costingService.initializeSheet();
      setSnackbar({ 
        open: true, 
        message: 'Costing sheet initialized successfully!', 
        severity: 'success' 
      });
      fetchCostingEntries();
    } catch (error) {
      setSnackbar({ 
        open: true, 
        message: 'Error initializing sheet: ' + error.message, 
        severity: 'error' 
      });
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
  };

  // Pagination handlers
  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: { xs: 2, md: 3 } }}>
      {/* Header */}
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 2.5,
          p: { xs: 2, md: 2.5 },
          mb: 3,
          background: (t) => `linear-gradient(180deg, ${alpha(t.palette.primary.main, 0.06)} 0%, transparent 100%)`,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 44, height: 44, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (t) => alpha(t.palette.primary.main, 0.1) }}>
              <PaidOutlined sx={{ color: 'primary.main' }} />
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
                Costing
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Cable & cord cost calculations and material rates
              </Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Rate settings">
              <IconButton onClick={() => setOpenSettings(true)} size="small">
                <SettingsIcon />
              </IconButton>
            </Tooltip>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchCostingEntries} disabled={loading} sx={{ textTransform: 'none' }}>
              Refresh
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpenDialog(true)} sx={{ textTransform: 'none' }}>
              Add New
            </Button>
          </Stack>
        </Box>
      </Paper>

      {/* Stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <StatCard label="Total Entries" value={costingEntries.length} icon={ReceiptLongOutlined} accent={theme.palette.primary.dark} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard label="Copper Rate" value={`₹${settings.copperRate || 0}`} sub="per kg" icon={PaidOutlined} accent={theme.palette.warning.main} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard label="PVC Rate" value={`₹${settings.pvcRate || 0}`} sub="per kg" icon={CableOutlined} accent={theme.palette.primary.main} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatCard label="Labour Rate" value={`${settings.labourOnWire || 0}%`} sub="on wire" icon={TrendingUpRounded} accent={theme.palette.primary.main} />
        </Grid>
      </Grid>

      {/* Settings Dialog */}
      <Dialog 
        open={openSettings} 
        onClose={() => setOpenSettings(false)} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            overflow: 'hidden'
          }
        }}
      >
        <DialogTitle sx={{
          backgroundColor: 'primary.main',
          color: 'common.white',
          py: 3,
          px: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 2
        }}>
          <Box sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <SettingsIcon />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Costing Settings
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ p: 4, backgroundColor: 'grey.50' }}>
          <Box sx={{ mb: 3, p: 3, backgroundColor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'grey.100' }}>
            <Typography variant="h6" sx={{ mb: 3, color: 'primary.main', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
              💰 Material Rates Configuration
            </Typography>
            
            <Typography variant="body2" color="textSecondary" sx={{ mb: 3, lineHeight: 1.6 }}>
              Configure the default rates for copper and PVC materials. These rates will be used in all costing calculations unless overridden.
            </Typography>
            
            <Grid container spacing={3}>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Copper Rate"
                  type="number"
                  value={settings.copperRate}
                  onChange={(e) => handleSettingsChange('copperRate', e.target.value)}
                  fullWidth
                  InputProps={{
                    endAdornment: <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>₹/kg</Typography>,
                    sx: {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    }
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
                <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                  Current market rate for copper per kilogram
                </Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="PVC Rate"
                  type="number"
                  value={settings.pvcRate}
                  onChange={(e) => handleSettingsChange('pvcRate', e.target.value)}
                  fullWidth
                  InputProps={{
                    endAdornment: <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>₹/kg</Typography>,
                    sx: {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    }
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
                <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                  Current market rate for PVC per kilogram
                </Typography>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Labour on Wire"
                  type="number"
                  value={settings.labourOnWire}
                  onChange={(e) => handleSettingsChange('labourOnWire', e.target.value)}
                  fullWidth
                  InputProps={{
                    endAdornment: <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>%</Typography>,
                    sx: {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    }
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
                <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                  Labour for wire processing
                </Typography>
              </Grid>
            </Grid>
          </Box>
          
          <Box sx={{ p: 3, backgroundColor: 'info.lighter', borderRadius: 2, border: '1px solid', borderColor: 'primary.light' }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.dark', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
              ℹ️ Information
            </Typography>
            <Typography variant="body2" color="primary.dark" sx={{ lineHeight: 1.6 }}>
              These rates are used as default values for all new costing entries. Copper rate: ₹700/kg, PVC rate: ₹100/kg, Labour rate: 12%. You can modify them at any time, and the changes will apply to future calculations. Existing entries will retain their original rates.
            </Typography>
          </Box>
        </DialogContent>
        
        <DialogActions sx={{ p: 3, backgroundColor: 'grey.100', gap: 2 }}>
          <Button
            onClick={() => setOpenSettings(false)}
            variant="outlined"
            sx={{
              borderRadius: 2,
              px: 3,
              py: 1,
              borderColor: 'text.secondary',
              color: 'text.secondary',
              '&:hover': {
                borderColor: 'text.primary',
                backgroundColor: 'grey.100'
              }
            }}
          >
            Close
          </Button>
          <Button
            onClick={() => setOpenSettings(false)}
            variant="contained"
            sx={{
              borderRadius: 2,
              px: 4,
              py: 1,
              backgroundColor: 'primary.main',
              '&:hover': {
                backgroundColor: 'primary.dark'
              }
            }}
          >
            Save Settings
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add New Dialog */}
      <Dialog 
        open={openDialog} 
        onClose={() => setOpenDialog(false)} 
        maxWidth="lg" 
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            overflow: 'hidden'
          }
        }}
      >
        <DialogTitle sx={{
          backgroundColor: 'primary.main',
          color: 'common.white',
          py: 3,
          px: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 2
        }}>
          <Box sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <AddIcon />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Add New Costing Entry
          </Typography>
        </DialogTitle>
        
        <DialogContent sx={{ p: 4, backgroundColor: 'grey.50' }}>
          {/* Live cost breakdown — updates as you fill the form */}
          <Paper
            elevation={0}
            sx={{
              mb: 3, p: 2, borderRadius: 2.5, position: 'sticky', top: 0, zIndex: 2,
              border: '1px solid', borderColor: 'divider',
              background: (t) => `linear-gradient(135deg, ${alpha(t.palette.primary.main, 0.1)} 0%, ${alpha(t.palette.primary.main, 0.03)} 100%)`,
              backdropFilter: 'blur(4px)',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, letterSpacing: '0.02em' }}>
                ⚡ Live Cost Breakdown
              </Typography>
              <Chip
                label={`Cord Cost  ₹${(Number(liveCost?.cordCost) || 0).toFixed(2)}`}
                color="primary"
                sx={{ fontWeight: 800, fontSize: '0.85rem', height: 30 }}
              />
            </Stack>
            <Grid container spacing={1.25}>
              {[
                { label: 'Final Copper', value: `${(Number(liveCost?.finalCopper) || 0).toFixed(3)}`, unit: 'kg/100m' },
                { label: 'Final PVC', value: `${((Number(liveCost?.finalPVCRound) || 0) + (Number(liveCost?.finalPVCFlat) || 0)).toFixed(3)}`, unit: 'kg/100m' },
                { label: 'RMC', value: `₹${(Number(liveCost?.rmc) || 0).toFixed(2)}`, unit: '/100m' },
                { label: 'Wire / metre', value: `₹${(Number(liveCost?.costOfWirePerMtr) || 0).toFixed(2)}`, unit: 'per m' },
                { label: 'Wire Cost', value: `₹${(Number(liveCost?.wireCost) || 0).toFixed(2)}`, unit: `× ${formData.lengthReq || 0} m` },
                { label: 'Plug + Terminal', value: `₹${((parseFloat(formData.plugCost) || 0) + (parseFloat(formData.terminalAccCost) || 0)).toFixed(2)}`, unit: 'add-ons' },
              ].map((m) => (
                <Grid item xs={6} sm={4} md={2} key={m.label}>
                  <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', height: '100%' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', fontSize: '0.62rem', display: 'block' }}>
                      {m.label}
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>{m.value}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.6rem' }}>{m.unit}</Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Paper>

          <Box sx={{ mb: 3, p: 2, backgroundColor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'grey.100' }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
              📋 Basic Information
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Specifications"
                  value={formData.specifications}
                  onChange={(e) => handleFormChange('specifications', e.target.value)}
                  fullWidth
                  required
                  multiline
                  rows={3}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Company"
                  value={formData.company}
                  onChange={(e) => handleFormChange('company', e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
            </Grid>
          </Box>

          <Box sx={{ mb: 3, p: 2, backgroundColor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'grey.100' }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
              🔧 Technical Specifications
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Cu Strands"
                  type="number"
                  value={formData.cuStrands}
                  onChange={(e) => handleFormChange('cuStrands', e.target.value)}
                  fullWidth
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Gauge"
                  type="number"
                  value={formData.gauge}
                  onChange={(e) => handleFormChange('gauge', e.target.value)}
                  fullWidth
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Inner OD"
                  type="number"
                  value={formData.innerOD}
                  onChange={(e) => handleFormChange('innerOD', e.target.value)}
                  fullWidth
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
              {/* <Grid item xs={12} sm={4}>
                <TextField
                  label="Bunch (%)"
                  type="number"
                  value={formData.bunch}
                  fullWidth
                  required
                  InputProps={{ readOnly: true }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      backgroundColor: 'grey.100',
                      '& fieldset': {
                        borderColor: 'grey.300',
                      },
                    },
                  }}
                  helperText="Auto-calculated: 3% if >24 strands, 0% otherwise"
                />
              </Grid> */}
              <Grid item xs={12} sm={4}>
                <TextField
                  label="No. of Cores"
                  type="number"
                  value={formData.noOfCores}
                  onChange={(e) => handleFormChange('noOfCores', e.target.value)}
                  fullWidth
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>

            </Grid>
          </Box>

          <Box sx={{ mb: 3, p: 2, backgroundColor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'grey.100' }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
              📏 Dimensions
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Round OD"
                  type="number"
                  value={formData.roundOD}
                  onChange={(e) => handleFormChange('roundOD', e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Flat B"
                  type="number"
                  value={formData.flatB}
                  onChange={(e) => handleFormChange('flatB', e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Flat W"
                  type="number"
                  value={formData.flatW}
                  onChange={(e) => handleFormChange('flatW', e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
            </Grid>
          </Box>

          <Box sx={{ mb: 3, p: 2, backgroundColor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'grey.100' }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
              💰 Cost & Labor
            </Typography>
            <Grid container spacing={3}>
              
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Length Required"
                  type="number"
                  value={formData.lengthReq}
                  onChange={(e) => handleFormChange('lengthReq', e.target.value)}
                  fullWidth
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth required>
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={formData.type}
                    onChange={(e) => handleFormChange('type', e.target.value)}
                    label="Type"
                    sx={{
                      borderRadius: 2,
                      '& .MuiOutlinedInput-notchedOutline': {
                        '&:hover': {
                          borderColor: 'primary.main',
                        },
                      },
                    }}
                  >
                    <MenuItem value="Wire">Wire</MenuItem>
                    <MenuItem value="Plug">Plug</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Plug Cost"
                  type="number"
                  value={formData.plugCost}
                  onChange={(e) => handleFormChange('plugCost', e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Terminal/Acc Cost"
                  type="number"
                  value={formData.terminalAccCost}
                  onChange={(e) => handleFormChange('terminalAccCost', e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
            </Grid>
          </Box>

          <Box sx={{ p: 2, backgroundColor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'grey.100' }}>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main', fontWeight: 600 }}>
              📝 Additional Information
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  label="Remarks"
                  value={formData.remarks}
                  onChange={(e) => handleFormChange('remarks', e.target.value)}
                  fullWidth
                  multiline
                  rows={3}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      '&:hover fieldset': {
                        borderColor: 'primary.main',
                      },
                    },
                  }}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        
        <DialogActions sx={{ p: 3, backgroundColor: 'grey.100', gap: 2 }}>
          <Button
            onClick={() => setOpenDialog(false)}
            variant="outlined"
            sx={{
              borderRadius: 2,
              px: 3,
              py: 1,
              borderColor: 'text.secondary',
              color: 'text.secondary',
              '&:hover': {
                borderColor: 'text.primary',
                backgroundColor: 'grey.100'
              }
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={
              !formData.specifications ||
              !formData.cuStrands ||
              !formData.gauge ||
              !formData.innerOD ||
              !formData.noOfCores ||
              !formData.lengthReq ||
              !formData.type
            }
            sx={{
              borderRadius: 2,
              px: 4,
              py: 1,
              backgroundColor: 'primary.main',
              '&:hover': {
                backgroundColor: 'primary.dark'
              },
              '&:disabled': {
                backgroundColor: 'grey.300',
                color: 'text.secondary'
              }
            }}
          >
            <AddIcon sx={{ mr: 1 }} />
            Add Entry
          </Button>
        </DialogActions>
      </Dialog>

      {/* Table */}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Costing Entries
          </Typography>
          <Button
            variant="outlined"
            onClick={handleInitializeSheet}
            size="small"
            sx={{ textTransform: 'none' }}
          >
            Initialize Sheet
          </Button>
        </Box>

        <TableContainer sx={{ maxHeight: 520, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{
                  fontWeight: 'bold',
                  backgroundColor: 'grey.200',
                  color: 'grey.700',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 100,
                  textAlign: 'center',
                  py: 1
                }}>
                  Costing ID
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 90
                }}>
                  Date
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 150
                }}>
                  Specifications
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 80
                }}>
                  Cu Strands
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 70
                }}>
                  Gauge
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 80
                }}>
                  Inner OD
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 80
                }}>
                  Bunch (%)
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 100
                }}>
                  No. of Cores
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 80
                }}>
                  Round OD
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 70
                }}>
                  Flat B
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 70
                }}>
                  Flat W
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 80
                }}>
                  Laying (%)
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 120
                }}>
                  Copper Weight
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 120
                }}>
                  PVC Weight
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 120
                }}>
                  Final Copper
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 120
                }}>
                  Final PVC Round
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 120
                }}>
                  Final PVC Flat
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 90
                }}>
                  RMC
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 100
                }}>
                  Bundle Cost
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 100
                }}>
                  Bundle Weight
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 100
                }}>
                  Wire Cost/Mtr
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 100
                }}>
                  Length Req
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 90
                }}>
                  Wire Cost
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 80
                }}>
                  Type
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 90
                }}>
                  Plug Cost
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 120
                }}>
                  Terminal Cost
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 90
                }}>
                  Cord Cost
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 100
                }}>
                  Enquiry By
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                  minWidth: 100
                }}>
                  Company
                </TableCell>
                <TableCell sx={{ 
                  fontWeight: 'bold', 
                  backgroundColor: 'grey.100',
                  color: 'grey.600',
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  minWidth: 120
                }}>
                  Remarks
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={32} align="center" sx={{ py: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CircularProgress size={24} sx={{ mr: 2 }} />
                      <Typography>Loading costing entries...</Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : costingEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={32} align="center" sx={{ py: 6 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <Typography variant="h5" color="textSecondary" sx={{ mb: 2 }}>
                        📊 No costing entries found
                      </Typography>
                      <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
                        Start by adding your first costing entry
                      </Typography>
                      <Button 
                        variant="contained" 
                        onClick={() => setOpenDialog(true)}
                        sx={{ borderRadius: 2 }}
                      >
                        Add First Entry
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                sortedEntries
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((entry, index) => (
                  <TableRow 
                    key={entry.Unique || index}
                    sx={{ 
                      '&:nth-of-type(odd)': { backgroundColor: 'grey.100' },
                      '&:hover': {
                        backgroundColor: 'info.lighter',
                        transform: 'scale(1.001)',
                        transition: 'all 0.2s ease'
                      },
                      transition: 'background-color 0.2s ease'
                    }}
                  >
                    <TableCell sx={{ 
                      fontWeight: 'bold',
                      color: 'primary.main',
                      borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                      fontFamily: 'monospace',
                      textAlign: 'center'
                    }}>
                      {entry['Costing ID']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100' }}>
                      {formatDate(entry.Date)}
                    </TableCell>
                    <TableCell sx={{ 
                      borderRight: '1px solid',
                  borderRightColor: 'grey.100',
                      maxWidth: 150,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {entry.Specifications}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry['Cu Strands']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry.Gauge}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry['Inner OD']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry.Bunch}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry['No. Of Cores']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry['Round OD']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry['Flat B']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry['Flat W']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry.Laying}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      {entry['Copper Weight (Kgs/100 mtr)']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      {entry['PVC Weight (Kgs/100 mtr)']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      {entry['Final Copper (Kgs/100 mtr)']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      {entry['Final PVC Round (Kgs/100 mtr)']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      {entry['Final PVC Flat (Kgs/100 mtr)']}
                    </TableCell>
                    <TableCell sx={{ 
                      borderRight: '1px solid',
                  borderRightColor: 'grey.100', 
                      textAlign: 'right', 
                      fontFamily: 'monospace',
                      fontWeight: 'bold',
                      color: 'success.main'
                    }}>
                      ₹{entry.RMC}
                    </TableCell>
                    <TableCell sx={{ 
                      borderRight: '1px solid',
                  borderRightColor: 'grey.100', 
                      textAlign: 'right', 
                      fontFamily: 'monospace',
                      fontWeight: 'bold',
                      color: 'primary.main'
                    }}>
                      ₹{entry['Bundle Cost']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      {entry['Bundle Weight']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      ₹{entry['Cost Of Wire/Mtr']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry['Length Required']}
                    </TableCell>
                    <TableCell sx={{ 
                      borderRight: '1px solid',
                  borderRightColor: 'grey.100', 
                      textAlign: 'right', 
                      fontFamily: 'monospace',
                      fontWeight: 'bold',
                      color: 'error.main'
                    }}>
                      ₹{entry['Wire Cost']}
                    </TableCell>
                    <TableCell sx={{ 
                      borderRight: '1px solid',
                  borderRightColor: 'grey.100', 
                      textAlign: 'center',
                      '& .MuiChip-root': {
                        fontSize: '0.75rem',
                        height: 20
                      }
                    }}>
                      <Chip 
                        label={entry['Type (Wire/Plug)']} 
                        size="small"
                        color={entry['Type (Wire/Plug)'] === 'Wire' ? 'primary' : 'secondary'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      ₹{entry['Plug Cost']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'right', fontFamily: 'monospace' }}>
                      ₹{entry['Terminal/Acc. Cost']}
                    </TableCell>
                    <TableCell sx={{ 
                      borderRight: '1px solid',
                  borderRightColor: 'grey.100', 
                      textAlign: 'right', 
                      fontFamily: 'monospace',
                      fontWeight: 'bold',
                      color: 'warning.main',
                      fontSize: '1.1rem'
                    }}>
                      ₹{entry['Cord Cost']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100', textAlign: 'center' }}>
                      {entry['Enquiry By']}
                    </TableCell>
                    <TableCell sx={{ borderRight: '1px solid', borderRightColor: 'grey.100' }}>
                      {entry.Company}
                    </TableCell>
                    <TableCell sx={{ 
                      maxWidth: 120,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {entry.Remarks}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        
        {/* Pagination */}
        {costingEntries.length > 0 && (
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            p: 2,
            borderTop: '1px solid',
            borderTopColor: 'grey.100',
            backgroundColor: 'grey.100'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                Rows per page:
              </Typography>
              <FormControl size="small" sx={{ minWidth: 80 }}>
                <Select
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(e.target.value);
                    setPage(0);
                  }}
                  sx={{
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(25, 118, 210, 0.3)',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'rgba(25, 118, 210, 0.5)',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'primary.main',
                    }
                  }}
                >
                  <MenuItem value={5}>5</MenuItem>
                  <MenuItem value={10}>10</MenuItem>
                  <MenuItem value={25}>25</MenuItem>
                  <MenuItem value={50}>50</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                {page * rowsPerPage + 1}-{Math.min((page + 1) * rowsPerPage, costingEntries.length)} of {costingEntries.length} entries
              </Typography>
              
              {Math.ceil(costingEntries.length / rowsPerPage) > 1 && (
                <Pagination
                  count={Math.ceil(costingEntries.length / rowsPerPage)}
                  page={page + 1}
                  onChange={(event, value) => setPage(value - 1)}
                  color="primary"
                  size="large"
                  showFirstButton
                  showLastButton
                  sx={(theme) => ({
                    '& .MuiPaginationItem-root': {
                      borderRadius: 3,
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      minWidth: 36,
                      height: 36,
                      margin: '0 2px',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'scale(1.1)',
                        boxShadow: '0 5px 15px rgba(0,0,0,0.2)'
                      },
                      '&.Mui-selected': {
                        background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
                        color: theme.palette.common.white,
                        fontWeight: 800,
                        boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                        '&:hover': {
                          transform: 'scale(1.15)',
                          boxShadow: '0 10px 25px rgba(0,0,0,0.4)'
                        }
                      }
                    }
                  })}
                />
              )}
            </Box>
          </Box>
        )}
        
        {costingEntries.length > 0 && (
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, backgroundColor: 'grey.100', borderRadius: 2 }}>
            <Typography variant="body1" sx={{ fontWeight: 500, color: 'primary.main' }}>
              📊 Total Entries: <strong>{costingEntries.length}</strong>
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Last updated: {new Date().toLocaleString()}
            </Typography>
          </Box>
        )}
      </Paper>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Costing; 