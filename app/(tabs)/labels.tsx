import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '../../components/AuthProvider';
import { supabase } from '../../lib/supabase';
import { LabelWithCount } from '../../types';

export default function LabelsScreen() {
  const { user } = useAuthContext();
  const [labels, setLabels] = useState<LabelWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabelText, setNewLabelText] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchLabels = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('labels_with_counts')
        .select('*')
        .eq('user_id', user.id)
        .order('name');

      if (error) throw error;
      setLabels(
        (data ?? []).map((l) => ({ ...l, clip_count: l.clip_count ?? 0 }))
      );
    } catch {
      // Fallback to labels table without counts
      try {
        const { data, error } = await supabase
          .from('labels')
          .select('*')
          .eq('user_id', user.id)
          .order('name');
        if (error) throw error;
        setLabels(
          (data ?? []).map((l) => ({ ...l, clip_count: 0 }))
        );
      } catch (fallbackErr: unknown) {
        const msg =
          fallbackErr instanceof Error
            ? fallbackErr.message
            : 'Failed to load labels';
        console.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  const createLabel = async () => {
    const name = newLabelText.trim();
    if (!name || !user) return;

    const exists = labels.some(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      Alert.alert('Duplicate', 'A label with that name already exists.');
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase
        .from('labels')
        .insert({ user_id: user.id, name });
      if (error) throw error;
      setNewLabelText('');
      await fetchLabels();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to create label';
      Alert.alert('Error', msg);
    } finally {
      setCreating(false);
    }
  };

  const deleteLabel = (label: LabelWithCount) => {
    Alert.alert(
      'Delete Label',
      `Delete "${label.name}"? This will remove it from all clips.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete clip_labels associations first
              await supabase
                .from('clip_labels')
                .delete()
                .eq('label_id', label.id);

              await supabase.from('labels').delete().eq('id', label.id);
              await fetchLabels();
            } catch (err: unknown) {
              const msg =
                err instanceof Error
                  ? err.message
                  : 'Failed to delete label';
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  const renderLabel = ({ item }: { item: LabelWithCount }) => (
    <View style={styles.labelRow}>
      <View style={styles.labelInfo}>
        <Text style={styles.labelName}>{item.name}</Text>
        <Text style={styles.labelCount}>
          {item.clip_count} clip{item.clip_count !== 1 ? 's' : ''}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => deleteLabel(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="trash-outline" size={20} color="#FF3B30" />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Create label input */}
      <View style={styles.createContainer}>
        <TextInput
          style={styles.createInput}
          placeholder="New label name..."
          placeholderTextColor="#666"
          value={newLabelText}
          onChangeText={setNewLabelText}
          onSubmitEditing={createLabel}
          returnKeyType="done"
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={[
            styles.createButton,
            (!newLabelText.trim() || creating) && styles.createButtonDisabled,
          ]}
          onPress={createLabel}
          disabled={!newLabelText.trim() || creating}
        >
          {creating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="add" size={22} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {labels.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="pricetags-outline" size={64} color="#555" />
          <Text style={styles.emptyTitle}>No labels yet</Text>
          <Text style={styles.emptySubtitle}>
            Create labels above or add them when importing clips
          </Text>
        </View>
      ) : (
        <FlatList
          data={labels}
          renderItem={renderLabel}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
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
  createContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
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
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonDisabled: {
    backgroundColor: '#444',
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
  list: {
    padding: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    marginHorizontal: 8,
    marginVertical: 2,
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
  },
  labelInfo: {
    flex: 1,
  },
  labelName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  labelCount: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
});
