import React, { useEffect, useRef } from 'react';

/**
 * CasperOrbVisualization
 * ---------------------
 * Compositor-driven realtime conversation avatar for Casper.
 *
 * History note: this component was previously a WebGL pipeline built with
 * @react-three/fiber + @react-three/postprocessing (custom GLSL displacement
 * shader + Bloom + ChromaticAberration + 700-particle field + halo torus
 * rings). Despite multiple rounds of defensive optimization (stable JSX
 * passes for the post-effects, ref-based audio reads, dt clamping, scratch
 * Color objects, custom React.memo comparators), the WebGL pipeline kept
 * producing visible flicker on production hardware. The remaining suspects
 * were GPU-bound and inherent to the postprocessing approach — DPR
 * mismatches between Canvas and EffectComposer render targets, antialias
 * collisions, bloom luminance-threshold edge cases.
 *
 * This implementation rebuilds the orb in pure CSS using only properties
 * that the browser can compositor-accelerate (transform, opacity, filter)
 * plus CSS custom properties (`@property` Houdini registrations) for smooth
 * color interpolation. Audio reactivity is delivered by mutating CSS custom
 * properties on the root element from a requestAnimationFrame loop — no
 * React re-renders, no GLSL, no GPU pass recreation.
 *
 * Public API is unchanged: same props, same default export, same lazy-load
 * behaviour from Casper.tsx.
 */

export type CasperOrbState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

export interface CasperOrbVisualizationProps {
  state: CasperOrbState;
  /** 0..1 microphone amplitude (used while `recording`). */
  audioLevel?: number;
  /**
   * Optional ref to live mic amplitude (0..1). When provided, the orb reads
   * audio amplitude from this ref every frame instead of from the prop —
   * which lets the parent skip 60Hz re-renders during recording.
   */
  audioLevelRef?: React.RefObject<number>;
  /** 0..100 — global Casper mood/instability that nudges base palette warmth. */
  instability?: number;
  className?: string;
}

interface StatePalette {
  colorA: string;
  colorB: string;
  particleColor: string;
  haloColor: string;
  glowColor: string;
  /** 0..1 — extra brightness multiplier when amplitude peaks. */
  reactivity: number;
}

function getPalette(state: CasperOrbState, instability: number): StatePalette {
  const hot = Math.min(1, Math.max(0, instability / 100));
  switch (state) {
    case 'recording':
      return {
        colorA: '#86efac',
        colorB: '#0aa46c',
        particleColor: '#bbf7d0',
        haloColor: '#4ade80',
        glowColor: 'rgba(74, 222, 128, 0.55)',
        reactivity: 1,
      };
    case 'transcribing':
      return {
        colorA: '#fde68a',
        colorB: '#f59e0b',
        particleColor: '#fef3c7',
        haloColor: '#fbbf24',
        glowColor: 'rgba(251, 191, 36, 0.45)',
        reactivity: 0.6,
      };
    case 'thinking':
      return {
        colorA: '#c4b5fd',
        colorB: '#6d28d9',
        particleColor: '#ddd6fe',
        haloColor: '#a78bfa',
        glowColor: 'rgba(167, 139, 250, 0.55)',
        reactivity: 0.5,
      };
    case 'speaking':
      return {
        colorA: hot > 0.5 ? '#ff8fb8' : '#ffafd0',
        colorB: '#00e5ff',
        particleColor: '#ffd6f1',
        haloColor: '#ff63c8',
        glowColor: 'rgba(255, 99, 200, 0.55)',
        reactivity: 0.85,
      };
    case 'idle':
    default:
      return {
        colorA: hot > 0.6 ? '#c4b5fd' : '#7dd3fc',
        colorB: hot > 0.6 ? '#5b21b6' : '#1166ff',
        particleColor: '#bae6fd',
        haloColor: '#00e5ff',
        glowColor: 'rgba(0, 229, 255, 0.45)',
        reactivity: 0.35,
      };
  }
}

