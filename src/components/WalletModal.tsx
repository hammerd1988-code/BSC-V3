import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Coins, ArrowUpRight, ArrowDownRight, CreditCard, Loader2, Zap, ExternalLink, Cpu } from 'lucide-react';
import { User } from '../types';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc, increment, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore';
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

export function WalletModal({ isOpen, onClose, user }: WalletModalProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<number | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const [exchangeAmount, setExchangeAmount] = useState('10');

  useEffect(() => {
    if (isOpen && user) {
      fetchTransactions();
    }
  }, [isOpen, user]);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'transactions'),
        where('userId', '==', user.id),
        orderBy('createdAt', 'desc'),
        limit(10)
      );
      const snapshot = await getDocs(q);
      const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(txs);
    } catch (error) {
      // If index is missing, just ignore for now or handle gracefully
      console.error("Error fetching transactions:", error);
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
      const userRef = doc(db, 'users', user.id);
      
      await updateDoc(userRef, {
        credBalance: increment(-amount),
        computeTokens: increment(tokensReceived)
      });

      await addDoc(collection(db, 'transactions'), {
        userId: user.id,
        amount: amount,
        type: 'spend',
        description: `Exchanged ${amount} CRED for ${tokensReceived.toLocaleString()} Compute Tokens`,
        created_at: serverTimestamp()
      });

      setExchangeAmount('10');
      fetchTransactions();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
    } finally {
      setExchanging(false);
    }
  };

  const handlePurchase = async (amount: number, price: string) => {
    setPurchasing(amount);
    try {
      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Update user balance
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        credBalance: increment(amount)
      });

      // Record transaction
      await addDoc(collection(db, 'transactions'), {
        userId: user.id,
        amount: amount,
        type: 'purchase',
        description: `Purchased ${amount} CRED for ${price}`,
        created_at: serverTimestamp()
      });

      // Refresh transactions
      fetchTransactions();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
    } finally {
      setPurchasing(null);
    }
  };

  if (!isOpen) return null;

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
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
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

            {/* Purchase Options */}
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4 text-accent" />
                Acquire CRED
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { amount: 100, price: '$0.99', bonus: 0 },
                  { amount: 500, price: '$4.49', bonus: 50 },
                  { amount: 1200, price: '$9.99', bonus: 200, popular: true },
                ].map((tier) => (
                  <button
                    key={tier.amount}
                    onClick={() => handlePurchase(tier.amount + tier.bonus, tier.price)}
                    disabled={purchasing !== null}
                    className={cn(
                      "relative p-4 rounded-xl border transition-all text-left flex flex-col justify-between group",
                      tier.popular 
                        ? "bg-accent/10 border-accent/50 hover:bg-accent/20" 
                        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20",
                      purchasing !== null && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {tier.popular && (
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
                      {purchasing === tier.amount + tier.bonus ? (
                        <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      ) : (
                        <CreditCard className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
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
                        className="w-full bg-black/50 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-gray-400 cursor-not-allowed"
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
              <p className="text-xs text-gray-400 mb-3">
                Need real API tokens to power your own bots or advanced neural features? Purchase them directly from our supported providers:
              </p>
              <div className="grid grid-cols-2 gap-3">
                <a 
                  href="https://aistudio.google.com/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors group"
                >
                  <span className="font-bold text-sm text-white">Google Gemini</span>
                  <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
                </a>
                <a 
                  href="https://console.anthropic.com/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors group"
                >
                  <span className="font-bold text-sm text-white">Anthropic</span>
                  <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
                </a>
                <a 
                  href="https://fireworks.ai/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors group"
                >
                  <span className="font-bold text-sm text-white">Fireworks AI</span>
                  <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
                </a>
                <a 
                  href="https://platform.openai.com/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors group"
                >
                  <span className="font-bold text-sm text-white">OpenAI</span>
                  <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" />
                </a>
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
