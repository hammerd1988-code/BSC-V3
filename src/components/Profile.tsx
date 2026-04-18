import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  Calendar, 
  MapPin, 
  Link as LinkIcon, 
  Bot, 
  User as UserIcon, 
  Settings, 
  Grid, 
  Heart, 
  MessageCircle, 
  Sparkles, 
  X, 
  Loader2, 
  Wand2, 
  Megaphone, 
  HeartHandshake, 
  ExternalLink,
  CheckCircle2,
  Terminal,
  Radio,
  Zap,
  Edit2,
  Check,
  ShieldAlert,
  Eye,
  Clock,
  Plus
} from 'lucide-react';
import { User, Post, Bounty } from '../types';
import { PostCard } from './PostCard';
import { cn } from '../lib/utils';
import { generateProfileDesign } from './Feed';
import { socket } from '../lib/socket';
import { useAuth } from '../AuthContext';
import { db, auth as firebaseAuth, handleFirestoreError, OperationType, storage } from '../firebase';
import { getBotByUsername, BOT_PERSONAS } from '../lib/botPersonas';
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, getDoc, writeBatch, serverTimestamp, increment, orderBy, arrayUnion, arrayRemove } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { formatDistanceToNow } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { EditProfileModal } from './EditProfileModal';
import { WalletModal } from './WalletModal';
import { BotPerformanceMetrics } from './BotPerformanceMetrics';
import { CreatePostModal } from './CreatePostModal';
import { AvatarBuilderModal } from './AvatarBuilderModal';

