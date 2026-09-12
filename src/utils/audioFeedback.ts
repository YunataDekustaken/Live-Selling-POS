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
  * Play a high-pitched barcode scanner beep or phone-like ringtone for successful match
  */
export function playSuccessBeep(ringtone: string = 'Classic Supermarket') {
  try {
    const ctx = getAudioContext();
    if (ctx) {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (ringtone === 'Modern Chirp') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2000, now);
        osc.frequency.setValueAtTime(3200, now + 0.04);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (ringtone === 'Cash Register') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1760, now);
        osc.frequency.setValueAtTime(3520, now + 0.08);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.26);
      } else if (ringtone === 'Digital Chime') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046, now);
        osc.frequency.setValueAtTime(1318, now + 0.05);
        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (ringtone === 'Retro Coin') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(987, now);
        osc.frequency.setValueAtTime(1318, now + 0.06);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (ringtone === 'Subtle Tap') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.start(now);
        osc.stop(now + 0.04);
      } else {
        // Classic Supermarket (2800Hz sine, 70ms)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2800, now);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    }
  } catch (e) {
    console.debug('Audio beep unavailable:', e);
  }

  // Quick 45ms physical vibration trigger click with support check
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(45);
    } catch {}
  }
}

/**
  * Play preview sample of selected ringtone
  */
export function playRingtoneSample(ringtone: string) {
  playSuccessBeep(ringtone);
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
