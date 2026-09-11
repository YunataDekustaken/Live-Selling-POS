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
 * Play a high-pitched pleasant chime for valid item match
 */
export function playSuccessBeep() {
  try {
    const ctx = getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12); // A6
      
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.15);
    }
  } catch (e) {
    console.debug('Audio beep unavailable:', e);
  }

  // Mobile vibration
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(60);
    } catch {}
  }
}

/**
 * Play a low buzz/error sound for wrong item or mismatch
 */
export function playErrorBuzz() {
  try {
    const ctx = getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(180, now + 0.1);
      
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (e) {
    console.debug('Audio buzz unavailable:', e);
  }

  // Mobile vibration double-pulse for error
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate([100, 60, 150]);
    } catch {}
  }
}
