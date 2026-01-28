import { Session, User } from '@supabase/supabase-js';

// Auth types
export interface AuthState {
  user: User | null;
  session: Session | null;
  initialized: boolean;
  loading: boolean;
}

// Database types
export interface Profile {
  id: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface Clip {
  id: string;
  user_id: string;
  device_asset_id: string;
  thumbnail_url: string | null;
  filename: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
}

export interface Label {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface ClipLabel {
  id: string;
  clip_id: string;
  label_id: string;
  created_at: string;
}

// View types
export interface ClipWithLabels extends Clip {
  labels: string[];
  label_ids: string[];
}

export interface LabelWithCount extends Label {
  clip_count: number;
}

// Database schema type for Supabase
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
      };
      clips: {
        Row: Clip;
        Insert: Omit<Clip, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Clip, 'id' | 'user_id' | 'created_at'>>;
      };
      labels: {
        Row: Label;
        Insert: Omit<Label, 'id' | 'created_at'>;
        Update: Partial<Omit<Label, 'id' | 'user_id' | 'created_at'>>;
      };
      clip_labels: {
        Row: ClipLabel;
        Insert: Omit<ClipLabel, 'id' | 'created_at'>;
        Update: never;
      };
    };
    Views: {
      clips_with_labels: {
        Row: ClipWithLabels;
      };
      labels_with_counts: {
        Row: LabelWithCount;
      };
    };
  };
}
