import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Container,
  Typography,
  Snackbar,
  Alert,
  Card,
  CardContent,
  Avatar,
  Button,
  TextField,
  Stack,
  Chip,
  Skeleton,
  CircularProgress,
  Divider,
  useTheme,
  alpha
} from '@mui/material';
import {
  PhotoCamera as PhotoCameraIcon,
  Save as SaveIcon,
  Person as PersonIcon,
  School as SchoolIcon,
  AccountBalance as BankIcon,
  Lock as LockIcon
} from '@mui/icons-material';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../context/AuthContext';

/**
 * Self-service profile editor.
 * Every logged-in user can view + edit THEIR OWN row in public.employees_data
 * (matched by lower("Email") = lower(user.email)) and upload a profile photo
 * to the public 'avatars' storage bucket.
 *
 * Admin-managed fields are shown read-only. RLS is permissive, but the UI
 * scopes every write to the user's own row (eq id = row.id).
 */

// Fields the user is allowed to edit, grouped by section.
const EDITABLE_SECTIONS = [
  {
    key: 'personal',
    title: 'Personal',
    icon: PersonIcon,
    fields: [
      { name: 'EmployeeName', label: 'Full Name' },
      { name: 'Phone', label: 'Phone' },
      { name: 'DateOfBirth', label: 'Date of Birth', type: 'date' },
      { name: 'Address', label: 'Address', multiline: true, rows: 2, full: true }
    ]
  },
  {
    key: 'qualifications',
    title: 'Qualifications',
    icon: SchoolIcon,
    fields: [
      { name: 'HighestQualification', label: 'Highest Qualification' },
      { name: 'University', label: 'University' },
      { name: 'GraduationYear', label: 'Graduation Year' },
      { name: 'Specialization', label: 'Specialization' },
      { name: 'Experience', label: 'Experience' },
      { name: 'Skills', label: 'Skills', multiline: true, rows: 2, full: true },
      { name: 'Certifications', label: 'Certifications', multiline: true, rows: 2, full: true }
    ]
  },
  {
    key: 'bank',
    title: 'Bank Details',
    icon: BankIcon,
    fields: [
      { name: 'UpiId', label: 'UPI ID' },
      { name: 'BankName', label: 'Bank Name' },
      { name: 'AccountNumber', label: 'Account Number' },
      { name: 'IfscCode', label: 'IFSC Code' },
      { name: 'BankBranch', label: 'Bank Branch' },
      { name: 'AccountHolderName', label: 'Account Holder Name' }
    ]
  }
];

// All editable field names (used to build the update payload).
const EDITABLE_FIELDS = EDITABLE_SECTIONS.flatMap((s) => s.fields.map((f) => f.name));

// Admin-managed (read-only) fields.
const READONLY_FIELDS = [
  { name: 'EmployeeCode', label: 'Employee Code' },
  { name: 'Email', label: 'Email' },
  { name: 'Department', label: 'Department' },
  { name: 'Designation', label: 'Designation' },
  { name: 'EmployeeType', label: 'Employee Type' },
  { name: 'JoiningDate', label: 'Joining Date' },
  { name: 'Status', label: 'Status' },
  { name: 'ReportingManager', label: 'Reporting Manager' },
  { name: 'SalaryGrade', label: 'Salary Grade' }
];

