import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

export interface ScannerCapabilities {
  hasTorch: boolean;
  hasZoom: boolean;
  minZoom: number;
  maxZoom: number;
  stepZoom: number;
  currentZoom: number;
  torchOn: boolean;
}

export interface CameraDeviceOption {
  id: string;
  label: string;
  isBack: boolean;
  isUltraWide: boolean;
  isTelephoto: boolean;
  isMain: boolean;
}

export function categorizeCamera(dev: { id: string; label: string }, index: number, total: number): CameraDeviceOption {
  const lbl = (dev.label || '').toLowerCase();
  const isFront = lbl.includes('front') || lbl.includes('user') || lbl.includes('selfie') || lbl.includes('facing front');
  const isUltraWide = lbl.includes('ultra') || lbl.includes('0.5') || lbl.includes('0.6') || lbl.includes('wide-angle') || lbl.includes('wide angle') || lbl.includes('uw');
  const isTelephoto = lbl.includes('tele') || lbl.includes('3x') || lbl.includes('5x') || lbl.includes('10x') || lbl.includes('zoom');
  const isBack = !isFront;
  const isMain = isBack && !isUltraWide && !isTelephoto;

  let friendlyLabel = dev.label || '';
  if (!friendlyLabel || friendlyLabel.startsWith('camera2') || /^\d+/.test(friendlyLabel)) {
    if (isFront) {
      friendlyLabel = `🤳 Front Camera`;
    } else if (isUltraWide) {
      friendlyLabel = `🌐 Back Ultra-Wide (0.5x)`;
    } else if (isTelephoto) {
      friendlyLabel = `🔍 Back Telephoto (Zoom)`;
    } else if (isMain) {
      friendlyLabel = `📷 Back Main Camera (1x - Autofocus)`;
    } else {
      friendlyLabel = `📷 Back Camera ${index + 1}`;
    }
  } else {
    if (isUltraWide && !friendlyLabel.toLowerCase().includes('ultra')) {
      friendlyLabel = `🌐 ${friendlyLabel} (Ultra-Wide)`;
    } else if (isMain && !friendlyLabel.toLowerCase().includes('main')) {
      friendlyLabel = `📷 ${friendlyLabel} (Main 1x)`;
    }
  }

  return {
    id: dev.id,
    label: friendlyLabel,
    isBack,
    isUltraWide,
    isTelephoto,
    isMain
  };
}

export class LiveScannerController {
  private scanner: Html5Qrcode | null = null;
  private elementId: string;
  public isRunning: boolean = false;
  private videoTrack: MediaStreamTrack | null = null;
  public activeCameraId: string | null = null;
  public availableCameras: CameraDeviceOption[] = [];
  private onDecodedCb: ((text: string) => void) | null = null;
  private onCapsCb: ((caps: ScannerCapabilities) => void) | null = null;

  public capabilities: ScannerCapabilities = {
    hasTorch: false,
    hasZoom: false,
    minZoom: 1,
    maxZoom: 1,
    stepZoom: 0.1,
    currentZoom: 1,
    torchOn: false
  };

  constructor(elementId: string) {
    this.elementId = elementId;
  }

  /**
   * Enumerate and sort all available video devices, prioritizing Main 1x rear cameras over Ultra-Wide
   */
  public static async queryCameras(): Promise<CameraDeviceOption[]> {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) return [];
      
      const list: CameraDeviceOption[] = devices.map((d, idx) => 
        categorizeCamera(d, idx, devices.length)
      );

