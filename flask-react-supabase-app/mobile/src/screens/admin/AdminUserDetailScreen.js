import React, { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function AdminUserDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { userId } = route.params;
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: colors.textSecondary, fontSize: FONT_SIZES.md },
    content: { padding: SPACING.md },
    header: { alignItems: 'center', marginBottom: SPACING.lg },
    avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
    avatarText: { fontSize: 24, fontWeight: '700', color: colors.accent },
    name: { color: colors.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '700' },
    email: { color: colors.textSecondary, fontSize: FONT_SIZES.md, marginTop: 4 },
    badges: { flexDirection: 'row', gap: 8, marginTop: SPACING.sm },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm },
    adminBadge: { backgroundColor: colors.primary },
    dealerBadge: { backgroundColor: colors.info },
    bannedBadge: { backgroundColor: colors.error },
    badgeText: { fontSize: FONT_SIZES.xs, fontWeight: '600', color: colors.textPrimary },
    actions: { gap: SPACING.sm, marginBottom: SPACING.lg },
    primaryBtn: { backgroundColor: colors.primary, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
    primaryBtnText: { color: colors.accent, fontSize: FONT_SIZES.md, fontWeight: '600' },
    secondaryBtn: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
    secondaryBtnText: { color: colors.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '600' },
    dangerBtn: { backgroundColor: 'rgba(255,59,48,0.1)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
    dangerBtnText: { color: colors.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
    stats: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, gap: 8 },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    statLabel: { color: colors.textSecondary, fontSize: FONT_SIZES.sm },
    statValue: { color: colors.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '600' },
    statDivider: { height: 1, backgroundColor: colors.borderLight },
  }), [colors]);

  useEffect(() => { loadUser(); }, []);

  const loadUser = async () => {
    try {
      const data = await apiClient.get(`/api/admin/users/${userId}/overview`);
      setUser(data);
    } catch (err) {
      Alert.alert('Error', 'Failed to load user details.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAdmin = async () => {
    try {
      const endpoint = user.is_admin ? 'remove-admin' : 'make-admin';
      await apiClient.post(`/api/admin/users/${userId}/${endpoint}`);
      loadUser();
    } catch (err) { Alert.alert('Error', err.message); }
  };

  const handleToggleBan = async () => {
    try {
      const newStatus = user.status === 'banned' ? 'active' : 'banned';
      await apiClient.patch(`/api/admin/users/${userId}/status`, { status: newStatus });
      loadUser();
    } catch (err) { Alert.alert('Error', err.message); }
  };

  const handleDelete = async () => {
    Alert.alert('Delete User', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await apiClient.delete(`/api/admin/users/${userId}`); navigation.goBack(); }
        catch (err) { Alert.alert('Error', err.message); }
      }},
    ]);
  };

  const getInitials = (u) => {
    const first = u.first_name?.[0] || '';
    const last = u.last_name?.[0] || '';
    return (first + last).toUpperCase() || u.email?.[0]?.toUpperCase() || '?';
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading user...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(user)}</Text>
          </View>
          <Text style={styles.name}>{user.first_name} {user.last_name}</Text>
          <Text style={styles.email}>{user.email}</Text>
          <View style={styles.badges}>
            {user.is_admin && (
              <View style={[styles.badge, styles.adminBadge]}>
                <Text style={styles.badgeText}>Admin</Text>
              </View>
            )}
            {user.is_dealer && (
              <View style={[styles.badge, styles.dealerBadge]}>
                <Text style={styles.badgeText}>Dealer</Text>
              </View>
            )}
            {user.status === 'banned' && (
              <View style={[styles.badge, styles.bannedBadge]}>
                <Text style={styles.badgeText}>Banned</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.actions}>
          {user.is_admin ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleToggleAdmin} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>Remove Admin</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={handleToggleAdmin} activeOpacity={0.7}>
              <Text style={styles.primaryBtnText}>Make Admin</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={user.status === 'banned' ? styles.primaryBtn : styles.secondaryBtn}
            onPress={handleToggleBan}
            activeOpacity={0.7}
          >
            <Text style={user.status === 'banned' ? styles.primaryBtnText : styles.secondaryBtnText}>
              {user.status === 'banned' ? 'Unban' : 'Ban'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerBtn} onPress={handleDelete} activeOpacity={0.7}>
            <Text style={styles.dangerBtnText}>Delete User</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.stats}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Listings</Text>
            <Text style={styles.statValue}>{user.listing_count || 0}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Member Since</Text>
            <Text style={styles.statValue}>{user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

