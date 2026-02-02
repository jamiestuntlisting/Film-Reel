import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useRouter } from 'expo-router';
import { useAuthContext } from '../../components/AuthProvider';
import { supabase } from '../../lib/supabase';
import { Clip } from '../../types';

const NUM_COLUMNS = 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE_GAP = 2;
const TILE_SIZE = (SCREEN_WIDTH - TILE_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

export default function LibraryScreen() {
  const { user } = useAuthContext();
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const fetchClips = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('clips')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClips(data ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to fetch clips:', message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchClips();
  }, [fetchClips]);

  const addClip = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please allow access to your photo library to import video clips.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      setImporting(true);

      const video = result.assets[0];
      const deviceAssetId = video.assetId ?? video.uri;

      // Check for duplicate
      if (user) {
        const { data: existing } = await supabase
          .from('clips')
          .select('id')
          .eq('user_id', user.id)
          .eq('device_asset_id', deviceAssetId)
          .maybeSingle();

        if (existing) {
          Alert.alert('Already Added', 'This clip is already in your library.');
          setImporting(false);
          return;
        }
      }

      // Generate thumbnail
      let thumbnailUrl: string | null = null;
      try {
        const thumbnail = await VideoThumbnails.getThumbnailAsync(video.uri, {
          time: 0,
        });

        // Upload thumbnail to Supabase Storage
        if (user && thumbnail.uri) {
          const fileExt = 'jpg';
          const fileName = `${user.id}/${Date.now()}.${fileExt}`;

          const response = await fetch(thumbnail.uri);
          const blob = await response.blob();

          // Convert blob to arraybuffer for Supabase upload
          const arrayBuffer = await new Response(blob).arrayBuffer();

          const { error: uploadError } = await supabase.storage
            .from('thumbnails')
            .upload(fileName, arrayBuffer, {
              contentType: 'image/jpeg',
              upsert: false,
            });

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from('thumbnails')
              .getPublicUrl(fileName);
            thumbnailUrl = urlData.publicUrl;
          } else {
            console.warn('Thumbnail upload failed:', uploadError.message);
          }
        }
      } catch (thumbErr) {
        console.warn('Thumbnail generation failed, continuing without thumbnail');
      }

      // Insert clip metadata
      if (!user) return;

      const { error: insertError } = await supabase.from('clips').insert({
        user_id: user.id,
        device_asset_id: deviceAssetId,
        thumbnail_url: thumbnailUrl,
        filename: video.fileName ?? null,
        duration: video.duration ? Math.round(video.duration / 1000) : null,
        width: video.width ?? null,
        height: video.height ?? null,
      });

      if (insertError) {
        throw insertError;
      }

      await fetchClips();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add clip';
      Alert.alert('Error', message);
    } finally {
      setImporting(false);
    }
  };

  const renderClip = ({ item }: { item: Clip }) => (
    <TouchableOpacity
      style={styles.tile}
      onPress={() => router.push(`/clip/${item.id}`)}
      activeOpacity={0.7}
    >
      {item.thumbnail_url ? (
        <Image source={{ uri: item.thumbnail_url }} style={styles.thumbnail} />
      ) : (
        <View style={styles.placeholderThumbnail}>
          <Ionicons name="film-outline" size={28} color="#555" />
        </View>
      )}
      {item.duration != null && (
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (clips.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Ionicons name="film-outline" size={64} color="#555" />
          <Text style={styles.emptyTitle}>No clips yet</Text>
          <Text style={styles.emptySubtitle}>
            Import video clips from your camera roll to get started
          </Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={addClip}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="add" size={24} color="#fff" />
            )}
            <Text style={styles.addButtonText}>
              {importing ? 'Importing...' : 'Add Clip'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={clips}
        renderItem={renderClip}
        keyExtractor={(item) => item.id}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={addClip}
        disabled={importing}
        activeOpacity={0.8}
      >
        {importing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="add" size={28} color="#fff" />
        )}
      </TouchableOpacity>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  centered: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  grid: {
    padding: TILE_GAP,
  },
  row: {
    gap: TILE_GAP,
    marginBottom: TILE_GAP,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#2a2a2a',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  placeholderThumbnail: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '500',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
});