const getInitials = (name) => {
  if (!name) return 'U';
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// Supabase date columns can come back as ISO strings; <input type="date"> wants YYYY-MM-DD.
const toDateInputValue = (value) => {
  if (!value) return '';
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const d = new Date(str);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const ProfilePage = () => {
  const theme = useTheme();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [row, setRow] = useState(null);
  const [form, setForm] = useState({});
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const fileInputRef = useRef(null);

  const showSnackbar = useCallback((message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const hydrateForm = useCallback((data) => {
    const next = {};
    EDITABLE_FIELDS.forEach((name) => {
      next[name] = data?.[name] != null ? String(data[name]) : '';
    });
    setForm(next);
  }, []);

  const loadProfile = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const { data, error } = await supabase
        .from('employees_data')
        .select('*')
        .ilike('Email', user.email)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setRow(null);
        setNotFound(true);
        return;
      }

      setRow(data);
      hydrateForm(data);
    } catch (err) {
      console.error('Error loading profile:', err);
      setLoadError(err.message || 'Failed to load your profile.');
    } finally {
      setLoading(false);
    }
  }, [user?.email, hydrateForm]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleFieldChange = (name) => (e) => {
    const value = e.target.value;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSnackbarClose = () => setSnackbar((s) => ({ ...s, open: false }));

  const handleSave = async () => {
    if (!row?.id) return;
    setSaving(true);
    try {
      // Build a trimmed payload of only editable fields.
      const payload = {};
      EDITABLE_FIELDS.forEach((name) => {
        const v = form[name];
        payload[name] = typeof v === 'string' ? v.trim() : v ?? '';
      });

      const { error } = await supabase
        .from('employees_data')
        .update(payload)
        .eq('id', row.id);

      if (error) throw error;

      showSnackbar('Profile saved successfully.', 'success');
      await loadProfile();
    } catch (err) {
      console.error('Error saving profile:', err);
      showSnackbar(err.message || 'Failed to save profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePickPhoto = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again re-fires onChange.
    if (e.target) e.target.value = '';
    if (!file || !row?.id) return;

    if (!file.type.startsWith('image/')) {
      showSnackbar('Please choose an image file.', 'error');
      return;
    }

    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const folder = row.EmployeeCode || user?.email || 'unknown';
      const path = `${folder}/avatar_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData?.publicUrl;
      if (!publicUrl) throw new Error('Could not resolve uploaded photo URL.');

      // Persist immediately, scoped to the user's own row.
      const { error: updateError } = await supabase
        .from('employees_data')
        .update({ ProfilePhoto: publicUrl })
        .eq('id', row.id);

      if (updateError) throw updateError;

      setRow((prev) => (prev ? { ...prev, ProfilePhoto: publicUrl } : prev));
      showSnackbar('Photo updated.', 'success');
    } catch (err) {
      console.error('Error uploading photo:', err);
      showSnackbar(err.message || 'Failed to upload photo.', 'error');
    } finally {
      setUploading(false);
    }
  };

  // ---- Render states -------------------------------------------------------

  const renderHeader = () => (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
        My Profile
      </Typography>
      <Typography variant="body1" color="text.secondary">
        View and update your personal information
      </Typography>
    </Box>
  );

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {renderHeader()}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems="center">
              <Skeleton variant="circular" width={112} height={112} />
              <Box sx={{ flex: 1, width: '100%' }}>
                <Skeleton variant="text" width="40%" height={40} />
                <Skeleton variant="text" width="25%" />
                <Skeleton variant="rectangular" width={140} height={36} sx={{ mt: 1.5, borderRadius: 1 }} />
              </Box>
            </Stack>
          </CardContent>
        </Card>
        {[0, 1].map((i) => (
          <Card key={i} sx={{ mb: 3 }}>
            <CardContent>
              <Skeleton variant="text" width="30%" height={32} sx={{ mb: 2 }} />
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }
                }}
              >
                {[0, 1, 2, 3].map((j) => (
                  <Skeleton key={j} variant="rectangular" height={56} sx={{ borderRadius: 1 }} />
                ))}
              </Box>
            </CardContent>
          </Card>
        ))}
      </Container>
    );
  }

  if (loadError) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {renderHeader()}
        <Alert severity="error">{loadError}</Alert>
        <Button onClick={loadProfile} sx={{ mt: 2 }} variant="outlined">
          Try again
        </Button>
      </Container>
    );
  }

  if (notFound) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {renderHeader()}
        <Alert severity="info">
          No employee profile linked to <strong>{user?.email}</strong> — ask an admin to add you.
        </Alert>
      </Container>
    );
  }

  const displayName = row?.EmployeeName || 'Unknown Employee';

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {renderHeader()}

      {/* Header card with avatar + change photo */}
      <Card
        sx={{
          mb: 3,
          background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
          color: theme.palette.primary.contrastText
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={3}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
          >
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={row?.ProfilePhoto || undefined}
                alt={displayName}
                sx={{
                  width: 112,
                  height: 112,
                  fontSize: '2.5rem',
                  fontWeight: 'bold',
                  bgcolor: alpha(theme.palette.common.white, 0.2),
                  border: `4px solid ${alpha(theme.palette.common.white, 0.3)}`
                }}
              >
                {getInitials(displayName)}
              </Avatar>
              {uploading && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    bgcolor: alpha(theme.palette.common.black, 0.4)
                  }}
                >
                  <CircularProgress size={32} sx={{ color: theme.palette.common.white }} />
                </Box>
              )}
            </Box>

            <Box sx={{ flex: 1 }}>
              <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                {displayName}
              </Typography>
              <Typography variant="h6" sx={{ opacity: 0.9 }}>
                {row?.Designation || 'No Designation'}
              </Typography>
              <Typography variant="body1" sx={{ opacity: 0.8, mb: 2 }}>
                {row?.Department || 'No Department'}
              </Typography>
              <Button
                variant="contained"
                color="inherit"
                startIcon={<PhotoCameraIcon />}
                onClick={handlePickPhoto}
                disabled={uploading}
                sx={{
                  color: theme.palette.primary.main,
                  bgcolor: theme.palette.common.white,
                  '&:hover': { bgcolor: alpha(theme.palette.common.white, 0.85) }
                }}
              >
                {uploading ? 'Uploading…' : 'Change photo'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handlePhotoChange}
              />
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Editable sections */}
      {EDITABLE_SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <Card key={section.key} sx={{ mb: 3 }}>
            <CardContent>
              <Typography
                variant="h6"
                sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Icon color="primary" />
                {section.title}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }
                }}
              >
                {section.fields.map((field) => (
                  <Box
                    key={field.name}
                    sx={{ gridColumn: field.full ? { xs: 'auto', sm: '1 / -1' } : 'auto' }}
                  >
                    <TextField
                      fullWidth
                      label={field.label}
                      type={field.type || 'text'}
                      value={
                        field.type === 'date'
                          ? toDateInputValue(form[field.name])
                          : form[field.name] ?? ''
                      }
                      onChange={handleFieldChange(field.name)}
                      multiline={field.multiline || false}
                      minRows={field.rows}
                      InputLabelProps={field.type === 'date' ? { shrink: true } : undefined}
                    />
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        );
      })}

      {/* Read-only / managed by HR */}
      <Card sx={{ mb: 3, bgcolor: alpha(theme.palette.text.primary, 0.03) }}>
        <CardContent>
          <Typography
            variant="h6"
            sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}
            color="text.secondary"
          >
            <LockIcon fontSize="small" />
            Managed by HR
          </Typography>
          <Typography variant="caption" color="text.secondary">
            These details are admin-managed. Contact HR to change them.
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                sm: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(3, minmax(0, 1fr))'
              }
            }}
          >
            {READONLY_FIELDS.map((field) => {
              const value = row?.[field.name];
              return (
                <Box key={field.name}>
                  <Typography variant="body2" color="text.secondary">
                    {field.label}
                  </Typography>
                  {field.name === 'Status' ? (
                    <Chip
                      label={value || 'Unknown'}
                      size="small"
                      sx={{ mt: 0.5, fontWeight: 600 }}
                    />
                  ) : (
                    <Typography variant="body1" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                      {value || 'N/A'}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </CardContent>
      </Card>

      {/* Save bar */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 2,
          position: 'sticky',
          bottom: 16,
          zIndex: 1
        }}
      >
        <Button
          variant="contained"
          size="large"
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving || uploading}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={handleSnackbarClose}
          severity={snackbar.severity}
          sx={{ width: '100%', fontSize: '1rem', fontWeight: 600 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default ProfilePage;
