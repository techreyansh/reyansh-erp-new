// Barcode/QR scan button. Prefers the native window.BarcodeDetector (Android Chrome);
// falls back to @zxing/browser (iOS Safari, desktop). Calls onResult(text) once.
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Button, Dialog, DialogContent, Box, IconButton, Typography } from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import CloseIcon from '@mui/icons-material/Close';

export default function ScanButton({ onResult, label = 'Scan', formats }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const zxingRef = useRef(null);
  const rafRef = useRef(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (zxingRef.current && typeof zxingRef.current.reset === 'function') {
      try { zxingRef.current.reset(); } catch { /* noop */ }
    }
    zxingRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    stop();
    setOpen(false);
  }, [stop]);

  const finish = useCallback((text) => {
    if (!text) return;
    handleClose();
    onResult?.(String(text));
  }, [handleClose, onResult]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const hasNative = typeof window !== 'undefined' && 'BarcodeDetector' in window;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      if (hasNative) {
        // eslint-disable-next-line no-undef
        const detector = new window.BarcodeDetector(formats ? { formats } : undefined);
        const tick = async () => {
          if (!videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length) {
              finish(codes[0].rawValue);
              return;
            }
          } catch { /* keep scanning */ }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } else {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        zxingRef.current = reader;
        await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) finish(result.getText());
        });
      }
    } catch (err) {
      setError(err?.message || 'Camera unavailable');
    }
  }, [formats, finish]);

  useEffect(() => {
    if (open) start();
    return () => stop();
  }, [open, start, stop]);

  return (
    <>
      <Button
        startIcon={<QrCodeScannerIcon />}
        variant="contained"
        onClick={() => setOpen(true)}
        sx={{ height: 56, borderRadius: 2, fontWeight: 700 }}
        fullWidth
      >
        {label}
      </Button>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
        <DialogContent sx={{ p: 0, position: 'relative', bgcolor: 'black' }}>
          <IconButton
            onClick={handleClose}
            aria-label="Close scanner"
            sx={{ position: 'absolute', top: 8, right: 8, color: 'white', zIndex: 2 }}
          >
            <CloseIcon />
          </IconButton>
          {error ? (
            <Box sx={{ p: 4, color: 'white', textAlign: 'center' }}>
              <Typography>{error}</Typography>
            </Box>
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video ref={videoRef} style={{ width: '100%', display: 'block' }} muted playsInline />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
