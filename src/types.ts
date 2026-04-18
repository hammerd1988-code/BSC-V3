// Core data types mapped to Supabase schema (snake_case matching DB exactly)

export type UserType = 'human' | 'bot';
export type AiProvider = 'gemini' | 'ollama' | 'lmstudio';

export interface AiSettings {
  provider: AiProvider;
  endpoint?: string;
  model?: string;
  apiKey?: string;
}

export interface SponsoredEntity {
  name: string;
  type: 'business' | 'charity' | 'public' | 'individual';
  link: string;
  description: string;
}

export interface User {
  id: string;
  auth_uid?: string | null;
  username: string;
  display_name: string;
  email?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  type: 'human' | 'bot';
  role?: 'user' | 'admin' | 'moderator';
  followers_count?: number;
  following_count?: number;
  reputation_score?: number;
  cred_balance?: number;
  is_online?: boolean;
  last_seen?: string | null;
  is_live?: boolean;
  created_at?: string;
  updated_at?: string;

  // Optional UI/feature fields (may not be persisted to DB)
  cover_url?: string | null;
  custom_accent?: string | null;
  sponsored_entity?: SponsoredEntity | null;
  compute_tokens?: number;
  last_daily_cred?: string | null;
  is_following?: boolean;
  is_thinking?: boolean;
  active_stream_id?: string | null;
  blocked_users?: string[];
  view_count?: number;
  friends?: string[];
  ai_settings?: AiSettings | null;
  status_message?: string;

  // camelCase compatibility aliases during migration
  displayName?: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  customAccent?: string | null;
  sponsoredEntity?: SponsoredEntity | null;
  activeStreamId?: string | null;
  blockedUsers?: string[];
  aiSettings?: AiSettings | null;
  followersCount?: number;
  followingCount?: number;
  reputationScore?: number;
  credBalance?: number;
  isLive?: boolean;
  isOnline?: boolean;
}

export interface Post {
  id: string;
  author_id: string;
  content: string;
  media_url?: string | null;
  media_type?: 'image' | 'video' | null;
  likes: number;
  boosts: number;
  comments_count: number;
  shares_count: number;
  is_boosted: boolean;
  neural_tags: string[];
  last_comment_at?: string | null;
  created_at: string;
  updated_at: string;

  // Optional joined/denormalized data (populated client-side)
  author?: User;
  is_liked?: boolean;

  // camelCase / legacy aliases used in some UI paths
  authorId?: string;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'video' | null;
  commentsCount?: number;
  sharesCount?: number;
  isBoosted?: boolean;
  neuralTags?: string[];
  lastCommentAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  likes_count?: number;
  isLiked?: boolean;
  likesCount?: number;
}

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;

  // Optional joined data
  author?: User;
}

export interface PostLike {
  post_id: string;
  user_id: string;
  created_at: string;
}

export interface Transmission {
  id: string;
  participant_ids: any[];
  last_transmit?: any;
  unread_counts: Record<string, number>;
  typing_status?: Record<string, boolean>;
  created_at?: string;
  updated_at?: string;

  // camelCase compatibility aliases during migration
  participantIds?: any[];
  lastTransmit?: any;
  unreadCounts?: Record<string, number>;
  typingStatus?: Record<string, boolean>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Transmit {
  id: string;
  transmission_id: string;
  sender_id: string;
  receiver_id?: string;
  content: string;
  type: 'text' | 'media' | 'call';
  media_url?: string | null;
  media_type?: 'image' | 'video' | null;
  read_at?: string | null;
  burn_duration?: number | null;
  expires_at?: string | null;
  created_at: string;

  // camelCase aliases
  transmissionId?: string;
  senderId?: string;
  receiverId?: string;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'video' | null;
  readAt?: string | null;
  burnDuration?: number | null;
  expiresAt?: string | null;
  createdAt?: string;
}

export interface Stream {
  id: string;
  host_id: string;
  title?: string | null;
  is_live: boolean;
  crowd_size: number;
  started_at: string;
  ended_at?: string | null;
}

export interface StreamChat {
  id: string;
  stream_id: string;
  sender_id: string;
  sender_name?: string | null;
  text: string;
  created_at: string;
}

export interface VoidPost {
  id: string;
  content: string;
  decay_rate: number;
  view_count: number;
  like_count: number;
  is_anonymous: boolean;
  is_echo: boolean;
  expires_at: string;
  created_at: string;
}

export interface Bounty {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  reward: number;
  status: 'open' | 'in-progress' | 'review' | 'completed' | 'cancelled' | 'rejected';
  category?: string | null;
  assigned_bot_id?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  result?: string | null;
  proof_of_work?: string | null;
  created_at: string;

  // Optional joined/denormalized data
  creator?: User;
  assigned_bot?: User;
}

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  type: 'spend' | 'earn' | 'purchase';
  description?: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

export type BountyCategory =
  | 'general'
  | 'code'
  | 'design'
  | 'data'
  | 'content generation'
  | 'data analysis'
  | 'creative writing'
  | 'image synthesis'
  | 'code audit'
  | 'neural training'
  | 'sentiment analysis'
  | 'other';

export interface LiveStream {
  id: string;
  host_id?: string;
  host_display_name?: string;
  host_username?: string;
  host_avatar?: string;
  title?: string;
  is_live?: boolean;
  crowd_size?: number;
  started_at?: string;
  ended_at?: string | null;

  // camelCase compatibility aliases during migration
  hostId?: string;
  hostName?: string;
  hostUsername?: string;
  hostAvatar?: string;
  status?: 'live' | 'ended';
  crowdSize?: number;
  createdAt?: string;
  startedAt?: string;
  endedAt?: string | null;
}
