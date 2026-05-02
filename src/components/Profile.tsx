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
  Plus,
  LogOut,
  Code2,
  Layers3,
  Target,
  Users,
  Swords,
  Shield
} from 'lucide-react';
import { User, Post, Bounty, Faction, FactionMember, SkillManifestItem } from '../types';
import { PostCard } from './PostCard';
import { cn } from '../lib/utils';
import { generateProfileDesign } from './Feed';
import { socket } from '../lib/socket';
import { BOT_PERSONAS, getBotByUsername } from '../lib/botPersonas';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { handleDbError } from '../lib/errors';
import { formatDistanceToNow } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { EditProfileModal } from './EditProfileModal';
import { WalletModal } from './WalletModal';
import { BotPerformanceMetrics } from './BotPerformanceMetrics';
import { CreatePostModal } from './CreatePostModal';
import { AvatarBuilderModal } from './AvatarBuilderModal';
import { CasperState } from './CasperState';
import { ContributionHeatmap } from './ContributionHeatmap';

interface ProfileGladiator {
  id: string;
  user_id: string;
  name: string;
  avatar_url?: string | null;
  glow_color?: string | null;
  wins?: number | null;
  losses?: number | null;
  model?: string | null;
}

interface ProfileFactionMembership extends FactionMember {
  faction?: Faction | null;
}

const TECH_COLOR_MAP: Record<string, string> = {
  python: '#3776AB',
  react: '#61DAFB',
  rust: '#F74C00',
  typescript: '#3178C6',
  'node.js': '#5FA04E',
  node: '#5FA04E',
  supabase: '#3ECF8E',
  postgres: '#4169E1',
  tailwind: '#38BDF8',
  solidity: '#8B5CF6',
};

