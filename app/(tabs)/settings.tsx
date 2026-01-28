import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '../../components/AuthProvider';

interface SettingsItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showChevron?: boolean;
  danger?: boolean;
  loading?: boolean;
}

function SettingsItem({
  icon,
  title,
  subtitle,
  onPress,
  showChevron = true,
  danger = false,
  loading = false,
}: SettingsItemProps) {
  return (
    <TouchableOpacity
      style={styles.settingsItem}
      onPress={onPress}
      disabled={loading}
    >
      <View style={styles.settingsItemLeft}>
        <View
          style={[
            styles.iconContainer,
            danger && styles.iconContainerDanger,
          ]}
        >
          <Ionicons
            name={icon}
            size={20}
            color={danger ? '#FF3B30' : '#007AFF'}
          />
        </View>
        <View style={styles.settingsItemText}>
          <Text
            style={[styles.settingsItemTitle, danger && styles.dangerText]}
          >
            {title}
          </Text>
          {subtitle && (
            <Text style={styles.settingsItemSubtitle}>{subtitle}</Text>
          )}
        </View>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color="#888" />
      ) : showChevron ? (
        <Ionicons name="chevron-forward" size={20} color="#555" />
      ) : null}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { user, signOut } = useAuthContext();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setIsSigningOut(true);
            const { error } = await signOut();
            setIsSigningOut(false);

            if (error) {
              Alert.alert('Error', 'Failed to sign out. Please try again.');
            }
            // Navigation is handled automatically by the root layout
          },
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.sectionContent}>
          <SettingsItem
            icon="person-outline"
            title="Email"
            subtitle={user?.email ?? 'Not signed in'}
            showChevron={false}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App</Text>
        <View style={styles.sectionContent}>
          <SettingsItem
            icon="information-circle-outline"
            title="About Film Reel"
            subtitle="Version 1.0.0"
            showChevron={false}
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionContent}>
          <SettingsItem
            icon="log-out-outline"
            title="Sign Out"
            onPress={handleSignOut}
            showChevron={false}
            danger
            loading={isSigningOut}
          />
        </View>
      </View>

      <Text style={styles.footerText}>
        Film Reel helps stunt performers organize and find their demo reel
        footage quickly.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionContent: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iconContainerDanger: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
  },
  settingsItemText: {
    flex: 1,
  },
  settingsItemTitle: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  settingsItemSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  dangerText: {
    color: '#FF3B30',
  },
  footerText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    padding: 24,
    lineHeight: 20,
  },
});
