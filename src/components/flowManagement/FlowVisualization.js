import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Chip,
  LinearProgress,
  Tooltip,
  IconButton,
  Grid,
  Avatar,
  alpha,
  useTheme
} from '@mui/material';
import {
  Store,
  Build,
  LocalShipping,
  Inventory,
  CheckCircle,
  Error as ErrorIcon,
  PlayArrow,
  Pause,
  ArrowForward,
  ArrowBack
} from '@mui/icons-material';
import { formatDate } from '../../utils/dateUtils';

const FlowVisualization = ({ tasks = [], onTaskAction, currentUser }) => {
  const theme = useTheme();

  // Define the flow steps with their properties
  const flowSteps = [
    {
      id: 'NEW',
      label: 'New SO',
      icon: <PlayArrow />,
      color: theme.palette.primary.main,
      description: 'New Sales Order'
    },
    {
      id: 'STORE_1',
      label: 'Store 1',
      icon: <Store />,
      color: theme.palette.warning.main,
      description: 'Raw Material Storage'
    },
    {
      id: 'CABLE_PRODUCTION',
      label: 'Cable Production',
      icon: <Build />,
      color: theme.palette.success.main,
      description: 'Cable Manufacturing'
    },
    {
      id: 'STORE_2',
      label: 'Store 2',
      icon: <Store />,
      color: theme.palette.warning.main,
      description: 'Work-in-Progress Storage'
    },
    {
      id: 'MOULDING',
      label: 'Moulding',
      icon: <Build />,
      color: theme.palette.primary.main,
      description: 'Moulding Process'
    },
    {
      id: 'FG_SECTION',
      label: 'FG Section',
      icon: <Inventory />,
      color: theme.palette.text.secondary,
      description: 'Finished Goods'
    },
    {
      id: 'DISPATCH',
      label: 'Dispatch',
      icon: <LocalShipping />,
      color: theme.palette.text.secondary,
      description: 'Ready for Dispatch'
    },
    {
      id: 'DELIVERED',
      label: 'Delivered',
      icon: <CheckCircle />,
      color: theme.palette.success.main,
      description: 'Completed'
    }
  ];

  // Get tasks count for each step
  const getTaskCountByStep = (stepId) => {
    return tasks.filter(task => task.Status === stepId).length;
  };

  // Get tasks for a specific step
  const getTasksForStep = (stepId) => {
    return tasks.filter(task => task.Status === stepId);
  };

  // Calculate progress percentage
  const getProgressPercentage = () => {
    if (tasks.length === 0) return 0;
    const completedTasks = tasks.filter(task => task.Status === 'DELIVERED').length;
    return (completedTasks / tasks.length) * 100;
  };

  // Get status icon based on task status
  const getStatusIcon = (status) => {
    switch (status) {
      case 'DELIVERED':
        return <CheckCircle sx={{ color: 'success.main' }} />;
      default:
        return <PlayArrow sx={{ color: 'primary.main' }} />;
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, color: theme.palette.primary.main }}>
            Production Flow Overview
          </Typography>
          
          {/* Progress Bar */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Overall Progress
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {Math.round(getProgressPercentage())}%
              </Typography>
            </Box>
            <LinearProgress 
              variant="determinate" 
              value={getProgressPercentage()} 
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        </Box>

        {/* Flow Steps Grid */}
        <Grid container spacing={2}>
          {flowSteps.map((step, index) => {
            const stepTasks = getTasksForStep(step.id);
            const taskCount = stepTasks.length;
            
            return (
              <Grid item xs={12} sm={6} md={3} key={step.id}>
                <Card 
                  sx={{ 
                    height: '100%',
                    border: `2px solid ${alpha(step.color, 0.2)}`,
                    backgroundColor: taskCount > 0 ? alpha(step.color, 0.05) : 'inherit',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      borderColor: alpha(step.color, 0.5),
                      transform: 'translateY(-2px)',
                      boxShadow: theme.shadows[4]
                    }
                  }}
                >
                  <CardContent sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {/* Step Header */}
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Avatar 
                        sx={{ 
                          backgroundColor: step.color, 
                          mr: 2,
                          width: 40,
                          height: 40
                        }}
                      >
                        {step.icon}
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {step.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {step.description}
                        </Typography>
                      </Box>
                      <Chip
                        label={taskCount}
                        size="small"
                        sx={{
                          backgroundColor: step.color,
                          color: 'common.white',
                          fontWeight: 600
                        }}
                      />
                    </Box>

                    {/* Tasks List */}
                    {taskCount > 0 && (
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                          Tasks in this step:
                        </Typography>
                        <Box sx={{ maxHeight: 120, overflowY: 'auto' }}>
                          {stepTasks.slice(0, 3).map((task) => (
                            <Box 
                              key={task.UniqueId || task.POId}
                              sx={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                mb: 1,
                                p: 1,
                                backgroundColor: alpha(step.color, 0.1),
                                borderRadius: 1
                              }}
                            >
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography 
                                  variant="caption" 
                                  sx={{ 
                                    fontWeight: 600,
                                    fontFamily: 'monospace',
                                    color: 'primary.main',
                                    display: 'block'
                                  }}
                                >
                                  {task.UniqueId || 'N/A'}
                                </Typography>
                                <Typography 
                                  variant="caption" 
                                  sx={{ 
                                    color: 'text.secondary',
                                    display: 'block',
                                    fontSize: '0.7rem'
                                  }}
                                >
                                  {task.ProductCode} • Qty: {task.Quantity}
                                </Typography>
                                {(task.updatedBatch || task.BatchSize) && (
                                  <Typography 
                                    variant="caption" 
                                    sx={{
                                      color: 'warning.main',
                                      fontSize: '0.7rem',
                                      display: 'block'
                                    }}
                                  >
                                    Batch: {(task.updatedBatch || task.BatchSize).toLocaleString()}
                                    {task.updatedBatch && task.BatchSize && task.updatedBatch !== task.BatchSize && (
                                      <Typography component="span" variant="caption" sx={{ color: 'text.disabled', textDecoration: 'line-through', ml: 0.5 }}>
                                        (was {task.BatchSize.toLocaleString()})
                                      </Typography>
                                    )}
                                  </Typography>
                                )}
                              </Box>
                              
                              {/* Action Button */}
                              {task.AssignedTo === currentUser?.email && (
                                <Tooltip title={`Move to ${flowSteps[index + 1]?.label || 'Next Step'}`}>
                                  <IconButton
                                    size="small"
                                    onClick={() => onTaskAction && onTaskAction('advance', task)}
                                    sx={{ 
                                      color: step.color,
                                      '&:hover': { backgroundColor: alpha(step.color, 0.1) }
                                    }}
                                  >
                                    <ArrowForward fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          ))}
                          
                          {stepTasks.length > 3 && (
                            <Typography 
                              variant="caption" 
                              color="text.secondary" 
                              sx={{ 
                                display: 'block',
                                textAlign: 'center',
                                mt: 1,
                                fontStyle: 'italic'
                              }}
                            >
                              +{stepTasks.length - 3} more tasks
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    )}

                    {/* Empty State */}
                    {taskCount === 0 && (
                      <Box sx={{ 
                        flex: 1, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        py: 2
                      }}>
                        <Typography 
                          variant="caption" 
                          color="text.secondary"
                          sx={{ fontStyle: 'italic', textAlign: 'center' }}
                        >
                          No tasks in this step
                        </Typography>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>

        {/* Summary Stats */}
        <Box sx={{ mt: 3, p: 2, backgroundColor: alpha(theme.palette.primary.main, 0.05), borderRadius: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="primary" sx={{ fontWeight: 600 }}>
                  {tasks.length}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Total Tasks
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="success.main" sx={{ fontWeight: 600 }}>
                  {getTaskCountByStep('DELIVERED')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Completed
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="warning.main" sx={{ fontWeight: 600 }}>
                  {tasks.filter(task => task.Status !== 'DELIVERED').length}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  In Progress
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h6" color="error.main" sx={{ fontWeight: 600 }}>
                  0
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Rejected
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Box>
      </CardContent>
    </Card>
  );
};

export default FlowVisualization;
