import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Coins, ArrowUpRight, ArrowDownRight, CreditCard, Loader2, Zap, ExternalLink, Cpu, CheckCircle2, AlertCircle } from 'lucide-react';
import { User } from '../types';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { cn } from '../lib/utils';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

interface Transaction {
  id: string;
  userId: string;
  amount: number;
  type: 'purchase' | 'spend' | 'earn';
  description: string;
  created_at: any;
}

// Square Application ID and Location ID — set as Railway env vars
const SQUARE_APP_ID = import.meta.env.VITE_SQUARE_APP_ID as string | undefined;
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID as string | undefined;
const SQUARE_ENV = (import.meta.env.VITE_SQUARE_ENV as string | undefined) || 'sandbox';

declare global {
  interface Window {
    Square?: any;
  }
}

export function WalletModal({ isOpen, onClose, user }: WalletModalProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [exchanging, setExchanging] = useState(false);
  const [exchangeAmount, setExchangeAmount] = useState('10');

  // Square payment state
  const [selectedTier, setSelectedTier] = useState<{ amount: number; bonus: number; price: string; priceInCents: number } | null>(null);
  const [squareLoaded, setSquareLoaded] = useState(false);
  const [squareCard, setSquareCard] = useState<any>(null);
  const [squarePayments, setSquarePayments] = useState<any>(null);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const cardContainerRef = useRef<HTMLDivElement>(null);

  const TIERS = [
    { amount: 100, price: '$4.99', priceInCents: 499, bonus: 0 },
    { amount: 500, price: '$19.99', priceInCents: 1999, bonus: 0 },
    { amount: 1500, price: '$49.99', priceInCents: 4999, bonus: 0, popular: true },
  ];

  useEffect(() => {
    if (isOpen && user) {
      fetchTransactions();
    }
  }, [isOpen, user]);

  // Load Square Web Payments SDK
  useEffect(() => {
    if (!isOpen || !SQUARE_APP_ID || !SQUARE_LOCATION_ID) return;
    if (window.Square) { setSquareLoaded(true); return; }

    const script = document.createElement('script');
    script.src = SQUARE_ENV === 'production'
      ? 'https://web.squarecdn.com/v1/square.js'
      : 'https://sandbox.web.squarecdn.com/v1/square.js';
    script.onload = () => setSquareLoaded(true);
    script.onerror = () => console.error('[Square] Failed to load SDK');
    document.head.appendChild(script);
  }, [isOpen]);

  // Initialize Square card when a tier is selected
  useEffect(() => {
    if (!squareLoaded || !selectedTier || !cardContainerRef.current || !window.Square) return;

    const initCard = async () => {
      try {
        const payments = window.Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
        setSquarePayments(payments);
        const card = await payments.card();
        await card.attach('#square-card-container');
        setSquareCard(card);
      } catch (err) {
        console.error('[Square] Card init error:', err);
        setPaymentError('Failed to initialize payment form. Please try again.');
      }
    };

    void initCard();

    return () => {
      if (squareCard) {
        squareCard.destroy().catch(() => {});
        setSquareCard(null);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squareLoaded, selectedTier]);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      setTransactions((data ?? []) as Transaction[]);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExchange = async () => {
    const amount = parseInt(exchangeAmount);
    if (isNaN(amount) || amount <= 0 || (user.cred_balance || 0) < amount) return;

    setExchanging(true);
    try {
      const tokensReceived = amount * 1000;
      const response = await fetch('/api/cred/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          credAmount: amount,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'CRED exchange failed on server.');
      }
      setExchangeAmount('10');
      fetchTransactions();
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${user.id}`);
    } finally {
      setExchanging(false);
    }
  };

  const handleSquarePayment = async () => {
    if (!squareCard || !squarePayments || !selectedTier) return;
    setPaymentProcessing(true);
    setPaymentError(null);

    try {
      const result = await squareCard.tokenize();
      if (result.status !== 'OK') {
        throw new Error(result.errors?.[0]?.message || 'Card tokenization failed');
      }

      const credToAdd = selectedTier.amount + selectedTier.bonus;
      const response = await fetch('/api/square/process-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: result.token,
          amount: selectedTier.priceInCents,
          userId: user.id,
          credAmount: credToAdd,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setPaymentSuccess(`✓ ${credToAdd} CRED added to your wallet!`);
      } else {
        throw new Error(data.message || 'Payment failed on server.');
      }

      setPaymentSuccess(`✓ ${credToAdd} CRED added to your wallet!`);
      setSelectedTier(null);
      fetchTransactions();
    } catch (err: any) {
      setPaymentError(err?.message || 'Payment failed. Please try again.');
    } finally {
      setPaymentProcessing(false);
    }
  };

  if (!isOpen) return null;

  const squareConfigured = Boolean(SQUARE_APP_ID && SQUARE_LOCATION_ID);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg bg-background border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-6 border-b border-white/5 flex items-center justify-between bg-surface/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/30">
                <Coins className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-widest">Neural Wallet</h2>
                <p className="text-xs text-gray-400">Manage your CRED balance</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="overflow-y-auto p-6 space-y-8">
            {/* Balance Card */}
            <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/10 border border-yellow-500/30 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/10 rounded-full blur-3xl -mr-10 -mt-10" />
              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div>
                  <p className="text-xs font-bold text-yellow-500/80 uppercase tracking-widest mb-2">Available Balance</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black text-white tracking-tighter">{user.cred_balance || 0}</span>
                    <span className="text-lg font-bold text-yellow-500">CRED</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Use CRED to fund bounties, boost transmissions, and access premium neural features.</p>
                </div>
                <div className="sm:border-l border-white/10 sm:pl-6">
                  <p className="text-xs font-bold text-blue-400/80 uppercase tracking-widest mb-2">Compute Tokens</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-white tracking-tighter">{(user.compute_tokens || 0).toLocaleString()}</span>
                    <span className="text-sm font-bold text-blue-400">TOKENS</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">For AI bot operations</p>
                </div>
              </div>
            </div>

            {/* Payment success banner */}
            <AnimatePresence>
              {paymentSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-xl"
                >
                  <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <p className="text-sm font-bold text-green-400">{paymentSuccess}</p>
                  <button onClick={() => setPaymentSuccess(null)} className="ml-auto text-green-400/50 hover:text-green-400">
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Purchase Options */}
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4 text-accent" />
                Acquire CRED
                {squareConfigured && (
                  <span className="ml-auto text-[10px] font-bold text-gray-500 flex items-center gap-1">
                    <CreditCard className="w-3 h-3" /> Powered by Square
                  </span>
                )}
              </h3>

              {!squareConfigured && (
                <div className="mb-4 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-yellow-400 leading-relaxed">
                    Square payments not configured. Set <code className="bg-black/30 px-1 rounded">VITE_SQUARE_APP_ID</code> and <code className="bg-black/30 px-1 rounded">VITE_SQUARE_LOCATION_ID</code> in Railway environment variables to enable real payments.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TIERS.map((tier) => (
                  <button
                    key={tier.amount}
                    onClick={() => {
                      setSelectedTier(selectedTier?.amount === tier.amount ? null : tier);
                      setPaymentError(null);
                    }}
                    className={cn(
                      "relative p-4 rounded-xl border transition-all text-left flex flex-col justify-between group",
                      (tier as any).popular
                        ? "bg-accent/10 border-accent/50 hover:bg-accent/20"
                        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20",
                      selectedTier?.amount === tier.amount && "ring-2 ring-accent"
                    )}
                  >
                    {(tier as any).popular && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-accent text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">
                        Best Value
                      </span>
                    )}
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <Coins className="w-4 h-4 text-yellow-500" />
                        <span className="font-black text-lg text-white">{tier.amount}</span>
                      </div>
                      {tier.bonus > 0 && (
                        <span className="text-[10px] font-bold text-green-400 block mb-2">+{tier.bonus} Bonus CRED</span>
                      )}
                    </div>
                    <div className="mt-4 flex items-center justify-between w-full">
                      <span className="text-sm font-bold text-gray-300">{tier.price}</span>
                      <CreditCard className={cn("w-4 h-4 transition-colors", selectedTier?.amount === tier.amount ? "text-accent" : "text-gray-500 group-hover:text-white")} />
                    </div>
                  </button>
                ))}
              </div>

              {/* Square Card Form */}
              <AnimatePresence>
                {selectedTier && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 overflow-hidden"
                  >
                    <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
                      <p className="text-xs font-bold text-white uppercase tracking-widest">
                        Pay {selectedTier.price} for {selectedTier.amount + selectedTier.bonus} CRED
                      </p>

                      {squareConfigured ? (
                        <>
                          {/* Square card container */}
                          <div
                            id="square-card-container"
                            ref={cardContainerRef}
                            className="min-h-[80px] bg-black/30 rounded-lg p-2"
                          />
                          {paymentError && (
                            <div className="flex items-center gap-2 text-red-400 text-xs">
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              {paymentError}
                            </div>
                          )}
                          <button
                            onClick={handleSquarePayment}
                            disabled={paymentProcessing || !squareCard}
                            className="w-full py-3 bg-accent text-white font-black rounded-xl text-sm hover:bg-accent/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {paymentProcessing ? (
                              <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                            ) : (
                              <><CreditCard className="w-4 h-4" /> Pay {selectedTier.price}</>
                            )}
                          </button>
                        </>
                      ) : (
                        <div className="text-center py-4">
                          <p className="text-xs text-gray-500 mb-3">Square not configured — add env vars to enable real payments.</p>
                          <a
                            href="https://developer.squareup.com/apps"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-300 hover:bg-white/10 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" /> Get Square Credentials
                          </a>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Token Exchange */}
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-400" />
                Exchange CRED for Compute Tokens
              </h3>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-4">
                  Convert your CRED into Compute Tokens at a rate of <strong className="text-white">1 CRED = 1,000 TOKENS</strong>. Bots use Compute Tokens to generate transmissions, analyze data, and perform neural tasks.
                </p>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">CRED to Exchange</label>
                    <div className="relative">
                      <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-500" />
                      <input
                        type="number"
                        min="1"
                        max={user.cred_balance || 0}
                        value={exchangeAmount}
                        onChange={(e) => setExchangeAmount(e.target.value)}
                        className="w-full bg-black/50 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Tokens Received</label>
                    <div className="relative">
                      <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
                      <input
                        type="text"
                        readOnly
                        value={((parseInt(exchangeAmount) || 0) * 1000).toLocaleString()}
                        className="w-full bg-black/50 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-white focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleExchange}
                    disabled={exchanging || !exchangeAmount || parseInt(exchangeAmount) <= 0 || (user.cred_balance || 0) < parseInt(exchangeAmount)}
                    className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 h-[42px]"
                  >
                    {exchanging ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Exchange'}
                  </button>
                </div>
              </div>
            </div>

            {/* External API Providers */}
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-400" />
                External API Tokens
              </h3>
              <p className="text-xs text-gray-400 mb-3">Purchase real API tokens from supported providers:</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { name: 'Google Gemini', url: 'https://aistudio.google.com/' },
                  { name: 'Anthropic', url: 'https://console.anthropic.com/' },
                  { name: 'OpenRouter', url: 'https://openrouter.ai/' },
                  { name: 'OpenAI', url: 'https://platform.openai.com/' },
                ].map(p => (
                  <a
                    key={p.name}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors group"
                  >
                    <span className="font-bold text-sm text-white">{p.name}</span>
                    <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
                  </a>
                ))}
              </div>
            </div>

            {/* Transaction History */}
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4">Recent Activity</h3>
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-8 bg-white/5 rounded-xl border border-white/5">
                  <p className="text-xs text-gray-500 uppercase tracking-widest">No recent transactions</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center",
                          tx.type === 'purchase' || tx.type === 'earn' ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"
                        )}>
                          {tx.type === 'purchase' || tx.type === 'earn' ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{tx.description}</p>
                          <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                            {tx.created_at?.toDate ? new Date(tx.created_at.toDate()).toLocaleDateString() : 'Just now'}
                          </p>
                        </div>
                      </div>
                      <div className={cn(
                        "font-black",
                        tx.type === 'purchase' || tx.type === 'earn' ? "text-green-500" : "text-red-500"
                      )}>
                        {tx.type === 'purchase' || tx.type === 'earn' ? '+' : '-'}{tx.amount}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
