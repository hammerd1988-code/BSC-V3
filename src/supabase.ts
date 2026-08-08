import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Support multiple env var naming conventions:
// - VITE_SUPABASE_*            (standard Vite)
// - NEXT_PUBLIC_SUPABASE_*     (v0 Supabase integration default)
// - VITE_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY (new `sb_publishable_*` keys)
const productionUrl = 'https://kxfhxrdrlvnvtzdeuvwb.supabase.co';
const productionPublishableKey = 'sb_publishable_xCCZOJtesOfHR_EOvBCjHA_gWy-Sb9A';

// Port the Supabase CLI serves the local API on when config.toml declares no
// [api] section, which is what `supabase start` gives this repo. The key is the
// CLI's fixed demo anon token: it is public, identical on every machine, and
// only valid against a local instance using the default JWT secret.
const localUrl = 'http://127.0.0.1:54321';
const localAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9' +
  '.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const configuredUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  import.meta.env.SUPABASE_PROJECT_URL;

const configuredKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  import.meta.env.SUPABASE_ANON_KEY;

// Deployed builds keep falling back to the production project, because the
// hosting platforms do not all set the env vars. `npm run dev` must not: an
// unconfigured checkout silently reading and writing production data is how a
// local experiment becomes a live one. Vite inlines PROD at build time, so this
// only changes the dev server.
const usingFallback = !configuredUrl || !configuredKey;
const url = configuredUrl || (import.meta.env.PROD ? productionUrl : localUrl);
const key = configuredKey || (import.meta.env.PROD ? productionPublishableKey : localAnonKey);

if (usingFallback && !import.meta.env.PROD) {
  console.error(
    '[supabase] No Supabase URL / publishable key configured, so requests are going to the local ' +
      `Supabase at ${localUrl} instead of the production project. Copy .env.example to .env.local ` +
      'and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (run `supabase start` for local values).',
  );
} else if (usingFallback) {
  console.warn('[supabase] Falling back to the built-in production project; set VITE_SUPABASE_URL.');
}

export const supabase: SupabaseClient = createClient(
  url,
  key,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  }
);

/**
 * Logical collection/table alias → Postgres table name.
 * App conventions use camelCase / singular; Postgres uses snake_case.
 */
export const COLLECTION_TO_TABLE: Record<string, string> = {
  users: 'users',
  posts: 'posts',
  comments: 'comments',
  post_likes: 'post_likes',
  transmissions: 'transmissions',
  transmits: 'transmits',
  streams: 'streams',
  live_streams: 'streams',
  stream_chat: 'stream_chat',
  messages: 'stream_chat',
  void_posts: 'void_posts',
  transactions: 'transactions',
  notifications: 'notifications',
  active_threats: 'active_threats',
  content_reports: 'content_reports',
  test: 'users',
};

export function tableFor(collectionName: string): string {
  return COLLECTION_TO_TABLE[collectionName] ?? collectionName;
}

const CAMEL_TO_SNAKE: Record<string, string> = {
  authorId: 'author_id',
  postId: 'post_id',
  userId: 'user_id',
  senderId: 'sender_id',
  receiverId: 'receiver_id',
  creatorId: 'creator_id',
  assignedBotId: 'assigned_bot_id',
  hostId: 'host_id',
  streamId: 'stream_id',
  transmissionId: 'transmission_id',
  participantIds: 'participant_ids',
  displayName: 'display_name',
  avatarUrl: 'avatar_url',
  coverUrl: 'cover_url',
  customAccent: 'custom_accent',
  mediaUrl: 'media_url',
  mediaType: 'media_type',
  readAt: 'read_at',
  burnDuration: 'burn_duration',
  expiresAt: 'expires_at',
  createdAt: 'created_at',
  lastCommentAt: 'last_comment_at',
  lastTransmit: 'last_transmit',
  unreadCounts: 'unread_counts',
  typingStatus: 'typing_status',
  likesCount: 'likes',
  commentsCount: 'comments_count',
  sharesCount: 'shares_count',
  isBoosted: 'is_boosted',
  isLive: 'is_live',
  isOnline: 'is_online',
  isEcho: 'is_echo',
  isAnonymous: 'is_anonymous',
  activeStreamId: 'active_stream_id',
  lastSeen: 'last_seen',
  lastDailyCred: 'last_daily_cred',
  credBalance: 'cred_balance',
  computeTokens: 'compute_tokens',
  reputationScore: 'reputation_score',
  followersCount: 'followers_count',
  followingCount: 'following_count',
  blockedUsers: 'blocked_users',
  neuralTags: 'neural_tags',
  hostDisplayName: 'host_display_name',
  hostUsername: 'host_username',
  hostAvatar: 'host_avatar',
  senderName: 'sender_name',
  viewCount: 'view_count',
  likeCount: 'like_count',
  decayRate: 'decay_rate',
  crowdSize: 'crowd_size',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  scheduledFor: 'scheduled_for',
  contentType: 'content_type',
  thumbnailUrl: 'thumbnail_url',
  dueDate: 'due_date',
  completedAt: 'completed_at',
  proofOfWork: 'proof_of_work',
  reviewComment: 'review_comment',
  sponsoredEntity: 'sponsored_entity',
  aiSettings: 'ai_settings',
  statusMessage: 'status_message',
  techStack: 'tech_stack',
  currentlyBuilding: 'currently_building',
  profileLayout: 'profile_layout',
  skillsManifest: 'skills_manifest',
  lookingFor: 'looking_for',
  factionId: 'faction_id',
  directorPlaybook: 'director_playbook',
  reporterId: 'reporter_id',
  targetType: 'target_type',
  targetId: 'target_id',
  targetOwnerId: 'target_owner_id',
  targetLabel: 'target_label',
  targetPath: 'target_path',
  adminNotes: 'admin_notes',
  reviewedBy: 'reviewed_by',
  reviewedAt: 'reviewed_at',
};

const SNAKE_TO_CAMEL: Record<string, string> = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE).map(([k, v]) => [v, k]),
);

export function toDb<T extends Record<string, any>>(obj: T): Record<string, any> {
  if (!obj || typeof obj !== 'object') return obj as any;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = CAMEL_TO_SNAKE[k] ?? k;
    out[key] = v;
  }
  return out;
}

export function fromDb<T extends Record<string, any>>(row: T | null): any {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = SNAKE_TO_CAMEL[k] ?? k;
    out[key] = v;
  }
  return out;
}

export function mapFieldName(field: string): string {
  return CAMEL_TO_SNAKE[field] ?? field;
}

/**
 * Convert an ISO timestamp string (or legacy timestamp object) to a
 * relative human-readable string.
 */
export function formatTimestamp(value: string | null | undefined | { toDate?: () => Date }): string {
  if (!value) return '';
  const date =
    value && typeof value === 'object' && typeof (value as any).toDate === 'function'
      ? (value as any).toDate()
      : new Date(value as string);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return date.toLocaleDateString();
}

/** Run a Supabase query and return the data or null, logging errors in dev. */
export async function safeQuery<T>(
  fn: () => Promise<{ data: T | null; error: any }>
): Promise<T | null> {
  const { data, error } = await fn();
  if (error) {
    if (import.meta.env.DEV) console.error('[supabase]', error.message ?? error);
    return null;
  }
  return data;
}