      // Sort order: Main Back (1x) first -> Other Back cameras -> Telephoto -> Ultra-Wide last -> Front
      return list.sort((a, b) => {
        if (a.isMain && !b.isMain) return -1;
        if (!a.isMain && b.isMain) return 1;
        if (a.isBack && !b.isBack) return -1;
        if (!a.isBack && b.isBack) return 1;
        if (!a.isUltraWide && b.isUltraWide) return -1;
        if (a.isUltraWide && !b.isUltraWide) return 1;
        return 0;
      });
    } catch (err) {
      console.warn('Error querying cameras:', err);
      return [];
    }
  }

  public async start(
    onDecoded: (text: string) => void,
    onCapabilitiesChanged?: (caps: ScannerCapabilities) => void,
    preferredCameraId?: string
  ): Promise<boolean> {
    try {
      if (this.isRunning) {
        await this.stop();
      }

      this.onDecodedCb = onDecoded;
      this.onCapsCb = onCapabilitiesChanged || null;

      const targetEl = document.getElementById(this.elementId);
      if (!targetEl) {
        console.warn(`Scanner element #${this.elementId} not found`);
        return false;
      }

      // Explicitly register QR code + common 1D barcodes so it recognizes all printed formats
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.UPC_A
      ];

      this.scanner = new Html5Qrcode(this.elementId, {
        formatsToSupport,
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      });

      // 1. Discover all cameras on the device to avoid Samsung Ultra-Wide traps
      this.availableCameras = await LiveScannerController.queryCameras();

      // High-resolution video stream constraints for razor-sharp QR decoding on 30x20mm thermal labels
      const scanConfig = {
        fps: 20,
        disableFlip: false,
        videoConstraints: {
          width: { min: 640, ideal: 1920, max: 2560 },
          height: { min: 480, ideal: 1080, max: 1440 }
        }
      };

      // 2. Determine target camera:
      // Priority 1: explicitly passed preferredCameraId or saved in localStorage
      // Priority 2: first Main Back camera (avoiding ultra-wide)
      // Priority 3: first Back camera
      // Priority 4: environment facingMode fallback
      const savedCamId = preferredCameraId || localStorage.getItem('pos_preferred_camera_id') || '';
      let targetCamera = this.availableCameras.find(c => c.id === savedCamId);

      if (!targetCamera) {
        targetCamera = this.availableCameras.find(c => c.isMain) ||
                       this.availableCameras.find(c => c.isBack && !c.isUltraWide) ||
                       this.availableCameras.find(c => c.isBack) ||
                       this.availableCameras[0];
      }

      let started = false;

      // If a specific camera device ID was identified, start with that camera ID
      if (targetCamera && targetCamera.id) {
        try {
          await this.scanner.start(
            targetCamera.id,
            scanConfig,
            (decodedText) => {
              if (decodedText) {
                onDecoded(decodedText.trim());
              }
            },
            () => {}
          );
          this.activeCameraId = targetCamera.id;
          localStorage.setItem('pos_preferred_camera_id', targetCamera.id);
          started = true;
        } catch (specCamErr) {
          console.warn(`Could not start camera ${targetCamera.label} (${targetCamera.id}):`, specCamErr);
        }
      }

      // Fallback 1: try environment facingMode if direct camera start failed
      if (!started) {
        try {
          await this.scanner.start(
            { facingMode: 'environment' },
            scanConfig,
            (decodedText) => {
              if (decodedText) {
                onDecoded(decodedText.trim());
              }
            },
            () => {}
          );
          started = true;
        } catch (backCamErr) {
          console.warn('Could not start with environment facingMode, attempting fallback:', backCamErr);
          try {
            await this.scanner.start(
              { facingMode: 'user' },
              { fps: 15, disableFlip: false },
              (decodedText) => {
                if (decodedText) {
                  onDecoded(decodedText.trim());
                }
              },
              () => {}
            );
            started = true;
          } catch (frontCamErr) {
            console.warn('Could not start user camera fallback:', frontCamErr);
          }
        }
      }

      if (!started) {
        this.isRunning = false;
        return false;
      }

      this.isRunning = true;

      // 3. Extract running video track & optimize Focus, Torch, and Zoom capabilities
      this.detectTrackCapabilities(onCapabilitiesChanged);

      return true;
    } catch (err) {
      console.warn('LiveScanner start error:', err);
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Switch active camera lens (e.g. from Ultra-Wide to Main 1x, or between lenses)
   */
  public async switchCamera(cameraId: string): Promise<boolean> {
    if (!this.onDecodedCb) return false;
    localStorage.setItem('pos_preferred_camera_id', cameraId);
    this.activeCameraId = cameraId;
    const cb = this.onDecodedCb;
    const capsCb = this.onCapsCb || undefined;
    return await this.start(cb, capsCb, cameraId);
  }

  private detectTrackCapabilities(onCapabilitiesChanged?: (caps: ScannerCapabilities) => void) {
    try {
      if (!this.scanner) return;
      
      // Retrieve track capabilities directly from the video element
      let track: MediaStreamTrack | null = null;
      try {
        const videoEl = document.querySelector(`#${this.elementId} video`) as HTMLVideoElement | null;
        if (videoEl && videoEl.srcObject instanceof MediaStream) {
          const tracks = videoEl.srcObject.getVideoTracks();
          if (tracks && tracks.length > 0) {
            track = tracks[0];
          }
        }
      } catch (e) {
        console.debug('Failed to get track from video element:', e);
      }

      this.videoTrack = track;

      if (track && typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities() as any;
        const settings = typeof track.getSettings === 'function' ? track.getSettings() as any : {};

        // Apply continuous autofocus constraint if supported by the camera hardware
        if (caps && caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          try {
            (track as any).applyConstraints({
              advanced: [{ focusMode: 'continuous' }]
            }).catch(() => {});
          } catch (e) {
            // ignore
          }
        }

        const hasTorch = Boolean(caps && caps.torch);
        const hasZoom = Boolean(caps && caps.zoom && typeof caps.zoom.max === 'number');

        const minZ = hasZoom ? (caps.zoom.min || 1) : 1;
        const maxZ = hasZoom ? (caps.zoom.max || 1) : 1;
        const defaultZoom = minZ; // Default to natural 1x zoom without digital blur

        this.capabilities = {
          hasTorch,
          hasZoom,
          minZoom: minZ,
          maxZoom: maxZ,
          stepZoom: hasZoom ? (caps.zoom.step || 0.1) : 0.1,
          currentZoom: defaultZoom,
          torchOn: Boolean(settings.torch)
        };
      } else {
        this.capabilities = {
          hasTorch: false,
          hasZoom: false,
          minZoom: 1,
          maxZoom: 1,
          stepZoom: 0.1,
          currentZoom: 1,
          torchOn: false
        };
      }

      if (onCapabilitiesChanged) {
        onCapabilitiesChanged(this.capabilities);
      }
    } catch (err) {
      console.warn('Could not detect camera hardware capabilities:', err);
    }
  }

  /**
   * Toggle Flashlight / Torch
   */
  public async toggleTorch(): Promise<boolean> {
    if (!this.capabilities.hasTorch && !this.videoTrack) return false;
    const nextState = !this.capabilities.torchOn;
    
    try {
      if (this.scanner && typeof (this.scanner as any).applyVideoConstraints === 'function') {
        await (this.scanner as any).applyVideoConstraints({
          advanced: [{ torch: nextState }]
        });
        this.capabilities.torchOn = nextState;
        return nextState;
      }
    } catch (e) {
      console.debug('applyVideoConstraints torch failed, trying direct track constraint:', e);
    }

    if (this.videoTrack) {
      try {
        await (this.videoTrack as any).applyConstraints({
          advanced: [{ torch: nextState }]
        });
        this.capabilities.torchOn = nextState;
        return nextState;
      } catch (err) {
        console.warn('Error toggling flashlight:', err);
      }
    }

    return this.capabilities.torchOn;
  }

  /**
   * Apply Optical/Digital Camera Zoom level (e.g. 1.0 to 3.0 or max)
   */
  public async setZoom(zoomLevel: number): Promise<number> {
    if (!this.capabilities.hasZoom) return 1;
    const clamped = Math.min(this.capabilities.maxZoom, Math.max(this.capabilities.minZoom, zoomLevel));
    
    try {
      if (this.scanner && typeof (this.scanner as any).applyVideoConstraints === 'function') {
        await (this.scanner as any).applyVideoConstraints({
          advanced: [{ zoom: clamped }]
        });
        this.capabilities.currentZoom = clamped;
        return clamped;
      }
    } catch (e) {
      console.debug('applyVideoConstraints zoom failed, trying direct track constraint:', e);
    }

    if (this.videoTrack) {
      try {
        await (this.videoTrack as any).applyConstraints({
          advanced: [{ zoom: clamped }]
        });
        this.capabilities.currentZoom = clamped;
        return clamped;
      } catch (err) {
        console.warn('Error setting camera zoom:', err);
      }
    }

    return this.capabilities.currentZoom;
  }

  public async stop(): Promise<void> {
    if (this.capabilities.torchOn) {
      try {
        if (this.videoTrack) {
          await (this.videoTrack as any).applyConstraints({ advanced: [{ torch: false }] });
        }
      } catch (e) {
        // ignore
      }
    }

    if (this.scanner && this.isRunning) {
      try {
        await this.scanner.stop();
        this.scanner.clear();
      } catch (e) {
        console.debug('Error stopping scanner:', e);
      }
    }
    this.isRunning = false;
    this.scanner = null;
    this.videoTrack = null;
    this.capabilities = {
      hasTorch: false,
      hasZoom: false,
      minZoom: 1,
      maxZoom: 1,
      stepZoom: 0.1,
      currentZoom: 1,
      torchOn: false
    };
  }
}
