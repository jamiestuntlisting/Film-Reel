# FILM REEL PROJECT CONTEXT

## Project Overview
Film Reel is a cross-platform mobile app (iOS and Android) that lets users import video clips from their device, add searchable keyword labels/tags, and quickly find footage by searching those tags.

Primary use case: Stunt performers and coordinators organizing demo reel footage by skill type.

## Tech Stack
- **Framework**: React Native with Expo SDK 52+
- **Language**: TypeScript (strict mode)
- **Navigation**: Expo Router (file-based routing)
- **Backend**: Supabase (Auth, Postgres, Storage)
- **Styling**: React Native StyleSheet

## Key Libraries
- `expo-media-library` for device video access
- `expo-video-thumbnails` for thumbnail generation
- `expo-av` for video playback
- `expo-secure-store` for credential storage
- `@supabase/supabase-js` for backend

## Database Tables
- `profiles`: User profile data
- `clips`: Video clip metadata (device_asset_id, thumbnail_url, duration)
- `labels`: User's labels/tags
- `clip_labels`: Junction table linking clips to labels

## Database Views
- `clips_with_labels`: Clips with their labels as an array
- `labels_with_counts`: Labels with usage counts

## Coding Conventions
- Functional components with hooks only
- Props interfaces defined above component
- StyleSheet.create() for styles at bottom of file
- Always handle loading and error states
- Filter by user_id in all queries

## Important Notes
- Video files stay on device, only metadata syncs
- Thumbnails upload to Supabase Storage
- Row Level Security is enabled on all tables
- Test on physical devices for media library access

## App Structure
```
app/
  _layout.tsx           # Root layout with auth provider
  (auth)/               # Public auth routes
    _layout.tsx
    sign-in.tsx
    sign-up.tsx
  (tabs)/               # Protected tab routes
    _layout.tsx
    index.tsx           # Library view
    labels.tsx          # Labels view
    settings.tsx        # Settings view
  clip/[id].tsx         # Clip detail view
components/
lib/
  supabase.ts           # Supabase client
hooks/
  useAuth.ts            # Authentication hook
types/
  index.ts              # TypeScript types
```
