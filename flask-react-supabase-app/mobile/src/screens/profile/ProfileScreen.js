import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, Linking, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';

const WEBVIEW_URLS = {
  privacy: 'https://dphclassifieds.com/privacy-policy',
  terms: 'https://dphclassifieds.com/terms-of-use',
};

export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await apiClient.get('/api/user/statistics');
        setStats(data);
      } catch (err) {
        // Stats endpoint may not exist
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This action is permanent and cannot be undone. All your listings and data will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.post('/api/user/delete-account');
              await signOut();
              Alert.alert('Account Deleted', 'Your account has been deleted.');
            } catch (err) {
              Alert.alert('Error', err.message || 'Failed to delete account. Please contact support.');
            }
          },
        },
      ]
    );
  };

  const menuItems = [
    {
      icon: 'list-outline',
      label: 'My Listings',
      onPress: () => navigation.navigate('MyListings'),
    },
    {
      icon: 'heart-outline',
      label: 'Saved Listings',
      onPress: () => navigation.navigate('Saved'),
    },
    {
      icon: 'settings-outline',
      label: 'Account Settings',
      onPress: () => navigation.navigate('Settings'),
    },
    {
      icon: 'shield-checkmark-outline',
      label: 'Admin Panel',
      onPress: () => navigation.navigate('AdminDashboard'),
      accent: true,
    },
    { divider: true },
    {
      icon: 'document-text-outline',
      label: 'Privacy Policy',
      onPress: () => Linking.openURL(WEBVIEW_URLS.privacy),
    },
    {
      icon: 'document-outline',
      label: 'Terms of Service',
      onPress: () => Linking.openURL(WEBVIEW_URLS.terms),
    },
    {
      icon: 'information-circle-outline',
      label: 'About DPH',
      onPress: () => Linking.openURL('https://dphclassifieds.com/about'),
    },
    {
      icon: 'chatbubble-outline',
      label: 'Contact Support',
      onPress: () => Linking.openURL('mailto:support@dphclassifieds.com'),
    },
    { divider: true },
    {
      icon: 'trash-outline',
      label: 'Delete Account',
      onPress: handleDeleteAccount,
      danger: true,
    },
    {
      icon: 'log-out-outline',
      label: 'Sign Out',
      onPress: handleLogout,
      danger: true,
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        <View style={styles.userCard}>
          <Avatar uri={user?.profile_photo || user?.avatar_url} name={user?.first_name || user?.email} size={72} />
          <Text style={styles.userName}>
            {user?.first_name ? `${user.first_name} ${user.last_name || ''}` : user?.display_name || 'User'}
          </Text>
          {user?.username && <Text style={styles.userUsername}>@{user.username}</Text>}
          <View style={styles.badgesRow}>
            {user?.phone_verified && <Badge label="Verified" variant="success" size="sm" />}
            {user?.is_dealer && <Badge label="Dealer" variant="info" size="sm" />}
            {user?.is_admin && <Badge label="Admin" variant="primary" size="sm" />}
          </View>
          <Text style={styles.memberSince}>
            Member since {formatDate(user?.created_at)}
          </Text>
        </View>

        {stats && (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.total_listings || stats.listings_count || 0}</Text>
              <Text style={styles.statLabel}>Listings</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.saved_count || 0}</Text>
              <Text style={styles.statLabel}>Saved</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.total_views || stats.views || 0}</Text>
              <Text style={styles.statLabel}>Views</Text>
            </View>
          </View>
        )}

        <View style={styles.menu}>
          {menuItems.map((item, index) => {
            if (item.divider) {
              return <View key={`div-${index}`} style={styles.menuDivider} />;
            }
            return (
              <TouchableOpacity
                key={item.label}
                style={styles.menuItem}
                onPress={item.onPress}
                activeOpacity={0.6}
              >
                <View style={styles.menuLeft}>
                  <Ionicons
                    name={item.icon}
                    size={22}
                    color={item.danger ? COLORS.error : item.accent ? COLORS.accent : COLORS.textSecondary}
                  />
                  <Text
                    style={[
                      styles.menuLabel,
                      item.danger && { color: COLORS.error },
                      item.accent && { color: COLORS.accent },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.version}>DPH Classifieds v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  headerTitle: { color: COLORS.white, fontSize: FONT_SIZES.xxl, fontWeight: '700' },
  userCard: {
    alignItems: 'center', paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface, marginHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
  },
  userName: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginTop: SPACING.sm },
  userUsername: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginTop: 2 },
  badgesRow: { flexDirection: 'row', gap: 6, marginTop: SPACING.sm },
  memberSince: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: SPACING.sm },
  statsRow: {
    flexDirection: 'row', backgroundColor: COLORS.surface, marginHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.md, marginBottom: SPACING.md,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNumber: { color: COLORS.white, fontSize: FONT_SIZES.xl, fontWeight: '700' },
  statLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 4 },
  menu: { marginHorizontal: SPACING.md, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, overflow: 'hidden' },
  menuItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 15, paddingHorizontal: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight,
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuLabel: { color: COLORS.white, fontSize: FONT_SIZES.md },
  menuDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.xs },
  version: { textAlign: 'center', color: COLORS.textMuted, fontSize: FONT_SIZES.xs, paddingVertical: SPACING.xl },
});
