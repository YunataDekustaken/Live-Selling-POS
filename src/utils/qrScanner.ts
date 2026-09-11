import { Html5Qrcode } from 'html5-qrcode';

export class LiveScannerController {
  private scanner: Html5Qrcode | null = null;
  private elementId: string;
  public isRunning: boolean = false;

  constructor(elementId: string) {
    this.elementId = elementId;
  }

  public async start(onDecoded: (text: string) => void): Promise<boolean> {
    try {
      if (this.isRunning) {
        await this.stop();
      }

      const targetEl = document.getElementById(this.elementId);
      if (!targetEl) {
        console.warn(`Scanner element #${this.elementId} not found`);
        return false;
      }

      this.scanner = new Html5Qrcode(this.elementId);
      await this.scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const qrboxSize = Math.floor(minEdge * 0.8);
            return {
              width: Math.max(200, qrboxSize),
              height: Math.max(200, qrboxSize)
            };
          },
          aspectRatio: 1.0
        },
        (decodedText) => {
          if (decodedText) {
            onDecoded(decodedText.trim());
          }
        },
        () => {
          // frame scan tick
        }
      );
      this.isRunning = true;
      return true;
    } catch (err) {
      console.warn('LiveScanner start error:', err);
      this.isRunning = false;
      return false;
    }
  }

  public async stop(): Promise<void> {
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
  }
}
