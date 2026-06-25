// Capture a photo from the rear camera (or pick from gallery). Returns the File
// plus an object-URL preview. Upload wiring is a module concern, not the primitive's.
import React, { useRef, useState } from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import DeleteIcon from '@mui/icons-material/Delete';

export default function PhotoCapture({ onCapture, label = 'Add Photo' }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    onCapture?.(file, url);
  };

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
    onCapture?.(null, null);
  };

  return (
    <Box>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
      {preview ? (
        <Box sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
          <img src={preview} alt="Captured" style={{ width: '100%', display: 'block' }} />
          <IconButton
            onClick={clear}
            aria-label="Remove photo"
            sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(0,0,0,0.6)', color: 'white' }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ) : (
        <Button
          startIcon={<PhotoCameraIcon />}
          variant="outlined"
          onClick={() => inputRef.current?.click()}
          sx={{ height: 56, borderRadius: 2, fontWeight: 700 }}
          fullWidth
        >
          {label}
        </Button>
      )}
      {!preview && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Uses the rear camera on mobile.
        </Typography>
      )}
    </Box>
  );
}
