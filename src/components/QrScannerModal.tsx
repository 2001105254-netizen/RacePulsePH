import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, ShieldAlert, UploadCloud } from 'lucide-react';

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
  const [localFileError, setLocalFileError] = useState('');
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    let stopped = false;
    const startScanning = async () => {
      try {
        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = html5QrCode;
        setCameraActive(true);
        setPermissionError(false);

        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
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
  }, []);

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
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
      {/* Hidden container for file decoder */}
      <div id="temporary-file-qr-decoder" className="hidden" />

      <div className="bg-[var(--surface-card)]/72 backdrop-blur-2xl border border-[var(--border-default)] rounded-[26px] w-full max-w-sm md:max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-inset)]/75 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-violet-500" />
            <div>
              <h2 className="heading-float text-md font-black tracking-tight font-display text-[var(--text-primary)] uppercase">{title}</h2>
              <p className="text-[10px] text-[var(--text-secondary)] font-mono">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition bg-[var(--surface-inset)]/75 backdrop-blur-md border border-[var(--border-default)] hover:border-[var(--border-default)] p-2 rounded-[20px] text-xs font-bold uppercase px-3"
          >
            ✕ Close
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center justify-center space-y-4">
          <div className="text-center text-[11px] text-[var(--text-secondary)] max-w-sm bg-[var(--surface-card)]/72 backdrop-blur-2xl p-3 rounded-[20px] border border-[var(--border-subtle)] leading-relaxed font-sans">
            {instructions}
          </div>

          {/* Active Scanning Frame */}
          <div className="relative w-full aspect-square max-w-[280px] rounded-[26px] overflow-hidden border-2 border-dashed border-[var(--border-default)] bg-[var(--surface-inset)]/75 backdrop-blur-md flex items-center justify-center shadow-inner">
            <div id={scannerId} className="w-full h-full" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--text-muted)] p-5 text-center bg-black/50 backdrop-blur-sm">
                <div className="relative mb-3 flex items-center justify-center w-12 h-12 bg-[var(--surface-inset)]/75 backdrop-blur-md rounded-full border border-[var(--border-default)]">
                  {permissionError ? (
                    <ShieldAlert className="w-6 h-6 text-red-500 animate-pulse" />
                  ) : (
                    <Camera className="w-6 h-6 text-[var(--text-muted)] animate-pulse" />
                  )}
                </div>
                {permissionError ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-mono font-black text-rose-500 tracking-wider">🚫 CAMERA ACCESS BLOCKED</p>
                    <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                      Permission was denied. Please click the <strong className="text-[var(--text-primary)] bg-[var(--surface-hover)] px-1 py-0.5 rounded">Camera Icon/Lock</strong> in your browser's address bar to enable webcam access, or click "Upload QR Image" below to scan a photo of the QR ticket!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-mono select-none">Awaiting Camera Feed...</p>
                    <p className="text-[10px] text-[var(--text-secondary)] mt-1 max-w-xs leading-normal">Please allow webcam access inside your browser when prompted.</p>
                  </div>
                )}
              </div>
            )}
            {cameraActive && (
              <div className="absolute top-3 left-3 bg-violet-600/15 border border-violet-500/20 text-violet-400 text-[9px] font-mono tracking-wider py-1 px-2.5 rounded-md uppercase font-bold animate-pulse">
                🎥 Scanner Active
              </div>
            )}
          </div>

          {/* Fallback Image Import Trigger */}
          <div className="w-full max-w-[280px]">
            <label className="flex flex-col items-center justify-center border border-dashed border-[var(--border-default)] hover:border-[var(--border-default)] bg-[var(--surface-card)]/72 backdrop-blur-2xl p-3 rounded-[20px] cursor-pointer transition select-none active:scale-95 duration-150">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] flex items-center gap-1.5 font-mono">
                <UploadCloud className="w-3.5 h-3.5 text-amber-500" />
                Upload Photo / Screenshot of QR
              </span>
              <p className="text-[9px] text-[var(--text-muted)] mt-1">If webcam is unavailable or blocked</p>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Dynamic Alerts */}
          {successMessage && (
            <div className="w-full text-xs text-green-400 font-bold p-3 bg-green-955/15 border border-green-900/35 rounded-[20px] text-center animate-pulse">
              ✅ {successMessage}
            </div>
          )}

          {errorMessage && (
            <div className="w-full text-xs text-red-400 font-bold p-3 bg-red-955/15 border border-red-900/35 rounded-[20px] text-center">
              ⚠️ {errorMessage}
            </div>
          )}

          {localFileError && (
            <div className="w-full text-xs text-amber-500 font-bold p-3 bg-amber-955/15 border border-amber-900/35 rounded-[20px] text-center">
              ⚠️ {localFileError}
            </div>
          )}
        </div>

        {/* Footer instruction indicator */}
        <div className="p-4 bg-[var(--surface-inset)]/75 backdrop-blur-md border-t border-[var(--border-subtle)] flex justify-center items-center">
          <span className="text-[9.5px] text-[var(--text-secondary)] font-mono text-center tracking-normal leading-relaxed">
            Hint: You can import screenshots or camera pictures of QR codes directly!
          </span>
        </div>
      </div>
    </div>
  );
}
