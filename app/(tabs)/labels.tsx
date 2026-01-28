import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function LabelsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.emptyState}>
        <Ionicons name="pricetags-outline" size={64} color="#555" />
        <Text style={styles.emptyTitle}>No labels yet</Text>
        <Text style={styles.emptySubtitle}>
          Labels will appear here once you start tagging your clips
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
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
});
