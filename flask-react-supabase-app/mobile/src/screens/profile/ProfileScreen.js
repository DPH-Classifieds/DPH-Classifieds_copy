import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, StyleSheet, Linking, ActivityIndicator, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import { SPACING, BORDER_RADIUS, FONT_SIZES, TAB_BAR_CLEARANCE } from '../../constants/theme';
import Avatar from '../../components/ui/Avatar';
import Badge from '../../components/ui/Badge';
import AnimatedCard from '../../components/ui/AnimatedCard';

export default function ProfileScreen({ navigation }) {
  const { colors, theme } = useTheme();
  const styles = useMemo(() => {
    // Card outlines per DESIGN.md §6 (ghost mint borders) — tinted green in
    // both modes so the box edges read on dark AND light surfaces.
    const boxBorder = theme === 'dark' ? 'rgba(139,214,180,0.16)' : 'rgba(11,107,76,0.35)';
    const lineBorder = theme === 'dark' ? colors.borderLight : 'rgba(11,107,76,0.18)';
    const boxShadow = theme === 'dark'
      ? { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 }
      : { shadowColor: '#0B1D13', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 };
    return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
    headerTitle: { color: colors.textPrimary, fontSize: FONT_SIZES.xxl, fontWeight: '700' },
    userCard: {
      alignItems: 'center', paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md,
      backgroundColor: colors.surface, marginHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.lg,
      marginBottom: SPACING.md,
      borderWidth: 1, borderColor: boxBorder,
      ...boxShadow,
    },
    userName: { color: colors.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700', marginTop: SPACING.sm },
    userUsername: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, marginTop: 2 },
    badgesRow: { flexDirection: 'row', gap: 6, marginTop: SPACING.sm },
    memberSince: { color: colors.textMuted, fontSize: FONT_SIZES.xs, marginTop: SPACING.sm },
    infoCard: {
      backgroundColor: colors.surface, marginHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.lg,
      paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, marginBottom: SPACING.md,
      borderWidth: 1, borderColor: boxBorder,
      ...boxShadow,
    },
    infoRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: lineBorder,
    },
    infoText: { color: colors.textPrimary, fontSize: FONT_SIZES.md, flex: 1 },
    statsRow: {
      flexDirection: 'row', backgroundColor: colors.surface, marginHorizontal: SPACING.md,
      borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.md, marginBottom: SPACING.md,
      borderWidth: 1, borderColor: boxBorder,
      ...boxShadow,
    },
    statItem: { flex: 1, alignItems: 'center' },
    statNumber: { color: colors.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '700' },
    statLabel: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
    statDivider: { width: 1, backgroundColor: lineBorder, marginVertical: 4 },
    menu: {
      marginHorizontal: SPACING.md, backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, overflow: 'hidden',
      borderWidth: 1, borderColor: boxBorder,
      ...boxShadow,
    },
    menuItem: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 15, paddingHorizontal: SPACING.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: lineBorder,
    },
    menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    menuLabel: { color: colors.textPrimary, fontSize: FONT_SIZES.md },
    menuDivider: { height: 1, backgroundColor: lineBorder, marginVertical: SPACING.xs },
    version: { textAlign: 'center', color: colors.textMuted, fontSize: FONT_SIZES.xs, paddingVertical: SPACING.xl },
    });
  }, [colors, theme]);

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
      icon: 'create-outline',
      label: 'Edit Listing',
      onPress: () => navigation.navigate('EditListing'),
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
    ...(!user?.phone_verified ? [{
      icon: 'call-outline',
      label: 'Verify Phone',
      onPress: () => navigation.navigate('VerifyPhone'),
      warning: true,
    }] : []),
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        <View style={styles.userCard}>
          <Avatar uri={user?.profile_photo_url || user?.profile_photo || user?.avatar_url} name={user?.first_name || user?.email} size={72} />
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
                <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.infoText} numberOfLines={1}>{user.email}</Text>
              </View>
            ) : null}
            {user?.phone ? (
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.infoText}>{`${user.country_code || ''} ${user.phone}`.trim()}</Text>
              </View>
            ) : null}
            {user?.bio ? (
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
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
                    color={item.danger ? colors.error : item.accent ? colors.accent : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.menuLabel,
                      item.danger && { color: colors.error },
                      item.accent && { color: colors.accent },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </AnimatedCard>
            );
          })}
        </View>

        <Text style={styles.version}>DPH Classifieds v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
