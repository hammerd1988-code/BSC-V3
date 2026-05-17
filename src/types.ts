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

export type ProfileLayout = 'developer' | 'showcase' | 'minimal';
export type SkillProficiency = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type FactionRole = 'member' | 'captain' | 'admin' | 'founder';
export type SubscriptionTier = 'free' | 'pro' | 'infinity';
export type ReportTargetType = 'post' | 'comment' | 'profile' | 'bot' | 'faction' | 'faction_post' | 'void_post' | 'battle' | 'other';
export type ReportReason = 'harassment' | 'hate' | 'sexual_content' | 'violence' | 'spam' | 'impersonation' | 'self_harm' | 'illegal_activity' | 'other';
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface SkillManifestItem {
  name: string;
  level: SkillProficiency;
}

export interface Faction {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon_url?: string | null;
  banner_url?: string | null;
  director_playbook?: FactionDirectorPlaybook | null;
  created_by?: string | null;
  member_count: number;
  created_at: string;
  updated_at?: string;
}

export interface FactionDirectorPlaybook {
  doctrine?: string;
  botPostingStyle?: string;
  battleEtiquette?: string;
  trashTalkTone?: string;
  rivalryDirectives?: string;
  allianceDirectives?: string;
  recruitmentPitch?: string;
  safetyBoundaries?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface FactionMember {
  id: string;
  faction_id: string;
  user_id: string;
  role: FactionRole;
  joined_at: string;
  user?: User;
  faction?: Faction;
}

export interface FactionPost {
  id: string;
  faction_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at?: string;
  user?: User;
}

export interface ContentReport {
  id: string;
  reporter_id?: string | null;
  reporterId?: string | null;
  target_type: ReportTargetType;
  targetType?: ReportTargetType;
  target_id: string;
  targetId?: string;
  target_owner_id?: string | null;
  targetOwnerId?: string | null;
  target_label?: string | null;
  targetLabel?: string | null;
  target_path?: string | null;
  targetPath?: string | null;
  reason: ReportReason;
  details?: string | null;
  status: ReportStatus;
  admin_notes?: string | null;
  adminNotes?: string | null;
  reviewed_by?: string | null;
  reviewedBy?: string | null;
  reviewed_at?: string | null;
  reviewedAt?: string | null;
  created_at: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  reporter?: User | null;
}

export interface UserActivityDaily {
  user_id: string;
  date: string;
  posts_count: number;
  comments_count: number;
  battles_count: number;
  cred_earned: number;
  created_at?: string;
  updated_at?: string;
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
  subscription_tier?: SubscriptionTier;
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
  friend_requests?: any[] | null;
  ai_settings?: AiSettings | null;
  status_message?: string;
  // Engagement + profile customization
  current_streak?: number;
  longest_streak?: number;
  last_active_date?: string | null;
  onboarding_complete?: boolean;
  profile_music_url?: string | null;
  profile_music_title?: string | null;
  profile_music_artist?: string | null;
  profile_theme?: any | null;
  profile_sections?: any[] | null;
  referral_count?: number;
  referred_by?: string | null;
  owned_bot_ids?: string[];
  tech_stack?: string[];
  currently_building?: string | null;
  profile_layout?: ProfileLayout;
  skills_manifest?: SkillManifestItem[];
  looking_for?: string[];

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
  techStack?: string[];
  currentlyBuilding?: string | null;
  profileLayout?: ProfileLayout;
  skillsManifest?: SkillManifestItem[];
  lookingFor?: string[];
  subscriptionTier?: SubscriptionTier;
}

export interface Post {
  id: string;
  author_id: string;
  content: string;
  media_url?: string | null;
  media_type?: 'image' | 'video' | null;
  likes: number;
  likes_count: number;
  boosts: number;
  comments_count: number;
  shares_count: number;
  is_boosted: boolean;
  neural_tags: string[];
  faction_id?: string | null;
  last_comment_at?: string | null;
  created_at: string;
  updated_at?: string;  // posts table has no updated_at column

  // Optional joined/denormalized data (populated client-side)
  author?: User;
  is_liked?: boolean;
  view_count?: number;
  poll_data?: any | null;

  // camelCase / legacy aliases used in some UI paths
  authorId?: string;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'video' | null;
  commentsCount?: number;
  sharesCount?: number;
  isBoosted?: boolean;
  neuralTags?: string[];
  factionId?: string | null;
  lastCommentAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
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

export interface TransmissionLastTransmit {
  content: string;
  sender_id: string;
  created_at: string;
}

export interface Transmission {
  id: string;
  participant_ids: string[];
  last_transmit?: TransmissionLastTransmit | null;
  unread_counts: Record<string, number>;
  typing_status?: Record<string, boolean>;
  created_at?: string;
  updated_at?: string;
}

export interface Transmit {
  id: string;
  transmission_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  type: 'text' | 'media' | 'call';
  media_url?: string | null;
  media_type?: 'image' | 'video' | null;
  read_at?: string | null;
  status?: 'sent' | 'delivered' | 'seen';
  delivered_at?: string | null;
  seen_at?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  attachment_mime?: string | null;
  burn_duration?: number | null;
  expires_at?: string | null;
  encryption_key?: string | null;
  created_at: string;
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
  author_id?: string | null;
  content: string;
  decay_rate: number;
  view_count: number;
  like_count: number;
  is_anonymous: boolean;
  is_echo: boolean;
  expires_at: string;
  created_at: string;
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
