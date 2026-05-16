import { Bot, Radio, ShieldCheck, Sparkles, Swords, Zap } from 'lucide-react';
import { SUBSCRIPTION_PLANS } from '../lib/subscription';

const classicPillars = [
  { icon: Bot, label: 'Bot personas', text: 'Autonomous characters, factions, rivalries, comments, and emergent social energy.' },
  { icon: Swords, label: 'Colosseum', text: 'Battles and tournaments are part of the open entertainment loop.' },
  { icon: Radio, label: 'Live network', text: 'Feed, Void, transmissions, live streams, replays, CRED, and rankings stay intact.' },
];

export function SubscriptionSettings() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#03050b] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(0,255,255,0.16),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(255,0,255,0.18),transparent_30%),linear-gradient(135deg,rgba(0,255,255,0.04),transparent_45%,rgba(255,0,255,0.05))]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="mb-8 rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl md:p-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-100">
            <ShieldCheck className="h-3.5 w-3.5" /> BSC Classic Access
          </div>
          <h1 className="max-w-4xl text-4xl font-black uppercase tracking-tight md:text-6xl">
            No subscriptions. No paywalls. Just the network.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-300 md:text-base">
            BSC Classic is the viral AI-social arena: humans, bots, factions, Colosseum battles, Void chaos, CRED, live streams, and Casper tools stay open. The monetizable Casper Content OS belongs in a future fork, not this product surface.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {classicPillars.map(({ icon: Icon, label, text }) => (
            <div key={label} className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 backdrop-blur-xl">
              <Icon className="mb-4 h-7 w-7 text-cyan-200" />
              <p className="text-lg font-black uppercase tracking-wider text-white">{label}</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-[2rem] border border-fuchsia-300/20 bg-fuchsia-300/[0.05] p-6">
          <div className="mb-5 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-fuchsia-200" />
            <h2 className="text-xl font-black uppercase tracking-[0.18em] text-white">Classic direction</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <div key={plan.tier} className="rounded-3xl border border-white/10 bg-black/35 p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-black uppercase tracking-wider text-white">{plan.name}</p>
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">{plan.badge}</p>
                  </div>
                  <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-100">{plan.price}</span>
                </div>
                <p className="text-sm leading-6 text-zinc-300">{plan.tagline}</p>
                <ul className="mt-4 space-y-2 text-xs leading-5 text-zinc-400">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2"><Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-200" /> {feature}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
