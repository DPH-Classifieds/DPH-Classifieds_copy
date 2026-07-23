import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, Linking, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, TAB_BAR_CLEARANCE } from '../../constants/theme';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import AnimatedCard from '../../components/ui/AnimatedCard';

const WEBVIEW_URLS = {
  privacy: 'https://dphclassifieds.com/privacy-policy',
  terms: 'https://dphclassifieds.com/terms-of-use',
};

export default function ProfileScreen({ navigation }) {
  const { user, signOut, syncWithSupabase } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/user/statistics');
      setStats(data);
    } catch (err) {
      setStats({ total_listings: 0, saved_count: 0, total_views: 0 });
    }
  }, []);

  useEffect(() => {
    fetchStats().finally(() => setLoading(false));
  }, [fetchStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (syncWithSupabase) await syncWithSupabase({ forceBackendCheck: true });
      await fetchStats();
    } finally {
      setRefreshing(false);
    }
  }, [fetchStats, syncWithSupabase]);

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
      onPress: () => router.push('/(saved)'),
    },
    {
      icon: 'settings-outline',
      label: 'Account Settings',
      onPress: () => navigation.navigate('Settings'),
    },
    ...(user?.is_dealer ? [{
      icon: 'business-outline',
      label: 'Dealer Dashboard',
      onPress: () => navigation.navigate('DealerDashboard'),
      accent: true,
    }] : []),
    ...(user?.is_admin ? [{
      icon: 'shield-checkmark-outline',
      label: 'Admin Panel',
      onPress: () => navigation.navigate('AdminDashboard'),
      accent: true,
    }] : []),
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
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} colors={[COLORS.accent]} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        <View style={styles.userCard}>
          <Avatar uri={user?.profile_photo || user?.avatar_url} name={user?.first_name || user?.email} size={72} />
          <Text style={styles.userName}>
            {user?.first_name
              ? `${user.first_name} ${user.last_name || ''}`.trim()
              : user?.display_name || user?.full_name || user?.email?.split('@')[0] || 'User'}
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

        {(user?.email || user?.phone || user?.bio) && (
          <View style={styles.infoCard}>
            {user?.email ? (
              <View style={styles.infoRow}>
                <Ionicons name="mail-outline" size={18} color={COLORS.textSecondary} />
                <Text style={styles.infoText} numberOfLines={1}>{user.email}</Text>
              </View>
            ) : null}
            {user?.phone ? (
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={18} color={COLORS.textSecondary} />
                <Text style={styles.infoText}>{`${user.country_code || ''} ${user.phone}`.trim()}</Text>
              </View>
            ) : null}
            {user?.bio ? (
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={18} color={COLORS.textSecondary} />
                <Text style={styles.infoText}>{user.bio}</Text>
              </View>
            ) : null}
          </View>
        )}

        {stats && (
          <View style={styles.statsRow}>
            <AnimatedCard style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.total_listings || stats.listings_count || 0}</Text>
              <Text style={styles.statLabel}>Listings</Text>
            </AnimatedCard>
            <View style={styles.statDivider} />
            <AnimatedCard style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.saved_count || 0}</Text>
              <Text style={styles.statLabel}>Saved</Text>
            </AnimatedCard>
            <View style={styles.statDivider} />
            <AnimatedCard style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.total_views || stats.views || 0}</Text>
              <Text style={styles.statLabel}>Views</Text>
            </AnimatedCard>
          </View>
        )}

        <View style={styles.menu}>
          {menuItems.map((item, index) => {
            if (item.divider) {
              return <View key={`div-${index}`} style={styles.menuDivider} />;
            }
            return (
              <AnimatedCard
                key={item.label}
                onPress={item.onPress}
                style={styles.menuItem}
                haptic={false}
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
              </AnimatedCard>
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
  infoCard: {
    backgroundColor: COLORS.surface, marginHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, marginBottom: SPACING.md,
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight,
  },
  infoText: { color: COLORS.white, fontSize: FONT_SIZES.md, flex: 1 },
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
