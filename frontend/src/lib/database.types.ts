export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          is_active?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admins_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
        ]
      }
      app_settings: {
        Row: {
          allowed_values: string[] | null
          created_at: string
          description: string
          key: string
          max_value: number | null
          min_value: number | null
          updated_at: string
          updated_by: string | null
          value: Json
          value_type: string
          venue_overridable: boolean
        }
        Insert: {
          allowed_values?: string[] | null
          created_at?: string
          description: string
          key: string
          max_value?: number | null
          min_value?: number | null
          updated_at?: string
          updated_by?: string | null
          value: Json
          value_type: string
          venue_overridable: boolean
        }
        Update: {
          allowed_values?: string[] | null
          created_at?: string
          description?: string
          key?: string
          max_value?: number | null
          min_value?: number | null
          updated_at?: string
          updated_by?: string | null
          value?: Json
          value_type?: string
          venue_overridable?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          id: number
          meta: Json
          target_id: string | null
          target_type: string | null
          venue_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          created_at?: string
          id?: never
          meta?: Json
          target_id?: string | null
          target_type?: string | null
          venue_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          id?: never
          meta?: Json
          target_id?: string | null
          target_type?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_audit_log_venue"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      bans: {
        Row: {
          created_at: string
          created_by: string | null
          device_id: string | null
          expires_at: string | null
          id: string
          lifted_at: string | null
          lifted_by: string | null
          phone_hash: string | null
          reason: string
          scope: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          expires_at?: string | null
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          phone_hash?: string | null
          reason: string
          scope: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          expires_at?: string | null
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          phone_hash?: string | null
          reason?: string
          scope?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bans_lifted_by_fkey"
            columns: ["lifted_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bans_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_terms: {
        Row: {
          created_at: string
          created_by: string | null
          term: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          term: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_terms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_requests: {
        Row: {
          conversation_id: string | null
          created_at: string
          expires_at: string
          from_session_id: string
          from_user_id: string
          id: string
          responded_at: string | null
          status: string
          to_session_id: string
          to_user_id: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          expires_at: string
          from_session_id: string
          from_user_id: string
          id?: string
          responded_at?: string | null
          status?: string
          to_session_id: string
          to_user_id: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          from_session_id?: string
          from_user_id?: string
          id?: string
          responded_at?: string | null
          status?: string
          to_session_id?: string
          to_user_id?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_requests_from_session_id_fkey"
            columns: ["from_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_requests_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_requests_to_session_id_fkey"
            columns: ["to_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_requests_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          created_at: string
          hidden_at: string | null
          last_read_message_id: number
          user_id: string
          visible_from_message_id: number
        }
        Insert: {
          conversation_id: string
          created_at?: string
          hidden_at?: string | null
          last_read_message_id?: number
          user_id: string
          visible_from_message_id?: number
        }
        Update: {
          conversation_id?: string
          created_at?: string
          hidden_at?: string | null
          last_read_message_id?: number
          user_id?: string
          visible_from_message_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          updated_at: string
          user_high_id: string
          user_low_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          updated_at?: string
          user_high_id: string
          user_low_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          updated_at?: string
          user_high_id?: string
          user_low_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_high_id_fkey"
            columns: ["user_high_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_low_id_fkey"
            columns: ["user_low_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          client_msg_id: string
          conversation_id: string
          created_at: string
          id: number
          sender_session_id: string | null
          sender_user_id: string
        }
        Insert: {
          body: string
          client_msg_id: string
          conversation_id: string
          created_at?: string
          id?: never
          sender_session_id?: string | null
          sender_user_id: string
        }
        Update: {
          body?: string
          client_msg_id?: string
          conversation_id?: string
          created_at?: string
          id?: never
          sender_session_id?: string | null
          sender_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_session_id_fkey"
            columns: ["sender_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_blocked: boolean
          birth_year: number | null
          consent_at: string | null
          consent_version: string | null
          created_at: string
          gender: string | null
          handle: string
          id: string
          nickname: string | null
          phone_hash: string
          preferred_language: string
          updated_at: string
        }
        Insert: {
          age_blocked?: boolean
          birth_year?: number | null
          consent_at?: string | null
          consent_version?: string | null
          created_at?: string
          gender?: string | null
          handle: string
          id: string
          nickname?: string | null
          phone_hash: string
          preferred_language?: string
          updated_at?: string
        }
        Update: {
          age_blocked?: boolean
          birth_year?: number | null
          consent_at?: string | null
          consent_version?: string | null
          created_at?: string
          gender?: string | null
          handle?: string
          id?: string
          nickname?: string | null
          phone_hash?: string
          preferred_language?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          created_at: string
          key: string
          window_start: string
        }
        Insert: {
          count: number
          created_at?: string
          key: string
          window_start: string
        }
        Update: {
          count?: number
          created_at?: string
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          away_since: string | null
          block_started_at: string
          created_at: string
          device_id: string | null
          end_reason: string | null
          ended_at: string | null
          expires_at: string
          final_deadline_at: string | null
          id: string
          is_offline: boolean
          kind: string
          last_lat: number | null
          last_lng: number | null
          last_seen_at: string
          last_taken_at: string | null
          location_checked_at: string | null
          location_state: string
          payment_grace_used: boolean
          resumed_from: string | null
          same_reading_count: number
          spoof_flags: Json
          start_accuracy_m: number | null
          start_distance_m: number | null
          started_at: string
          status: string
          table_id: string | null
          updated_at: string
          user_id: string
          venue_id: string
          warning_sent_at: string | null
        }
        Insert: {
          away_since?: string | null
          block_started_at?: string
          created_at?: string
          device_id?: string | null
          end_reason?: string | null
          ended_at?: string | null
          expires_at: string
          final_deadline_at?: string | null
          id?: string
          is_offline?: boolean
          kind: string
          last_lat?: number | null
          last_lng?: number | null
          last_seen_at?: string
          last_taken_at?: string | null
          location_checked_at?: string | null
          location_state: string
          payment_grace_used?: boolean
          resumed_from?: string | null
          same_reading_count?: number
          spoof_flags?: Json
          start_accuracy_m?: number | null
          start_distance_m?: number | null
          started_at?: string
          status?: string
          table_id?: string | null
          updated_at?: string
          user_id: string
          venue_id: string
          warning_sent_at?: string | null
        }
        Update: {
          away_since?: string | null
          block_started_at?: string
          created_at?: string
          device_id?: string | null
          end_reason?: string | null
          ended_at?: string | null
          expires_at?: string
          final_deadline_at?: string | null
          id?: string
          is_offline?: boolean
          kind?: string
          last_lat?: number | null
          last_lng?: number | null
          last_seen_at?: string
          last_taken_at?: string | null
          location_checked_at?: string | null
          location_state?: string
          payment_grace_used?: boolean
          resumed_from?: string | null
          same_reading_count?: number
          spoof_flags?: Json
          start_accuracy_m?: number | null
          start_distance_m?: number | null
          started_at?: string
          status?: string
          table_id?: string | null
          updated_at?: string
          user_id?: string
          venue_id?: string
          warning_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_resumed_from_fkey"
            columns: ["resumed_from"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_log: {
        Row: {
          created_at: string
          finished_at: string | null
          id: number
          phone_hash: string | null
          reason: string | null
          status: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: never
          phone_hash?: string | null
          reason?: string | null
          status: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: never
          phone_hash?: string | null
          reason?: string | null
          status?: string
        }
        Relationships: []
      }
      tables: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          qr_token: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          qr_token?: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          qr_token?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tables_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          id: string
          is_blocked: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_blocked?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_blocked?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_tags: {
        Row: {
          created_at: string
          tag_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          tag_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          tag_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
          venue_id: string
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
          venue_id: string
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_settings_key_fkey"
            columns: ["key"]
            isOneToOne: false
            referencedRelation: "app_settings"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "venue_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "venue_settings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          city: string | null
          closed_until: string | null
          created_at: string
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          name: string
          slug: string
          timezone: string
          type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          closed_until?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          name: string
          slug: string
          timezone?: string
          type: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          closed_until?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          name?: string
          slug?: string
          timezone?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_consent: { Args: { p_version: string }; Returns: undefined }
      active_ban_exists: {
        Args: {
          p_device_id: string
          p_phone_hash: string
          p_user_id: string
          p_venue_id?: string
        }
        Returns: boolean
      }
      admin_clear_venue_setting: {
        Args: { p_key: string; p_venue_id: string }
        Returns: undefined
      }
      admin_create_tables: {
        Args: { p_labels: string[]; p_venue_id: string }
        Returns: number
      }
      admin_create_venue: {
        Args: {
          p_address: string
          p_city: string
          p_latitude: number
          p_longitude: number
          p_name: string
          p_slug: string
          p_timezone?: string
          p_type: string
        }
        Returns: string
      }
      admin_get_venue: {
        Args: { p_venue_id: string }
        Returns: {
          address: string
          city: string
          closed_until: string
          created_at: string
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          name: string
          slug: string
          timezone: string
          type: string
          updated_at: string
        }[]
      }
      admin_list_tables: {
        Args: { p_venue_id: string }
        Returns: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          qr_token: string
        }[]
      }
      admin_list_venue_settings: {
        Args: { p_venue_id: string }
        Returns: {
          description: string
          global_value: Json
          key: string
          max_value: number
          min_value: number
          override_value: Json
          value_type: string
        }[]
      }
      admin_list_venues: {
        Args: never
        Returns: {
          city: string
          closed_until: string
          id: string
          is_active: boolean
          name: string
          slug: string
          table_count: number
          type: string
          updated_at: string
        }[]
      }
      admin_regenerate_qr_token: {
        Args: { p_table_id: string }
        Returns: string
      }
      admin_set_venue_active: {
        Args: { p_active: boolean; p_venue_id: string }
        Returns: undefined
      }
      admin_set_venue_pin: {
        Args: { p_latitude: number; p_longitude: number; p_venue_id: string }
        Returns: undefined
      }
      admin_set_venue_setting: {
        Args: { p_key: string; p_value: Json; p_venue_id: string }
        Returns: undefined
      }
      admin_test_location: {
        Args: {
          p_accuracy_m: number
          p_age_seconds: number
          p_latitude: number
          p_longitude: number
          p_venue_id: string
        }
        Returns: {
          buffer_m: number
          distance_m: number
          max_accuracy_m: number
          radius_m: number
          state: string
        }[]
      }
      admin_update_table: {
        Args: { p_is_active: boolean; p_label: string; p_table_id: string }
        Returns: undefined
      }
      admin_update_venue: {
        Args: {
          p_address: string
          p_city: string
          p_name: string
          p_slug: string
          p_timezone: string
          p_type: string
          p_venue_id: string
        }
        Returns: undefined
      }
      before_user_created_hook: { Args: { event: Json }; Returns: Json }
      can_send: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: boolean
      }
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window: string }
        Returns: undefined
      }
      continue_free: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["session_state"]
        SetofOptions: {
          from: "*"
          to: "session_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      end_my_session: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["session_state"]
        SetofOptions: {
          from: "*"
          to: "session_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      end_session: {
        Args: { p_reason: string; p_session_id: string }
        Returns: undefined
      }
      evaluate_location: {
        Args: {
          p_accuracy_m: number
          p_age_seconds: number
          p_latitude: number
          p_longitude: number
          p_venue_id: string
        }
        Returns: {
          distance_m: number
          state: string
        }[]
      }
      generate_handle: { Args: never; Returns: string }
      generate_qr_token: { Args: never; Returns: string }
      get_conversations: {
        Args: never
        Returns: {
          can_send: boolean
          conversation_id: string
          last_from_me: boolean
          last_message: string
          last_message_at: string
          partner_handle: string
          unread: number
        }[]
      }
      get_messages: {
        Args: {
          p_after_id?: number
          p_before_id?: number
          p_conversation_id: string
          p_limit?: number
        }
        Returns: {
          body: string
          created_at: string
          from_me: boolean
          message_id: number
          seen: boolean
        }[]
      }
      get_people: {
        Args: never
        Returns: {
          chat_state: string
          conversation_id: string
          handle: string
          online: boolean
          request_id: string
          session_id: string
          shared_tags: string[]
          tags: string[]
        }[]
      }
      get_requests: {
        Args: never
        Returns: {
          expires_at: string
          handle: string
          request_id: string
          shared_tags: string[]
          tags: string[]
        }[]
      }
      haversine_m: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      heartbeat: {
        Args: {
          p_accuracy_m?: number
          p_age_seconds?: number
          p_latitude?: number
          p_longitude?: number
          p_permission?: string
        }
        Returns: Database["public"]["CompositeTypes"]["session_state"]
        SetofOptions: {
          from: "*"
          to: "session_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      hourly_cleanup: { Args: never; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      is_blocked_pair: { Args: { p_a: string; p_b: string }; Returns: boolean }
      live_session_of: {
        Args: { p_user_id: string }
        Returns: {
          away_since: string | null
          block_started_at: string
          created_at: string
          device_id: string | null
          end_reason: string | null
          ended_at: string | null
          expires_at: string
          final_deadline_at: string | null
          id: string
          is_offline: boolean
          kind: string
          last_lat: number | null
          last_lng: number | null
          last_seen_at: string
          last_taken_at: string | null
          location_checked_at: string | null
          location_state: string
          payment_grace_used: boolean
          resumed_from: string | null
          same_reading_count: number
          spoof_flags: Json
          start_accuracy_m: number | null
          start_distance_m: number | null
          started_at: string
          status: string
          table_id: string | null
          updated_at: string
          user_id: string
          venue_id: string
          warning_sent_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      location_check: {
        Args: {
          p_accuracy_m: number
          p_age_seconds: number
          p_device_id: string
          p_latitude: number
          p_longitude: number
          p_qr_token: string
          p_slug: string
        }
        Returns: string
      }
      lock_live_session: {
        Args: { p_user_id: string }
        Returns: {
          away_since: string | null
          block_started_at: string
          created_at: string
          device_id: string | null
          end_reason: string | null
          ended_at: string | null
          expires_at: string
          final_deadline_at: string | null
          id: string
          is_offline: boolean
          kind: string
          last_lat: number | null
          last_lng: number | null
          last_seen_at: string
          last_taken_at: string | null
          location_checked_at: string | null
          location_state: string
          payment_grace_used: boolean
          resumed_from: string | null
          same_reading_count: number
          spoof_flags: Json
          start_accuracy_m: number | null
          start_distance_m: number | null
          started_at: string
          status: string
          table_id: string | null
          updated_at: string
          user_id: string
          venue_id: string
          warning_sent_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_seen: {
        Args: { p_conversation_id: string; p_up_to_message_id: number }
        Returns: undefined
      }
      my_profile: {
        Args: never
        Returns: {
          age_blocked: boolean
          birth_year: number
          consent_current: boolean
          gender: string
          handle: string
          nickname: string
          preferred_language: string
          profile_complete: boolean
          tags: string[]
        }[]
      }
      my_session: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["session_state"][]
        SetofOptions: {
          from: "*"
          to: "session_state"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      normalize_indian_mobile: { Args: { p_phone: string }; Returns: string }
      normalize_tag: { Args: { p_tag: string }; Returns: string }
      notify: {
        Args: { p_event: string; p_payload?: Json; p_topic: string }
        Returns: undefined
      }
      partner_of: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: string
      }
      phone_hash: { Args: { p_phone: string }; Returns: string }
      push_send_secret: { Args: never; Returns: string }
      push_subscription_gone: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      push_targets: {
        Args: { p_user_id: string }
        Returns: {
          auth: string
          endpoint: string
          p256dh: string
        }[]
      }
      queue_push: {
        Args: { p_event: string; p_payload: Json; p_user_id: string }
        Returns: undefined
      }
      raise_admin_write_error: {
        Args: { p_constraint: string; p_sqlstate: string }
        Returns: undefined
      }
      realtime_topic_allowed: {
        Args: { p_send: boolean; p_topic: string }
        Returns: boolean
      }
      request_between: {
        Args: { p_session_a: string; p_session_b: string }
        Returns: {
          conversation_id: string | null
          created_at: string
          expires_at: string
          from_session_id: string
          from_user_id: string
          id: string
          responded_at: string | null
          status: string
          to_session_id: string
          to_user_id: string
          updated_at: string
          venue_id: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_admin: { Args: never; Returns: undefined }
      require_guest: { Args: never; Returns: string }
      require_live_session: {
        Args: { p_user_id: string }
        Returns: {
          away_since: string | null
          block_started_at: string
          created_at: string
          device_id: string | null
          end_reason: string | null
          ended_at: string | null
          expires_at: string
          final_deadline_at: string | null
          id: string
          is_offline: boolean
          kind: string
          last_lat: number | null
          last_lng: number | null
          last_seen_at: string
          last_taken_at: string | null
          location_checked_at: string | null
          location_state: string
          payment_grace_used: boolean
          resumed_from: string | null
          same_reading_count: number
          spoof_flags: Json
          start_accuracy_m: number | null
          start_distance_m: number | null
          started_at: string
          status: string
          table_id: string | null
          updated_at: string
          user_id: string
          venue_id: string
          warning_sent_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      require_member: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: {
          conversation_id: string
          created_at: string
          hidden_at: string | null
          last_read_message_id: number
          user_id: string
          visible_from_message_id: number
        }
        SetofOptions: {
          from: "*"
          to: "conversation_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_scan: {
        Args: { p_qr_token: string; p_slug: string }
        Returns: {
          table_id: string
          table_label: string
          venue_id: string
        }[]
      }
      respond_chat_request: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: {
          conversation_id: string
        }[]
      }
      save_push_subscription: {
        Args: { p_auth: string; p_endpoint: string; p_p256dh: string }
        Returns: undefined
      }
      send_chat_request: {
        Args: { p_target_session_id: string }
        Returns: {
          conversation_id: string
          request_id: string
        }[]
      }
      send_message: {
        Args: {
          p_body: string
          p_client_msg_id: string
          p_conversation_id: string
        }
        Returns: {
          created_at: string
          message_id: number
        }[]
      }
      session_state_of: {
        Args: { p_session_id: string }
        Returns: Database["public"]["CompositeTypes"]["session_state"]
        SetofOptions: {
          from: "*"
          to: "session_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_tags: { Args: { p_names: string[] }; Returns: string[] }
      setting: { Args: { p_key: string; p_venue_id?: string }; Returns: Json }
      setting_bool: {
        Args: { p_key: string; p_venue_id?: string }
        Returns: boolean
      }
      setting_int: {
        Args: { p_key: string; p_venue_id?: string }
        Returns: number
      }
      setting_value_is_valid: {
        Args: {
          p_allowed_values: string[]
          p_max_value: number
          p_min_value: number
          p_value: Json
          p_value_type: string
        }
        Returns: boolean
      }
      sms_hook_check: {
        Args: { p_phone: string }
        Returns: {
          allowed: boolean
          log_id: number
          refusal: string
        }[]
      }
      sms_hook_finish: {
        Args: { p_error?: string; p_log_id: number; p_sent: boolean }
        Returns: undefined
      }
      start_session: {
        Args: {
          p_accuracy_m: number
          p_age_seconds: number
          p_device_id: string
          p_latitude: number
          p_longitude: number
          p_qr_token: string
          p_slug: string
        }
        Returns: Database["public"]["CompositeTypes"]["session_state"]
        SetofOptions: {
          from: "*"
          to: "session_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tag_is_blocked: { Args: { p_name: string }; Returns: boolean }
      tag_names: { Args: { p_user_id: string }; Returns: string[] }
      tag_suggestions: {
        Args: { p_query?: string }
        Returns: {
          name: string
          users: number
        }[]
      }
      tick: { Args: never; Returns: Json }
      update_profile: {
        Args: {
          p_birth_year: number
          p_gender: string
          p_language: string
          p_nickname: string
        }
        Returns: string
      }
      venue_public: {
        Args: { p_qr_token: string; p_slug: string }
        Returns: {
          payments_enabled: boolean
          scan_fee_enabled: boolean
          scan_fee_paise: number
          subscription_enabled: boolean
          subscription_price_paise: number
          subscription_scans: number
          table_label: string
          venue_name: string
          venue_type: string
        }[]
      }
      write_audit: {
        Args: {
          p_action: string
          p_actor_id: string
          p_actor_type: string
          p_meta?: Json
          p_target_id?: string
          p_target_type?: string
          p_venue_id?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      session_state: {
        session_id: string | null
        status: string | null
        end_reason: string | null
        kind: string | null
        venue_name: string | null
        table_label: string | null
        started_at: string | null
        expires_at: string | null
        warning_at: string | null
        final_deadline_at: string | null
        final_prompt_seconds: number | null
        away_since: string | null
        away_grace_seconds: number | null
        payments_enabled: boolean | null
        continue_free_minutes: number | null
        heartbeat_seconds: number | null
        location_seconds: number | null
        server_now: string | null
        venue_id: string | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