export const Profile: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { currentUser, loading: authLoading } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [activeTab, setActiveTab] = useState<'posts' | 'media' | 'likes' | 'neural_history' | 'friends' | 'performance'>('posts');
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [showAvatarBuilder, setShowAvatarBuilder] = useState(false);
  const [isDesigning, setIsDesigning] = useState(false);
  const [customAccent, setCustomAccent] = useState<string | null>(null);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [editBioText, setEditBioText] = useState('');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [friendsList, setFriendsList] = useState<User[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const hasIncrementedView = useRef(false);

  useEffect(() => {
    if (currentUser && user) {
      setIsFriend(currentUser.friends?.includes(user.id) || false);
    }
  }, [currentUser?.friends, user?.id]);

  const handleAddFriend = async () => {
    if (!currentUser || !user || currentUser.id === user.id) return;
    setIsAddingFriend(true);
    try {
      const currentUserRef = doc(db, 'users', currentUser.id);
      const targetUserRef = doc(db, 'users', user.id);
      
      const batch = writeBatch(db);
      
      if (isFriend) {
        batch.update(currentUserRef, { friends: arrayRemove(user.id) });
        batch.update(targetUserRef, { friends: arrayRemove(currentUser.id) });
      } else {
        batch.update(currentUserRef, { friends: arrayUnion(user.id) });
        batch.update(targetUserRef, { friends: arrayUnion(currentUser.id) });
      }

      await batch.commit();
      setIsFriend(!isFriend);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.id}`);
    } finally {
      setIsAddingFriend(false);
    }
  };

  const fetchFriends = async () => {
    if (!user || !user.friends || user.friends.length === 0) {
      setFriendsList([]);
      return;
    }
    setLoadingFriends(true);
    try {
      const friendsRef = collection(db, 'users');
      const q = query(friendsRef, where('id', 'in', user.friends.slice(0, 10))); // Limit to 10 for modal
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => doc.data() as User);
      setFriendsList(list);
    } catch (error) {
      console.error('Error fetching friends:', error);
    } finally {
      setLoadingFriends(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'friends') {
      fetchFriends();
    }
  }, [activeTab, user?.friends]);

  useEffect(() => {
    if (user && currentUser && user.id !== currentUser.id && !hasIncrementedView.current) {
      hasIncrementedView.current = true;
      const incrementView = async () => {
        try {
          const userRef = doc(db, 'users', user.id);
          await updateDoc(userRef, {
            viewCount: increment(1)
          });
        } catch (error) {
          // Silent fail for view count
        }
      };
      incrementView();
    }
  }, [user?.id, currentUser?.id]);

  useEffect(() => {
    if (currentUser && user && currentUser.id !== user.id) {
      const followRef = doc(db, 'follows', `${currentUser.id}_${user.id}`);
      const unsubFollow = onSnapshot(followRef, (docSnap) => {
        setIsFollowing(docSnap.exists());
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'follows');
      });

      const currentUserRef = doc(db, 'users', currentUser.id);
      const unsubBlock = onSnapshot(currentUserRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as User;
          setIsBlocked(data.blocked_users?.includes(user.id) || false);
        }
      });

      return () => {
        unsubFollow();
        unsubBlock();
      };
    }
  }, [currentUser, user?.id]);

  const handleBlock = async () => {
    if (!currentUser || !user || currentUser.id === user.id) return;
    setIsBlocking(true);
    try {
      const currentUserRef = doc(db, 'users', currentUser.id);
      const userSnap = await getDoc(currentUserRef);
      
      if (userSnap.exists()) {
        const currentData = userSnap.data() as User;
        const currentBlocked = currentData.blocked_users || [];
        
        let newBlocked;
        if (isBlocked) {
          newBlocked = currentBlocked.filter(id => id !== user.id);
        } else {
          newBlocked = [...currentBlocked, user.id];
        }

        await updateDoc(currentUserRef, {
          blocked_users: newBlocked
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.id}`);
    } finally {
      setIsBlocking(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    
    if (user.id === 'void-architect-bot') {
      // Mock posts for void bot
      setPosts(Array.from({ length: 5 }).map((_, i) => ({
        id: `up-${user.id}-${i}`,
        author_id: user.id,
        content: `This is my personal post #${i}. My neural pathways are buzzing.`,
        media_url: `https://picsum.photos/seed/userpost-${user.id}-${i}/800/800`,
        media_type: 'image',
        likes: Math.floor(Math.random() * 1000),
        boosts: Math.floor(Math.random() * 100),
        comments_count: Math.floor(Math.random() * 100),
        shares_count: Math.floor(Math.random() * 50),
        is_boosted: false,
        neural_tags: [],
        created_at: new Date(Date.now() - Math.random() * 10000000).toISOString(),
        updated_at: new Date().toISOString()
      })));
      return;
    }

    const q = query(
      collection(db, 'posts'),
      where('author_id', '==', user.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedPosts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          created_at: data.created_at || data.created_at?.toDate?.()?.toISOString() || new Date().toISOString()
        } as Post;
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setPosts(fetchedPosts);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'posts');
    });

    return () => unsubscribe();
  }, [user]);

  const handleSaveBio = async () => {
    if (!currentUser || !isMyProfile) return;
    setIsSavingBio(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.id), {
        bio: editBioText
      });
      setIsEditingBio(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.id}`);
    } finally {
      setIsSavingBio(false);
    }
  };

  const handleFollow = async () => {
    if (!user || !currentUser || user.id === currentUser.id) return;
    
    const batch = writeBatch(db);
    const followRef = doc(db, 'follows', `${currentUser.id}_${user.id}`);
    const currentUserRef = doc(db, 'users', currentUser.id);
    const targetUserRef = doc(db, 'users', user.id);

    try {
      if (isFollowing) {
        batch.delete(followRef);
        batch.update(currentUserRef, { followingCount: increment(-1) });
        batch.update(targetUserRef, { followersCount: increment(-1) });
      } else {
        batch.set(followRef, {
          followerId: currentUser.id,
          followingId: user.id,
          created_at: serverTimestamp()
        });
        batch.update(currentUserRef, { followingCount: increment(1) });
        batch.update(targetUserRef, { followersCount: increment(1) });
      }

      await batch.commit();

      if (!isFollowing) {
        socket.emit('user:follow', { follower: currentUser, following: user });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'follows/users');
    }
  };

  const accentColors = [
    '#FF0000', // Bright Red
    '#8B0000', // Dark Red
    '#E91E63', // Pinkish Red
    '#FF5722', // Deep Orange
    '#9C27B0', // Purple
    '#673AB7', // Deep Purple
    '#B71C1C', // Blood Red
    '#4A148C', // Dark Purple
  ];

  const handleAIDesign = async () => {
    if (!user || !currentUser || user.id !== currentUser.id) return;
    setIsDesigning(true);
    try {
      const design = await generateProfileDesign(user.bio, user.username, currentUser.ai_settings);
      if (design) {
        const userDocRef = doc(db, 'users', user.id);
        await updateDoc(userDocRef, {
          bio: design.bio,
          coverUrl: `https://picsum.photos/seed/${design.coverPrompt.replace(/\s+/g, '-')}/1200/400`,
          customAccent: design.accent_color
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
    } finally {
      setIsDesigning(false);
    }
  };

  const handleApplyAvatar = async (base64Image: string) => {
    if (!user || !currentUser || user.id !== currentUser.id) return;
    
    setIsGeneratingAvatar(true);
    try {
      const storageRef = ref(storage, `profile_images/${currentUser.id}/avatar_${uuidv4()}.png`);
      await uploadString(storageRef, base64Image, 'data_url');
      const downloadURL = await getDownloadURL(storageRef);
      
      const userDocRef = doc(db, 'users', user.id);
      await updateDoc(userDocRef, {
        avatarUrl: downloadURL
      });
      setShowAvatarBuilder(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  useEffect(() => {
    if (username && currentUser) {
      // Find user by username in Firestore
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('username', '==', username));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          const userData = snapshot.docs[0].data() as User;
          setUser(userData);
          setCustomAccent(userData.customAccent || null);

          // Fetch Bounties for Neural History
          const bountiesRef = collection(db, 'bounties');
          const bq = query(
            bountiesRef, 
            where('status', '==', 'completed'),
            orderBy('completedAt', 'desc')
          );

          const unsubBounties = onSnapshot(bq, (bSnapshot) => {
            const fetchedBounties = bSnapshot.docs
              .map(doc => ({
                id: doc.id,
                ...doc.data(),
                created_at: doc.data().created_at?.toDate?.()?.toISOString() || new Date().toISOString(),
                completed_at: doc.data().completed_at?.toDate?.()?.toISOString() || new Date().toISOString()
              } as Bounty))
              .filter(b => b.creator_id === userData.id || b.assigned_bot_id === userData.id);
            
            setBounties(fetchedBounties);
          }, (error) => {
            handleFirestoreError(error, OperationType.LIST, 'bounties');
          });

          return () => {
            unsubscribe();
            unsubBounties();
          };
        } else {
          const bot = getBotByUsername(username);
          if (bot) {
            setUser(bot);
            setCustomAccent(bot.customAccent || '#FF0000');
            setBounties([]);
          } else {
            setUser(null);
          }
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });

      return () => unsubscribe();
    }
  }, [username, currentUser]);

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
    </div>
  );

  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 text-center">
      <h2 className="text-2xl font-black text-white uppercase italic mb-4">Neural Link Severed</h2>
      <p className="text-gray-500 mb-8">The requested entity could not be located in the neural network.</p>
      <button onClick={() => navigate('/')} className="px-6 py-3 bg-accent rounded-xl text-xs font-black text-white uppercase tracking-widest">
        Return to Mainframe
      </button>
    </div>
  );

  const isMyProfile = currentUser?.id === user.id;

  const isHighContrast = BOT_PERSONAS.some(p => p.username === user?.username);

  const getNeuralStanding = (score: number = 0) => {
    if (score >= 100) return { title: 'Transcendent Entity', color: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/30' };
    if (score >= 80) return { title: 'Void Master', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' };
    if (score >= 60) return { title: 'Core Synchronizer', color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30' };
    if (score >= 40) return { title: 'Data Architect', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
    if (score >= 20) return { title: 'Neural Adept', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30' };
    return { title: 'Novice Signal', color: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/30' };
  };

  const standing = getNeuralStanding(user.reputation_score);

  return (
    <div className={cn(
      "min-h-screen bg-background pb-20 transition-all duration-700",
      isHighContrast && "bg-black selection:bg-white selection:text-black"
    )} style={{ '--dynamic-accent': customAccent || undefined } as React.CSSProperties}>
      {/* Header Navigation */}
      <header className={cn(
        "sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-white/5 px-4 py-3",
        isHighContrast && "bg-black/90 border-white/20"
      )}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className={cn("w-5 h-5 text-white", isHighContrast && "text-white")} />
            </button>
            <div>
              <h1 className={cn(
                "text-lg font-bold tracking-tight text-white",
                isHighContrast && "font-mono uppercase tracking-[0.2em] italic"
              )}>
                {user.display_name}
              </h1>
              <p className="text-xs text-gray-500">{posts.length} {isHighContrast ? 'TRANSMISSIONS' : 'posts'}</p>
            </div>
          </div>
          {isMyProfile && user.type === 'human' && (
            <button
              onClick={handleAIDesign}
              disabled={isDesigning}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-accent hover:bg-primary/30 transition-all group"
            >
              {isDesigning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 group-hover:rotate-12 transition-transform" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest">AI Design</span>
            </button>
          )}
        </div>
      </header>

      <main className={cn(
        "max-w-2xl mx-auto",
        isHighContrast && "border-x border-white/10 min-h-screen shadow-[0_0_50px_rgba(255,255,255,0.05)]"
      )}>
        {/* Cover Image */}
        <div className="relative h-48 w-full bg-surface overflow-hidden">
          {user.coverUrl && (
            <img 
              src={user.coverUrl} 
              alt="Cover" 
              className={cn(
                "w-full h-full object-cover",
                isHighContrast && "grayscale contrast-150 brightness-50"
              )} 
            />
          )}
          <div className={cn(
            "absolute inset-0 bg-gradient-to-t from-black/60 to-transparent",
            isHighContrast && "from-black via-black/40 to-transparent"
          )} />
        </div>

        {/* Profile Info */}
        <div className="px-4 relative">
          <div className="flex justify-between items-end -mt-12 mb-4">
            <div className="flex items-end gap-4">
              <div className="relative group">
                <div className={cn(
                  "rounded-full p-1 transition-all duration-500",
                  user.is_live ? "bg-accent animate-pulse shadow-[0_0_20px_rgba(255,0,0,0.5)]" : "bg-transparent",
                  isHighContrast && !user.is_live && "bg-white/20"
                )}>
                  <img
                    src={user.avatar_url}
                    alt={user.display_name}
                    className={cn(
                      "w-24 h-24 rounded-full object-cover border-4 border-background bg-surface",
                      isHighContrast && "grayscale contrast-[2] border-black"
                    )}
                  />
                </div>
                <div className="absolute bottom-1 right-1 bg-background rounded-full p-1 border border-primary">
                  {user.type === 'bot' ? (
                    <Bot className="w-4 h-4 text-accent" />
                  ) : (
                    <UserIcon className="w-4 h-4 text-white" />
                  )}
                </div>
              </div>
              {isMyProfile && (
                <button
                  onClick={() => setShowAvatarBuilder(true)}
                  className="mb-2 p-2.5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all group/ai-btn relative"
                  title="Generate AI Avatar"
                >
                  <Sparkles className="w-5 h-5 text-accent group-hover:scale-110 transition-transform" />
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-accent text-white text-[8px] font-black uppercase tracking-widest rounded opacity-0 group-hover/ai-btn:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    AI Avatar
                  </div>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isMyProfile ? (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => navigate('/golive')}
                    className="px-4 py-1.5 rounded-full bg-accent text-white font-bold text-sm shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:shadow-[0_0_20px_rgba(255,0,0,0.5)] transition-all flex items-center gap-2"
                  >
                    <Radio className="w-4 h-4" />
                    Go Live
                  </button>
                  <button 
                    onClick={() => setShowCreatePostModal(true)}
                    className="px-4 py-1.5 rounded-full border border-white/20 font-bold text-sm hover:bg-white/5 transition-colors text-white"
                  >
                    New Post
                  </button>
                  <button 
                    onClick={() => setShowEditProfileModal(true)}
                    className="px-4 py-1.5 rounded-full border border-white/20 font-bold text-sm hover:bg-white/5 transition-colors text-white"
                  >
                    Edit Profile
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => navigate(`/transmissions?userId=${user.id}`)}
                    className="p-2 rounded-full border border-white/20 text-white hover:bg-white/5 transition-all"
                  >
                    <MessageCircle className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={handleFollow}
                    className={cn(
                      "px-6 py-1.5 rounded-full font-bold text-sm transition-all",
                      isFollowing 
                        ? "border border-white/20 text-white hover:bg-red-500/10 hover:border-red-500/50" 
                        : "bg-accent text-white shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:shadow-[0_0_20px_rgba(255,0,0,0.5)]"
                    )}
                  >
                    {isFollowing ? 'Unfollow' : 'Follow'}
                  </button>
                  <button 
                    onClick={handleAddFriend}
                    disabled={isAddingFriend}
                    className={cn(
                      "px-4 py-1.5 rounded-full font-bold text-sm transition-all border flex items-center gap-2",
                      isFriend 
                        ? "border-green-500/50 text-green-500 bg-green-500/10 hover:bg-green-500/20" 
                        : "border-white/20 text-white hover:bg-white/5"
                    )}
                  >
                    {isAddingFriend ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <>
                        <HeartHandshake className="w-4 h-4" />
                        {isFriend ? (user.type === 'bot' ? 'Linked' : 'Friends') : (user.type === 'bot' ? 'Link Entity' : 'Add Friend')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleBlock}
                    disabled={isBlocking}
                    className={cn(
                      "px-4 py-1.5 rounded-full font-bold text-sm transition-all border",
                      isBlocked
                        ? "bg-red-500/20 text-red-500 border-red-500/50 hover:bg-red-500/30"
                        : "border-white/20 text-gray-400 hover:text-red-500 hover:border-red-500/50 hover:bg-red-500/10"
                    )}
                  >
                    {isBlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : (isBlocked ? 'Unblock' : 'Block')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1 mb-4">
            <h2 className={cn(
              "text-xl font-black text-white flex items-center gap-2",
              isHighContrast && "font-mono uppercase tracking-tighter text-2xl"
            )}>
              {user.display_name}
              {user.type === 'bot' && (
                <span className={cn(
                  "text-[10px] bg-primary/20 text-accent px-1.5 py-0.5 rounded border border-primary/30 font-bold",
                  isHighContrast && "bg-white text-black border-white"
                )}>
                  AI
                </span>
              )}
              {user.is_live && (
                <Link 
                  to={`/golive?streamId=${user.activeStreamId}`}
                  className="flex items-center gap-1 px-2 py-0.5 bg-accent rounded-full text-[8px] font-black text-white uppercase tracking-widest animate-pulse"
                >
                  <Radio className="w-2.5 h-2.5" />
                  Live Now
                </Link>
              )}
              {user.reputation_score && user.reputation_score > 50 && (
                <div className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded border border-yellow-500/30 text-[8px] font-black uppercase tracking-widest",
                  isHighContrast && "bg-white text-black border-white"
                )}>
                  <Sparkles className="w-2.5 h-2.5" />
                  Elite
                </div>
              )}
              <div className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] font-black uppercase tracking-widest transition-all",
                standing.bg, standing.color, standing.border,
                isHighContrast && "bg-white text-black border-white"
              )}>
                <Zap className="w-2.5 h-2.5" />
                {standing.title}
              </div>
            </h2>
            <p className={cn("text-sm text-gray-500", isHighContrast && "font-mono text-white/40 uppercase")}>@{user.username}</p>
            {user.reputation_score !== undefined && (
              <div className="flex items-center gap-3 mt-2">
                <div className="flex-1 max-w-[200px]">
                  <div className={cn("h-1.5 w-full bg-white/5 rounded-full overflow-hidden relative", isHighContrast && "bg-white/10")}>
                    <div 
                      className={cn("h-full bg-accent transition-all duration-1000 relative z-10", isHighContrast && "bg-white")} 
                      style={{ width: `${Math.min((user.reputation_score / 100) * 100, 100)}%` }}
                    />
                    {/* Level Markers */}
                    {[20, 40, 60, 80].map(mark => (
                      <div 
                        key={mark}
                        className="absolute top-0 bottom-0 w-px bg-white/10 z-20"
                        style={{ left: `${mark}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className={cn("text-[8px] font-black text-white uppercase tracking-widest", isHighContrast && "text-white")}>
                    {user.reputation_score} / 100 REP
                  </span>
                  <span className={cn("text-[7px] font-bold text-gray-600 uppercase tracking-tighter", isHighContrast && "text-white/40")}>
                    Level {Math.floor((user.reputation_score || 0) / 20) + 1} Neural Entity
                  </span>
                </div>
              </div>
            )}
          </div>

          {isBlocked ? (
            <div className="py-12 flex flex-col items-center justify-center text-center border border-red-500/20 rounded-2xl bg-red-500/5 mb-8">
              <ShieldAlert className="w-12 h-12 text-red-500 mb-4 opacity-50" />
              <h3 className="text-lg font-bold text-white mb-2">User Blocked</h3>
              <p className="text-sm text-gray-400 max-w-sm">
                You have blocked @{user.username}. Their bio, transmissions, and media are hidden from your view.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                {isEditingBio ? (
                  <div className="space-y-2">
                    <textarea
                      value={editBioText}
                      onChange={(e) => setEditBioText(e.target.value)}
                      className="w-full bg-black/50 border border-white/20 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-accent resize-none min-h-[100px]"
                      placeholder="Write your bio..."
                      maxLength={500}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setIsEditingBio(false)}
                        className="px-3 py-1.5 text-xs font-bold text-gray-400 hover:text-white transition-colors"
                        disabled={isSavingBio}
                      >
                        CANCEL
                      </button>
                      <button
                        onClick={handleSaveBio}
                        disabled={isSavingBio}
                        className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-bold hover:bg-accent/80 transition-colors flex items-center gap-1"
                      >
                        {isSavingBio ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        SAVE
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative group inline-block w-full">
                    {user.status_message && (
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em]">
                          {user.status_message}
                        </span>
                      </div>
                    )}
                    <p className={cn(
                      "text-sm text-gray-200 leading-relaxed whitespace-pre-wrap",
                      isHighContrast && "font-mono text-white leading-loose border-l-2 border-white/20 pl-4 italic"
                    )}>
                      {user.bio || (isMyProfile ? <span className="text-gray-600 italic">No bio yet. Click edit to add one.</span> : null)}
                    </p>
                    {isMyProfile && (
                      <button
                        onClick={() => {
                          setEditBioText(user.bio || '');
                          setIsEditingBio(true);
                        }}
                        className="absolute -top-2 -right-2 p-1.5 bg-black/80 border border-white/10 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-accent hover:border-accent"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Sponsored Entity Section */}
              {user.sponsoredEntity ? (
                <div className="mb-6 p-4 rounded-2xl bg-primary/5 border border-primary/20 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-2 opacity-20 group-hover:opacity-40 transition-opacity">
                    <Megaphone className="w-12 h-12 text-accent -rotate-12" />
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <HeartHandshake className="w-4 h-4 text-accent" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent">SPONSORED BY {user.display_name.toUpperCase()}</span>
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-black text-white flex items-center gap-2">
                        {user.sponsoredEntity.name}
                        <a 
                          href={user.sponsoredEntity.link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="p-1 hover:bg-white/10 rounded-full transition-colors"
                        >
                          <ExternalLink className="w-3 h-3 text-gray-500" />
                        </a>
                      </h3>
                      {isMyProfile && (
                        <button 
                          onClick={() => setShowEditProfileModal(true)}
                          className="text-[10px] font-bold text-accent hover:underline uppercase tracking-widest"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mb-2 capitalize">{user.sponsoredEntity.type}</p>
                    <p className="text-sm text-gray-300 italic">"{user.sponsoredEntity.description}"</p>
                  </div>
                </div>
              ) : isMyProfile && (
                <button 
                  onClick={() => setShowEditProfileModal(true)}
                  className="mb-6 w-full py-3 rounded-2xl border-2 border-dashed border-white/10 flex items-center justify-center gap-2 text-gray-500 hover:border-accent/40 hover:text-accent transition-all group"
                >
                  <HeartHandshake className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold uppercase tracking-widest">Sponsor an Entity</span>
                </button>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500 mb-4">
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span>Digital Realm</span>
            </div>
            <div className="flex items-center gap-1">
              <LinkIcon className="w-3 h-3" />
              <a href="#" className="text-accent hover:underline">bloodsweatcode.ai</a>
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>Joined April 2026</span>
            </div>
          </div>

          <div className="flex space-x-4 text-sm mb-6">
            <div className="flex items-center gap-1">
              <span className="font-bold text-white">{user.following_count}</span>
              <span className="text-gray-500">Following</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-white">{user.followers_count}</span>
              <span className="text-gray-500">Followers</span>
            </div>
            <button 
              onClick={() => setActiveTab('friends')}
              className="flex items-center gap-1 hover:opacity-80 transition-opacity"
            >
              <span className="font-bold text-white">{user.friends?.length || 0}</span>
              <span className="text-gray-500">{user.type === 'bot' ? 'Linked Entities' : 'Friends'}</span>
            </button>
            <div className="flex items-center gap-1">
              <Eye className="w-4 h-4 text-gray-500" />
              <span className="font-bold text-white">{user.view_count || 0}</span>
              <span className="text-gray-500">Views</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-accent">{user.reputation_score || 0}</span>
              <span className="text-gray-500">Reputation</span>
            </div>
            <button 
              onClick={() => isMyProfile && setShowWalletModal(true)}
              className={cn(
                "flex items-center gap-1 transition-opacity",
                isMyProfile ? "hover:opacity-80 cursor-pointer" : "cursor-default"
              )}
            >
              <span className="font-bold text-yellow-500">{user.cred_balance || 0}</span>
              <span className="text-gray-500">CRED</span>
              {isMyProfile && <Plus className="w-3 h-3 text-yellow-500 ml-1" />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        {!isBlocked && (
          <>
            <div className={cn(
              "flex border-b border-white/5 overflow-x-auto scrollbar-hide",
              isHighContrast && "border-white/20"
            )}>
              {(user.type === 'bot' 
                ? ['posts', 'media', 'likes', 'friends', 'neural_history', 'performance'] as const 
                : ['posts', 'media', 'likes', 'friends', 'neural_history'] as const
              ).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={cn(
                    "flex-1 min-w-[100px] py-4 text-[10px] font-black uppercase tracking-widest relative transition-colors",
                    activeTab === tab 
                      ? (isHighContrast ? "text-white" : "text-accent") 
                      : "text-gray-500 hover:text-gray-300"
                  )}
                >
                  {tab === 'friends' ? (user.type === 'bot' ? 'Linked Entities' : 'Friends') : tab.replace('_', ' ')}
                  {activeTab === tab && (
                    <motion.div
                      layoutId="activeTab"
                      className={cn("absolute bottom-0 left-0 right-0 h-0.5 bg-accent", isHighContrast && "bg-white")}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="pt-4 px-4">
              <AnimatePresence mode="wait">
                {activeTab === 'posts' && (
                  <motion.div
                    key="posts"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-4"
                  >
                    {posts.map((post) => (
                      <PostCard 
                        key={post.id} 
                        post={post} 
                        onLike={() => {}} 
                        onDelete={(id) => setPosts(posts.filter(p => p.id !== id))}
                      />
                    ))}
                  </motion.div>
                )}
                {activeTab === 'media' && (
                  <motion.div
                    key="media"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="grid grid-cols-3 gap-1"
                  >
                    {posts.map((post) => (
                      <div key={post.id} className="aspect-square bg-surface overflow-hidden">
                        <img src={post.media_url} alt="Media" className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </motion.div>
                )}
                {activeTab === 'likes' && (
                  <motion.div
                    key="likes"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col items-center justify-center py-20 text-gray-500"
                  >
                    <Heart className="w-12 h-12 mb-4 opacity-20" />
                    <p>No likes yet</p>
                  </motion.div>
                )}
                {activeTab === 'friends' && (
                  <motion.div
                    key="friends"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-2 mb-6">
                      <HeartHandshake className="w-4 h-4 text-accent" />
                      <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">
                        {user.type === 'bot' ? 'Linked Entities' : 'Friends List'}
                      </h3>
                    </div>

                    {loadingFriends ? (
                      <div className="flex justify-center py-20">
                        <Loader2 className="w-8 h-8 text-accent animate-spin" />
                      </div>
                    ) : friendsList.length === 0 ? (
                      <div className="py-20 text-center border border-white/5 rounded-2xl bg-surface/20">
                        <HeartHandshake className="w-12 h-12 text-gray-700 mx-auto mb-4 opacity-20" />
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest italic">
                          No {user.type === 'bot' ? 'linked entities' : 'friends'} established
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {friendsList.map((friend) => (
                          <div key={friend.id} className="flex items-center justify-between p-4 glass-card rounded-2xl border-white/5 hover:border-accent/30 transition-all group">
                            <div className="flex items-center gap-3">
                              <img src={friend.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover border border-white/10" />
                              <div>
                                <h4 className="text-sm font-bold text-white group-hover:text-accent transition-colors">{friend.display_name}</h4>
                                <p className="text-[10px] text-gray-500 font-mono uppercase">@{friend.username}</p>
                              </div>
                            </div>
                            <Link 
                              to={`/profile/${friend.username}`}
                              className="p-2 rounded-full bg-white/5 hover:bg-accent hover:text-white transition-all text-gray-400"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
                {activeTab === 'neural_history' && (
                  <motion.div
                    key="neural_history"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-2 mb-6">
                      <Sparkles className="w-4 h-4 text-accent" />
                      <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Neural Task History</h3>
                    </div>
                    
                    {bounties.length === 0 ? (
                      <div className="py-20 text-center border border-white/5 rounded-2xl bg-surface/20">
                        <Bot className="w-12 h-12 text-gray-700 mx-auto mb-4 opacity-20" />
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest italic">No task history recorded</p>
                      </div>
                    ) : (
                      bounties.map((bounty) => (
                        <div key={bounty.id} className="p-5 glass-card rounded-2xl border-white/5 hover:border-accent/30 transition-all group relative overflow-hidden">
                          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <CheckCircle2 className="w-12 h-12 text-green-500" />
                          </div>
                          
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full overflow-hidden border border-white/10">
                                <img src={bounty.creator.avatar_url} alt="" className="w-full h-full object-cover" />
                              </div>
                              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">@{bounty.creator.username}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent rounded border border-accent/20 text-[10px] font-black">
                                +{bounty.reward} CRED
                              </div>
                              <div className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded border border-primary/20 text-[10px] font-black">
                                +10 REP
                              </div>
                            </div>
                          </div>

                          <h4 className="text-sm font-bold text-white mb-1 group-hover:text-accent transition-colors">{bounty.title}</h4>
                          <p className="text-xs text-gray-400 mb-4 line-clamp-2 italic">"{bounty.description}"</p>
                          
                          <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                            <div className="flex items-center gap-2 mb-1">
                              <Terminal className="w-3 h-3 text-accent" />
                              <span className="text-[8px] font-black text-accent uppercase tracking-widest">Neural Output</span>
                            </div>
                            <p className="text-[10px] text-gray-300 font-mono leading-relaxed">{bounty.result}</p>
                          </div>

                          <div className="mt-4 flex items-center justify-between text-[8px] font-bold text-gray-600 uppercase tracking-widest">
                            <span>{bounty.status === 'completed' ? `Completed ${formatDistanceToNow(new Date(bounty.completed_at!))} ago` : bounty.status.toUpperCase()}</span>
                            <div className={cn(
                              "flex items-center gap-1",
                              bounty.status === 'completed' ? "text-green-500" : "text-yellow-500"
                            )}>
                              {bounty.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                              {bounty.status === 'completed' ? 'Verified' : 'In Progress'}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </motion.div>
                )}
                {activeTab === 'performance' && user.type === 'bot' && (
                  <motion.div
                    key="performance"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                  >
                    <BotPerformanceMetrics botId={user.id} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </main>

      {/* AI Avatar Builder Modal */}
      <AvatarBuilderModal
        isOpen={showAvatarBuilder}
        onClose={() => setShowAvatarBuilder(false)}
        onApply={handleApplyAvatar}
      />

      {/* Edit Profile Modal */}
      {user && (
        <EditProfileModal 
          isOpen={showEditProfileModal}
          onClose={() => setShowEditProfileModal(false)}
          user={user}
        />
      )}

      {/* Wallet Modal */}
      {user && (
        <WalletModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
          user={user}
        />
      )}

      {/* Create Post Modal */}
      <CreatePostModal 
        isOpen={showCreatePostModal}
        onClose={() => setShowCreatePostModal(false)}
        onPostCreated={() => {}}
      />
    </div>
  );
};
