import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, FlatList, TouchableOpacity, Alert, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function AdminReportsScreen() {
  const { colors } = useTheme();
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
            await apiClient.patch(`/api/admin/reports/${report.id}`, { status: 'dismissed' });
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
            await apiClient.patch(`/api/admin/reports/${report.id}`, {
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
      case 'pending': return colors.warning;
      case 'resolved': return colors.success;
      case 'dismissed': return colors.textMuted;
      default: return colors.textMuted;
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
          <Ionicons name={getTypeIcon(item.listing_type)} size={16} color={colors.accent} />
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
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.removeBtn]}
            onPress={() => handleRemoveListing(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash" size={18} color={colors.error} />
            <Text style={styles.removeText}>Remove Listing</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
    },
    reportCard: {
      backgroundColor: colors.surface,
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
      color: colors.accent,
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
      color: colors.textPrimary,
      textTransform: 'capitalize',
    },
    reason: {
      fontSize: FONT_SIZES.md,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    details: {
      fontSize: FONT_SIZES.sm,
      color: colors.textSecondary,
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
      color: colors.textMuted,
    },
    actions: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
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
      color: colors.textSecondary,
    },
    removeText: {
      fontSize: FONT_SIZES.sm,
      fontWeight: '600',
      color: colors.error,
    },
  }), [colors]);

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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <EmptyState icon="flag-outline" title="No reports" message="No reports to review." />
          }
        />
      )}
    </SafeAreaView>
  );
}

