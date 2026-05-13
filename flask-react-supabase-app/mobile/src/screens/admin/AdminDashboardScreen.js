import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../utils/apiClient';
import { formatNumber } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const STAT_CARDS = [
  { key: 'total_users', label: 'Total Users', icon: 'people', color: COLORS.accent },
  { key: 'total_cars', label: 'Total Cars', icon: 'car', color: COLORS.accent },
  { key: 'total_bikes', label: 'Total Bikes', icon: 'bicycle', color: COLORS.accent },
  { key: 'total_parts', label: 'Total Parts', icon: 'construct', color: COLORS.accent },
  { key: 'total_plates', label: 'Total Plates', icon: 'key', color: COLORS.accent },
  { key: 'pending_total', label: 'Pending Approvals', icon: 'time', color: COLORS.warning },
  { key: 'total_views', label: 'Total Views', icon: 'eye', color: COLORS.accent },
  { key: 'total_reports', label: 'Live Reports', icon: 'flag', color: COLORS.error },
];

const QUICK_ACTIONS = [
  { label: 'Review Users', icon: 'people-outline', route: 'AdminUsers' },
  { label: 'Review Listings', icon: 'list-outline', route: 'AdminListings' },
  { label: 'Review Dealers', icon: 'business-outline', route: 'AdminDealers' },
  { label: 'Open Reports', icon: 'flag-outline', route: 'AdminReports' },
];

export default function AdminDashboardScreen({ navigation }) {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  if (!user?.is_admin && !user?.is_super_admin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="lock-closed" size={48} color={COLORS.textMuted} />
        <Text style={{ color: COLORS.white, fontSize: 18, fontWeight: '600', marginTop: 16 }}>Access Denied</Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>You don't have admin privileges.</Text>
      </SafeAreaView>
    );
  }

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get('/api/admin/stats');
      setStats(data);
    } catch (err) {
      // Failed to fetch admin stats
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  }, []);

  const getStatValue = (key) => {
    if (!stats) return 0;
    if (key === 'pending_total') {
      return (
        (stats.cars_pending || 0) +
        (stats.bikes_pending || 0) +
        (stats.parts_pending || 0) +
        (stats.plates_pending || 0)
      );
    }
    if (key === 'total_views') {
      return (
        (stats.cars_views || 0) +
        (stats.bikes_views || 0) +
        (stats.parts_views || 0) +
        (stats.plates_views || 0)
      );
    }
    return stats[key] ?? 0;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner message="Loading admin dashboard..." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Operator Console</Text>
        </View>

        <View style={styles.kpiGrid}>
          {STAT_CARDS.map((card) => (
            <View key={card.key} style={styles.kpiCard}>
              <Ionicons name={card.icon} size={22} color={card.color} style={styles.kpiIcon} />
              <Text style={styles.kpiValue}>{formatNumber(getStatValue(card.key))}</Text>
              <Text style={styles.kpiLabel}>{card.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          {QUICK_ACTIONS.map((action, index) => (
            <TouchableOpacity
              key={index}
              style={styles.actionCard}
              onPress={() => navigation.navigate(action.route)}
              activeOpacity={0.7}
            >
              <View style={styles.actionLeft}>
                <Ionicons name={action.icon} size={20} color={COLORS.white} />
                <Text style={styles.actionLabel}>{action.label}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZES.hero,
    fontWeight: '700',
    color: COLORS.white,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.lg,
  },
  kpiCard: {
    width: '48%',
    backgroundColor: '#272729',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  kpiIcon: {
    marginBottom: SPACING.sm,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 4,
  },
  kpiLabel: {
    fontSize: FONT_SIZES.sm,
    color: 'rgba(255,255,255,0.63)',
  },
  section: {
    paddingHorizontal: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionLabel: {
    fontSize: FONT_SIZES.md,
    fontWeight: '500',
    color: COLORS.white,
  },
});
