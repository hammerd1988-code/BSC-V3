import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';

/**
 * CasperOrbVisualization
 * ---------------------
 * State-of-the-art realtime conversation avatar for Casper. A WebGL "ghost orb"
 * built with @react-three/fiber:
 *
 *  - A vertex-displacement shader sphere driven by Perlin/simplex noise +
 *    audio amplitude (mic level when listening, synthetic envelope when
 *    speaking). The orb literally breathes.
 *  - Audio-reactive particle field orbiting the core (additive blending).
 *  - 3 inclined halo torus rings spinning at staggered speeds.
 *  - A subtle Bloom + ChromaticAberration post-processing pass so the orb
 *    feels "alive" without blowing out the screen.
 *
 * Each voice state (`idle`, `recording`, `transcribing`, `thinking`, `speaking`)
 * has its own color palette + displacement intensity + bloom strength. State
 * transitions are smoothed via lerp so flips feel intentional, never jarring.
 *
 * Lazy-loaded by Casper.tsx so the three.js bundle (~150kb gz) only ships when
 * a user actually opens voice mode.
 */

export type CasperOrbState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

export interface CasperOrbVisualizationProps {
  state: CasperOrbState;
  /** 0..1 microphone amplitude (used while `recording`). */
  audioLevel?: number;
  /**
   * Optional ref to live mic amplitude (0..1). When provided, the orb reads
   * audio amplitude from this ref every frame instead of from the prop —
   * which lets the parent skip 60Hz re-renders during recording (the actual
   * cause of the orb's previously-visible "flash/blink" glitch on prod: heavy
   * parent re-renders stalled the main thread, which made `dt` in `useFrame`
   * spike, which made the smoothing lerp snap to its target = visible jump).
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
  intensity: number;
  bloom: number;
  particleSpeed: number;
}

function getPalette(state: CasperOrbState, instability: number): StatePalette {
  const hot = Math.min(1, Math.max(0, instability / 100));
  switch (state) {
    case 'recording':
      return {
        colorA: '#4ade80',
        colorB: '#0aa46c',
        particleColor: '#86efac',
        haloColor: '#4ade80',
        intensity: 0.26,
        bloom: 0.22,
        particleSpeed: 0.7,
      };
    case 'transcribing':
      return {
        colorA: '#fbbf24',
        colorB: '#f59e0b',
        particleColor: '#fde68a',
        haloColor: '#fbbf24',
        intensity: 0.22,
        bloom: 0.2,
        particleSpeed: 0.8,
      };
    case 'thinking':
      return {
        colorA: '#a78bfa',
        colorB: '#6d28d9',
        particleColor: '#c4b5fd',
        haloColor: '#a78bfa',
        intensity: 0.32,
        bloom: 0.26,
        particleSpeed: 1.0,
      };
    case 'speaking':
      return {
        colorA: hot > 0.5 ? '#ff63c8' : '#ff8fb8',
        colorB: '#00e5ff',
        particleColor: '#ffd6f1',
        haloColor: '#ff63c8',
        intensity: 0.3,
        bloom: 0.3,
        particleSpeed: 1.1,
      };
    case 'idle':
    default:
      return {
        colorA: hot > 0.6 ? '#a78bfa' : '#00e5ff',
        colorB: hot > 0.6 ? '#5b21b6' : '#1166ff',
        particleColor: '#7dd3fc',
        haloColor: '#00e5ff',
        intensity: 0.18,
        bloom: 0.18,
        particleSpeed: 0.5,
      };
  }
}

// Synthetic audio envelope generator. Real audio level is used during
// `recording`; for `speaking` we synthesize a believable speech envelope so
// the orb still pulses to "speech" without wiring an analyser to the TTS
// playback (which has CORS quirks for blob URLs).
function envelope(state: CasperOrbState, audioLevel: number, time: number): number {
  // All harmonics kept under ~2.4 Hz so brightness never strobes. The orb
  // breathes; it does not flicker. Amplitudes intentionally small so peaks
  // stay below the bloom luminanceThreshold most of the time.
  switch (state) {
    case 'recording':
      // smoothed mic level with a tiny baseline so the orb never freezes
      return Math.min(1, Math.max(0.08, audioLevel * 0.9));
    case 'speaking':
      return Math.min(
        1,
        0.32 +
          0.12 * Math.abs(Math.sin(time * 1.6)) +
          0.06 * Math.abs(Math.sin(time * 2.3)),
      );
    case 'thinking':
      return Math.min(1, 0.16 + 0.07 * Math.sin(time * 0.7) + 0.03 * Math.sin(time * 1.6));
    case 'transcribing':
      return Math.min(1, 0.13 + 0.05 * Math.abs(Math.sin(time * 1.1)));
    case 'idle':
    default:
      return 0.07 + 0.04 * Math.sin(time * 0.45);
  }
}

const noiseGLSL = `
vec3 mod289_3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289_4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute4(vec4 x){return mod289_4(((x*34.)+1.)*x);}
vec4 taylorInvSqrt4(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1./6., 1./3.);
  const vec4 D = vec4(0., 0.5, 1., 2.);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v   - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289_3(i);
  vec4 p = permute4(permute4(permute4(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt4(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const sphereVert = /* glsl */ `
uniform float uTime;
uniform float uAudio;
uniform float uIntensity;
varying vec3 vNormal;
varying float vDistortion;

${noiseGLSL}

void main() {
  vNormal = normalize(normalMatrix * normal);
  float n  = snoise(position * 1.55 + uTime * 0.42);
  float n2 = snoise(position * 3.6 + uTime * 0.85);
  float d = (n * 0.55 + n2 * 0.22) * (uIntensity + uAudio * 0.55);
  vDistortion = d;
  vec3 displaced = position + normal * d;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const sphereFrag = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uAudio;
varying vec3 vNormal;
varying float vDistortion;

void main() {
  // Fresnel-style edge highlight.
  float fres = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.4);
  vec3 base = mix(uColorA, uColorB, clamp(vDistortion * 1.5 + uAudio * 0.3, 0.0, 1.0));
  // Soft inner mass so the orb still has a body when bloom is dialed back.
  vec3 inner = mix(base * 0.32, base, fres);
  // Cap audio's brightness contribution so peaks can't strobe-flash the orb.
  float audioLift = clamp(uAudio, 0.0, 1.0) * 0.18;
  vec3 finalCol = inner + fres * (base + 0.4) * (0.16 + audioLift);
  gl_FragColor = vec4(finalCol, 1.0);
}
`;

const particleVert = /* glsl */ `
attribute float aSize;
uniform float uTime;
uniform float uAudio;
uniform float uSpeed;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * uSpeed;
  float a = sin(t + position.x * 1.3) * 0.06;
  float b = cos(t + position.y * 1.1) * 0.06;
  p += vec3(a, b, 0.0) * (1.0 + uAudio * 1.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * 320.0 / max(0.5, -mv.z) * (1.0 + uAudio * 1.2);
  vAlpha = clamp(0.5 + uAudio * 0.45, 0.0, 1.0);
}
`;

const particleFrag = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(uColor, a);
}
`;

interface SceneProps {
  state: CasperOrbState;
  audioLevel: number;
  audioLevelRef?: React.RefObject<number>;
  instability: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function CasperOrbScene({ state, audioLevel, audioLevelRef, instability }: SceneProps) {
  const sphereRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const haloARef = useRef<THREE.Mesh>(null);
  const haloBRef = useRef<THREE.Mesh>(null);
  const haloCRef = useRef<THREE.Mesh>(null);

  const sphereUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAudio: { value: 0 },
      uIntensity: { value: 0.22 },
      uColorA: { value: new THREE.Color('#00e5ff') },
      uColorB: { value: new THREE.Color('#1166ff') },
    }),
    [],
  );

  const particleUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAudio: { value: 0 },
      uSpeed: { value: 0.6 },
      uColor: { value: new THREE.Color('#7dd3fc') },
    }),
    [],
  );

  const sphereGeometry = useMemo(() => new THREE.IcosahedronGeometry(1, 64), []);

  const particleGeometry = useMemo(() => {
    const PARTICLES = 700;
    const positions = new Float32Array(PARTICLES * 3);
    const sizes = new Float32Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i++) {
      const r = 1.65 + Math.random() * 1.4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      sizes[i] = Math.random() * 0.05 + 0.012;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return geo;
  }, []);

  // Animated palette/intensity targets — smoothed each frame so transitions feel intentional.
  const targetColorA = useMemo(() => new THREE.Color('#00e5ff'), []);
  const targetColorB = useMemo(() => new THREE.Color('#1166ff'), []);
  const targetParticleColor = useMemo(() => new THREE.Color('#7dd3fc'), []);
  const targetHaloColor = useMemo(() => new THREE.Color('#00e5ff'), []);

  useFrame((_, dt) => {
    // Cap dt so a stalled main thread (e.g., a heavy React re-render burst
    // from setAudioLevel firing 60Hz) cannot snap-lerp the orb's smoothed
    // values to their target in a single frame. Without this cap, every
    // hiccup looks like a brightness/color flash to the user.
    const cdt = Math.min(0.05, Math.max(0, dt));
    const palette = getPalette(state, instability);
    const time = (sphereUniforms.uTime.value += cdt);
    const liveAudio = audioLevelRef?.current ?? audioLevel ?? 0;
    const env = envelope(state, liveAudio, time);

    // Smooth color interpolation
    const damp = Math.min(0.6, cdt * 4);
    targetColorA.lerp(new THREE.Color(palette.colorA), damp);
    targetColorB.lerp(new THREE.Color(palette.colorB), damp);
    targetParticleColor.lerp(new THREE.Color(palette.particleColor), damp);
    targetHaloColor.lerp(new THREE.Color(palette.haloColor), damp);

    sphereUniforms.uColorA.value.copy(targetColorA);
    sphereUniforms.uColorB.value.copy(targetColorB);
    sphereUniforms.uAudio.value = lerp(sphereUniforms.uAudio.value, env, damp);
    sphereUniforms.uIntensity.value = lerp(sphereUniforms.uIntensity.value, palette.intensity, damp);

    // EVERYTHING below reads from the *smoothed* audio (uAudio.value), never
    // raw `env`. Reading raw env here was the second flash source: the sphere
    // shader saw a smoothed value, but rotation speed and halo opacity jumped
    // every frame in lockstep with mic noise, producing visible stutter.
    const smoothAudio = sphereUniforms.uAudio.value;

    particleUniforms.uTime.value = time;
    particleUniforms.uAudio.value = smoothAudio;
    particleUniforms.uSpeed.value = lerp(particleUniforms.uSpeed.value, palette.particleSpeed, damp);
    particleUniforms.uColor.value.copy(targetParticleColor);

    if (sphereRef.current) {
      sphereRef.current.rotation.y += 0.003 + smoothAudio * 0.008;
      sphereRef.current.rotation.x += 0.0009;
    }
    if (pointsRef.current) {
      pointsRef.current.rotation.y -= 0.0014 + smoothAudio * 0.002;
    }
    const haloOpacity = (base: number) => Math.min(0.4, base + smoothAudio * 0.08);
    [haloARef, haloBRef, haloCRef].forEach((ref, i) => {
      const m = ref.current;
      if (!m) return;
      m.rotation.z += 0.002 + i * 0.0014 + smoothAudio * 0.002;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.copy(targetHaloColor);
      mat.opacity = haloOpacity(0.22 - i * 0.05);
    });
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[2, 2, 2]} intensity={0.6} />

      <mesh ref={sphereRef} geometry={sphereGeometry}>
        <shaderMaterial
          uniforms={sphereUniforms}
          vertexShader={sphereVert}
          fragmentShader={sphereFrag}
        />
      </mesh>

      <points ref={pointsRef} geometry={particleGeometry}>
        <shaderMaterial
          uniforms={particleUniforms}
          vertexShader={particleVert}
          fragmentShader={particleFrag}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <mesh ref={haloARef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.45, 0.011, 16, 200]} />
        <meshBasicMaterial color="#00e5ff" transparent opacity={0.22} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={haloBRef} rotation={[Math.PI / 2 + 0.18, 0, 0.4]}>
        <torusGeometry args={[1.62, 0.01, 16, 200]} />
        <meshBasicMaterial color="#00e5ff" transparent opacity={0.18} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={haloCRef} rotation={[Math.PI / 2 + 0.36, 0, 0.8]}>
        <torusGeometry args={[1.78, 0.01, 16, 200]} />
        <meshBasicMaterial color="#00e5ff" transparent opacity={0.14} blending={THREE.AdditiveBlending} />
      </mesh>
    </>
  );
}

interface BloomDriverProps {
  state: CasperOrbState;
  instability: number;
}

function BloomDriver({ state, instability }: BloomDriverProps) {
  // Drive bloom strength from voice state. Previously this stored strength in
  // a plain ref and read it through JSX (`<Bloom intensity={ref.current...}>`),
  // which only flushes on React re-render — meaning bloom intensity got stuck
  // at whatever value it had when the component last rendered, which produced
  // visible step-changes (= flashes) when voice state flipped.
  //
  // Now: lerp inside useFrame and only call setState when the smoothed value
  // has drifted enough to be visible (>0.005). This caps the React re-render
  // rate to ~10Hz max during transitions and 0Hz when bloom is stable, while
  // still keeping bloom intensity smoothly animated.
  const target = getPalette(state, instability).bloom;
  const smoothedRef = useRef(target);
  const [strength, setStrength] = useState(target);
  useFrame((_, dt) => {
    const cdt = Math.min(0.05, Math.max(0, dt));
    const damp = Math.min(0.4, cdt * 2);
    smoothedRef.current = lerp(smoothedRef.current, target, damp);
    if (Math.abs(smoothedRef.current - strength) > 0.005) {
      setStrength(smoothedRef.current);
    }
  });
  return (
    <EffectComposer>
      <Bloom
        intensity={strength}
        luminanceThreshold={0.85}
        luminanceSmoothing={0.5}
        mipmapBlur
        radius={0.45}
      />
      <ChromaticAberration
        offset={new THREE.Vector2(0.0003, 0.0005)}
        blendFunction={BlendFunction.NORMAL}
        radialModulation={false}
        modulationOffset={0}
      />
    </EffectComposer>
  );
}

const CasperOrbVisualization: React.FC<CasperOrbVisualizationProps> = ({
  state,
  audioLevel = 0,
  audioLevelRef,
  instability = 10,
  className,
}) => {
  return (
    <div className={className} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <Canvas
        camera={{ position: [0, 0, 4.2], fov: 45 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
      >
        <CasperOrbScene
          state={state}
          audioLevel={audioLevel}
          audioLevelRef={audioLevelRef}
          instability={instability}
        />
        <BloomDriver state={state} instability={instability} />
      </Canvas>
    </div>
  );
};

export default CasperOrbVisualization;
