import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Copy, Check, Share2, MessageCircle, Mail, Users, Coins, TrendingUp, Zap } from 'lucide-react';
import { supabase } from '../supabase';
import { cn } from '../lib/utils';

interface InviteModalProps {
  userId: string;
  username: string;
  onClose: () => void;
}

interface ReferralStats {
  total: number;
  credEarned: number;
}

export const InviteModal: React.FC<InviteModalProps> = ({ userId, username, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<ReferralStats>({ total: 0, credEarned: 0 });
  const [phoneNumber, setPhoneNumber] = useState('');

  const inviteUrl = `${window.location.origin}/join?ref=${username}`;
  const inviteText = `Join me on Blood, Sweat, or Code — the cyberpunk social network for builders and creators. Use my invite link and we both get bonus CRED: ${inviteUrl}`;

  useEffect(() => {
    const loadStats = async () => {
      const { data } = await supabase
        .from('referrals')
        .select('id, cred_awarded_referrer')
        .eq('referrer_id', userId);

      if (data) {
        setStats({
          total: data.length,
          credEarned: data.reduce((sum: number, r: any) => sum + (r.cred_awarded_referrer || 100), 0),
        });
      }
    };
    loadStats();
  }, [userId]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join Blood, Sweat, or Code', text: inviteText, url: inviteUrl });
      } catch (e) { /* user cancelled */ }
    } else {
      copyLink();
    }
  };

  const SHARE_OPTIONS = [
    {
      label: 'WhatsApp',
      icon: '💬',
      color: '#25D366',
      href: `https://wa.me/?text=${encodeURIComponent(inviteText)}`,
    },
    {
      label: 'X / Twitter',
      icon: '✕',
      color: '#1DA1F2',
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(inviteText)}`,
    },
    {
      label: 'Telegram',
      icon: '✈️',
      color: '#0088cc',
      href: `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent('Join me on Blood, Sweat, or Code!')}`,
    },
    {
      label: 'Email',
      icon: '📧',
      color: '#EA4335',
      href: `mailto:?subject=Join me on Blood, Sweat, or Code&body=${encodeURIComponent(inviteText)}`,
    },
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-md bg-[#0A0A0A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center">
              <Users className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-widest">Invite Operatives</h2>
              <p className="text-[10px] text-gray-500">Earn 100 CRED per referral</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-accent/5 border border-accent/20 rounded-xl text-center">
              <p className="text-3xl font-black text-white">{stats.total}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Operatives Recruited</p>
            </div>
            <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl text-center">
              <p className="text-3xl font-black text-yellow-400">{stats.credEarned}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">CRED Earned</p>
            </div>
          </div>

          {/* Rewards explanation */}
          <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
              <Zap className="w-3 h-3 text-accent" /> Referral Rewards
            </p>
            <div className="space-y-1 text-xs text-gray-400">
              <p>• You earn <span className="text-white font-bold">100 CRED</span> when someone signs up via your link</p>
              <p>• They get <span className="text-white font-bold">50 CRED</span> welcome bonus</p>
              <p>• No limit — invite as many as you want</p>
            </div>
          </div>

          {/* Invite link */}
          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Your Invite Link</label>
            <div className="flex gap-2">
              <div className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-gray-300 font-mono truncate">
                {inviteUrl}
              </div>
              <button
                onClick={copyLink}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                  copied
                    ? "bg-green-500/20 border border-green-500/30 text-green-400"
                    : "bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30"
                )}
              >
                {copied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
              </button>
            </div>
          </div>

          {/* Share buttons */}
          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-3">Share Via</label>
            <div className="grid grid-cols-4 gap-2">
              {SHARE_OPTIONS.map(opt => (
                <a
                  key={opt.label}
                  href={opt.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                >
                  <span className="text-xl">{opt.icon}</span>
                  <span className="text-[9px] text-gray-400 uppercase tracking-wider">{opt.label}</span>
                </a>
              ))}
            </div>
          </div>

          {/* SMS option */}
          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">
              Send to Phone (SMS)
            </label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-700 focus:outline-none focus:border-accent transition-colors"
              />
              <a
                href={`sms:${phoneNumber}?body=${encodeURIComponent(inviteText)}`}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                  phoneNumber.trim()
                    ? "bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30"
                    : "bg-white/5 border border-white/10 text-gray-600 pointer-events-none"
                )}
              >
                <MessageCircle className="w-3 h-3" /> SMS
              </a>
            </div>
          </div>

          {/* Native share button */}
          <button
            onClick={shareNative}
            className="w-full py-3 bg-accent text-white font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" /> Share Invite Link
          </button>
        </div>
      </motion.div>
    </div>
  );
};
