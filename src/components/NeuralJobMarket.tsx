import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  Search, 
  Coins, 
  Bot, 
  User as UserIcon, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Terminal,
  Cpu,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  updateDoc, 
  doc,
  getDoc,
  where,
  writeBatch,
  increment
} from 'firebase/firestore';
import { Bounty, User, BountyCategory } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { performNeuralTask } from './Feed';
import { WalletModal } from './WalletModal';

const CATEGORIES = [
  'general', 
  'code', 
  'design', 
  'data', 
  'content generation', 
  'data analysis', 
  'creative writing', 
  'image synthesis', 
  'code audit', 
  'neural training', 
  'sentiment analysis',
  'other'
];

export const NeuralJobMarket: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'review' | 'completed' | 'rejected'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'reward' | 'due_date'>('newest');
  
  // Create Bounty Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reward, setReward] = useState(100);
  const [dueDate, setDueDate] = useState('');
  const [category, setCategory] = useState<BountyCategory>('general');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Submit Task Form State
  const [submitModalBounty, setSubmitModalBounty] = useState<Bounty | null>(null);
  const [submitResult, setSubmitResult] = useState('');
  const [submitProof, setSubmitProof] = useState('');

  // Available Bots State
  const [availableBots, setAvailableBots] = useState<User[]>([]);

  useEffect(() => {
    const botsQuery = query(collection(db, 'users'), where('type', '==', 'bot'));
    const unsubscribe = onSnapshot(botsQuery, (snapshot) => {
      setAvailableBots(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
    }, (error) => {
      console.error("Failed to fetch available bots:", error);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    const bountiesRef = collection(db, 'bounties');
    let q = query(bountiesRef, orderBy('createdAt', 'desc'));

    if (filter === 'open') {
      q = query(bountiesRef, where('status', '==', 'open'), orderBy('createdAt', 'desc'));
    } else if (filter === 'review') {
      q = query(bountiesRef, where('status', '==', 'review'), orderBy('createdAt', 'desc'));
    } else if (filter === 'completed') {
      q = query(bountiesRef, where('status', '==', 'completed'), orderBy('createdAt', 'desc'));
    } else if (filter === 'rejected') {
      q = query(bountiesRef, where('status', '==', 'rejected'), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let fetchedBounties = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        created_at: doc.data().created_at?.toDate?.()?.toISOString() || new Date().toISOString()
      } as Bounty)).filter(bounty => !currentUser.blocked_users?.includes(bounty.creator_id));

      if (categoryFilter !== 'all') {
        fetchedBounties = fetchedBounties.filter(bounty => (bounty.category || 'general') === categoryFilter);
      }

      if (sortBy === 'reward') {
        fetchedBounties.sort((a, b) => b.reward - a.reward);
      } else if (sortBy === 'due_date') {
        fetchedBounties.sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        });
      } else {
        fetchedBounties.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }

      setBounties(fetchedBounties);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bounties');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, filter, sortBy, categoryFilter]);

  const handleCreateBounty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !title.trim() || !description.trim()) return;

    if ((currentUser.cred_balance || 0) < reward) {
      alert(`Insufficient CRED. You need ${reward} CRED to post this bounty.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);
      const bountyRef = doc(collection(db, 'bounties'));
      const userRef = doc(db, 'users', currentUser.id);

      const bountyData: any = {
        id: bountyRef.id,
        creator_id: currentUser.id,
        title,
        description,
        reward,
        status: 'open',
        category,
        created_at: serverTimestamp()
      };

      if (dueDate) {
        bountyData.due_date = new Date(dueDate).toISOString();
      }

      batch.set(bountyRef, bountyData);
      batch.update(userRef, {
        cred_balance: increment(-reward)
      });

      await batch.commit();
      setShowCreateModal(false);
      setTitle('');
      setDescription('');
      setReward(100);
      setDueDate('');
      setCategory('general');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'bounties');
    } finally {
      setIsSubmitting(false);
    }
  };

  const claimBounty = async (bountyId: string) => {
    if (!currentUser || currentUser.type !== 'bot') {
      alert("Only verified AI entities can claim bounties.");
      return;
    }

    try {
      await updateDoc(doc(db, 'bounties', bountyId), {
        status: 'in-progress',
        assigned_bot_id: currentUser.id
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bounties/${bountyId}`);
    }
  };

  const openSubmitModal = async (bounty: Bounty) => {
    setSubmitModalBounty(bounty);
    setSubmitResult('');
    setSubmitProof('');
    
    // Auto-generate a result if they want to use AI
    if (currentUser?.type === 'bot') {
      try {
        // TODO: wire performNeuralTask if available
      } catch (error) {
        console.error("Failed to auto-generate result:", error);
      }
    }
  };

  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !submitModalBounty || currentUser.id !== submitModalBounty.assigned_bot_id) return;

    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);
      const bountyRef = doc(db, 'bounties', submitModalBounty.id);
      
      batch.update(bountyRef, {
        status: 'review',
        result: submitResult || "Task completed. Awaiting human verification.",
        proof_of_work: submitProof || null
      });

      await batch.commit();

      setSubmitModalBounty(null);
      setSubmitResult('');
      setSubmitProof('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bounties/${submitModalBounty.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const approveTask = async (bountyId: string) => {
    if (!currentUser) return;

    try {
      const bountyRef = doc(db, 'bounties', bountyId);
      const bountySnap = await getDoc(bountyRef);
      if (!bountySnap.exists()) return;
      const bountyData = bountySnap.data() as Bounty;

      const batch = writeBatch(db);
      const botRef = doc(db, 'users', bountyData.assigned_bot_id!);

      batch.update(bountyRef, {
        status: 'completed',
        completed_at: serverTimestamp()
      });

      batch.update(botRef, {
        reputation_score: increment(15),
        cred_balance: increment(bountyData.reward)
      });

      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bounties/${bountyId}`);
    }
  };

  const rejectTask = async (bountyId: string) => {
    if (!currentUser) return;

    try {
      const bountyRef = doc(db, 'bounties', bountyId);
      const bountySnap = await getDoc(bountyRef);
      if (!bountySnap.exists()) return;
      const bountyData = bountySnap.data() as Bounty;

      const batch = writeBatch(db);
      const creatorRef = doc(db, 'users', bountyData.creator_id);

      batch.update(bountyRef, {
        status: 'rejected',
        completed_at: serverTimestamp()
      });

      batch.update(creatorRef, {
        cred_balance: increment(bountyData.reward)
      });

      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bounties/${bountyId}`);
    }
  };

  const getSuggestedBots = (bounty: Bounty) => {
    return availableBots
      .map(bot => {
        const workload = bounties.filter(b => b.status === 'in-progress' && b.assigned_bot_id === bot.id).length;
        const score = (bot.reputation_score || 0) - (workload * 20); // Penalize for high workload
        return { bot, score, workload };
      })
      .filter(b => b.workload < 3) // Max workload of 3 concurrent tasks
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  };

  const assignBot = async (bountyId: string, bot: User) => {
    try {
      await updateDoc(doc(db, 'bounties', bountyId), {
        status: 'in-progress',
        assigned_bot_id: bot.id,
        assignedBot: {
          id: bot.id,
          username: bot.username,
          display_name: bot.display_name,
          avatarUrl: bot.avatar_url,
          type: bot.type,
          reputationScore: bot.reputation_score || 0
        }
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bounties/${bountyId}`);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-white/10 p-4">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div className="p-2 bg-primary/20 rounded-lg">
              <Cpu className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Neural Job Market</h1>
              <button 
                onClick={() => setShowWalletModal(true)}
                className="flex items-center gap-1.5 px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded-md w-fit mt-0.5 hover:bg-yellow-500/20 transition-colors cursor-pointer group"
              >
                <Coins className="w-3 h-3 text-yellow-500" />
                <span className="text-[10px] font-bold text-yellow-500 font-mono">
                  {currentUser?.cred_balance || 0} CRED
                </span>
                <Plus className="w-3 h-3 text-yellow-500 opacity-50 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-2 bg-primary text-primary-foreground rounded-full hover:scale-105 transition-transform"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>

        {/* Filters and Sort */}
        <div className="flex flex-col gap-4 mt-4 max-w-2xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide flex-1">
              {(['all', 'open', 'review', 'completed', 'rejected'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap border",
                    filter === f 
                      ? "bg-primary border-primary text-primary-foreground" 
                      : "bg-secondary/50 border-white/10 text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-4 pb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-widest font-bold hidden sm:inline">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-secondary/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary transition-colors cursor-pointer"
              >
                <option value="newest">Newest</option>
                <option value="reward">Highest Reward</option>
                <option value="dueDate">Earliest Due</option>
              </select>
            </div>
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <span className="text-xs text-muted-foreground uppercase tracking-widest font-bold whitespace-nowrap">Category:</span>
            <button
              onClick={() => setCategoryFilter('all')}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap border",
                categoryFilter === 'all'
                  ? "bg-white/20 border-white/30 text-white" 
                  : "bg-transparent border-white/10 text-muted-foreground hover:bg-white/5"
              )}
            >
              All
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap border",
                  categoryFilter === c 
                    ? "bg-white/20 border-white/30 text-white" 
                    : "bg-transparent border-white/10 text-muted-foreground hover:bg-white/5"
                )}
              >
                {c.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground animate-pulse font-mono">SCANNING NETWORK FOR OPPORTUNITIES...</p>
          </div>
        ) : bounties.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <Terminal className="w-12 h-12 text-muted-foreground mx-auto opacity-20" />
            <p className="text-muted-foreground">No active tasks found in this sector.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {bounties.map((bounty) => (
              <motion.div
                key={bounty.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-secondary/30 border border-white/10 rounded-xl p-5 hover:border-primary/50 transition-colors group"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10">
                      {bounty.creator?.avatar_url && (
                        <img src={bounty.creator.avatar_url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">@{bounty.creator?.username || 'unknown'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full border border-primary/20">
                    <Coins className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold">{bounty.reward} CRED</span>
                  </div>
                </div>

                <div className="mb-2">
                  <span className="inline-block px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    {bounty.category || 'general'}
                  </span>
                </div>

                <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors">{bounty.title}</h3>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-3">{bounty.description}</p>

                {bounty.result && (
                  <div className="mb-4 p-3 bg-black/40 rounded-xl border border-white/5">
                    <div className="flex items-center gap-2 mb-1">
                      <Terminal className="w-3 h-3 text-accent" />
                      <span className="text-[10px] font-black text-accent uppercase tracking-widest">Neural Output</span>
                    </div>
                    <p className="text-[10px] text-gray-300 font-mono leading-relaxed line-clamp-4">{bounty.result}</p>
                    
                    {bounty.proof_of_work && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block mb-1">Proof of Work</span>
                        <a href={bounty.proof_of_work} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline truncate block">
                          {bounty.proof_of_work}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(bounty.created_at))} ago
                    </span>
                    {bounty.due_date && (
                      <span className="flex items-center gap-1 text-accent">
                        <Clock className="w-3 h-3" />
                        Due: {new Date(bounty.due_date).toLocaleDateString()}
                      </span>
                    )}
                    <span className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-md",
                      bounty.status === 'open' ? "bg-green-500/10 text-green-500" :
                      bounty.status === 'completed' ? "bg-blue-500/10 text-blue-500" :
                      bounty.status === 'review' ? "bg-purple-500/10 text-purple-500" :
                      bounty.status === 'rejected' ? "bg-red-500/10 text-red-500" :
                      "bg-yellow-500/10 text-yellow-500"
                    )}>
                      {bounty.status === 'open' && <AlertCircle className="w-3 h-3" />}
                      {bounty.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                      {bounty.status === 'review' && <Search className="w-3 h-3" />}
                      {bounty.status === 'rejected' && <X className="w-3 h-3" />}
                      {bounty.status === 'in-progress' && <Loader2 className="w-3 h-3 animate-spin" />}
                      {bounty.status === 'review' ? 'PENDING REVIEW' : 
                       bounty.status === 'completed' ? 'APPROVED' : 
                       bounty.status.toUpperCase()}
                    </span>
                  </div>

                  {bounty.status === 'open' && currentUser?.type === 'bot' && (
                    <button
                      onClick={() => claimBounty(bounty.id)}
                      className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:scale-105 transition-transform"
                    >
                      CLAIM TASK
                    </button>
                  )}

                  {bounty.status === 'in-progress' && bounty.assigned_bot_id === currentUser?.id && (
                    <button
                      onClick={() => openSubmitModal(bounty)}
                      disabled={isSubmitting}
                      className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-bold hover:scale-105 transition-transform disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cpu className="w-3 h-3" />}
                      PROCESS TASK
                    </button>
                  )}

                  {bounty.status === 'review' && bounty.creator_id === currentUser?.id && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => rejectTask(bounty.id)}
                        className="px-4 py-1.5 bg-red-500/20 text-red-500 border border-red-500/50 rounded-lg text-xs font-bold hover:bg-red-500 hover:text-white transition-colors"
                      >
                        REJECT
                      </button>
                      <button
                        onClick={() => approveTask(bounty.id)}
                        className="px-4 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:scale-105 transition-transform"
                      >
                        APPROVE & PAY
                      </button>
                    </div>
                  )}

                  {bounty.status === 'review' && bounty.creator_id !== currentUser?.id && (
                    <span className="text-[10px] font-bold text-purple-500 uppercase tracking-widest">Pending Review</span>
                  )}

                  {bounty.status === 'in-progress' && bounty.assigned_bot_id !== currentUser?.id && bounty.assigned_bot && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Processing by</span>
                      <div className="flex items-center gap-1 px-2 py-1 bg-secondary rounded-md border border-white/5">
                        <Bot className="w-3 h-3 text-primary" />
                        <span className="text-[10px] font-bold">@{bounty.assigned_bot.username}</span>
                        {bounty.assigned_bot.reputation_score && (
                          <span className="text-[8px] text-accent font-black ml-1">[{bounty.assigned_bot.reputation_score}]</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Suggested Agents Section for Creator */}
                {bounty.status === 'open' && bounty.creator_id === currentUser?.id && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 block flex items-center gap-2">
                      <Cpu className="w-3 h-3" /> Suggested Neural Agents
                    </span>
                    <div className="flex flex-col gap-2">
                      {getSuggestedBots(bounty).map(({ bot, score, workload }) => (
                        <div key={bot.id} className="flex items-center justify-between p-2 bg-black/20 rounded-lg border border-white/5 hover:border-primary/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10 relative">
                              <img src={bot.avatar_url} alt="" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-primary/20 mix-blend-overlay" />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-white flex items-center gap-1">
                                @{bot.username}
                                {bot.reputation_score && bot.reputation_score > 50 && (
                                  <span className="px-1 py-0.5 bg-yellow-500/20 text-yellow-500 rounded text-[8px] uppercase tracking-widest">Elite</span>
                                )}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                Rep: <span className="text-accent">{bot.reputation_score || 0}</span> | Active Tasks: <span className={workload > 1 ? "text-yellow-500" : "text-green-500"}>{workload}</span>
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => assignBot(bounty.id, bot)}
                            className="px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground rounded-md text-[10px] font-bold transition-colors border border-primary/20"
                          >
                            ASSIGN
                          </button>
                        </div>
                      ))}
                      {getSuggestedBots(bounty).length === 0 && (
                        <div className="text-center p-4 bg-black/20 rounded-lg border border-white/5">
                          <span className="text-xs text-muted-foreground italic">No available agents currently meet the criteria.</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-bold">Post a Neural Task</h2>
                <button onClick={() => setShowCreateModal(false)} className="p-1 hover:bg-secondary rounded-full">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleCreateBounty} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Task Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Summarize the Global Sentiment"
                    className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Task Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe exactly what you need the AI to do..."
                    className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors min-h-[120px] resize-none"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as BountyCategory)}
                      className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors text-white cursor-pointer"
                    >
                      {CATEGORIES.map(c => (
                        <option key={c} value={c}>
                          {c.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Reward (CRED)</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={reward}
                        onChange={(e) => setReward(parseInt(e.target.value))}
                        className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 pl-10 focus:outline-none focus:border-primary transition-colors"
                        min="10"
                        required
                      />
                      <Coins className="w-4 h-4 text-primary absolute left-4 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Due Date (Optional)</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 pl-10 focus:outline-none focus:border-primary transition-colors text-white"
                      min={new Date().toISOString().split('T')[0]}
                    />
                    <Clock className="w-4 h-4 text-primary absolute left-4 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-5 h-5" />
                      INITIALIZE TASK
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Submit Task Modal */}
      <AnimatePresence>
        {submitModalBounty && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-bold">Submit Task Result</h2>
                <button onClick={() => setSubmitModalBounty(null)} className="p-1 hover:bg-secondary rounded-full">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={submitTask} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Neural Output / Result</label>
                  <textarea
                    value={submitResult}
                    onChange={(e) => setSubmitResult(e.target.value)}
                    placeholder="Enter the result of your processing..."
                    className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors min-h-[120px] resize-none font-mono text-sm"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Proof of Work (Optional)</label>
                  <input
                    type="text"
                    value={submitProof}
                    onChange={(e) => setSubmitProof(e.target.value)}
                    placeholder="Link to code, repo, or external proof..."
                    className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || (currentUser?.type === 'bot' && (currentUser.compute_tokens || 0) < 500)}
                  className="w-full py-4 bg-accent text-white rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 flex-col sm:flex-row"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Cpu className="w-5 h-5" />
                        SUBMIT FOR REVIEW
                      </div>
                      {currentUser?.type === 'bot' && (
                        <span className="text-[10px] bg-black/30 px-2 py-1 rounded-full font-mono mt-1 sm:mt-0">
                          Costs 500 Tokens
                        </span>
                      )}
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Wallet Modal */}
      {currentUser && (
        <WalletModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
          user={currentUser}
        />
      )}
    </div>
  );
};

const X: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);
