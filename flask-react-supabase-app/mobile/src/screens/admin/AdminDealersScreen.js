import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const FILTER_TABS = ['All', 'Pending', 'Verified'];

export default function AdminDealersScreen() {
  const [dealers, setDealers] = useState([]);
  const [activeFilter, setActiveFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchDealers();
  }, [activeFilter]);

  const fetchDealers = async () => {
    try {
      setLoading(true);
      const params = activeFilter !== 'All' ? `?status=${activeFilter.toLowerCase()}` : '';
      const data = await apiClient.get(`/api/admin/dealers${params}`);
      setDealers(Array.isArray(data) ? data : data?.dealers || []);
    } catch (err) {
      setDealers([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDealers();
    setRefreshing(false);
  }, [activeFilter]);

  const handleVerify = async (dealer) => {
    Alert.alert(
      'Verify Dealer',
      `Verify "${dealer.company_name || dealer.first_name || dealer.email}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Verify',
          onPress: async () => {
            try {
              await apiClient.post(`/api/admin/dealers/${dealer.id}/verify`);
              setDealers((prev) =>
                prev.map((d) =>
                  d.id === dealer.id ? { ...d, dealer_verified: true } : d
                )
              );
            } catch (err) {
              Alert.alert('Error', 'Failed to verify dealer.');
            }
          },
        },
      ]
    );
  };

  const handleReject = async (dealer) => {
    Alert.alert(
      'Reject Dealer',
      `Reject "${dealer.company_name || dealer.first_name || dealer.email}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.post(`/api/admin/dealers/${dealer.id}/reject`);
              setDealers((prev) =>
                prev.map((d) =>
                  d.id === dealer.id ? { ...d, dealer_verified: false } : d
                )
              );
            } catch (err) {
              Alert.alert('Error', 'Failed to reject dealer.');
            }
          },
        },
      ]
    );
  };

  const renderDealer = ({ item }) => (
    <View style={styles.dealerCard}>
      <View style={styles.dealerHeader}>
        <View style={styles.dealerInfo}>
          <Text style={styles.companyName} numberOfLines={1}>
            {item.company_name || 'Unknown Company'}
          </Text>
          <Text style={styles.userName} numberOfLines={1}>
            {item.first_name} {item.last_name}
          </Text>
          <Text style={styles.userEmail} numberOfLines={1}>{item.email}</Text>
          <Text style={styles.joinDate}>Joined {formatDate(item.created_at)}</Text>
        </View>
        <View
          style={[
            styles.verificationBadge,
            { backgroundColor: item.dealer_verified ? COLORS.success : COLORS.warning },
          ]}
        >
          <Text style={styles.verificationText}>
            {item.dealer_verified ? 'Verified' : 'Pending'}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {!item.dealer_verified && (
          <>
            <TouchableOpacity
              style={[styles.actionBtn, styles.verifyBtn]}
              onPress={() => handleVerify(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
              <Text style={styles.verifyText}>Verify</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={() => handleReject(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="close-circle" size={18} color={COLORS.error} />
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.filterBar}>
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.filterTab, activeFilter === tab && styles.activeFilterTab]}
            onPress={() => setActiveFilter(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterTabText, activeFilter === tab && styles.activeFilterTabText]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && dealers.length === 0 ? (
        <LoadingSpinner message="Loading dealers..." />
      ) : (
        <FlatList
          data={dealers}
          renderItem={renderDealer}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
          }
          ListEmptyComponent={
            <EmptyState icon="business-outline" title="No dealers found" message="No dealers match the filter." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 8,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  activeFilterTab: {
    backgroundColor: COLORS.primary,
  },
  filterTabText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeFilterTabText: {
    color: COLORS.accent,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: 40,
  },
  dealerCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  dealerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  dealerInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  companyName: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 4,
  },
  userName: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  userEmail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  joinDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  verificationBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
  },
  verificationText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.white,
  },
  actions: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    gap: 20,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verifyText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.accent,
  },
  rejectText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.error,
  },
});
