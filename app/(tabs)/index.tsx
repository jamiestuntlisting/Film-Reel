import { useState, useEffect, useCallback, useMemo } from 'react';
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
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useRouter } from 'expo-router';
import { useAuthContext } from '../../components/AuthProvider';
import { supabase } from '../../lib/supabase';
import { ClipWithLabels, Label } from '../../types';

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

interface PendingAsset {
  uri: string;
  assetId?: string | null;
  fileName?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

export default function LibraryScreen() {
  const { user } = useAuthContext();
  const router = useRouter();
  const [clips, setClips] = useState<ClipWithLabels[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [albumModalVisible, setAlbumModalVisible] = useState(false);
  const [albums, setAlbums] = useState<AlbumWithCount[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);

  // Search / filter
  const [searchText, setSearchText] = useState('');
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);

  // Tag picker state
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [pendingAssets, setPendingAssets] = useState<PendingAsset[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());
  const [newLabelText, setNewLabelText] = useState('');

  const fetchClips = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('clips_with_labels')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClips(
        (data ?? []).map((c) => ({
          ...c,
          labels: c.labels ?? [],
          label_ids: c.label_ids ?? [],
        }))
      );
    } catch (err: unknown) {
      // Fallback to clips table if view doesn't exist
      try {
        const { data, error } = await supabase
          .from('clips')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setClips(
          (data ?? []).map((c) => ({ ...c, labels: [], label_ids: [] }))
        );
      } catch (fallbackErr: unknown) {
        const message =
          fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error';
        console.error('Failed to fetch clips:', message);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchLabels = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('labels')
        .select('*')
        .eq('user_id', user.id)
        .order('name');
      if (error) throw error;
      setAllLabels(data ?? []);
    } catch {
      // Labels table might not have data yet
    }
  }, [user]);

  useEffect(() => {
    fetchClips();
    fetchLabels();
  }, [fetchClips, fetchLabels]);

  const filteredClips = useMemo(() => {
    let result = clips;
    if (activeFilterId) {
      result = result.filter((c) => c.label_ids.includes(activeFilterId));
    }
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.labels.some((l) => l.toLowerCase().includes(query)) ||
          (c.filename && c.filename.toLowerCase().includes(query))
      );
    }
    return result;
  }, [clips, activeFilterId, searchText]);

  // ── Import logic ──────────────────────────────────────────────────────

  const importSingleAsset = async (
    asset: PendingAsset,
    labelIds: string[]
  ): Promise<'imported' | 'skipped' | 'error'> => {
    if (!user) return 'error';

    const deviceAssetId = asset.assetId ?? asset.uri;

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

    const { data: insertData, error: insertError } = await supabase
      .from('clips')
      .insert({
        user_id: user.id,
        device_asset_id: deviceAssetId,
        thumbnail_url: thumbnailUrl,
        filename: asset.fileName ?? null,
        duration: asset.duration ? Math.round(asset.duration / 1000) : null,
        width: asset.width ?? null,
        height: asset.height ?? null,
      })
      .select('id')
      .single();

    if (insertError || !insertData) return 'error';

    // Attach labels
    if (labelIds.length > 0) {
      await supabase.from('clip_labels').insert(
        labelIds.map((labelId) => ({
          clip_id: insertData.id,
          label_id: labelId,
        }))
      );
    }

    return 'imported';
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

      if (result.canceled || !result.assets || result.assets.length === 0)
        return;

      const assets: PendingAsset[] = result.assets.map((v) => ({
        uri: v.uri,
        assetId: v.assetId,
        fileName: v.fileName,
        duration: v.duration,
        width: v.width,
        height: v.height,
      }));

      setPendingAssets(assets);
      setSelectedLabelIds(new Set());
      setNewLabelText('');
      await fetchLabels();
      setTagPickerVisible(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to select videos';
      Alert.alert('Error', message);
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
      const message =
        err instanceof Error ? err.message : 'Failed to load albums';
      Alert.alert('Error', message);
      setAlbumModalVisible(false);
    } finally {
      setLoadingAlbums(false);
    }
  };

  const selectAlbum = async (album: MediaLibrary.Album) => {
    setAlbumModalVisible(false);

    try {
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

      const assets: PendingAsset[] = [];
      for (const asset of allAssets) {
        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset);
        assets.push({
          uri: assetInfo.localUri ?? asset.uri,
          assetId: asset.id,
          fileName: asset.filename,
          duration: asset.duration ? asset.duration * 1000 : null,
          width: asset.width,
          height: asset.height,
        });
      }

      setPendingAssets(assets);
      setSelectedLabelIds(new Set());
      setNewLabelText('');
      await fetchLabels();
      setTagPickerVisible(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to load album';
      Alert.alert('Error', message);
    }
  };

  const createAndSelectLabel = async () => {
    const name = newLabelText.trim();
    if (!name || !user) return;

    // Check if label already exists
    const existing = allLabels.find(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      setSelectedLabelIds((prev) => new Set([...prev, existing.id]));
      setNewLabelText('');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('labels')
        .insert({ user_id: user.id, name })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setAllLabels((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedLabelIds((prev) => new Set([...prev, data.id]));
      }
      setNewLabelText('');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to create label';
      Alert.alert('Error', message);
    }
  };

  const confirmImport = async () => {
    setTagPickerVisible(false);
    const labelIds = Array.from(selectedLabelIds);
    const assets = pendingAssets;
    setPendingAssets([]);

    try {
      setImporting(true);
      const total = assets.length;
      let skipped = 0;
      let errors = 0;

      for (let i = 0; i < assets.length; i++) {
        setProgress({ current: i + 1, total, skipped });
        const status = await importSingleAsset(assets[i], labelIds);
        if (status === 'skipped') skipped++;
        if (status === 'error') errors++;
      }

      await fetchClips();
      await fetchLabels();

      const imported = total - skipped - errors;
      const parts: string[] = [];
      if (imported > 0)
        parts.push(
          `${imported} clip${imported !== 1 ? 's' : ''} imported`
        );
      if (skipped > 0)
        parts.push(
          `${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped`
        );
      if (errors > 0) parts.push(`${errors} error${errors !== 1 ? 's' : ''}`);

      if (parts.length > 0) {
        Alert.alert('Import Complete', parts.join(', ') + '.');
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to import clips';
      Alert.alert('Error', message);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const toggleLabelSelection = (labelId: string) => {
    setSelectedLabelIds((prev) => {
      const next = new Set(prev);
      if (next.has(labelId)) {
        next.delete(labelId);
      } else {
        next.add(labelId);
      }
      return next;
    });
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

  // ── Render helpers ────────────────────────────────────────────────────

  const renderClip = ({ item }: { item: ClipWithLabels }) => (
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
          <Text style={styles.durationText}>
            {formatDuration(item.duration)}
          </Text>
        </View>
      )}
      {item.labels.length > 0 && (
        <View style={styles.tileLabelBadge}>
          <Text style={styles.tileLabelText} numberOfLines={1}>
            {item.labels[0]}
            {item.labels.length > 1 ? ` +${item.labels.length - 1}` : ''}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderAlbumItem = ({ item }: { item: AlbumWithCount }) => (
    <TouchableOpacity
      style={styles.albumItem}
      onPress={() => selectAlbum(item.album)}
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

  const searchAndFilterHeader = (
    <View>
      <View style={styles.searchContainer}>
        <Ionicons
          name="search"
          size={18}
          color="#888"
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by label or filename..."
          placeholderTextColor="#666"
          value={searchText}
          onChangeText={setSearchText}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Ionicons name="close-circle" size={18} color="#666" />
          </TouchableOpacity>
        )}
      </View>
      {allLabels.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsContainer}
        >
          <TouchableOpacity
            style={[
              styles.filterChip,
              !activeFilterId && styles.filterChipActive,
            ]}
            onPress={() => setActiveFilterId(null)}
          >
            <Text
              style={[
                styles.filterChipText,
                !activeFilterId && styles.filterChipTextActive,
              ]}
            >
              All
            </Text>
          </TouchableOpacity>
          {allLabels.map((label) => (
            <TouchableOpacity
              key={label.id}
              style={[
                styles.filterChip,
                activeFilterId === label.id && styles.filterChipActive,
              ]}
              onPress={() =>
                setActiveFilterId(
                  activeFilterId === label.id ? null : label.id
                )
              }
            >
              <Text
                style={[
                  styles.filterChipText,
                  activeFilterId === label.id &&
                    styles.filterChipTextActive,
                ]}
              >
                {label.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );

  // ── Loading state ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  // ── Import overlay ────────────────────────────────────────────────────

  const importOverlay = importing && progress && (
    <View style={styles.importOverlay}>
      <View style={styles.importCard}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.importText}>
          Importing {progress.current} of {progress.total}...
        </Text>
        {progress.skipped > 0 && (
          <Text style={styles.importSubtext}>
            {progress.skipped} duplicate
            {progress.skipped !== 1 ? 's' : ''} skipped
          </Text>
        )}
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${(progress.current / progress.total) * 100}%`,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );

  // ── Empty state ───────────────────────────────────────────────────────

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
        <TagPickerModal
          visible={tagPickerVisible}
          labels={allLabels}
          selectedIds={selectedLabelIds}
          onToggle={toggleLabelSelection}
          newLabelText={newLabelText}
          onNewLabelTextChange={setNewLabelText}
          onCreateLabel={createAndSelectLabel}
          onConfirm={confirmImport}
          onCancel={() => {
            setTagPickerVisible(false);
            setPendingAssets([]);
          }}
          assetCount={pendingAssets.length}
        />
      </View>
    );
  }

  // ── Main content ──────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredClips}
        renderItem={renderClip}
        keyExtractor={(item) => item.id}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        ListHeaderComponent={searchAndFilterHeader}
        ListEmptyComponent={
          <View style={styles.noResults}>
            <Text style={styles.noResultsText}>No clips match your search</Text>
          </View>
        }
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
      <TagPickerModal
        visible={tagPickerVisible}
        labels={allLabels}
        selectedIds={selectedLabelIds}
        onToggle={toggleLabelSelection}
        newLabelText={newLabelText}
        onNewLabelTextChange={setNewLabelText}
        onCreateLabel={createAndSelectLabel}
        onConfirm={confirmImport}
        onCancel={() => {
          setTagPickerVisible(false);
          setPendingAssets([]);
        }}
        assetCount={pendingAssets.length}
      />
    </View>
  );
}

// ── Tag Picker Modal ──────────────────────────────────────────────────────

interface TagPickerModalProps {
  visible: boolean;
  labels: Label[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  newLabelText: string;
  onNewLabelTextChange: (text: string) => void;
  onCreateLabel: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  assetCount: number;
}

function TagPickerModal({
  visible,
  labels,
  selectedIds,
  onToggle,
  newLabelText,
  onNewLabelTextChange,
  onCreateLabel,
  onConfirm,
  onCancel,
  assetCount,
}: TagPickerModalProps) {
  const hasSelection = selectedIds.size > 0;
  const trimmed = newLabelText.trim();
  const canCreate =
    trimmed.length > 0 &&
    !labels.some((l) => l.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            Tag {assetCount} Clip{assetCount !== 1 ? 's' : ''}
          </Text>
          <TouchableOpacity
            onPress={onConfirm}
            disabled={!hasSelection}
          >
            <Text
              style={[
                styles.confirmText,
                !hasSelection && styles.confirmTextDisabled,
              ]}
            >
              Import
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.tagPickerHint}>
          Select at least one label for these clips
        </Text>

        <View style={styles.createLabelRow}>
          <TextInput
            style={styles.createLabelInput}
            placeholder="Type to create a new label..."
            placeholderTextColor="#666"
            value={newLabelText}
            onChangeText={onNewLabelTextChange}
            onSubmitEditing={onCreateLabel}
            returnKeyType="done"
            autoCapitalize="none"
          />
          {canCreate && (
            <TouchableOpacity
              style={styles.createLabelButton}
              onPress={onCreateLabel}
            >
              <Ionicons name="add-circle" size={20} color="#007AFF" />
              <Text style={styles.createLabelButtonText}>
                Create "{trimmed}"
              </Text>
            </TouchableOpacity>
          )}
          {!canCreate && trimmed.length > 0 && (
            <TouchableOpacity
              style={styles.createLabelButton}
              onPress={onCreateLabel}
            >
              <Ionicons name="checkmark-circle" size={20} color="#34C759" />
              <Text style={styles.createLabelButtonText}>
                Select "{trimmed}"
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          style={styles.tagPickerScroll}
          contentContainerStyle={styles.tagPickerChips}
        >
          {labels.map((label) => {
            const isSelected = selectedIds.has(label.id);
            return (
              <TouchableOpacity
                key={label.id}
                style={[
                  styles.tagChip,
                  isSelected && styles.tagChipSelected,
                ]}
                onPress={() => onToggle(label.id)}
              >
                <Ionicons
                  name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={isSelected ? '#fff' : '#888'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.tagChipText,
                    isSelected && styles.tagChipTextSelected,
                  ]}
                >
                  {label.name}
                </Text>
              </TouchableOpacity>
            );
          })}
          {labels.length === 0 && (
            <Text style={styles.noLabelsHint}>
              No labels yet. Type above to create your first label.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Album Modal ─────────────────────────────────────────────────────────

interface AlbumModalProps {
  visible: boolean;
  albums: AlbumWithCount[];
  loading: boolean;
  onClose: () => void;
  renderAlbumItem: ({ item }: { item: AlbumWithCount }) => React.JSX.Element;
}

function AlbumModal({
  visible,
  albums,
  loading,
  onClose,
  renderAlbumItem,
}: AlbumModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <View style={{ width: 60 }} />
          <Text style={styles.modalTitle}>Select Album</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
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
            <Text style={styles.noAlbumsText}>
              No albums with videos found
            </Text>
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

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Styles ──────────────────────────────────────────────────────────────

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
  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    height: 40,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
  },
  // Filter chips
  filterChipsContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#2a2a2a',
    marginRight: 0,
  },
  filterChipActive: {
    backgroundColor: '#007AFF',
  },
  filterChipText: {
    color: '#ccc',
    fontSize: 13,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  noResults: {
    padding: 40,
    alignItems: 'center',
  },
  noResultsText: {
    color: '#888',
    fontSize: 15,
  },
  // Grid
  grid: {
    paddingHorizontal: TILE_GAP,
    paddingBottom: 80,
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
  tileLabelBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(0, 122, 255, 0.8)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tileLabelText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
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
  // Import overlay
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
  // Modal shared
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
  cancelText: {
    color: '#007AFF',
    fontSize: 16,
  },
  confirmText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmTextDisabled: {
    color: '#555',
  },
  // Album modal
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
  // Tag picker
  tagPickerHint: {
    color: '#888',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  createLabelRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  createLabelInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  createLabelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  createLabelButtonText: {
    color: '#007AFF',
    fontSize: 14,
    marginLeft: 6,
  },
  tagPickerScroll: {
    flex: 1,
  },
  tagPickerChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 10,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#444',
  },
  tagChipSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  tagChipText: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '500',
  },
  tagChipTextSelected: {
    color: '#fff',
  },
  noLabelsHint: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    paddingTop: 20,
  },
});
