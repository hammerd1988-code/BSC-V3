// Auto-generated from Supabase project kxfhxrdrlvnvtzdeuvwb
// Do not edit manually – run pnpm supabase gen types typescript instead

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      active_threats: {
        Row: { created_at: string; id: string; severity: string; source: string | null; summary: string | null }
        Insert: { created_at?: string; id?: string; severity: string; source?: string | null; summary?: string | null }
        Update: { created_at?: string; id?: string; severity?: string; source?: string | null; summary?: string | null }
      }
      comments: {
        Row: { author_id: string; content: string; created_at: string; id: string; post_id: string }
        Insert: { author_id: string; content: string; created_at?: string; id?: string; post_id: string }
        Update: Partial<Database['public']['Tables']['comments']['Insert']>
      }
      notifications: {
        Row: { created_at: string; id: string; is_read: boolean; payload: Json; type: string; user_id: string }
        Insert: { created_at?: string; id?: string; is_read?: boolean; payload?: Json; type: string; user_id: string }
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
      }
      post_likes: {
        Row: { created_at: string; post_id: string; user_id: string }
        Insert: { created_at?: string; post_id: string; user_id: string }
        Update: Partial<Database['public']['Tables']['post_likes']['Insert']>
      }
      posts: {
        Row: {
          author_id: string; boosts: number; comments_count: number; content: string
          created_at: string; id: string; is_boosted: boolean; last_comment_at: string | null
          likes_count: number; media_type: string | null; media_url: string | null; neural_tags: string[]
          shares_count: number; type: string | null; updated_at: string
        }
        Insert: {
          author_id: string; boosts?: number; comments_count?: number; content: string
          created_at?: string; id?: string; is_boosted?: boolean; last_comment_at?: string | null
          likes_count?: number; media_type?: string | null; media_url?: string | null; neural_tags?: string[]
          shares_count?: number; type?: string | null; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['posts']['Insert']>
      }
      stream_chat: {
        Row: { created_at: string; id: string; sender_id: string; sender_name: string | null; stream_id: string; text: string }
        Insert: { created_at?: string; id?: string; sender_id: string; sender_name?: string | null; stream_id: string; text: string }
        Update: Partial<Database['public']['Tables']['stream_chat']['Insert']>
      }
      streams: {
        Row: {
          crowd_size: number; ended_at: string | null; host_avatar: string | null
          host_display_name: string | null; host_id: string; host_username: string | null
          id: string; is_live: boolean; started_at: string; title: string | null
        }
        Insert: {
          crowd_size?: number; ended_at?: string | null; host_avatar?: string | null
          host_display_name?: string | null; host_id: string; host_username?: string | null
          id?: string; is_live?: boolean; started_at?: string; title?: string | null
        }
        Update: Partial<Database['public']['Tables']['streams']['Insert']>
      }
      transactions: {
        Row: { amount: number; created_at: string; description: string | null; id: string; type: string; user_id: string }
        Insert: { amount: number; created_at?: string; description?: string | null; id?: string; type: string; user_id: string }
        Update: Partial<Database['public']['Tables']['transactions']['Insert']>
      }
      transmissions: {
        Row: {
          created_at: string; id: string; last_transmit: Json | null
          participant_ids: string[]; typing_status: Json; unread_counts: Json; updated_at: string
        }
        Insert: {
          created_at?: string; id?: string; last_transmit?: Json | null
          participant_ids: string[]; typing_status?: Json; unread_counts?: Json; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['transmissions']['Insert']>
      }
      transmits: {
        Row: {
          burn_duration: number | null; content: string; created_at: string
          encryption_key: string | null; expires_at: string | null; id: string
          media_type: string | null; media_url: string | null; read_at: string | null
          sender_id: string; transmission_id: string; type: string
        }
        Insert: {
          burn_duration?: number | null; content: string; created_at?: string
          encryption_key?: string | null; expires_at?: string | null; id?: string
          media_type?: string | null; media_url?: string | null; read_at?: string | null
          sender_id: string; transmission_id: string; type?: string
        }
        Update: Partial<Database['public']['Tables']['transmits']['Insert']>
      }
      users: {
        Row: {
          active_stream_id: string | null; ai_settings: Json | null; auth_uid: string | null
          avatar_url: string | null; bio: string | null; blocked_users: string[]
          compute_tokens: number; cover_url: string | null; created_at: string; cred_balance: number
          custom_accent: string | null; display_name: string; email: string | null
          followers_count: number; following_count: number; friends: string[]; id: string
          is_live: boolean; is_online: boolean; last_daily_cred: string | null; last_seen: string | null
          reputation_score: number; role: string; sponsored_entity: Json | null
          status_message: string | null; type: string; updated_at: string; username: string; view_count: number
        }
        Insert: {
          active_stream_id?: string | null; ai_settings?: Json | null; auth_uid?: string | null
          avatar_url?: string | null; bio?: string | null; blocked_users?: string[]
          compute_tokens?: number; cover_url?: string | null; created_at?: string; cred_balance?: number
          custom_accent?: string | null; display_name: string; email?: string | null
          followers_count?: number; following_count?: number; friends?: string[]; id: string
          is_live?: boolean; is_online?: boolean; last_daily_cred?: string | null; last_seen?: string | null
          reputation_score?: number; role?: string; sponsored_entity?: Json | null
          status_message?: string | null; type?: string; updated_at?: string; username: string; view_count?: number
        }
        Update: Partial<Database['public']['Tables']['users']['Insert']>
      }
      void_posts: {
        Row: {
          content: string; created_at: string; decay_rate: number; expires_at: string
          id: string; is_anonymous: boolean; is_echo: boolean; like_count: number; view_count: number
        }
        Insert: {
          content: string; created_at?: string; decay_rate?: number; expires_at: string
          id?: string; is_anonymous?: boolean; is_echo?: boolean; like_count?: number; view_count?: number
        }
        Update: Partial<Database['public']['Tables']['void_posts']['Insert']>
      }
    }
  }
}

// Convenience row types
export type DBUser         = Database['public']['Tables']['users']['Row']
export type DBPost         = Database['public']['Tables']['posts']['Row']
export type DBComment      = Database['public']['Tables']['comments']['Row']
export type DBTransmission = Database['public']['Tables']['transmissions']['Row']
export type DBTransmit     = Database['public']['Tables']['transmits']['Row']
export type DBStream       = Database['public']['Tables']['streams']['Row']
export type DBStreamChat   = Database['public']['Tables']['stream_chat']['Row']
export type DBVoidPost     = Database['public']['Tables']['void_posts']['Row']
export type DBTransaction  = Database['public']['Tables']['transactions']['Row']
export type DBNotification = Database['public']['Tables']['notifications']['Row']
export type DBPostLike     = Database['public']['Tables']['post_likes']['Row']
export type DBActiveThreat = Database['public']['Tables']['active_threats']['Row']
