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
  Modal,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useRouter } from 'expo-router';
import { useAuthContext } from '../../components/AuthProvider';
import { supabase } from '../../lib/supabase';
import { Clip } from '../../types';

const NUM_COLUMNS = 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const TILE_GAP = 2;
const TILE_SIZE = (SCREEN_WIDTH - TILE_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

interface ImportProgress {
  current: number;
  total: number;
  skipped: number;
}

interface AlbumWithCount {
  album: MediaLibrary.Album;
  videoCount: number;
}

export default function LibraryScreen() {
  const { user } = useAuthContext();
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [albumModalVisible, setAlbumModalVisible] = useState(false);
  const [albums, setAlbums] = useState<AlbumWithCount[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);

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

  const importSingleAsset = async (asset: {
    uri: string;
    assetId?: string | null;
    fileName?: string | null;
    duration?: number | null;
    width?: number | null;
    height?: number | null;
  }): Promise<'imported' | 'skipped' | 'error'> => {
    if (!user) return 'error';

    const deviceAssetId = asset.assetId ?? asset.uri;

    // Check for duplicate
    const { data: existing } = await supabase
      .from('clips')
      .select('id')
      .eq('user_id', user.id)
      .eq('device_asset_id', deviceAssetId)
      .maybeSingle();

    if (existing) return 'skipped';

    // Generate thumbnail
    let thumbnailUrl: string | null = null;
    try {
      const thumbnail = await VideoThumbnails.getThumbnailAsync(asset.uri, {
        time: 0,
      });

      if (thumbnail.uri) {
        const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

        const response = await fetch(thumbnail.uri);
        const blob = await response.blob();
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
        }
      }
    } catch {
      // Continue without thumbnail
    }

    const { error: insertError } = await supabase.from('clips').insert({
      user_id: user.id,
      device_asset_id: deviceAssetId,
      thumbnail_url: thumbnailUrl,
      filename: asset.fileName ?? null,
      duration: asset.duration ? Math.round(asset.duration / 1000) : null,
      width: asset.width ?? null,
      height: asset.height ?? null,
    });

    return insertError ? 'error' : 'imported';
  };

  const requestPermissions = async (): Promise<boolean> => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Please allow access to your photo library to import video clips.'
      );
      return false;
    }
    return true;
  };

  const selectVideos = async () => {
    try {
      if (!(await requestPermissions())) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsMultipleSelection: true,
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      setImporting(true);
      const total = result.assets.length;
      let skipped = 0;

      for (let i = 0; i < result.assets.length; i++) {
        setProgress({ current: i + 1, total, skipped });
        const video = result.assets[i];
        const status = await importSingleAsset({
          uri: video.uri,
          assetId: video.assetId,
          fileName: video.fileName,
          duration: video.duration,
          width: video.width,
          height: video.height,
        });
        if (status === 'skipped') skipped++;
      }

      await fetchClips();

      if (skipped > 0) {
        const imported = total - skipped;
        Alert.alert(
          'Import Complete',
          `${imported} clip${imported !== 1 ? 's' : ''} imported, ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped.`
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to import clips';
      Alert.alert('Error', message);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const openAlbumPicker = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please allow access to your photo library to import albums.'
        );
        return;
      }

      setLoadingAlbums(true);
      setAlbumModalVisible(true);

      const allAlbums = await MediaLibrary.getAlbumsAsync({
        includeSmartAlbums: true,
      });

      // Get video counts for each album
      const albumsWithCounts: AlbumWithCount[] = [];
      for (const album of allAlbums) {
        const { totalCount } = await MediaLibrary.getAssetsAsync({
          album: album,
          mediaType: MediaLibrary.MediaType.video,
          first: 0,
        });
        if (totalCount > 0) {
          albumsWithCounts.push({ album, videoCount: totalCount });
        }
      }

      albumsWithCounts.sort((a, b) => b.videoCount - a.videoCount);
      setAlbums(albumsWithCounts);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load albums';
      Alert.alert('Error', message);
      setAlbumModalVisible(false);
    } finally {
      setLoadingAlbums(false);
    }
  };

  const importAlbum = async (album: MediaLibrary.Album) => {
    setAlbumModalVisible(false);

    try {
      setImporting(true);

      let allAssets: MediaLibrary.Asset[] = [];
      let hasMore = true;
      let endCursor: string | undefined;

      while (hasMore) {
        const page = await MediaLibrary.getAssetsAsync({
          album,
          mediaType: MediaLibrary.MediaType.video,
          first: 100,
          after: endCursor,
          sortBy: [MediaLibrary.SortBy.creationTime],
        });
        allAssets = allAssets.concat(page.assets);
        hasMore = page.hasNextPage;
        endCursor = page.endCursor;
      }

      if (allAssets.length === 0) {
        Alert.alert('No Videos', 'This album has no video clips.');
        return;
      }

      const total = allAssets.length;
      let skipped = 0;
      let errors = 0;

      for (let i = 0; i < allAssets.length; i++) {
        setProgress({ current: i + 1, total, skipped });
        const asset = allAssets[i];
        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset);

        const status = await importSingleAsset({
          uri: assetInfo.localUri ?? asset.uri,
          assetId: asset.id,
          fileName: asset.filename,
          duration: asset.duration ? asset.duration * 1000 : null,
          width: asset.width,
          height: asset.height,
        });

        if (status === 'skipped') skipped++;
        if (status === 'error') errors++;
      }

      await fetchClips();

      const imported = total - skipped - errors;
      const parts: string[] = [];
      if (imported > 0) parts.push(`${imported} clip${imported !== 1 ? 's' : ''} imported`);
      if (skipped > 0) parts.push(`${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped`);
      if (errors > 0) parts.push(`${errors} error${errors !== 1 ? 's' : ''}`);

      Alert.alert('Import Complete', parts.join(', ') + '.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to import album';
      Alert.alert('Error', message);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const showAddOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Select Videos', 'Import Album'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) selectVideos();
          if (buttonIndex === 2) openAlbumPicker();
        }
      );
    } else {
      Alert.alert('Add Clips', 'Choose an import method', [
        { text: 'Select Videos', onPress: selectVideos },
        { text: 'Import Album', onPress: openAlbumPicker },
        { text: 'Cancel', style: 'cancel' },
      ]);
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

  const renderAlbumItem = ({ item }: { item: AlbumWithCount }) => (
    <TouchableOpacity
      style={styles.albumItem}
      onPress={() => importAlbum(item.album)}
      activeOpacity={0.7}
    >
      <Ionicons name="folder-outline" size={24} color="#007AFF" />
      <View style={styles.albumInfo}>
        <Text style={styles.albumName} numberOfLines={1}>
          {item.album.title}
        </Text>
        <Text style={styles.albumCount}>
          {item.videoCount} video{item.videoCount !== 1 ? 's' : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#555" />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const importOverlay = importing && progress && (
    <View style={styles.importOverlay}>
      <View style={styles.importCard}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.importText}>
          Importing {progress.current} of {progress.total}...
        </Text>
        {progress.skipped > 0 && (
          <Text style={styles.importSubtext}>
            {progress.skipped} duplicate{progress.skipped !== 1 ? 's' : ''} skipped
          </Text>
        )}
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${(progress.current / progress.total) * 100}%` },
            ]}
          />
        </View>
      </View>
    </View>
  );

  if (clips.length === 0 && !importing) {
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
            onPress={showAddOptions}
            disabled={importing}
          >
            <Ionicons name="add" size={24} color="#fff" />
            <Text style={styles.addButtonText}>Add Clips</Text>
          </TouchableOpacity>
        </View>
        {importOverlay}
        <AlbumModal
          visible={albumModalVisible}
          albums={albums}
          loading={loadingAlbums}
          onClose={() => setAlbumModalVisible(false)}
          renderAlbumItem={renderAlbumItem}
        />
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
        onPress={showAddOptions}
        disabled={importing}
        activeOpacity={0.8}
      >
        {importing && !progress ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="add" size={28} color="#fff" />
        )}
      </TouchableOpacity>
      {importOverlay}
      <AlbumModal
        visible={albumModalVisible}
        albums={albums}
        loading={loadingAlbums}
        onClose={() => setAlbumModalVisible(false)}
        renderAlbumItem={renderAlbumItem}
      />
    </View>
  );
}

interface AlbumModalProps {
  visible: boolean;
  albums: AlbumWithCount[];
  loading: boolean;
  onClose: () => void;
  renderAlbumItem: ({ item }: { item: AlbumWithCount }) => React.JSX.Element;
}

function AlbumModal({ visible, albums, loading, onClose, renderAlbumItem }: AlbumModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Select Album</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingAlbumsText}>Loading albums...</Text>
          </View>
        ) : albums.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="folder-open-outline" size={48} color="#555" />
            <Text style={styles.noAlbumsText}>No albums with videos found</Text>
          </View>
        ) : (
          <FlatList
            data={albums}
            renderItem={renderAlbumItem}
            keyExtractor={(item) => item.album.id}
            contentContainerStyle={styles.albumList}
          />
        )}
      </View>
    </Modal>
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
  importOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  importCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    width: SCREEN_WIDTH * 0.75,
  },
  importText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
  },
  importSubtext: {
    color: '#888',
    fontSize: 13,
    marginTop: 4,
  },
  progressBarTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  albumList: {
    padding: 8,
  },
  albumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  albumInfo: {
    flex: 1,
    marginLeft: 12,
  },
  albumName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#fff',
  },
  albumCount: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  loadingAlbumsText: {
    color: '#888',
    fontSize: 14,
    marginTop: 12,
  },
  noAlbumsText: {
    color: '#888',
    fontSize: 14,
    marginTop: 12,
  },
});
