import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { AlertTriangle, Camera, CheckCircle2, ShieldAlert, UploadCloud, X } from 'lucide-react';
import { useAndroidBackHandler } from '../lib/capacitorAndroid';
import DialogSurface from './ui/DialogSurface';

interface QrScannerModalProps {
  onClose: () => void;
  onScanSuccess: (text: string) => Promise<boolean>;
  successMessage: string;
  errorMessage: string;
  title?: string;
  subtitle?: string;
  instructions?: string;
}

// Shared webcam/file QR reader used by both the Engraving desk (offline ticket sync)
// and the Timing console (scan-to-record a runner's bib at a checkpoint).
export default function QrScannerModal({
  onClose,
  onScanSuccess,
  successMessage,
  errorMessage,
  title = 'Live Ticket QR Reader',
  subtitle = 'STANDBY FOR RUNNER TICKET TRANSIT',
  instructions = "Point your webcam or laptop camera at the runner's QR code to read it instantly.",
}: QrScannerModalProps) {
  const scannerId = "html5-qr-scanner-element";
  const [cameraActive, setCameraActive] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [scannerAttempt, setScannerAttempt] = useState(0);
  const [localFileError, setLocalFileError] = useState('');
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  useAndroidBackHandler(true, onClose);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let stopped = false;
    const startScanning = async () => {
      try {
        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = html5QrCode;
        setCameraActive(false);
        setPermissionError(false);
        setCameraError('');

        // iOS Safari can expose the front camera first. Asking the browser
        // for the physical camera list after permission lets us select the
        // rear/back camera explicitly, which prevents the blank-white feed
        // seen on older iPhones with an `environment` hint alone.
        let rearCameraId: string | undefined;
        try {
          const cameras = await Html5Qrcode.getCameras();
          rearCameraId = cameras.find((camera) => /back|rear|environment/i.test(camera.label))?.id;
        } catch (cameraListError) {
          // iPhone Safari occasionally declines device enumeration even after
          // permission is granted. Starting directly with the environment
          // preference still works, so never block the scanner on this step.
          console.warn('Could not enumerate cameras; using the rear-camera preference instead.', cameraListError);
        }

        await html5QrCode.start(
          rearCameraId || { facingMode: { ideal: "environment" } },
          {
            fps: 8,
            aspectRatio: 1,
            disableFlip: true,
            qrbox: (width, height) => {
              const min = Math.min(width, height);
              return { width: Math.floor(min * 0.75), height: Math.floor(min * 0.75) };
            }
          },
          async (decodedText) => {
            if (stopped) return;
            await onScanSuccess(decodedText);
          },
          () => {
            // Silence verbose camera tracking errors in log console
          }
        );
        if (stopped) {
          if (html5QrCode.isScanning) await html5QrCode.stop();
          return;
        }
        // Only mark the scanner active once a real video stream is rendered.
        // Previously this was set before start() completed, which could leave
        // iPhone Safari showing a blank camera box after a failed startup.
        setCameraActive(true);
      } catch (err: any) {
        console.error("Failed to start QR camera:", err);
        setCameraActive(false);
        const errMsg = err?.toString() || '';
        if (
          err?.name === "NotAllowedError" ||
          errMsg.includes("NotAllowedError") ||
          errMsg.includes("Permission denied") ||
          errMsg.includes("permission denied")
        ) {
          setPermissionError(true);
        } else {
          setCameraError('The rear camera could not start. Tap Try camera again, or upload a photo of the QR code.');
        }
      }
    };

    // Give DOM a tick to render element container
    const timer = setTimeout(() => {
      startScanning();
    }, 250);

    return () => {
      stopped = true;
      clearTimeout(timer);
      if (html5QrCodeRef.current) {
        if (html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().then(() => {
            html5QrCodeRef.current?.clear();
          }).catch(err => console.warn("Error stopping scanner component:", err));
        }
      }
    };
  }, [scannerAttempt]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalFileError('');

    try {
      const fileDecoder = new Html5Qrcode("temporary-file-qr-decoder");
      const text = await fileDecoder.scanFile(file, true);
      const success = await onScanSuccess(text);
      if (!success) {
        setLocalFileError("The QR code scanned is valid but matches an incompatible format.");
      }
    } catch (err: any) {
      console.error("Manual QR photo decoder failed: ", err);
      setLocalFileError("Unable to detect QR code from this image. Please click closer or ensure clear lighting.");
    }
  };

  return (
    <DialogSurface
      titleId="qr-scanner-modal-title"
      onRequestClose={onClose}
      className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[26px] w-full max-w-sm md:max-w-md p-0 shadow-2xl flex flex-col"
    >
      {/* Hidden container for file decoder */}
      <div id="temporary-file-qr-decoder" className="hidden" />

      <div className="flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-inset)]">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-violet-700 dark:text-violet-400 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="qr-scanner-modal-title" className="heading-float text-base font-semibold tracking-tight font-display text-[var(--text-primary)] uppercase">{title}</h2>
              <p className="text-[11px] text-[var(--text-secondary)] font-mono">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR scanner"
            className="min-h-11 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition bg-[var(--surface-card)] border border-[var(--border-default)] py-2 px-3 rounded-[20px] text-xs font-semibold uppercase flex items-center gap-1"
          >
            <X className="w-4 h-4" aria-hidden="true" /> Close
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center justify-center space-y-4">
          <div className="text-center text-xs text-[var(--text-secondary)] max-w-sm bg-[var(--surface-inset)] p-3 rounded-[20px] border border-[var(--border-subtle)] leading-relaxed font-sans">
            {instructions}
          </div>

          {/* Active Scanning Frame */}
          <div className="relative w-full aspect-square max-w-[280px] rounded-[26px] overflow-hidden border-2 border-dashed border-[var(--border-default)] bg-black flex items-center justify-center shadow-inner">
            <div id={scannerId} className="w-full h-full" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-200 p-5 text-center bg-black/70 backdrop-blur-sm">
                <div className="relative mb-3 flex items-center justify-center w-12 h-12 bg-zinc-900/90 rounded-full border border-white/15">
                  {permissionError ? (
                    <ShieldAlert className="w-6 h-6 text-red-400" aria-hidden="true" />
                  ) : (
                    <Camera className="w-6 h-6 text-zinc-300" aria-hidden="true" />
                  )}
                </div>
                {permissionError ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-mono font-semibold text-red-300 tracking-wider">CAMERA ACCESS BLOCKED</p>
                    <p className="text-xs text-zinc-200 leading-relaxed">
                      Permission was denied. Enable webcam access via the Camera icon in your browser address bar, or upload a QR image below.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-mono select-none text-zinc-100">{cameraError ? 'CAMERA UNAVAILABLE' : 'Awaiting Camera Feed...'}</p>
                    <p className="text-xs text-zinc-300 mt-1 max-w-xs leading-normal">{cameraError || 'Allow camera access inside your browser when prompted.'}</p>
                    {cameraError && <button type="button" onClick={() => setScannerAttempt((attempt) => attempt + 1)} className="mt-3 min-h-11 rounded-lg border border-violet-400/50 bg-violet-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-violet-600">Try camera again</button>}
                  </div>
                )}
              </div>
            )}
            {cameraActive && (
              <div className="absolute top-3 left-3 bg-zinc-900/90 border border-violet-400/40 text-violet-200 text-xs font-mono tracking-wider py-1 px-2.5 rounded-md uppercase font-semibold">
                Scanner Active
              </div>
            )}
          </div>

          {/* Fallback Image Import Trigger */}
          <div className="w-full max-w-[280px] space-y-2">
            <label className="min-h-11 flex flex-col items-center justify-center border border-violet-500/45 hover:border-violet-400 bg-violet-500/10 p-3 rounded-[20px] cursor-pointer transition select-none active:scale-95 duration-150">
              <span className="text-xs uppercase font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5 font-mono">
                <Camera className="w-3.5 h-3.5" aria-hidden="true" /> Use iPhone Camera Photo
              </span>
              <p className="text-xs text-[var(--text-secondary)] mt-1 text-center">Best fallback for mobile: take a photo of the QR to scan it automatically.</p>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>
            <label className="min-h-11 flex flex-col items-center justify-center border border-dashed border-[var(--border-default)] bg-[var(--surface-inset)] p-3 rounded-[20px] cursor-pointer transition select-none active:scale-95 duration-150">
              <span className="text-xs uppercase font-semibold text-[var(--text-primary)] flex items-center gap-1.5 font-mono">
                <UploadCloud className="w-3.5 h-3.5 text-amber-800 dark:text-amber-300" aria-hidden="true" />
                Upload Existing QR Photo
              </span>
              <p className="text-xs text-[var(--text-secondary)] mt-1">If webcam is unavailable or blocked</p>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>
          </div>

          {/* Dynamic Alerts */}
          {successMessage && (
            <div role="status" className="w-full text-xs text-emerald-800 dark:text-emerald-300 font-semibold p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-[20px] text-center flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="w-full text-xs text-red-700 dark:text-red-400 font-semibold p-3 bg-red-500/10 border border-red-500/30 rounded-[20px] text-center flex items-center justify-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{errorMessage}</span>
            </div>
          )}

          {localFileError && (
            <div role="alert" className="w-full text-xs text-amber-900 dark:text-amber-300 font-semibold p-3 bg-amber-500/10 border border-amber-500/30 rounded-[20px] text-center flex items-center justify-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{localFileError}</span>
            </div>
          )}
        </div>

        {/* Footer instruction indicator */}
        <div className="p-4 bg-[var(--surface-inset)] border-t border-[var(--border-subtle)] flex justify-center items-center">
          <span className="text-xs text-[var(--text-secondary)] font-mono text-center tracking-normal leading-relaxed">
            Hint: You can import screenshots or camera pictures of QR codes directly.
          </span>
        </div>
      </div>

      <style>{`#${scannerId} video { width: 100% !important; height: 100% !important; object-fit: cover !important; background: #000 !important; } #${scannerId} img, #${scannerId} canvas { max-width: 100% !important; }`}</style>
    </DialogSurface>
  );
}
