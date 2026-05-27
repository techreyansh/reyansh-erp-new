import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Box,
  Typography,
  Avatar,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  IconButton,
  alpha,
  useTheme
} from '@mui/material';
import {
  Close as CloseIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  LocationOn as LocationIcon,
  Work as WorkIcon,
  CalendarToday as CalendarIcon,
  School as SchoolIcon,
  Badge as BadgeIcon,
  Star as StarIcon,
  Edit as EditIcon
} from '@mui/icons-material';

// Using regular Box component for now
const MotionBox = Box;

const EmployeeDetailView = ({ open, onClose, employee, onEdit }) => {
  const theme = useTheme();

  if (!employee) return null;

  const normalizedEmployee = {
    ...employee,
    EmployeeCode: employee.EmployeeCode || employee.id || employee.employee_id || '',
    EmployeeName: employee.EmployeeName || employee.full_name || employee.name || 'Unknown Employee',
    Email: employee.Email || employee.email || '',
    Phone: employee.Phone || employee.phone || '',
    Department: employee.Department || employee.department || '',
    Designation:
      employee.Designation ||
      employee.designation ||
      employee.role_name ||
      employee.roles?.role_name ||
      employee.roles?.name ||
      '',
    Status: employee.Status || (employee.is_active === false ? 'Inactive' : 'Active'),
    EmployeeType: employee.EmployeeType || employee.employee_type || 'Full-time',
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not provided';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'error';
      case 'on leave':
        return 'warning';
      default:
        return 'default';
    }
  };

  const personalInfo = [
    { label: 'Employee Code', value: normalizedEmployee.EmployeeCode, icon: <BadgeIcon /> },
    { label: 'Full Name', value: normalizedEmployee.EmployeeName, icon: <PersonIcon /> },
    { label: 'Email', value: normalizedEmployee.Email, icon: <EmailIcon /> },
    { label: 'Phone', value: normalizedEmployee.Phone, icon: <PhoneIcon /> },
    { label: 'Date of Birth', value: formatDate(employee.DateOfBirth || employee.date_of_birth), icon: <CalendarIcon /> },
    { label: 'Address', value: employee.Address || employee.address, icon: <LocationIcon /> }
  ];

  const employmentInfo = [
    { label: 'Department', value: normalizedEmployee.Department, icon: <WorkIcon /> },
    { label: 'Designation', value: normalizedEmployee.Designation, icon: <WorkIcon /> },
    { label: 'Employee Type', value: normalizedEmployee.EmployeeType, icon: <BadgeIcon /> },
    { label: 'Joining Date', value: formatDate(employee.JoiningDate || employee.joining_date), icon: <CalendarIcon /> },
    { label: 'Reporting Manager', value: employee.ReportingManager || employee.reporting_manager, icon: <PersonIcon /> },
    { label: 'Salary Grade', value: employee.SalaryGrade || employee.salary_grade, icon: <WorkIcon /> }
  ];

  const educationInfo = [
    { label: 'Highest Qualification', value: employee.HighestQualification, icon: <SchoolIcon /> },
    { label: 'University/Institute', value: employee.University, icon: <SchoolIcon /> },
    { label: 'Graduation Year', value: employee.GraduationYear, icon: <CalendarIcon /> },
    { label: 'Specialization', value: employee.Specialization, icon: <SchoolIcon /> }
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          maxHeight: '90vh'
        }
      }}
    >
      <DialogTitle sx={{ 
        pb: 2,
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
        borderRadius: '12px 12px 0 0'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Avatar
              sx={{ 
                width: 64, 
                height: 64, 
                bgcolor: 'primary.main',
                fontSize: '1.5rem',
                fontWeight: 600
              }}
            >
              {normalizedEmployee.EmployeeName?.charAt(0) || 'E'}
            </Avatar>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
                {normalizedEmployee.EmployeeName || 'Unknown Employee'}
              </Typography>
              <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
                {normalizedEmployee.Designation || 'No Designation'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip
                  label={normalizedEmployee.Status || 'Active'}
                  color={getStatusColor(normalizedEmployee.Status)}
                  size="small"
                />
                <Chip
                  label={normalizedEmployee.EmployeeType || 'Full-time'}
                  variant="outlined"
                  size="small"
                />
              </Box>
            </Box>
          </Box>
          
          <Box sx={{ display: 'flex', gap: 1 }}>
            {onEdit && (
              <Button
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={() => {
                  onEdit(employee);
                  onClose();
                }}
                sx={{ borderRadius: 2 }}
              >
                Edit
              </Button>
            )}
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Grid container spacing={4}>
          {/* Personal Information */}
          <Grid item xs={12} md={6}>
            <Box>
              <Paper sx={{ p: 3, height: '100%', borderRadius: 2 }}>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PersonIcon color="primary" />
                  Personal Information
                </Typography>
                <List>
                  {personalInfo.map((item, index) => (
                    <React.Fragment key={index}>
                      <ListItem sx={{ px: 0 }}>
                        <ListItemIcon>
                          {item.icon}
                        </ListItemIcon>
                        <ListItemText
                          primary={item.label}
                          secondary={item.value || 'Not provided'}
                          primaryTypographyProps={{ 
                            variant: 'body2', 
                            color: 'text.secondary',
                            fontWeight: 500
                          }}
                          secondaryTypographyProps={{ 
                            variant: 'body1',
                            sx: { fontWeight: 600 }
                          }}
                        />
                      </ListItem>
                      {index < personalInfo.length - 1 && <Divider variant="inset" component="li" />}
                    </React.Fragment>
                  ))}
                </List>
              </Paper>
            </Box>
          </Grid>

          {/* Employment Information */}
          <Grid item xs={12} md={6}>
            <Box>
              <Paper sx={{ p: 3, height: '100%', borderRadius: 2 }}>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <WorkIcon color="primary" />
                  Employment Information
                </Typography>
                <List>
                  {employmentInfo.map((item, index) => (
                    <React.Fragment key={index}>
                      <ListItem sx={{ px: 0 }}>
                        <ListItemIcon>
                          {item.icon}
                        </ListItemIcon>
                        <ListItemText
                          primary={item.label}
                          secondary={item.value || 'Not provided'}
                          primaryTypographyProps={{ 
                            variant: 'body2', 
                            color: 'text.secondary',
                            fontWeight: 500
                          }}
                          secondaryTypographyProps={{ 
                            variant: 'body1',
                            sx: { fontWeight: 600 }
                          }}
                        />
                      </ListItem>
                      {index < employmentInfo.length - 1 && <Divider variant="inset" component="li" />}
                    </React.Fragment>
                  ))}
                </List>
              </Paper>
            </Box>
          </Grid>

          {/* Education Information */}
          <Grid item xs={12} md={6}>
            <Box>
              <Paper sx={{ p: 3, height: '100%', borderRadius: 2 }}>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SchoolIcon color="primary" />
                  Education Information
                </Typography>
                <List>
                  {educationInfo.map((item, index) => (
                    <React.Fragment key={index}>
                      <ListItem sx={{ px: 0 }}>
                        <ListItemIcon>
                          {item.icon}
                        </ListItemIcon>
                        <ListItemText
                          primary={item.label}
                          secondary={item.value || 'Not provided'}
                          primaryTypographyProps={{ 
                            variant: 'body2', 
                            color: 'text.secondary',
                            fontWeight: 500
                          }}
                          secondaryTypographyProps={{ 
                            variant: 'body1',
                            sx: { fontWeight: 600 }
                          }}
                        />
                      </ListItem>
                      {index < educationInfo.length - 1 && <Divider variant="inset" component="li" />}
                    </React.Fragment>
                  ))}
                </List>
              </Paper>
            </Box>
          </Grid>

          {/* Skills & Experience */}
          <Grid item xs={12} md={6}>
            <Box>
              <Paper sx={{ p: 3, height: '100%', borderRadius: 2 }}>
                <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <StarIcon color="primary" />
                  Skills & Experience
                </Typography>
                
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Experience
                  </Typography>
                  <Typography variant="body1">
                    {employee.Experience || 'Not specified'}
                  </Typography>
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Skills
                  </Typography>
                  {employee.Skills ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {employee.Skills.split(',').map((skill, index) => (
                        <Chip
                          key={index}
                          label={skill.trim()}
                          size="small"
                          variant="outlined"
                          color="primary"
                        />
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No skills specified
                    </Typography>
                  )}
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Certifications
                  </Typography>
                  {employee.Certifications ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {employee.Certifications.split(',').map((cert, index) => (
                        <Chip
                          key={index}
                          label={cert.trim()}
                          size="small"
                          color="success"
                        />
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No certifications specified
                    </Typography>
                  )}
                </Box>
              </Paper>
            </Box>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 1 }}>
        <Button onClick={onClose} variant="outlined" sx={{ borderRadius: 2 }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EmployeeDetailView;
