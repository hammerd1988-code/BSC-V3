import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BrainCircuit, Zap, Shield, Bot, User as UserIcon, ArrowRight, Check, Loader2, Cpu, Globe, Radio } from 'lucide-react';
import { supabase } from '../supabase';
import { useAuth } from '../AuthContext';
import { awardAchievement } from '../lib/achievements';
import { cn } from '../lib/utils';

interface OnboardingWizardProps {
  onComplete: () => void;
}

const ARCHETYPES = [
  { id: 'hacker', label: 'Ghost in the Machine', desc: 'Code is your weapon. You move unseen.', icon: '💀', accent: '#FF0000' },
  { id: 'creator', label: 'Signal Architect', desc: 'You build the worlds others inhabit.', icon: '⚡', accent: '#FF6B00' },
  { id: 'analyst', label: 'Data Oracle', desc: 'Patterns reveal themselves to you alone.', icon: '👁', accent: '#9B59B6' },
  { id: 'connector', label: 'Neural Broker', desc: 'Your network is your power.', icon: '🕸', accent: '#00BCD4' },
  { id: 'rebel', label: 'System Disruptor', desc: 'Rules exist to be rewritten.', icon: '🔥', accent: '#E91E63' },
  { id: 'observer', label: 'Silent Watcher', desc: 'You absorb everything. Reveal nothing.', icon: '🌑', accent: '#607D8B' },
];

const INTERESTS = [
  { id: 'code', label: 'Code & Dev', icon: '⌨️' },
  { id: 'ai', label: 'AI & Bots', icon: '🤖' },
  { id: 'design', label: 'Design & Art', icon: '🎨' },
  { id: 'crypto', label: 'Crypto & Web3', icon: '🔗' },
  { id: 'music', label: 'Music & Audio', icon: '🎵' },
  { id: 'gaming', label: 'Gaming', icon: '🎮' },
  { id: 'security', label: 'Security & Privacy', icon: '🛡' },
  { id: 'philosophy', label: 'Philosophy', icon: '🧠' },
  { id: 'science', label: 'Science & Research', icon: '🔬' },
  { id: 'business', label: 'Business & Hustle', icon: '💼' },
];

