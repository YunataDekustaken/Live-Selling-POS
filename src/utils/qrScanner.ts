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

export class LiveScannerController {
  private scanner: Html5Qrcode | null = null;
  private elementId: string;
  public isRunning: boolean = false;
  private videoTrack: MediaStreamTrack | null = null;
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

  public async start(
    onDecoded: (text: string) => void,
    onCapabilitiesChanged?: (caps: ScannerCapabilities) => void
  ): Promise<boolean> {
    try {
      if (this.isRunning) {
        await this.stop();
      }

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

      // Html5Qrcode expects cameraIdOrConfig to have EXACTLY 1 key: either 'facingMode' or 'deviceId'
      // Try environment (rear) camera first. If on laptop/desktop without rear camera, fallback to user (front)
      const scanConfig = {
        fps: 15,
        disableFlip: false,
        videoConstraints: {
          facingMode: { ideal: 'environment' },
          width: { min: 640, ideal: 1280, max: 1920 },
          height: { min: 480, ideal: 720, max: 1080 }
        }
      };

      let started = false;

      try {
        await this.scanner.start(
          { facingMode: 'environment' },
          scanConfig,
          (decodedText) => {
            if (decodedText) {
              onDecoded(decodedText.trim());
            }
          },
          () => {
            // frame tick
          }
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

      if (!started) {
        this.isRunning = false;
        return false;
      }

      this.isRunning = true;

      // Extract running video track to query Torch / Zoom hardware capabilities
      this.detectTrackCapabilities(onCapabilitiesChanged);

      return true;
    } catch (err) {
      console.warn('LiveScanner start error:', err);
      this.isRunning = false;
      return false;
    }
  }

  private detectTrackCapabilities(onCapabilitiesChanged?: (caps: ScannerCapabilities) => void) {
    try {
      if (!this.scanner) return;
      
      // Attempt to retrieve track capabilities directly from Html5Qrcode or the video element
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

        const hasTorch = Boolean(caps && caps.torch);
        const hasZoom = Boolean(caps && caps.zoom && typeof caps.zoom.max === 'number');

        this.capabilities = {
          hasTorch,
          hasZoom,
          minZoom: hasZoom ? (caps.zoom.min || 1) : 1,
          maxZoom: hasZoom ? (caps.zoom.max || 1) : 1,
          stepZoom: hasZoom ? (caps.zoom.step || 0.1) : 0.1,
          currentZoom: hasZoom ? (settings.zoom || caps.zoom.min || 1) : 1,
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
    if (!this.capabilities.hasTorch) return false;
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
