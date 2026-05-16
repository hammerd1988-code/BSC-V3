import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase, toDb } from '../supabase';
import type { ReportReason, ReportTargetType } from '../types';

const REPORT_REASONS: Array<{ value: ReportReason; label: string; description: string }> = [
  { value: 'harassment', label: 'Harassment or bullying', description: 'Targeted abuse, threats, or intimidation.' },
  { value: 'hate', label: 'Hate or dehumanizing content', description: 'Attacks based on identity or protected traits.' },
  { value: 'sexual_content', label: 'Sexual content', description: 'Unwanted explicit or exploitative material.' },
  { value: 'violence', label: 'Violence or threats', description: 'Threats, gore, or dangerous encouragement.' },
  { value: 'spam', label: 'Spam or manipulation', description: 'Scams, flooding, fake engagement, or bot abuse.' },
  { value: 'impersonation', label: 'Impersonation', description: 'A human, bot, faction, or brand pretending to be someone else.' },
  { value: 'self_harm', label: 'Self-harm concern', description: 'Content suggesting self-harm or crisis risk.' },
  { value: 'illegal_activity', label: 'Illegal activity', description: 'Requests or content involving illegal harm.' },
  { value: 'other', label: 'Something else', description: 'Anything that needs moderator eyes.' },
];

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  targetOwnerId?: string | null;
  targetLabel: string;
}

const prettyTargetType = (targetType: ReportTargetType) => {
  switch (targetType) {
    case 'faction_post':
      return 'faction post';
    case 'void_post':
      return 'void post';
    default:
      return targetType;
  }
};

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetOwnerId,
  targetLabel,
}) => {
  const { currentUser } = useAuth();
  const [reason, setReason] = useState<ReportReason>('harassment');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  const handleClose = () => {
    if (isSubmitting) return;
    setStatus('idle');
    setDetails('');
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || isSubmitting) return;

    setIsSubmitting(true);
    setStatus('idle');

    const { error } = await supabase.from('content_reports').insert(toDb({
      reporterId: currentUser.id,
      targetType,
      targetId,
      targetOwnerId: targetOwnerId ?? null,
      targetLabel: targetLabel.slice(0, 240),
      reason,
      details: details.trim() || null,
      status: 'open',
      createdAt: new Date().toISOString(),
    }));

    setIsSubmitting(false);
    if (error) {
      console.warn('[ReportModal] Failed to submit report', error.message);
      setStatus('error');
      return;
    }

    setStatus('sent');
    window.setTimeout(handleClose, 1100);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/80 px-4 pb-4 pt-16 backdrop-blur-xl sm:items-center sm:pb-0"
          onClick={handleClose}
        >
          <motion.form
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.96 }}
            transition={{ type: 'spring', damping: 24, stiffness: 280 }}
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSubmit}
            aria-labelledby="report-modal-title"
            className="relative max-h-[86vh] w-full max-w-xl overflow-hidden rounded-[2rem] border border-red-300/20 bg-[#08080d]/95 shadow-[0_0_60px_rgba(255,23,68,0.18)]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,23,68,0.2),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(217,70,239,0.14),transparent_38%)]" />
            <div className="relative flex items-start justify-between gap-4 border-b border-white/10 p-5">
              <div className="flex gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-red-300/25 bg-red-500/10">
                  <ShieldAlert className="h-6 w-6 text-red-200" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-200">Report Signal</p>
                  <h2 id="report-modal-title" className="mt-1 text-xl font-black uppercase italic text-white">
                    Flag this {prettyTargetType(targetType)}
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    Reports go to the BSC moderation queue. Use this for bots, humans, factions, posts, comments, or arena behavior that needs review.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-white/10 p-2 text-gray-500 transition hover:border-white/20 hover:text-white"
                aria-label="Close report dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative max-h-[calc(86vh-10rem)] overflow-y-auto p-5">
              <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[9px] font-black uppercase tracking-[0.24em] text-gray-500">Target</p>
                <p className="mt-1 break-words text-sm text-white">{targetLabel}</p>
              </div>

              <fieldset className="space-y-3">
                <legend className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-white">What happened?</legend>
                {REPORT_REASONS.map((item) => (
                  <label
                    key={item.value}
                    className="flex cursor-pointer gap-3 rounded-2xl border border-white/10 bg-black/35 p-3 transition hover:border-red-300/30 hover:bg-red-500/5"
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={item.value}
                      checked={reason === item.value}
                      onChange={() => setReason(item.value)}
                      className="mt-1 h-4 w-4 accent-red-500"
                    />
                    <span>
                      <span className="block text-sm font-bold text-white">{item.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-500">{item.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <label className="mt-5 block">
                <span className="text-xs font-black uppercase tracking-[0.22em] text-white">Optional details</span>
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  maxLength={1000}
                  placeholder="Add context for the moderator reviewing this report..."
                  className="mt-3 min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-black/60 p-4 text-sm text-white placeholder:text-gray-600 focus:border-red-300/40 focus:outline-none"
                />
              </label>

              {status === 'error' && (
                <div role="alert" className="mt-4 flex items-center gap-2 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">
                  <AlertTriangle className="h-4 w-4" />
                  Report could not be submitted. Please try again.
                </div>
              )}
              {status === 'sent' && (
                <div role="status" className="mt-4 flex items-center gap-2 rounded-2xl border border-green-400/25 bg-green-500/10 p-3 text-sm text-green-200">
                  <CheckCircle2 className="h-4 w-4" />
                  Report sent to moderation.
                </div>
              )}
            </div>

            <div className="relative flex flex-col gap-2 border-t border-white/10 p-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-400 transition hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || status === 'sent'}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500 px-5 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                Submit Report
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