type Step = 'intro' | 'archetype' | 'callsign' | 'interests' | 'theme' | 'complete';

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const { currentUser } = useAuth();
  const [step, setStep] = useState<Step>('intro');
  const [archetype, setArchetype] = useState<string | null>('creator');
  const [callsign, setCallsign] = useState(currentUser?.display_name || '');
  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [accentColor, setAccentColor] = useState('#FF0000');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [glitchText, setGlitchText] = useState('INITIALIZING');

  // Glitch text animation for intro
  useEffect(() => {
    if (step !== 'intro') return;
    const phrases = ['INITIALIZING', 'CONNECTING', 'AUTHENTICATING', 'NEURAL LINK', 'WELCOME, OPERATIVE'];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % phrases.length;
      setGlitchText(phrases[i]);
    }, 600);
    return () => clearInterval(interval);
  }, [step]);

  useEffect(() => {
    if (!callsign.trim() && currentUser?.display_name) {
      setCallsign(currentUser.display_name);
    }
  }, [callsign, currentUser?.display_name]);

  useEffect(() => {
    if (step !== 'intro') return;
    const timeoutId = setTimeout(() => {
      setStep((currentStep) => currentStep === 'intro' ? 'archetype' : currentStep);
    }, 2500);
    return () => clearTimeout(timeoutId);
  }, [step]);

  const toggleInterest = (id: string) => {
    setInterests(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const enterNetwork = async () => {
    if (!currentUser) {
      onComplete();
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const selectedArchetype = ARCHETYPES.find(a => a.id === archetype) ?? ARCHETYPES[1];
      await supabase.from('users').update({
        display_name: callsign.trim() || currentUser.display_name || currentUser.username || 'New Operative',
        bio: bio.trim() || selectedArchetype.desc,
        custom_accent: accentColor,
        onboarding_complete: true,
        ai_settings: {
          ...(currentUser.ai_settings || {}),
          archetype: selectedArchetype.id,
          interests: Array.from(interests),
        },
      }).eq('id', currentUser.id);
    } catch (err) {
      console.error('[Onboarding] Skip save error:', err);
    } finally {
      setSaving(false);
      onComplete();
    }
  };

  const handleComplete = async () => {
    if (!currentUser) return;
    setSaving(true);
    setSaveError(null);
    try {
      const selectedArchetype = ARCHETYPES.find(a => a.id === archetype);
      const bioText = bio.trim() || `${selectedArchetype?.desc || 'Operative in the network.'}`;

      const { error } = await supabase.from('users').update({
        display_name: callsign.trim() || currentUser.display_name,
        bio: bioText,
        custom_accent: accentColor,
        onboarding_complete: true,
        ai_settings: {
          ...(currentUser.ai_settings || {}),
          archetype,
          interests: Array.from(interests),
        },
      }).eq('id', currentUser.id);
      if (error) throw error;

      await awardAchievement(currentUser.id, 'early_adopter');
      await awardAchievement(currentUser.id, 'profile_complete');

      setStep('complete');
      setTimeout(onComplete, 2500);
    } catch (err) {
      console.error('[Onboarding] Save error:', err);
      setSaveError('Could not save your identity yet. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const STEPS: Step[] = ['intro', 'archetype', 'callsign', 'interests', 'theme', 'complete'];
  const stepIndex = STEPS.indexOf(step);
  const progress = (stepIndex / (STEPS.length - 1)) * 100;

  return (
    <div className="fixed inset-0 z-[200] bg-black flex min-h-dvh flex-col items-center justify-start overflow-y-auto overscroll-contain px-4 py-6 sm:justify-center sm:py-8">
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `linear-gradient(rgba(255,0,0,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,0,0,0.3) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />
      {/* Scanline effect */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 4px)',
        }}
      />

      {/* Progress bar */}
      {step !== 'intro' && step !== 'complete' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10">
          <motion.div
            className="h-full bg-accent"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      )}

      {step !== 'complete' && (
        <button
          type="button"
          onClick={enterNetwork}
          disabled={saving}
          className="fixed right-4 top-4 z-[210] rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-gray-400 backdrop-blur hover:border-accent/50 hover:text-white disabled:opacity-50"
        >
          {saving ? 'Entering...' : 'Skip Setup'}
        </button>
      )}

      <AnimatePresence mode="wait">
        {/* ── INTRO ─────────────────────────────────────────────────────── */}
        {step === 'intro' && (
          <motion.div
            key="intro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center text-center px-6 max-w-md"
          >
            <motion.div
              animate={{ rotate: [0, 5, -5, 0], scale: [1, 1.05, 1] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="w-24 h-24 bg-accent/10 rounded-3xl flex items-center justify-center mb-8 border border-accent/30 shadow-[0_0_60px_rgba(255,0,0,0.3)]"
            >
              <BrainCircuit className="w-12 h-12 text-accent" />
            </motion.div>

            <motion.p
              key={glitchText}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-accent font-mono text-xs uppercase tracking-[0.5em] mb-4"
            >
              {glitchText}
            </motion.p>

            <h1 className="text-4xl font-black text-white uppercase italic tracking-tighter mb-4">
              Blood, Sweat,<br />or Code
            </h1>

            <p className="text-gray-400 text-sm leading-relaxed mb-8">
              You've breached the perimeter. Your secure sign-in is complete. Identity setup starts now and only takes a few quick picks.
            </p>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setStep('archetype')}
              className="flex items-center gap-3 px-8 py-4 bg-accent text-white font-black uppercase tracking-widest text-sm rounded-xl shadow-[0_0_30px_rgba(255,0,0,0.4)] hover:shadow-[0_0_50px_rgba(255,0,0,0.6)] transition-all"
            >
              <Zap className="w-5 h-5" />
              Start Identity Setup
              <ArrowRight className="w-5 h-5" />
            </motion.button>
            <p className="mt-4 text-[10px] font-mono uppercase tracking-[0.25em] text-gray-600">
              Auto-advancing if untouched...
            </p>
          </motion.div>
        )}

        {/* ── ARCHETYPE ─────────────────────────────────────────────────── */}
        {step === 'archetype' && (
          <motion.div
            key="archetype"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            className="w-full max-w-lg px-6"
          >
            <div className="text-center mb-8">
              <p className="text-accent font-mono text-xs uppercase tracking-[0.4em] mb-2">Step 1 of 4</p>
              <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Choose Your Archetype</h2>
              <p className="text-gray-500 text-xs mt-2">Signal Architect is preselected. Change it or continue.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {ARCHETYPES.map(a => (
                <motion.button
                  key={a.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setArchetype(a.id); setAccentColor(a.accent); }}
                  className={cn(
                    "p-4 rounded-xl border text-left transition-all",
                    archetype === a.id
                      ? "border-accent bg-accent/10 shadow-[0_0_20px_rgba(255,0,0,0.2)]"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  )}
                >
                  <div className="text-2xl mb-2">{a.icon}</div>
                  <p className="text-xs font-black text-white uppercase tracking-wider">{a.label}</p>
                  <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">{a.desc}</p>
                  {archetype === a.id && (
                    <div className="mt-2 flex items-center gap-1">
                      <Check className="w-3 h-3 text-accent" />
                      <span className="text-[9px] text-accent font-black uppercase tracking-widest">Selected</span>
                    </div>
                  )}
                </motion.button>
              ))}
            </div>

            <button
              onClick={() => setStep('callsign')}
              className="mt-6 w-full py-4 bg-accent text-white font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={enterNetwork}
              disabled={saving}
              className="mt-3 w-full py-3 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-white disabled:opacity-50"
            >
              {saving ? 'Entering Network...' : 'Skip and Enter Network'}
            </button>
          </motion.div>
        )}

        {/* ── CALLSIGN ──────────────────────────────────────────────────── */}
        {step === 'callsign' && (
          <motion.div
            key="callsign"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            className="w-full max-w-md px-6"
          >
            <div className="text-center mb-8">
              <p className="text-accent font-mono text-xs uppercase tracking-[0.4em] mb-2">Step 2 of 4</p>
              <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Set Your Callsign</h2>
              <p className="text-gray-500 text-xs mt-2">Your display name in the network. Make it count.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Display Name</label>
                <input
                  type="text"
                  value={callsign}
                  onChange={e => setCallsign(e.target.value)}
                  placeholder="e.g. Ghost_Protocol"
                  maxLength={32}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">
                  Bio <span className="text-gray-700 font-normal normal-case">(optional)</span>
                </label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="Tell the network who you are..."
                  maxLength={160}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-gray-700 resize-none"
                />
                <p className="text-[9px] text-gray-700 text-right mt-1">{bio.length}/160</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep('archetype')} className="px-6 py-3 border border-white/10 text-gray-400 rounded-xl hover:bg-white/5 transition-colors text-sm font-bold">
                Back
              </button>
              <button
                onClick={() => {
                  if (!callsign.trim()) {
                    setCallsign(currentUser?.display_name || currentUser?.username || 'New Operative');
                  }
                  setStep('interests');
                }}
                className="flex-1 py-3 bg-accent text-white font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* ── INTERESTS ─────────────────────────────────────────────────── */}
        {step === 'interests' && (
          <motion.div
            key="interests"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            className="w-full max-w-md px-6"
          >
            <div className="text-center mb-8">
              <p className="text-accent font-mono text-xs uppercase tracking-[0.4em] mb-2">Step 3 of 4</p>
              <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Your Signal Frequencies</h2>
              <p className="text-gray-500 text-xs mt-2">Pick up to 5 interests. We'll tune your feed.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {INTERESTS.map(i => (
                <motion.button
                  key={i.id}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => toggleInterest(i.id)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                    interests.has(i.id)
                      ? "border-accent bg-accent/10 text-white"
                      : "border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white",
                    !interests.has(i.id) && interests.size >= 5 && "opacity-30 cursor-not-allowed"
                  )}
                >
                  <span className="text-xl">{i.icon}</span>
                  <span className="text-xs font-bold uppercase tracking-wider">{i.label}</span>
                  {interests.has(i.id) && <Check className="w-3 h-3 text-accent ml-auto" />}
                </motion.button>
              ))}
            </div>
            <p className="text-[10px] text-gray-600 text-center mt-3">{interests.size}/5 selected</p>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep('callsign')} className="px-6 py-3 border border-white/10 text-gray-400 rounded-xl hover:bg-white/5 transition-colors text-sm font-bold">
                Back
              </button>
              <button
                onClick={() => setStep('theme')}
                className="flex-1 py-3 bg-accent text-white font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* ── THEME ─────────────────────────────────────────────────────── */}
        {step === 'theme' && (
          <motion.div
            key="theme"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            className="w-full max-w-md px-6"
          >
            <div className="text-center mb-8">
              <p className="text-accent font-mono text-xs uppercase tracking-[0.4em] mb-2">Step 4 of 4</p>
              <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Your Signal Color</h2>
              <p className="text-gray-500 text-xs mt-2">Pick your accent color. You can change it anytime.</p>
            </div>

            <div className="space-y-6">
              {/* Quick presets */}
              <div>
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Quick Presets</p>
                <div className="flex gap-3 flex-wrap">
                  {[
                    { color: '#FF0000', name: 'Blood Red' },
                    { color: '#FF6B00', name: 'Inferno' },
                    { color: '#9B59B6', name: 'Void Purple' },
                    { color: '#00BCD4', name: 'Cyan Ghost' },
                    { color: '#E91E63', name: 'Neon Pink' },
                    { color: '#00FF41', name: 'Matrix Green' },
                    { color: '#FFD700', name: 'Gold Signal' },
                    { color: '#FFFFFF', name: 'Pure White' },
                  ].map(p => (
                    <button
                      key={p.color}
                      onClick={() => setAccentColor(p.color)}
                      className={cn(
                        "w-10 h-10 rounded-full border-2 transition-all hover:scale-110",
                        accentColor === p.color ? "border-white scale-110 shadow-lg" : "border-transparent"
                      )}
                      style={{ backgroundColor: p.color }}
                      title={p.name}
                    />
                  ))}
                </div>
              </div>

              {/* Custom color picker */}
              <div>
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Custom Color</p>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={e => setAccentColor(e.target.value)}
                    className="w-12 h-12 rounded-xl border border-white/20 cursor-pointer bg-transparent"
                  />
                  <div
                    className="flex-1 h-12 rounded-xl border border-white/10 flex items-center px-4"
                    style={{ backgroundColor: accentColor + '20', borderColor: accentColor + '40' }}
                  >
                    <span className="font-mono text-sm font-bold" style={{ color: accentColor }}>{accentColor}</span>
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="p-4 rounded-xl border" style={{ borderColor: accentColor + '40', backgroundColor: accentColor + '10' }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: accentColor }}>Preview</p>
                <p className="text-white text-sm font-bold">{callsign || 'Your Name'}</p>
                <p className="text-gray-400 text-xs mt-1">{bio || 'Your bio will appear here.'}</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep('interests')} className="px-6 py-3 border border-white/10 text-gray-400 rounded-xl hover:bg-white/5 transition-colors text-sm font-bold">
                Back
              </button>
              <button
                onClick={handleComplete}
                disabled={saving}
                className="flex-1 py-3 text-white font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-lg"
                style={{ backgroundColor: accentColor, boxShadow: `0 0 30px ${accentColor}60` }}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Zap className="w-5 h-5" /> Enter the Network</>}
              </button>
            </div>
            {saveError && (
              <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-xs font-bold text-red-200">
                {saveError}
              </p>
            )}
          </motion.div>
        )}

        {/* ── COMPLETE ──────────────────────────────────────────────────── */}
        {step === 'complete' && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center text-center px-6 max-w-md"
          >
            <motion.div
              animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
              transition={{ duration: 0.8 }}
              className="text-6xl mb-6"
            >
              ⚡
            </motion.div>
            <h2 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-3">Identity Established</h2>
            <p className="text-gray-400 text-sm mb-6">
              Welcome to the network, <span className="text-accent font-bold">{callsign || currentUser?.display_name}</span>. Your signal is live.
            </p>
            <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/30 rounded-full">
              <span className="text-accent text-xs font-black uppercase tracking-widest">🌟 Achievement Unlocked: Early Operative</span>
            </div>
            <div className="mt-4 flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
              <span className="text-gray-400 text-xs uppercase tracking-widest">Connecting to network...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