// Synthetic envelope so non-recording states still pulse believably without
// touching the TTS audio graph.
function syntheticEnvelope(state: CasperOrbState, time: number): number {
  switch (state) {
    case 'speaking':
      return Math.min(
        1,
        0.32 + 0.18 * Math.abs(Math.sin(time * 1.6)) + 0.08 * Math.abs(Math.sin(time * 2.3)),
      );
    case 'thinking':
      return 0.18 + 0.08 * Math.sin(time * 0.7) + 0.04 * Math.sin(time * 1.6);
    case 'transcribing':
      return 0.15 + 0.06 * Math.abs(Math.sin(time * 1.1));
    case 'idle':
    default:
      return 0.08 + 0.05 * Math.sin(time * 0.45);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const CasperOrbVisualizationInner: React.FC<CasperOrbVisualizationProps> = ({
  state,
  audioLevel = 0,
  audioLevelRef,
  instability = 10,
  className,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);

  // Latest values surfaced into rAF loop without forcing re-renders.
  const stateRef = useRef(state);
  const audioPropRef = useRef(audioLevel);
  const instabilityRef = useRef(instability);
  stateRef.current = state;
  audioPropRef.current = audioLevel;
  instabilityRef.current = instability;

  // Apply state-driven palette via CSS custom properties on the root. The
  // root has `transition` declarations for these properties (registered via
  // @property in the inline <style> below) so the browser interpolates
  // colors smoothly between states — no React-driven animation tick needed.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const palette = getPalette(state, instability);
    root.style.setProperty('--orb-color-a', palette.colorA);
    root.style.setProperty('--orb-color-b', palette.colorB);
    root.style.setProperty('--orb-particle', palette.particleColor);
    root.style.setProperty('--orb-halo', palette.haloColor);
    root.style.setProperty('--orb-glow', palette.glowColor);
    root.style.setProperty('--orb-reactivity', String(palette.reactivity));
  }, [state, instability]);

  // Audio reactivity: smooth EMA on top of the source mic level (already
  // EMA-smoothed in Casper.tsx, but a second pass at the consumer keeps
  // the orb visually steady even if React batching produces an occasional
  // 50ms gap). For non-recording states we drive a synthetic envelope.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    let smoothed = 0;
    const startTime = performance.now();

    const loop = () => {
      const now = performance.now();
      const time = (now - startTime) / 1000;
      const currentState = stateRef.current;
      const liveAudio =
        currentState === 'recording'
          ? audioLevelRef?.current ?? audioPropRef.current ?? 0
          : syntheticEnvelope(currentState, time);
      // EMA smoothing — alpha near 0.18 strikes a balance between visible
      // pulses and visual steadiness. Higher = more responsive but jumpier.
      smoothed = lerp(smoothed, Math.min(1, Math.max(0, liveAudio)), 0.18);
      root.style.setProperty('--orb-pulse', smoothed.toFixed(3));
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [audioLevelRef]);

  return (
    <div
      ref={rootRef}
      className={className}
      data-state={state}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Scoped style block. Keeping the CSS local to this component keeps
          the global stylesheet clean and avoids name collisions. */}
      <style>{ORB_STYLES}</style>

      <div className="casper-orb-stage">
        {/* Outer halo rings (rotate at staggered speeds). Pure CSS keyframes
            on `transform` are compositor-accelerated and won't flicker. */}
        <span className="casper-orb-ring casper-orb-ring--outer" aria-hidden />
        <span className="casper-orb-ring casper-orb-ring--mid" aria-hidden />
        <span className="casper-orb-ring casper-orb-ring--inner" aria-hidden />

        {/* Wide ambient glow (opacity reacts to audio). */}
        <span className="casper-orb-aura" aria-hidden />

        {/* Mid-brightness corona layered above the wide glow. */}
        <span className="casper-orb-corona" aria-hidden />

        {/* Core sphere with multi-layer radial gradient + audio-reactive
            scale. */}
        <span className="casper-orb-core" aria-hidden>
          <span className="casper-orb-core__highlight" aria-hidden />
        </span>

        {/* Floating particles (orbit via two combined transforms; each has
            its own delay so they're not in lockstep). */}
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className="casper-orb-particle"
            style={{
              ['--p-angle' as string]: `${i * 60}deg`,
              ['--p-delay' as string]: `${i * 0.7}s`,
              ['--p-radius' as string]: `${42 + (i % 3) * 6}%`,
            }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
};

const CasperOrbVisualization = React.memo(CasperOrbVisualizationInner);
CasperOrbVisualization.displayName = 'CasperOrbVisualization';

export default CasperOrbVisualization;

const ORB_STYLES = `
  @property --orb-color-a {
    syntax: '<color>';
    inherits: true;
    initial-value: #00e5ff;
  }
  @property --orb-color-b {
    syntax: '<color>';
    inherits: true;
    initial-value: #1166ff;
  }
  @property --orb-particle {
    syntax: '<color>';
    inherits: true;
    initial-value: #7dd3fc;
  }
  @property --orb-halo {
    syntax: '<color>';
    inherits: true;
    initial-value: #00e5ff;
  }
  @property --orb-glow {
    syntax: '<color>';
    inherits: true;
    initial-value: rgba(0, 229, 255, 0.45);
  }
  @property --orb-reactivity {
    syntax: '<number>';
    inherits: true;
    initial-value: 0.35;
  }
  @property --orb-pulse {
    syntax: '<number>';
    inherits: true;
    initial-value: 0;
  }

  .casper-orb-stage {
    position: relative;
    width: min(80vw, 520px);
    height: min(80vw, 520px);
    transition:
      --orb-color-a 0.6s ease,
      --orb-color-b 0.6s ease,
      --orb-particle 0.6s ease,
      --orb-halo 0.6s ease,
      --orb-glow 0.6s ease,
      --orb-reactivity 0.6s ease;
    /* Hint to the browser that the stage will be transformed/composited so
       it gets its own layer and animations stay smooth. */
    will-change: transform;
    transform: translateZ(0);
  }

  .casper-orb-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1px solid var(--orb-halo);
    opacity: 0.22;
    pointer-events: none;
    will-change: transform, opacity;
  }
  .casper-orb-ring--outer {
    inset: 4%;
    animation: casper-orb-spin-cw 22s linear infinite;
  }
  .casper-orb-ring--mid {
    inset: 14%;
    border-style: dashed;
    opacity: 0.18;
    animation: casper-orb-spin-ccw 18s linear infinite;
  }
  .casper-orb-ring--inner {
    inset: 24%;
    opacity: 0.28;
    animation: casper-orb-spin-cw 12s linear infinite;
  }

  .casper-orb-aura {
    position: absolute;
    inset: -10%;
    border-radius: 50%;
    background: radial-gradient(
      circle at 50% 50%,
      var(--orb-glow) 0%,
      transparent 65%
    );
    filter: blur(24px);
    opacity: calc(0.55 + var(--orb-pulse) * 0.45 * var(--orb-reactivity));
    transform: scale(calc(1 + var(--orb-pulse) * 0.08));
    will-change: opacity, transform;
  }

  .casper-orb-corona {
    position: absolute;
    inset: 12%;
    border-radius: 50%;
    background: radial-gradient(
      circle at 45% 45%,
      var(--orb-color-a) 0%,
      var(--orb-color-b) 38%,
      transparent 70%
    );
    opacity: calc(0.55 + var(--orb-pulse) * 0.25 * var(--orb-reactivity));
    filter: blur(18px);
    transform: scale(calc(1 + var(--orb-pulse) * 0.04));
    will-change: opacity, transform;
  }

  .casper-orb-core {
    position: absolute;
    inset: 28%;
    border-radius: 50%;
    background:
      radial-gradient(circle at 38% 32%, rgba(255, 255, 255, 0.55) 0%, transparent 38%),
      radial-gradient(
        circle at 50% 55%,
        var(--orb-color-a) 0%,
        var(--orb-color-b) 55%,
        rgba(0, 0, 0, 0.6) 100%
      );
    box-shadow:
      0 0 30px var(--orb-glow),
      inset 0 0 25px rgba(0, 0, 0, 0.35);
    transform: scale(calc(1 + var(--orb-pulse) * 0.06));
    transition: transform 0.05s linear;
    animation: casper-orb-breathe 6s ease-in-out infinite;
    will-change: transform;
  }
  .casper-orb-core__highlight {
    position: absolute;
    top: 12%;
    left: 18%;
    width: 38%;
    height: 28%;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, transparent 70%);
    filter: blur(6px);
    pointer-events: none;
  }

  .casper-orb-particle {
    --p-size: 4px;
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--p-size);
    height: var(--p-size);
    border-radius: 50%;
    background: var(--orb-particle);
    box-shadow: 0 0 8px var(--orb-particle);
    transform-origin: 0 0;
    animation: casper-orb-particle 8s linear infinite;
    animation-delay: var(--p-delay);
    opacity: calc(0.5 + var(--orb-pulse) * 0.5);
    will-change: transform, opacity;
  }

  @keyframes casper-orb-spin-cw {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes casper-orb-spin-ccw {
    from { transform: rotate(0deg); }
    to   { transform: rotate(-360deg); }
  }
  @keyframes casper-orb-breathe {
    0%, 100% { filter: brightness(1); }
    50%      { filter: brightness(1.08); }
  }
  /* Each particle orbits via a transform chain: rotate to its slot, then
     translate outward to the orbital radius. Its own animation cycles the
     rotation so all six trace a circle in the same direction at the same
     period, but offset in phase via animation-delay. */
  @keyframes casper-orb-particle {
    from {
      transform: rotate(var(--p-angle)) translateX(var(--p-radius)) rotate(0deg);
    }
    to {
      transform: rotate(calc(var(--p-angle) + 360deg)) translateX(var(--p-radius)) rotate(-360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .casper-orb-ring,
    .casper-orb-particle,
    .casper-orb-core {
      animation: none !important;
    }
    .casper-orb-aura,
    .casper-orb-core,
    .casper-orb-corona {
      transform: none !important;
    }
  }
`;
