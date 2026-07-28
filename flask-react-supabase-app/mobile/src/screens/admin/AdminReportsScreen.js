import React, { useState, useEffect, useCallback } from 'react';
import { View, FlatList, TouchableOpacity, Alert, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

export default function AdminReportsScreen() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get('/api/admin/reports');
      setReports(Array.isArray(data) ? data : data?.reports || []);
    } catch (err) {
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReports();
    setRefreshing(false);
  }, []);

  const handleDismiss = async (report) => {
    Alert.alert('Dismiss Report', 'Dismiss this report without action?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Dismiss',
        onPress: async () => {
          try {
            await apiClient.put(`/api/admin/reports/${report.id}`, { status: 'dismissed' });
            setReports((prev) =>
              prev.map((r) => (r.id === report.id ? { ...r, status: 'dismissed' } : r))
            );
          } catch (err) {
            Alert.alert('Error', 'Failed to dismiss report.');
          }
        },
      },
    ]);
  };

  const handleRemoveListing = async (report) => {
    Alert.alert('Remove Listing', 'Remove the reported listing permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.put(`/api/admin/reports/${report.id}`, {
              status: 'resolved',
              action: 'remove_listing',
            });
            setReports((prev) =>
              prev.map((r) => (r.id === report.id ? { ...r, status: 'resolved' } : r))
            );
          } catch (err) {
            Alert.alert('Error', 'Failed to remove listing.');
          }
        },
      },
    ]);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return COLORS.warning;
      case 'resolved': return COLORS.success;
      case 'dismissed': return COLORS.textMuted;
      default: return COLORS.textMuted;
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'car':
      case 'cars': return 'car-sport-outline';
      case 'bike':
      case 'bikes': return 'bicycle-outline';
      case 'plate':
      case 'plates': return 'grid-outline';
      case 'part':
      case 'parts': return 'construct-outline';
      default: return 'document-outline';
    }
  };

  const renderReport = ({ item }) => (
    <View style={styles.reportCard}>
      <View style={styles.reportHeader}>
        <View style={styles.typeBadge}>
          <Ionicons name={getTypeIcon(item.listing_type)} size={16} color={COLORS.accent} />
          <Text style={styles.typeText}>{item.listing_type || 'Unknown'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.statusBadgeText}>{item.status || 'pending'}</Text>
        </View>
      </View>

      <Text style={styles.reason} numberOfLines={1}>
        {item.reason || 'No reason provided'}
      </Text>

      {item.details && (
        <Text style={styles.details} numberOfLines={1}>
          {item.details}
        </Text>
      )}

      <View style={styles.reportMeta}>
        <Text style={styles.metaText} numberOfLines={1}>
          {[item.reporter_name, formatDate(item.created_at)].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {(!item.status || item.status === 'pending') && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.dismissBtn]}
            onPress={() => handleDismiss(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.removeBtn]}
            onPress={() => handleRemoveListing(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash" size={18} color={COLORS.error} />
            <Text style={styles.removeText}>Remove Listing</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {loading && reports.length === 0 ? (
        <LoadingSpinner message="Loading reports..." />
      ) : (
        <FlatList
          data={reports}
          renderItem={renderReport}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
          }
          ListEmptyComponent={
            <EmptyState icon="flag-outline" title="No reports" message="No reports to review." />
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
  listContent: {
    padding: SPACING.md,
    paddingBottom: 40,
  },
  reportCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.accent,
    textTransform: 'capitalize',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.white,
    textTransform: 'capitalize',
  },
  reason: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 6,
  },
  details: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  reportMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: SPACING.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingTop: SPACING.sm,
    gap: 20,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dismissText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  removeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.error,
  },
});
