import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, Alert, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { toastApiError } from '../../utils/toast';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import SearchBar from '../../components/ui/SearchBar';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

function AdminUserCard({ item, index, onPress, colors, styles }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const getInitials = (user) => {
    const first = user.first_name?.[0] || '';
    const last = user.last_name?.[0] || '';
    return (first + last).toUpperCase() || user.email?.[0]?.toUpperCase() || '?';
  };
  const fullName = `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.email?.split('@')[0] || 'User';
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(item)}</Text>
          </View>
          <View style={styles.userInfo}>
            <View style={styles.userRow}>
              <Text style={styles.userName} numberOfLines={1}>{fullName}</Text>
              <View style={styles.badges}>
                {item.is_admin && (
                  <View style={[styles.badge, styles.adminBadge]}>
                    <Text style={styles.badgeText}>Admin</Text>
                  </View>
                )}
                {item.is_dealer && (
                  <View style={[styles.badge, styles.dealerBadge]}>
                    <Text style={styles.badgeText}>Dealer</Text>
                  </View>
                )}
                {item.status === 'banned' && (
                  <View style={[styles.badge, styles.bannedBadge]}>
                    <Text style={styles.badgeText}>Banned</Text>
                  </View>
                )}
              </View>
            </View>
            <Text style={styles.userEmail} numberOfLines={1}>{item.email}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function AdminUsersScreen({ navigation }) {
  const { colors } = useTheme();
  const [users, setUsers] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    searchSection: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
    },
    userCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.sm,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: FONT_SIZES.sm,
      fontWeight: '700',
      color: colors.accent,
    },
    userInfo: {
      flex: 1,
      marginLeft: SPACING.md,
    },
    userRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    userName: {
      fontSize: FONT_SIZES.md,
      fontWeight: '600',
      color: colors.textPrimary,
      flex: 1,
      marginRight: 8,
    },
    badges: {
      flexDirection: 'row',
      gap: 6,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: BORDER_RADIUS.sm,
    },
    adminBadge: {
      backgroundColor: colors.primary,
    },
    dealerBadge: {
      backgroundColor: colors.info,
    },
    bannedBadge: {
      backgroundColor: colors.error,
    },
    verifiedBadge: {
      backgroundColor: colors.success || '#4CAF50',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    phoneVerifiedBadge: {
      backgroundColor: colors.info || '#2196F3',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    badgeText: {
      fontSize: FONT_SIZES.xs,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    userEmail: {
      fontSize: FONT_SIZES.sm,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    userPhone: {
      fontSize: FONT_SIZES.sm,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    },
    userMeta: {
      fontSize: FONT_SIZES.xs,
      color: colors.textMuted,
    },
    lastLogin: {
      fontSize: FONT_SIZES.xs,
      color: colors.textMuted,
    },
  }), [colors]);

  useEffect(() => {
    fetchUsers(true);
  }, [searchText]);

  const fetchUsers = async (reset = false) => {
    try {
      setLoading(true);
      const currentPage = reset ? 1 : page;
      const params = new URLSearchParams({ page: currentPage, limit: 20 });
      if (searchText.trim()) params.append('search', searchText.trim());
      const data = await apiClient.get(`/api/admin/users?${params.toString()}`);
      const list = Array.isArray(data) ? data : data?.users || [];
      setUsers(reset ? list : [...users, ...list]);
      setHasMore(list.length >= 20);
      if (reset) setPage(1);
    } catch (err) {
      if (reset) setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUsers(true);
    setRefreshing(false);
  }, [searchText]);

  const loadMore = () => {
    if (!loading && hasMore) {
      setPage((prev) => prev + 1);
      fetchUsers(false);
    }
  };

  const showUserActions = (user) => {
    const isBanned = user.status === 'banned';
    const actions = [];

    if (user.is_admin) {
      actions.push({ text: 'Remove Admin', onPress: () => toggleAdmin(user) });
    } else {
      actions.push({ text: 'Make Admin', onPress: () => makeAdmin(user) });
    }

    if (isBanned) {
      actions.push({ text: 'Unban User', onPress: () => toggleBan(user, false) });
    } else {
      actions.push({ text: 'Ban User', style: 'destructive', onPress: () => toggleBan(user, true) });
    }

    actions.push({ text: 'Delete User', style: 'destructive', onPress: () => deleteUser(user) });
    actions.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(user.first_name || user.email, 'Select an action', actions);
  };

  const makeAdmin = async (user) => {
    try {
      await apiClient.post(`/api/admin/users/${user.id}/make-admin`);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_admin: true } : u))
      );
    } catch (err) {
      Alert.alert('Error', 'Failed to make user admin.');
    }
  };

  const toggleAdmin = async (user) => {
    try {
      await apiClient.patch(`/api/admin/users/${user.id}/status`, {
        is_admin: !user.is_admin,
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_admin: !u.is_admin } : u))
      );
    } catch (err) {
      Alert.alert('Error', 'Failed to update user role.');
    }
  };

  const toggleBan = async (user, ban) => {
    const action = ban ? 'ban' : 'unban';
    Alert.alert(`Confirm ${action}`, `Are you sure you want to ${action} this user?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: ban ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await apiClient.patch(`/api/admin/users/${user.id}/status`, {
              status: ban ? 'banned' : 'active',
            });
            setUsers((prev) =>
              prev.map((u) =>
                u.id === user.id ? { ...u, status: ban ? 'banned' : 'active' } : u
              )
            );
          } catch (err) {
            Alert.alert('Error', `Failed to ${action} user.`);
          }
        },
      },
    ]);
  };

  const deleteUser = (user) => {
    Alert.alert('Delete User', `Permanently delete "${user.first_name || user.email}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/api/admin/users/${user.id}`);
            setUsers((prev) => prev.filter((u) => u.id !== user.id));
          } catch (err) {
            Alert.alert('Error', 'Failed to delete user.');
          }
        },
      },
    ]);
  };

  const renderUser = ({ item, index }) => (
    <AdminUserCard
      item={item}
      index={index}
      onPress={() => navigation.navigate('AdminUserDetail', { userId: item.id })}
      colors={colors}
      styles={styles}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScreenEntrance>
        <View style={styles.searchSection}>
          <SearchBar
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search users..."
          />
        </View>

        {loading && users.length === 0 ? (
          <LoadingSpinner message="Loading users..." />
        ) : (
          <FlashList
            estimatedItemSize={260}
            data={users}
            renderItem={renderUser}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListEmptyComponent={
              <EmptyState icon="people-outline" title="No users found" message="No users match your search." />
            }
          />
        )}
      </ScreenEntrance>
    </SafeAreaView>
  );
}