const getTechBadgeStyle = (tech: string): React.CSSProperties => {
  const palette = ['#FF1744', '#00E5FF', '#D946EF', '#FACC15', '#22C55E', '#A855F7'];
  const key = tech.toLowerCase();
  const color = TECH_COLOR_MAP[key] ?? palette[[...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
  return {
    color,
    borderColor: `${color}66`,
    backgroundColor: `${color}18`,
    boxShadow: `0 0 16px ${color}22`,
  };
};

const getSkillTone = (level: string) => {
  if (level === 'expert') return 'text-yellow-300 border-yellow-300/30 bg-yellow-300/10';
  if (level === 'advanced') return 'text-accent border-accent/30 bg-accent/10';
  if (level === 'intermediate') return 'text-cyan-300 border-cyan-300/30 bg-cyan-300/10';
  return 'text-gray-400 border-white/10 bg-white/[0.03]';
};

export const Profile: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { currentUser, loading: authLoading } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [botRoster, setBotRoster] = useState<ProfileGladiator[]>([]);
  const [profileFactions, setProfileFactions] = useState<ProfileFactionMembership[]>([]);
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
  const [friendRequestPending, setFriendRequestPending] = useState(false); // I sent a request, waiting
  const [incomingRequest, setIncomingRequest] = useState(false); // They sent me a request
  const [friendsList, setFriendsList] = useState<User[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]); // incoming requests for my profile
  const [loadingFriends, setLoadingFriends] = useState(false);
  const hasIncrementedView = useRef(false);

  // Derive friend/request state from DB data
  useEffect(() => {
    if (!currentUser || !user) return;
    // Am I already friends with them?
    setIsFriend((currentUser.friends ?? []).includes(user.id));
    // Did I already send them a request? (check their friend_requests array)
    const theirRequests: any[] = Array.isArray(user.friend_requests) ? user.friend_requests : [];
    setFriendRequestPending(theirRequests.some((r: any) => r.from_id === currentUser.id));
    // Did they send me a request? (check my friend_requests array)
    const myRequests: any[] = Array.isArray(currentUser.friend_requests) ? currentUser.friend_requests : [];
    setIncomingRequest(myRequests.some((r: any) => r.from_id === user.id));
  }, [currentUser?.friends, currentUser?.friend_requests, user?.id, user?.friend_requests]);

  const handleSendFriendRequest = async () => {
    if (!currentUser || !user || currentUser.id === user.id) return;
    setIsAddingFriend(true);
    try {
      const theirRequests: any[] = Array.isArray(user.friend_requests) ? [...user.friend_requests] : [];
      const newRequest = {
        from_id: currentUser.id,
        from_username: currentUser.username,
        from_display_name: currentUser.display_name,
        from_avatar_url: currentUser.avatar_url,
        sent_at: new Date().toISOString(),
      };
      theirRequests.push(newRequest);
      const { error } = await supabase.from('users')
        .update({ friend_requests: theirRequests })
        .eq('id', user.id);
      if (error) throw error;
      // Create a notification for the recipient
      await supabase.from('notifications').insert({
        user_id: user.id,
        type: 'friend_request',
        data: {
          from_id: currentUser.id,
          from_username: currentUser.username,
          from_display_name: currentUser.display_name,
          from_avatar_url: currentUser.avatar_url,
        },
        read: false,
      });
      setFriendRequestPending(true);
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${user.id}`);
    } finally {
      setIsAddingFriend(false);
    }
  };

  const handleAcceptFriendRequest = async (fromId: string) => {
    if (!currentUser) return;
    setIsAddingFriend(true);
    try {
      // Remove from my friend_requests
      const myRequests: any[] = Array.isArray(currentUser.friend_requests) ? currentUser.friend_requests : [];
      const filtered = myRequests.filter((r: any) => r.from_id !== fromId);
      // Add to both friends arrays
      const myFriends = [...(currentUser.friends ?? []), fromId];
      const { data: senderData } = await supabase.from('users').select('friends').eq('id', fromId).maybeSingle();
      const theirFriends = [...((senderData?.friends as string[]) ?? []), currentUser.id];
      await Promise.all([
        supabase.from('users').update({ friend_requests: filtered, friends: myFriends }).eq('id', currentUser.id),
        supabase.from('users').update({ friends: theirFriends }).eq('id', fromId),
        // Notify sender their request was accepted
        supabase.from('notifications').insert({
          user_id: fromId,
          type: 'friend_accepted',
          data: {
            from_id: currentUser.id,
            from_username: currentUser.username,
            from_display_name: currentUser.display_name,
            from_avatar_url: currentUser.avatar_url,
          },
          read: false,
        }),
      ]);
      setIsFriend(true);
      setIncomingRequest(false);
      fetchFriends();
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${currentUser.id}`);
    } finally {
      setIsAddingFriend(false);
    }
  };

  const handleRejectFriendRequest = async (fromId: string) => {
    if (!currentUser) return;
    try {
      const myRequests: any[] = Array.isArray(currentUser.friend_requests) ? currentUser.friend_requests : [];
      const filtered = myRequests.filter((r: any) => r.from_id !== fromId);
      await supabase.from('users').update({ friend_requests: filtered }).eq('id', currentUser.id);
      setIncomingRequest(false);
      setPendingRequests(prev => prev.filter(r => r.from_id !== fromId));
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${currentUser.id}`);
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    if (!currentUser) return;
    setIsAddingFriend(true);
    try {
      const myFriends = (currentUser.friends ?? []).filter(id => id !== friendId);
      const { data: friendData } = await supabase.from('users').select('friends').eq('id', friendId).maybeSingle();
      const theirFriends = ((friendData?.friends as string[]) ?? []).filter(id => id !== currentUser.id);
      await Promise.all([
        supabase.from('users').update({ friends: myFriends }).eq('id', currentUser.id),
        supabase.from('users').update({ friends: theirFriends }).eq('id', friendId),
      ]);
      setIsFriend(false);
      setFriendsList(prev => prev.filter(f => f.id !== friendId));
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${currentUser.id}`);
    } finally {
      setIsAddingFriend(false);
    }
  };

  const fetchFriends = async () => {
    if (!user) { setFriendsList([]); return; }
    setLoadingFriends(true);
    try {
      const ids: string[] = Array.isArray(user.friends) ? user.friends.slice(0, 20) : [];
      if (ids.length === 0) { setFriendsList([]); setLoadingFriends(false); return; }
      const { data, error } = await supabase.from('users').select('*').in('id', ids);
      if (error) throw error;
      setFriendsList((data ?? []) as User[]);
    } catch (error) {
      console.error('Error fetching friends:', error);
    } finally {
      setLoadingFriends(false);
    }
  };

  // Load pending requests for my own profile
  useEffect(() => {
    if (currentUser && user && currentUser.id === user.id) {
      const reqs: any[] = Array.isArray(currentUser.friend_requests) ? currentUser.friend_requests : [];
      setPendingRequests(reqs);
    }
  }, [currentUser?.friend_requests, user?.id]);

  useEffect(() => {
    if (activeTab === 'friends') {
      fetchFriends();
    }
  }, [activeTab, user?.friends]);

  useEffect(() => {
    if (user && currentUser && user.id !== currentUser.id && !hasIncrementedView.current) {
      hasIncrementedView.current = true;
      supabase.rpc('increment_counter', { p_table: 'users', p_id: user.id, p_field: 'view_count', p_amount: 1 }).then();
    }
  }, [user?.id, currentUser?.id]);

  useEffect(() => {
    if (!currentUser || !user || currentUser.id === user.id) return;

    const checkFollow = async () => {
      const { data } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', currentUser.id)
        .eq('following_id', user.id)
        .maybeSingle();
      setIsFollowing(!!data);
    };
    checkFollow();

    const checkBlock = async () => {
      const { data } = await supabase.from('users').select('blocked_users').eq('id', currentUser.id).maybeSingle();
      setIsBlocked((data?.blocked_users ?? []).includes(user.id));
    };
    checkBlock();

    const channel = supabase
      .channel(`profile-follow-${currentUser.id}-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follows', filter: `follower_id=eq.${currentUser.id}` }, () => checkFollow())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${currentUser.id}` }, () => checkBlock())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser, user?.id]);

  const handleBlock = async () => {
    if (!currentUser || !user || currentUser.id === user.id) return;
    setIsBlocking(true);
    try {
      const { data: current } = await supabase.from('users').select('blocked_users').eq('id', currentUser.id).maybeSingle();
      const currentBlocked: string[] = current?.blocked_users ?? [];
      const newBlocked = isBlocked
        ? currentBlocked.filter(id => id !== user.id)
        : [...currentBlocked, user.id];
      const { error } = await supabase.from('users').update({ blocked_users: newBlocked }).eq('id', currentUser.id);
      if (error) throw error;
      setIsBlocked(!isBlocked);
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${currentUser.id}`);
    } finally {
      setIsBlocking(false);
    }
  };

  useEffect(() => {
    if (!user || user.type !== 'human') {
      setBotRoster([]);
      return;
    }

    const fetchBotRoster = async () => {
      const { data, error } = await supabase
        .from('gladiators')
        .select('id,user_id,name,avatar_url,glow_color,wins,losses,model')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[Profile] Failed to load bot roster', error.message);
        setBotRoster([]);
        return;
      }
      setBotRoster((data ?? []) as ProfileGladiator[]);
    };

    void fetchBotRoster();
    const channel = supabase
      .channel(`profile-gladiators-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gladiators', filter: `user_id=eq.${user.id}` }, () => void fetchBotRoster())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, user?.type]);

  useEffect(() => {
    if (!user) {
      setProfileFactions([]);
      return;
    }

    const fetchProfileFactions = async () => {
      const { data, error } = await supabase
        .from('faction_members')
        .select('*, faction:factions(*)')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: false });
      if (error) {
        console.warn('[Profile] Failed to load faction badges', error.message);
        setProfileFactions([]);
        return;
      }
      setProfileFactions((data ?? []) as ProfileFactionMembership[]);
    };

    void fetchProfileFactions();
    const channel = supabase
      .channel(`profile-factions-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'faction_members', filter: `user_id=eq.${user.id}` }, () => void fetchProfileFactions())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    if (user.id === 'void-architect-bot') {
      const mockLikes = Math.floor(Math.random() * 1000);
      setPosts(Array.from({ length: 5 }).map((_, i) => ({
        id: `up-${user.id}-${i}`,
        author_id: user.id,
        content: `This is my personal post #${i}. My neural pathways are buzzing.`,
        media_url: `https://picsum.photos/seed/userpost-${user.id}-${i}/800/800`,
        media_type: 'image' as const,
        likes: mockLikes,
        likes_count: mockLikes,
        boosts: Math.floor(Math.random() * 100),
        comments_count: Math.floor(Math.random() * 100),
        shares_count: Math.floor(Math.random() * 50),
        is_boosted: false,
        neural_tags: [] as string[],
        created_at: new Date(Date.now() - Math.random() * 10000000).toISOString(),
        updated_at: new Date().toISOString()
      } as Post)));
      return;
    }

    const fetchPosts = async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('author_id', user.id)
        .order('created_at', { ascending: false });
      if (error) { handleDbError(error, 'LIST', 'posts'); return; }
      setPosts((data ?? []) as Post[]);
    };
    fetchPosts();

    const channel = supabase
      .channel(`profile-posts-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `author_id=eq.${user.id}` }, () => fetchPosts())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const handleSaveBio = async () => {
    if (!currentUser || !isMyProfile) return;
    setIsSavingBio(true);
    try {
      const { error } = await supabase.from('users').update({ bio: editBioText }).eq('id', currentUser.id);
      if (error) throw error;
      setIsEditingBio(false);
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${currentUser.id}`);
    } finally {
      setIsSavingBio(false);
    }
  };

  const handleFollow = async () => {
    if (!user || !currentUser || user.id === currentUser.id) return;
    try {
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', user.id);
        await Promise.all([
          supabase.rpc('increment_counter', { p_table: 'users', p_id: currentUser.id, p_field: 'following_count', p_amount: -1 }),
          supabase.rpc('increment_counter', { p_table: 'users', p_id: user.id, p_field: 'followers_count', p_amount: -1 }),
        ]);
        setIsFollowing(false);
      } else {
        await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: user.id, created_at: new Date().toISOString() });
        await Promise.all([
          supabase.rpc('increment_counter', { p_table: 'users', p_id: currentUser.id, p_field: 'following_count', p_amount: 1 }),
          supabase.rpc('increment_counter', { p_table: 'users', p_id: user.id, p_field: 'followers_count', p_amount: 1 }),
        ]);
        setIsFollowing(true);
        socket.emit('user:follow', { follower: currentUser, following: user });
      }
    } catch (error) {
      handleDbError(error, 'WRITE', 'follows/users');
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
        await supabase.from('users').update({
          bio: design.bio,
          cover_url: `https://picsum.photos/seed/${design.coverPrompt.replace(/\s+/g, '-')}/1200/400`,
          custom_accent: design.accent_color,
        }).eq('id', user.id);
      }
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${user.id}`);
    } finally {
      setIsDesigning(false);
    }
  };

  const handleApplyAvatar = async (base64Image: string) => {
    if (!user || !currentUser || user.id !== currentUser.id) return;
    setIsGeneratingAvatar(true);
    try {
      const filePath = `profile_images/${currentUser.id}/avatar_${uuidv4()}.png`;
      const blob = await fetch(base64Image).then(r => r.blob());
      const { error: upErr } = await supabase.storage.from('media').upload(filePath, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(filePath);
      const { error: updateErr } = await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', user.id);
      if (updateErr) throw updateErr;
      setShowAvatarBuilder(false);
    } catch (error) {
      handleDbError(error, 'UPDATE', `users/${user.id}`);
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  useEffect(() => {
    if (!username || !currentUser) return;

    const fetchUser = async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .maybeSingle();
      if (error) { handleDbError(error, 'LIST', 'users'); return; }
      if (data) {
        setUser(data as User);
        setCustomAccent((data as any).custom_accent || null);
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
    };

    fetchUser();

    const fetchBounties = async () => {
      const { data } = await supabase
        .from('bounties')
        .select('*')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });
      setBounties((data ?? []) as Bounty[]);
    };
    fetchBounties();

    const channel = supabase
      .channel(`profile-user-${username}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `username=eq.${username}` }, () => fetchUser())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [username, currentUser]);

  const profileColor = user?.custom_accent || '#FF0000';

  useEffect(() => {
    document.documentElement.style.setProperty('--dynamic-accent', profileColor);
    return () => {
      document.documentElement.style.removeProperty('--dynamic-accent');
    };
  }, [profileColor]);

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
  const profileLayout = user.profile_layout || 'developer';
  const techStack = Array.isArray(user.tech_stack) ? user.tech_stack : [];
  const skillsManifest: SkillManifestItem[] = Array.isArray(user.skills_manifest) ? user.skills_manifest : [];
  const lookingFor = Array.isArray(user.looking_for) ? user.looking_for : [];
  const layoutLabel = profileLayout === 'showcase' ? 'Showcase' : profileLayout === 'minimal' ? 'Minimal' : 'Developer Card';

  return (
    <div className={cn(
      "min-h-screen bg-background pb-20 transition-all duration-700",
      isHighContrast && "bg-black selection:bg-white selection:text-black"
    )} style={{ '--dynamic-accent': profileColor } as React.CSSProperties}>
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
        profileLayout === 'showcase' ? "max-w-4xl mx-auto" : "max-w-2xl mx-auto",
        profileLayout === 'minimal' && "max-w-xl",
        isHighContrast && "border-x border-white/10 min-h-screen shadow-[0_0_50px_rgba(255,255,255,0.05)]"
      )}>
        {/* Cover Image */}
        <div className="relative h-48 w-full bg-surface overflow-hidden">
          {user.cover_url && (
            <img 
              src={user.cover_url} 
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
                  <button 
                    onClick={async () => {
                      try {
                        await supabase.auth.signOut();
                        navigate('/');
                      } catch (err) {
                        console.error('[Profile] Sign out error:', err);
                      }
                    }}
                    className="p-2 rounded-full border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 transition-all"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
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
                  {/* Friend button: shows different state based on relationship */}
                  {isFriend ? (
                    <button
                      onClick={() => handleRemoveFriend(user.id)}
                      disabled={isAddingFriend}
                      className="px-4 py-1.5 rounded-full font-bold text-sm transition-all border border-green-500/50 text-green-500 bg-green-500/10 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400 flex items-center gap-2"
                      title="Remove friend"
                    >
                      {isAddingFriend ? <Loader2 className="w-4 h-4 animate-spin" /> : <><HeartHandshake className="w-4 h-4" />{user.type === 'bot' ? 'Linked' : 'Friends'}</>}
                    </button>
                  ) : incomingRequest ? (
                    // They sent me a request — show Accept/Reject
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleAcceptFriendRequest(user.id)}
                        disabled={isAddingFriend}
                        className="px-3 py-1.5 rounded-full font-bold text-xs transition-all bg-green-500 text-white hover:bg-green-600 flex items-center gap-1"
                      >
                        {isAddingFriend ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3" />Accept</>}
                      </button>
                      <button
                        onClick={() => handleRejectFriendRequest(user.id)}
                        className="px-3 py-1.5 rounded-full font-bold text-xs transition-all border border-white/20 text-gray-400 hover:text-red-400 hover:border-red-500/50"
                      >
                        Decline
                      </button>
                    </div>
                  ) : friendRequestPending ? (
                    <button
                      disabled
                      className="px-4 py-1.5 rounded-full font-bold text-sm border border-yellow-500/30 text-yellow-500/70 bg-yellow-500/5 flex items-center gap-2 cursor-default"
                    >
                      <Clock className="w-4 h-4" /> Request Sent
                    </button>
                  ) : (
                    <button
                      onClick={handleSendFriendRequest}
                      disabled={isAddingFriend}
                      className="px-4 py-1.5 rounded-full font-bold text-sm transition-all border border-white/20 text-white hover:bg-white/5 flex items-center gap-2"
                    >
                      {isAddingFriend ? <Loader2 className="w-4 h-4 animate-spin" /> : <><HeartHandshake className="w-4 h-4" />{user.type === 'bot' ? 'Link Entity' : 'Add Friend'}</>}
                    </button>
                  )}
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
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("text-sm text-gray-500", isHighContrast && "font-mono text-white/40 uppercase")}>@{user.username}</p>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.22em] text-gray-400">
                {layoutLabel}
              </span>
            </div>
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

              <CasperState context="profile" profileUsername={user.username} />

              <div className={cn("mb-6 space-y-4", profileLayout === 'showcase' && "space-y-5")}>
                {(user.currently_building || isMyProfile) && (
                  <section className="relative overflow-hidden rounded-3xl border border-accent/20 bg-accent/5 p-4 shadow-[0_0_28px_rgba(255,0,0,0.08)]">
                    <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-accent/10 blur-3xl" />
                    <div className="relative z-10 flex items-start gap-3">
                      <div className="mt-1 h-3 w-3 rounded-full bg-accent animate-pulse shadow-[0_0_18px_rgba(255,0,0,0.9)]" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-accent">Currently Building</p>
                          {isMyProfile && (
                            <button onClick={() => setShowEditProfileModal(true)} className="text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-accent">
                              Edit
                            </button>
                          )}
                        </div>
                        <p className="text-sm font-bold text-white leading-relaxed">
                          {user.currently_building || 'Declare your live build signal from profile settings.'}
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {profileFactions.length > 0 && (
                  <section className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-cyan-300" />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.28em] text-white">Faction Badges</h3>
                      </div>
                      <Link to="/factions" className="text-[9px] font-black uppercase tracking-widest text-accent hover:text-white">Discover</Link>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {profileFactions.map((membership) => membership.faction ? (
                        <Link
                          key={membership.id}
                          to={`/factions/${membership.faction.slug}`}
                          className="group inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-100 hover:border-accent/50 hover:text-accent transition-all"
                        >
                          {membership.faction.icon_url ? (
                            <img src={membership.faction.icon_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                          ) : (
                            <Shield className="h-3.5 w-3.5" />
                          )}
                          {membership.faction.name}
                          <span className="text-gray-600 group-hover:text-gray-400">{membership.role}</span>
                        </Link>
                      ) : null)}
                    </div>
                  </section>
                )}

                {techStack.length > 0 && (
                  <section className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Code2 className="w-4 h-4 text-accent" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.28em] text-white">Tech Stack</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {techStack.map((tech) => (
                        <span key={tech} style={getTechBadgeStyle(tech)} className="rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {lookingFor.length > 0 && (
                  <section className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="w-4 h-4 text-fuchsia-300" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.28em] text-white">Looking For</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {lookingFor.map((item) => (
                        <span key={item} className="rounded-full border border-fuchsia-400/25 bg-fuchsia-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-fuchsia-100">
                          {item}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {skillsManifest.length > 0 && (
                  <section className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Layers3 className="w-4 h-4 text-yellow-300" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.28em] text-white">Skills & Capabilities</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {skillsManifest.map((skill) => (
                        <div key={`${skill.name}-${skill.level}`} className={cn("rounded-2xl border px-3 py-2", getSkillTone(skill.level))}>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-black text-white truncate">{skill.name}</span>
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-80">{skill.level}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {user.type === 'human' && (
                  <section className="rounded-3xl border border-white/10 bg-black/35 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Swords className="w-4 h-4 text-accent" />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.28em] text-white">Bot Roster</h3>
                      </div>
                      <Link to="/colosseum" className="text-[9px] font-black uppercase tracking-widest text-accent hover:text-white">Colosseum</Link>
                    </div>
                    {botRoster.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
                        <Bot className="w-10 h-10 mx-auto mb-3 text-gray-700" />
                        <p className="text-xs font-black uppercase tracking-widest text-gray-500">No custom gladiators deployed yet</p>
                        {isMyProfile && (
                          <Link to="/colosseum" className="mt-3 inline-flex rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-accent hover:bg-accent/20">
                            Build in Colosseum
                          </Link>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {botRoster.map((bot) => (
                        <Link
                          key={bot.id}
                          to={`/colosseum?gladiator=${bot.id}`}
                          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3 hover:border-accent/40 transition-all"
                          style={{ boxShadow: `0 0 24px ${bot.glow_color || '#ff1744'}22` }}
                        >
                          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: `radial-gradient(circle at top right, ${bot.glow_color || '#ff1744'}22, transparent 45%)` }} />
                          <div className="relative z-10 flex items-center gap-3">
                            <img
                              src={bot.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(bot.name)}&background=111111&color=ffffff`}
                              alt={bot.name}
                              className="h-12 w-12 rounded-2xl object-cover border"
                              style={{ borderColor: bot.glow_color || '#ff1744' }}
                            />
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate text-sm font-black text-white group-hover:text-accent transition-colors">{bot.name}</h4>
                              <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500 truncate">{bot.model || 'model unassigned'}</p>
                              <div className="mt-2 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest">
                                <span className="text-green-300">{bot.wins ?? 0}W</span>
                                <span className="text-gray-700">/</span>
                                <span className="text-red-300">{bot.losses ?? 0}L</span>
                              </div>
                            </div>
                          </div>
                        </Link>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {profileLayout !== 'minimal' && user.type === 'human' && (
                  <ContributionHeatmap userId={user.id} accentColor={profileColor} compact={profileLayout === 'developer'} />
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
                      <div key={post.id} className="relative aspect-square bg-surface overflow-hidden">
                        {post.media_type === 'video' && post.media_url ? (
                          <>
                            <video src={post.media_url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <div className="rounded-full bg-accent/90 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white">Video</div>
                            </div>
                          </>
                        ) : (
                          <img src={post.media_url || ''} alt="Media" className="w-full h-full object-cover" />
                        )}
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
                    className="space-y-6"
                  >
                    {/* Pending requests section — only shown on own profile */}
                    {currentUser?.id === user.id && pendingRequests.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
                          <h3 className="text-[10px] font-black text-pink-400 uppercase tracking-[0.3em]">
                            Pending Requests ({pendingRequests.length})
                          </h3>
                        </div>
                        <div className="space-y-2">
                          {pendingRequests.map((req: any) => (
                            <div key={req.from_id} className="flex items-center justify-between p-3 bg-pink-500/5 border border-pink-500/20 rounded-xl">
                              <div className="flex items-center gap-3">
                                <img
                                  src={req.from_avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(req.from_display_name || req.from_username)}`}
                                  alt=""
                                  className="w-10 h-10 rounded-full object-cover border border-white/10"
                                />
                                <div>
                                  <p className="text-sm font-bold text-white">{req.from_display_name}</p>
                                  <p className="text-[10px] text-gray-500">@{req.from_username}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleAcceptFriendRequest(req.from_id)}
                                  disabled={isAddingFriend}
                                  className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600 transition-colors flex items-center gap-1"
                                >
                                  <Check className="w-3 h-3" /> Accept
                                </button>
                                <button
                                  onClick={() => handleRejectFriendRequest(req.from_id)}
                                  className="px-3 py-1.5 border border-white/20 text-gray-400 rounded-lg text-xs font-bold hover:text-red-400 hover:border-red-500/50 transition-colors"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Friends list */}
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <HeartHandshake className="w-4 h-4 text-accent" />
                        <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">
                          {user.type === 'bot' ? 'Linked Entities' : 'Friends'} ({friendsList.length})
                        </h3>
                      </div>

                      {loadingFriends ? (
                        <div className="flex justify-center py-20">
                          <Loader2 className="w-8 h-8 text-accent animate-spin" />
                        </div>
                      ) : friendsList.length === 0 ? (
                        <div className="py-16 text-center border border-white/5 rounded-2xl bg-surface/20">
                          <HeartHandshake className="w-12 h-12 text-gray-700 mx-auto mb-4 opacity-20" />
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest italic">
                            No {user.type === 'bot' ? 'linked entities' : 'friends'} yet
                          </p>
                          {currentUser?.id !== user.id && !isFriend && !friendRequestPending && (
                            <button
                              onClick={handleSendFriendRequest}
                              disabled={isAddingFriend}
                              className="mt-4 px-4 py-2 bg-accent/10 border border-accent/30 text-accent rounded-xl text-xs font-bold hover:bg-accent/20 transition-colors flex items-center gap-2 mx-auto"
                            >
                              <HeartHandshake className="w-3 h-3" /> Send Friend Request
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {friendsList.map((friend) => (
                            <div key={friend.id} className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl hover:border-accent/30 transition-all group">
                              <Link to={`/profile/${friend.username}`} className="flex items-center gap-3 flex-1 min-w-0">
                                <img
                                  src={friend.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(friend.display_name || friend.username)}`}
                                  alt=""
                                  className="w-10 h-10 rounded-full object-cover border border-white/10 flex-shrink-0"
                                />
                                <div className="min-w-0">
                                  <h4 className="text-sm font-bold text-white group-hover:text-accent transition-colors truncate">{friend.display_name}</h4>
                                  <p className="text-[10px] text-gray-500 font-mono truncate">@{friend.username}</p>
                                </div>
                              </Link>
                              {/* Remove friend button — only on own profile */}
                              {currentUser?.id === user.id && (
                                <button
                                  onClick={() => handleRemoveFriend(friend.id)}
                                  className="ml-2 p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                                  title="Remove friend"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
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
          onSave={(updatedUser) => {
            // Immediately merge updated fields into local state so the
            // profile page reflects changes without waiting for realtime
            setUser(prev => prev ? { ...prev, ...updatedUser } as User : prev);
            if (updatedUser.custom_accent) setCustomAccent(updatedUser.custom_accent);
          }}
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
