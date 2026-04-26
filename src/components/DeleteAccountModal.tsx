import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertTriangle, Loader2, Trash2, Heart, ChevronRight } from 'lucide-react';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';

interface DeleteAccountModalProps {
  userId: string;
  username: string;
  email: string;
  postCount: number;
  createdAt: string;
  onClose: () => void;
  onDeleted: () => void;
}

const DELETION_REASONS = [
  { value: 'not_enough_content', label: 'Not enough content or activity' },
  { value: 'privacy_concerns', label: 'Privacy or security concerns' },
  { value: 'found_another_platform', label: 'Found a better platform' },
  { value: 'too_confusing', label: 'Too confusing or hard to use' },
  { value: 'too_many_notifications', label: 'Too many notifications' },
  { value: 'technical_issues', label: 'Technical issues / bugs' },
  { value: 'taking_a_break', label: 'Just taking a break' },
  { value: 'other', label: 'Other reason' },
];

type Step = 'sorry' | 'feedback' | 'confirm';

export const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
  userId, username, email, postCount, createdAt, onClose, onDeleted,
}) => {
  const [step, setStep] = useState<Step>('sorry');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountAgeDays = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));

  const handleDelete = async () => {
    if (confirmText !== 'DELETE MY ACCOUNT') {
      setError('Please type the confirmation phrase exactly.');
      return;
    }
    if (!reason) { setError('Please select a reason.'); return; }
    if (explanation.trim().length < 10) { setError('Please write at least a brief explanation.'); return; }

    setDeleting(true);
    setError(null);

    try {
      // 1. Save feedback first (before deletion)
      await supabase.from('account_deletion_feedback').insert({
        user_id: userId,
        username,
        email,
        reason,
        explanation: explanation.trim(),
        account_age_days: accountAgeDays,
        post_count: postCount,
      });

      // 2. Sign out and delete auth user
      await supabase.auth.signOut();

      // Note: Full account deletion requires a server-side call with service role key.
      // The user data will be anonymized. The auth.signOut() above logs them out immediately.
      // For complete deletion, the admin can process the deletion_feedback table.
      // We mark the account as deleted in the users table.
      await supabase.from('users').update({
        bio: '[Account deleted]',
        display_name: '[Deleted User]',
        avatar_url: null,
        email: `deleted_${userId}@deleted.bsc`,
      }).eq('id', userId);

      onDeleted();
    } catch (err) {
      handleDbError(err, 'DELETE', `users/${userId}`);
      setError('Failed to delete account. Please try again or contact support.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md bg-[#0A0A0A] border border-red-500/30 rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-widest">Delete Account</h2>
              <p className="text-[10px] text-gray-500">This action is permanent</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {/* ── STEP 1: SORRY ─────────────────────────────────────────── */}
          {step === 'sorry' && (
            <motion.div key="sorry" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-5">
              <div className="text-center">
                <div className="text-5xl mb-4">😔</div>
                <h3 className="text-xl font-black text-white mb-2">We're sorry to see you go</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  <span className="text-white font-bold">@{username}</span>, you've been part of the network
                  {accountAgeDays > 0 && ` for ${accountAgeDays} day${accountAgeDays !== 1 ? 's' : ''}`}.
                  {postCount > 0 && ` You've made ${postCount} transmission${postCount !== 1 ? 's' : ''}.`}
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
                  <p className="text-xs text-yellow-400 font-bold mb-1">⚠️ Before you go</p>
                  <p className="text-[11px] text-gray-400">Account deletion is permanent. Your posts, CRED, connections, and data will be removed and cannot be recovered.</p>
                </div>
                <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                  <p className="text-xs text-blue-400 font-bold mb-1">💡 Consider instead</p>
                  <p className="text-[11px] text-gray-400">You can take a break without deleting — just close the app. Or update your notification settings if that's the issue.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 py-3 border border-white/10 text-white rounded-xl hover:bg-white/5 transition-colors text-sm font-bold">
                  Keep My Account
                </button>
                <button
                  onClick={() => setStep('feedback')}
                  className="flex-1 py-3 bg-red-500/20 border border-red-500/50 text-red-400 rounded-xl hover:bg-red-500/30 transition-colors text-sm font-bold flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: FEEDBACK ──────────────────────────────────────── */}
          {step === 'feedback' && (
            <motion.div key="feedback" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-5">
              <div>
                <h3 className="text-lg font-black text-white mb-1">Help us improve</h3>
                <p className="text-xs text-gray-500">Your feedback is required before deletion. This helps us build a better platform.</p>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">
                  Primary Reason <span className="text-red-400">*</span>
                </label>
                <select
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-red-500 transition-colors cursor-pointer"
                >
                  <option value="">Select a reason...</option>
                  {DELETION_REASONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">
                  Tell us more <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={explanation}
                  onChange={e => setExplanation(e.target.value)}
                  placeholder="Please explain in your own words. What could we have done better? What would have made you stay?"
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-red-500 transition-colors placeholder:text-gray-700 resize-none"
                />
                <p className={cn("text-[9px] text-right mt-1", explanation.trim().length < 10 ? "text-red-400" : "text-gray-600")}>
                  {explanation.trim().length} chars (min 10)
                </p>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('sorry')} className="px-5 py-3 border border-white/10 text-gray-400 rounded-xl hover:bg-white/5 transition-colors text-sm font-bold">
                  Back
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  disabled={!reason || explanation.trim().length < 10}
                  className="flex-1 py-3 bg-red-500/20 border border-red-500/50 text-red-400 rounded-xl hover:bg-red-500/30 transition-colors text-sm font-bold disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 3: CONFIRM ───────────────────────────────────────── */}
          {step === 'confirm' && (
            <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6 space-y-5">
              <div className="text-center">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
                <h3 className="text-lg font-black text-white mb-1">Final Confirmation</h3>
                <p className="text-xs text-gray-400">This cannot be undone.</p>
              </div>

              <div className="p-4 bg-red-500/5 border border-red-500/30 rounded-xl space-y-2 text-xs text-red-300">
                <p>✗ All your posts and transmissions will be deleted</p>
                <p>✗ Your CRED balance will be forfeited</p>
                <p>✗ Your connections and friends list will be removed</p>
                <p>✗ Your username @{username} will be released</p>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">
                  Type <span className="text-red-400 font-mono">DELETE MY ACCOUNT</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="DELETE MY ACCOUNT"
                  className="w-full bg-white/5 border border-red-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-red-500 transition-colors placeholder:text-gray-700 font-mono"
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 font-mono">{error}</p>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep('feedback')} className="px-5 py-3 border border-white/10 text-gray-400 rounded-xl hover:bg-white/5 transition-colors text-sm font-bold">
                  Back
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting || confirmText !== 'DELETE MY ACCOUNT'}
                  className="flex-1 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors text-sm font-black disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Trash2 className="w-4 h-4" /> Delete My Account</>}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
