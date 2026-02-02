import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '../../components/AuthProvider';
import { supabase } from '../../lib/supabase';
import { ClipWithLabels, Label } from '../../types';

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function ClipDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthContext();
  const router = useRouter();

  const [clip, setClip] = useState<ClipWithLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [newLabelText, setNewLabelText] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchClip = useCallback(async () => {
    if (!id || !user) return;
    try {
      const { data, error } = await supabase
        .from('clips_with_labels')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      if (error) throw error;
      setClip({
        ...data,
        labels: data.labels ?? [],
        label_ids: data.label_ids ?? [],
      });
    } catch {
      // Fallback to clips table
      try {
        const { data, error } = await supabase
          .from('clips')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id)
          .single();
        if (error) throw error;
        if (data) {
          setClip({ ...data, labels: [], label_ids: [] });
        }
      } catch (fallbackErr: unknown) {
        const msg =
          fallbackErr instanceof Error
            ? fallbackErr.message
            : 'Failed to load clip';
        Alert.alert('Error', msg);
      }
    } finally {
      setLoading(false);
    }
  }, [id, user]);

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
      // Ignore
    }
  }, [user]);

  useEffect(() => {
    fetchClip();
    fetchLabels();
  }, [fetchClip, fetchLabels]);

  const addLabelToClip = async (labelId: string) => {
    if (!clip) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('clip_labels')
        .insert({ clip_id: clip.id, label_id: labelId });
      if (error) throw error;
      await fetchClip();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to add label';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const removeLabelFromClip = async (labelId: string) => {
    if (!clip) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('clip_labels')
        .delete()
        .eq('clip_id', clip.id)
        .eq('label_id', labelId);
      if (error) throw error;
      await fetchClip();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to remove label';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const createAndAddLabel = async () => {
    const name = newLabelText.trim();
    if (!name || !user || !clip) return;

    // Check if exists
    const existing = allLabels.find(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      if (!clip.label_ids.includes(existing.id)) {
        await addLabelToClip(existing.id);
      }
      setNewLabelText('');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('labels')
        .insert({ user_id: user.id, name })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setAllLabels((prev) =>
          [...prev, data].sort((a, b) => a.name.localeCompare(b.name))
        );
        await supabase
          .from('clip_labels')
          .insert({ clip_id: clip.id, label_id: data.id });
        await fetchClip();
      }
      setNewLabelText('');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to create label';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const deleteClip = () => {
    Alert.alert(
      'Delete Clip',
      'Are you sure you want to delete this clip?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!clip) return;
            try {
              await supabase
                .from('clip_labels')
                .delete()
                .eq('clip_id', clip.id);
              await supabase.from('clips').delete().eq('id', clip.id);
              router.back();
            } catch (err: unknown) {
              const msg =
                err instanceof Error
                  ? err.message
                  : 'Failed to delete clip';
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!clip) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Clip not found</Text>
      </View>
    );
  }

  const availableLabels = allLabels.filter(
    (l) => !clip.label_ids.includes(l.id)
  );

  return (
    <ScrollView style={styles.container} bounces={false}>
      {/* Thumbnail hero */}
      <View style={styles.thumbnailContainer}>
        {clip.thumbnail_url ? (
          <Image
            source={{ uri: clip.thumbnail_url }}
            style={styles.heroThumbnail}
          />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Ionicons name="film-outline" size={64} color="#555" />
          </View>
        )}
        {clip.duration != null && (
          <View style={styles.heroDurationBadge}>
            <Ionicons name="time-outline" size={14} color="#fff" />
            <Text style={styles.heroDurationText}>
              {formatDuration(clip.duration)}
            </Text>
          </View>
        )}
      </View>

      {/* Metadata */}
      <View style={styles.metadataSection}>
        {clip.filename && (
          <Text style={styles.filename} numberOfLines={2}>
            {clip.filename}
          </Text>
        )}
        <View style={styles.metaRow}>
          {clip.width && clip.height && (
            <View style={styles.metaItem}>
              <Ionicons name="resize-outline" size={16} color="#888" />
              <Text style={styles.metaText}>
                {clip.width} x {clip.height}
              </Text>
            </View>
          )}
          {clip.duration != null && (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={16} color="#888" />
              <Text style={styles.metaText}>
                {formatDuration(clip.duration)}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Current labels */}
      <View style={styles.labelsSection}>
        <Text style={styles.sectionTitle}>Labels</Text>
        {clip.labels.length > 0 ? (
          <View style={styles.chipWrap}>
            {clip.labels.map((labelName, idx) => {
              const labelId = clip.label_ids[idx];
              return (
                <View key={labelId} style={styles.labelChip}>
                  <Text style={styles.labelChipText}>{labelName}</Text>
                  <TouchableOpacity
                    onPress={() => removeLabelFromClip(labelId)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    disabled={saving}
                  >
                    <Ionicons name="close-circle" size={18} color="#aaa" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.noLabelsText}>
            No labels yet. Add some below.
          </Text>
        )}
      </View>

      {/* Add labels */}
      <View style={styles.addLabelSection}>
        <Text style={styles.sectionTitle}>Add Labels</Text>
        <View style={styles.createRow}>
          <TextInput
            style={styles.createInput}
            placeholder="Create new label..."
            placeholderTextColor="#666"
            value={newLabelText}
            onChangeText={setNewLabelText}
            onSubmitEditing={createAndAddLabel}
            returnKeyType="done"
            autoCapitalize="none"
          />
          {newLabelText.trim().length > 0 && (
            <TouchableOpacity
              style={styles.createBtn}
              onPress={createAndAddLabel}
              disabled={saving}
            >
              <Ionicons name="add-circle" size={28} color="#007AFF" />
            </TouchableOpacity>
          )}
        </View>
        {availableLabels.length > 0 && (
          <View style={styles.chipWrap}>
            {availableLabels.map((label) => (
              <TouchableOpacity
                key={label.id}
                style={styles.addChip}
                onPress={() => addLabelToClip(label.id)}
                disabled={saving}
              >
                <Ionicons name="add" size={14} color="#007AFF" />
                <Text style={styles.addChipText}>{label.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {saving && (
        <ActivityIndicator
          size="small"
          color="#007AFF"
          style={{ marginTop: 8 }}
        />
      )}

      {/* Delete button */}
      <TouchableOpacity style={styles.deleteButton} onPress={deleteClip}>
        <Ionicons name="trash-outline" size={18} color="#FF3B30" />
        <Text style={styles.deleteButtonText}>Delete Clip</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
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
  errorText: {
    color: '#888',
    fontSize: 16,
  },
  // Thumbnail hero
  thumbnailContainer: {
    width: SCREEN_WIDTH,
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  heroThumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111',
  },
  heroDurationBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  heroDurationText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Metadata
  metadataSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  filename: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 20,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    color: '#888',
    fontSize: 14,
  },
  // Labels
  labelsSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  labelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  labelChipText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  noLabelsText: {
    color: '#666',
    fontSize: 14,
  },
  // Add labels
  addLabelSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  createInput: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  createBtn: {
    marginLeft: 8,
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: '#444',
  },
  addChipText: {
    color: '#ccc',
    fontSize: 14,
  },
  // Delete
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    gap: 8,
  },
  deleteButtonText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
  },
});
