/**
 * Call & notification sounds using the Web Audio API.
 * No external audio files needed — all tones are generated programmatically.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// ============================================================================
// Looping tone handles — used for ringtone and dial tone that need to be
// stopped externally when the call state changes.
// ============================================================================

interface LoopHandle {
  stop: () => void;
}

let activeRingtone: LoopHandle | null = null;
let activeDialTone: LoopHandle | null = null;

// ============================================================================
// Core tone generators
// ============================================================================

/**
 * Play a simple beep at a given frequency and duration.
 */
function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.15
): void {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    // Fade out to avoid click
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('[Sounds] playTone failed:', e);
  }
}

/**
 * Play a two-tone beep (like a phone ring).
 */
function playDualTone(
  freq1: number,
  freq2: number,
  duration: number,
  volume: number = 0.12
): void {
  try {
    const ctx = getAudioContext();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    gain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq1, ctx.currentTime);
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + duration);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq2, ctx.currentTime);
    osc2.connect(gain);
    osc2.start(ctx.currentTime);
    osc2.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('[Sounds] playDualTone failed:', e);
  }
}

function canPlayForegroundNotificationSound(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start a looping ringtone for incoming calls.
 * Pattern: two short rings, pause, repeat.
 */
export function startRingtone(): void {
  stopRingtone(); // Stop any existing ringtone first

  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout>;

  const ring = () => {
    if (stopped) return;
    // Ring pattern: beep-beep, pause, repeat
    playDualTone(440, 480, 0.4, 0.2);
    setTimeout(() => {
      if (stopped) return;
      playDualTone(440, 480, 0.4, 0.2);
    }, 500);
    timeoutId = setTimeout(ring, 3000); // Repeat every 3 seconds
  };

  ring();

  // Vibrate on mobile (pattern: vibrate 300ms, pause 200ms, vibrate 300ms)
  if ('vibrate' in navigator) {
    const vibrateLoop = () => {
      if (stopped) return;
      navigator.vibrate([300, 200, 300, 200, 300]);
      timeoutId = setTimeout(vibrateLoop, 3000);
    };
    vibrateLoop();
  }

  activeRingtone = {
    stop: () => {
      stopped = true;
      clearTimeout(timeoutId);
      if ('vibrate' in navigator) navigator.vibrate(0); // Stop vibration
    },
  };
}

/**
 * Stop the incoming call ringtone.
 */
export function stopRingtone(): void {
  if (activeRingtone) {
    activeRingtone.stop();
    activeRingtone = null;
  }
  if ('vibrate' in navigator) navigator.vibrate(0);
}

/**
 * Start a looping dial tone for outgoing calls.
 * Pattern: single tone, long pause, repeat (like a US phone ringing).
 */
export function startDialTone(): void {
  stopDialTone();

  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout>;

  const dial = () => {
    if (stopped) return;
    // US ringback: 440+480 Hz for 2 seconds, 4 second pause
    playDualTone(440, 480, 2.0, 0.08);
    timeoutId = setTimeout(dial, 6000);
  };

  dial();

  activeDialTone = {
    stop: () => {
      stopped = true;
      clearTimeout(timeoutId);
    },
  };
}

/**
 * Stop the outgoing dial tone.
 */
export function stopDialTone(): void {
  if (activeDialTone) {
    activeDialTone.stop();
    activeDialTone = null;
  }
}

/**
 * Play a "call connected" sound — ascending two-note chime.
 */
export function playConnectedSound(): void {
  playTone(523, 0.15, 'sine', 0.2); // C5
  setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 150); // E5
  setTimeout(() => playTone(784, 0.25, 'sine', 0.15), 300); // G5
}

/**
 * Play a "call disconnected" sound — descending two-note tone.
 */
export function playDisconnectedSound(): void {
  playTone(523, 0.2, 'sine', 0.15); // C5
  setTimeout(() => playTone(392, 0.3, 'sine', 0.12), 200); // G4
}

/**
 * Play a "call failed" sound — low buzzer.
 */
export function playFailedSound(): void {
  playTone(200, 0.3, 'sawtooth', 0.1);
  setTimeout(() => playTone(150, 0.4, 'sawtooth', 0.08), 350);
}

/**
 * Play a short notification sound for new messages.
 */
export function playMessageSound(): void {
  if (!canPlayForegroundNotificationSound()) return;
  playTone(880, 0.06, 'square', 0.08); // A5
  setTimeout(() => playTone(1319, 0.08, 'sine', 0.1), 70); // E6
  setTimeout(() => playTone(1047, 0.1, 'triangle', 0.08), 150); // C6
}

/**
 * Play a sharper neon blip when someone mentions the current user.
 */
export function playMentionSound(): void {
  if (!canPlayForegroundNotificationSound()) return;
  playTone(1175, 0.05, 'square', 0.08); // D6
  setTimeout(() => playTone(1568, 0.09, 'sine', 0.1), 65); // G6
  setTimeout(() => playTone(1760, 0.07, 'triangle', 0.07), 155); // A6
}

/**
 * Play a short digital pulse when a new comment lands on the user's post.
 */
export function playCommentSound(): void {
  if (!canPlayForegroundNotificationSound()) return;
  playTone(740, 0.06, 'triangle', 0.08); // F#5
  setTimeout(() => playTone(988, 0.1, 'sine', 0.09), 85); // B5
}

/**
 * Stop all active sounds.
 */
export function stopAllSounds(): void {
  stopRingtone();
  stopDialTone();
}
