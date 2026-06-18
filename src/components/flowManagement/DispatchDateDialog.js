import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Alert,
  Paper,
  Divider,
  Chip,
  Stack
} from '@mui/material';
import {
  Event as EventIcon,
  Schedule as ScheduleIcon,
  Info as InfoIcon,
  LocalShipping as DispatchIcon
} from '@mui/icons-material';
import { calculateStageDueDates, formatDispatchDate, getOrderedStageDueDates } from '../../utils/backwardPlanning';
import { validateDispatchDate } from '../../utils/dateRestrictions';

const DispatchDateDialog = ({ open, onClose, onConfirm, task }) => {
  const [dispatchDate, setDispatchDate] = useState('');
  const [error, setError] = useState('');
  const [dueDates, setDueDates] = useState(null);

  const handleDateChange = (e) => {
    const selectedDate = e.target.value;
    setDispatchDate(selectedDate);
    setError('');

    if (selectedDate) {
      // Validate the dispatch date
      const validation = validateDispatchDate(selectedDate);
      
      if (!validation.isValid) {
        setError(validation.message);
        setDueDates(null);
      } else {
        // Calculate all stage due dates
        const calculatedDates = calculateStageDueDates(selectedDate, task?.OrderType);
        setDueDates(calculatedDates);
      }
    } else {
      setDueDates(null);
    }
  };

  const handleConfirm = () => {
    if (!dispatchDate) {
      setError('Please select a dispatch date');
      return;
    }

    const validation = validateDispatchDate(dispatchDate);
    if (!validation.isValid) {
      setError(validation.message);
      return;
    }

    const calculatedDates = calculateStageDueDates(dispatchDate, task?.OrderType);
    onConfirm(dispatchDate, calculatedDates);
    handleClose();
  };

  const handleClose = () => {
    setDispatchDate('');
    setError('');
    setDueDates(null);
    onClose();
  };

  // Get minimum date (today)
  const today = new Date().toISOString().split('T')[0];

  const orderedDates = dueDates ? getOrderedStageDueDates(dueDates) : [];

  return (
    <Dialog 
      open={open} 
      onClose={handleClose} 
      maxWidth="md" 
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'info.lighter'
        }
      }}
    >
      <DialogTitle
        sx={(theme) => ({
          background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
          color: 'common.white',
          py: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 2
        })}
      >
        <DispatchIcon sx={{ fontSize: 32 }} />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Schedule Dispatch & Start Production
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
            Select dispatch date to plan production and move to Store 1
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ py: 3, px: 3, backgroundColor: 'grey.100' }}>
        <Box sx={{ mb: 3 }}>
          <Alert severity="info" icon={<InfoIcon />} sx={{ mb: 3 }}>
            <Typography variant="body2">
              <strong>Backward Planning:</strong> Select your target dispatch date (D), and the system will
              automatically calculate due dates for all production stages working backwards. The order will then
              move to <strong>Store 1</strong> to start production with the calculated timeline.
            </Typography>
          </Alert>

          <TextField
            label="Dispatch Date"
            type="date"
            value={dispatchDate}
            onChange={handleDateChange}
            fullWidth
            required
            InputLabelProps={{
              shrink: true,
            }}
            inputProps={{
              min: today
            }}
            error={!!error}
            helperText={error || 'Select the target date for dispatch (D)'}
            sx={(theme) => ({
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: theme.palette.info.lighter },
                '&:hover fieldset': { borderColor: theme.palette.primary.main },
                '&.Mui-focused fieldset': { borderColor: theme.palette.primary.main }
              }
            })}
          />
        </Box>

        {dueDates && !error && (
          <Paper
            elevation={0}
            sx={{
              p: 3,
              backgroundColor: 'background.paper',
              border: '1px solid',
              borderColor: 'info.lighter',
              borderRadius: 2
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <ScheduleIcon sx={{ color: 'primary.main' }} />
              <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 600 }}>
                Production Timeline
              </Typography>
            </Box>
            
            <Divider sx={{ mb: 2 }} />
            
            <Stack spacing={1.5}>
              {orderedDates.map((stageInfo, index) => (
                <Box
                  key={stageInfo.status}
                  sx={(theme) => ({
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    p: 2,
                    backgroundColor: index === orderedDates.length - 1
                      ? theme.palette.success.lighter
                      : theme.palette.grey[100],
                    borderRadius: 1,
                    border: index === orderedDates.length - 1
                      ? `2px solid ${theme.palette.success.main}`
                      : `1px solid ${theme.palette.info.lighter}`
                  })}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Chip
                      label={stageInfo.label}
                      size="small"
                      sx={{
                        backgroundColor: index === orderedDates.length - 1
                          ? 'success.main'
                          : 'primary.main',
                        color: 'common.white',
                        fontWeight: 600,
                        minWidth: 50
                      }}
                    />
                    <Typography
                      variant="body1"
                      sx={{
                        fontWeight: index === orderedDates.length - 1 ? 700 : 500,
                        color: index === orderedDates.length - 1 ? 'success.main' : 'text.primary'
                      }}
                    >
                      {stageInfo.stage}
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      color: index === orderedDates.length - 1 ? 'success.main' : 'primary.main',
                      backgroundColor: index === orderedDates.length - 1
                        ? 'background.paper'
                        : 'info.lighter',
                      px: 2,
                      py: 0.5,
                      borderRadius: 1
                    }}
                  >
                    {formatDispatchDate(stageInfo.dueDate)}
                  </Typography>
                </Box>
              ))}
            </Stack>

            <Alert severity="success" sx={{ mt: 2 }}>
              <Typography variant="body2">
                <strong>Timeline Summary:</strong> Production starts in <strong>Store 1</strong> on{' '}
                <strong>{formatDispatchDate(dueDates.Store1DueDate)}</strong> (D-5) and completes dispatch on{' '}
                <strong>{formatDispatchDate(dueDates.DispatchDate)}</strong>
              </Typography>
            </Alert>
          </Paper>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3, backgroundColor: 'grey.100' }}>
        <Button
          onClick={handleClose}
          variant="outlined"
          sx={{
            borderColor: 'primary.main',
            color: 'primary.main',
            '&:hover': {
              borderColor: 'primary.dark',
              backgroundColor: 'grey.100'
            }
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={!dispatchDate || !!error}
          startIcon={<EventIcon />}
          sx={{
            backgroundColor: 'success.main',
            '&:hover': { backgroundColor: 'success.dark' },
            '&:disabled': { backgroundColor: 'grey.300' }
          }}
        >
          Confirm & Start Production
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DispatchDateDialog;
