// Sound and Haptic Feedback for Barcode / QR Scanning and Verification

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioCtx && AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
  * Play a high-pitched sharp supermarket barcode scanner beep for successful match
  */
export function playSuccessBeep() {
  try {
    const ctx = getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      // Crisp high-pitch supermarket scanner beep (2500Hz)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2500, now);
      
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.09);
    }
  } catch (e) {
    console.debug('Audio beep unavailable:', e);
  }

  // Mobile vibration (forces vibration even if phone is on silent mode)
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(80);
    } catch {}
  }
}

/**
  * Play a low-pitched, harsh contrasting double-buzz for scanning error / mismatch
  */
export function playErrorBuzz() {
  try {
    const ctx = getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      // Low-pitched harsh sawtooth buzz (150Hz -> 120Hz)
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.setValueAtTime(120, now + 0.15);
      
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.36);
    }
  } catch (e) {
    console.debug('Audio buzz unavailable:', e);
  }

  // Strong multi-pulse mobile vibration for error (even in silent mode)
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate([200, 60, 200, 60, 250]);
    } catch {}
  }
}
