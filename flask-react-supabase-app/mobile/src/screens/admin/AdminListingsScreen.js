import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  StyleSheet,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const REJECTION_REASONS = [
  'Inappropriate content',
  'Wrong category',
  'Spam',
  'Duplicate listing',
  'Incomplete information',
  'Misleading information',
  'Price manipulation',
  'Other',
];

const TYPE_TABS = ['All', 'Cars', 'Bikes', 'Plates', 'Parts', 'Buying Requests'];
const STATUS_TABS = ['All', 'Pending', 'Active', 'Approved', 'Expired', 'Rejected', 'Deleted'];
const TYPE_KEYS = ['cars', 'bikes', 'plates', 'parts', 'buying_requests'];

const typeKeyMap = {
  All: null,
  Cars: 'cars',
  Bikes: 'bikes',
  Plates: 'plates',
  Parts: 'parts',
  'Buying Requests': 'buying_requests',
};

const statusKeyMap = {
  All: null,
  Pending: 'pending',
  Active: 'active',
  Approved: 'approved',
  Expired: 'expired',
  Rejected: 'rejected',
  Deleted: 'deleted',
};

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return item.images[0].url || item.images[0].image_url;
  }
  return item.image_url || null;
};

const getTitle = (item) => {
  if (item.listing_type === 'buying_requests' || item.item_type) {
    const carPart = `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim();
    return item.item_name || carPart || 'Buying Request';
  }
  if (item.car_manufacturer) return `${item.car_manufacturer} ${item.car_model || ''}`.trim() || 'Car';
  if (item.bike_brand) return `${item.bike_brand} ${item.bike_model || ''}`.trim() || 'Bike';
  if (item.city) return [item.city, item.code, item.digits || item.number].filter(Boolean).join(' ') || 'Plate';
  return item.part_type || item.part_name || 'Part';
};

const getDisplayPrice = (item) => {
  if (item.listing_type === 'buying_requests') return item.budget || 0;
  return item.price || item.expected_selling_price || 0;
};

export default function AdminListingsScreen({ navigation }) {
  const [listings, setListings] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState(['All']);
  const [selectedStatuses, setSelectedStatuses] = useState(['All']);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kpi, setKpi] = useState({ total: 0, pending: 0, active: 0 });

  useEffect(() => {
    fetchListings();
  }, [selectedTypes, selectedStatuses]);

  const fetchListings = async () => {
    try {
      setLoading(true);
      const selectedTypeKeys = selectedTypes.includes('All')
        ? []
        : selectedTypes.map((t) => typeKeyMap[t]).filter(Boolean);
      const types = selectedTypeKeys.join(',');
      const selectedStatusKeys = selectedStatuses.includes('All') ? [] : selectedStatuses.map((s) => statusKeyMap[s]).filter(Boolean);
      const statuses = selectedStatusKeys.join(',');
      const params = [];
      if (types) params.push(`types=${types}`);
      if (statuses) params.push(`statuses=${statuses}`);
      const query = params.length ? `?${params.join('&')}` : '';
      const data = await apiClient.get(`/api/admin/listings-search${query}`);
      const list = Array.isArray(data) ? data : data?.listings || [];
      setListings(list);

      if (data && data.metadata) {
        setKpi({
          total: data.metadata.total ?? list.length,
          pending: data.metadata.pending ?? 0,
          active: data.metadata.active ?? 0,
        });
      } else {
        setKpi({
          total: list.length,
          pending: list.filter((l) => l.status === 'pending').length,
          active: list.filter((l) => l.status === 'active').length,
        });
      }
    } catch (err) {
      setListings([]);
      setKpi({ total: 0, pending: 0, active: 0 });
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchListings();
    setRefreshing(false);
  }, [selectedTypes, selectedStatuses]);

  const toggleType = (tab) => {
    setSelectedTypes((prev) => {
      if (tab === 'All') return ['All'];
      if (prev.includes('All')) return [tab];
      if (prev.includes(tab)) {
        if (prev.length === 1) return prev;
        const next = prev.filter((t) => t !== tab);
        return next.length ? next : ['All'];
      }
      return [...prev, tab];
    });
  };

  const toggleStatus = (tab) => {
    setSelectedStatuses((prev) => {
      if (tab === 'All') return ['All'];
      if (prev.includes('All')) return [tab];
      if (prev.includes(tab)) {
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== tab);
      }
      return [...prev, tab];
    });
  };

  const handleApprove = async (item) => {
    try {
      const typeKey = item.listing_type || 'cars';
      await apiClient.post(`/${typeKey}/${item.id}/approve`);
      setListings((prev) => prev.filter((l) => l.id !== item.id));
    } catch (err) {
      Alert.alert('Error', 'Failed to approve listing.');
    }
  };

  const handleReject = async (item) => {
    const reasonButtons = REJECTION_REASONS.map((reason) => ({
      text: reason,
      onPress: async (reasonText) => {
        try {
          const typeKey = item.listing_type || 'cars';
          await apiClient.post(`/${typeKey}/${item.id}/reject`, { reason: reasonText || reason });
          setListings((prev) => prev.filter((l) => l.id !== item.id));
        } catch (err) {
          Alert.alert('Error', 'Failed to reject listing.');
        }
      },
    }));

    Alert.alert(
      'Reject Listing',
      'Select a reason for rejection:',
      [
        { text: 'Cancel', style: 'cancel' },
        ...reasonButtons,
      ],
    );
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'active': return 'success';
      case 'approved': return 'success';
      case 'expired': return 'warning';
      case 'pending': return 'warning';
      case 'sold': return 'info';
      case 'deleted': return 'default';
      case 'rejected': return 'error';
      default: return 'default';
    }
  };

  const renderListing = ({ item }) => {
    const imageUri = getImageUri(item);
    const title = getTitle(item);
    const displayStatus = item.listing_state || item.status || 'pending';
    const rawStatus = item._table_status || item.status || 'pending';
    const isBuyingRequest = item.listing_type === 'buying_requests';
    const isPending = rawStatus === 'pending' && !isBuyingRequest;
    const placeholderIcon = isBuyingRequest ? 'cart-outline' : 'image-outline';

    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('AdminListingDetail', { itemType: item.listing_type || 'cars', itemId: item.id })}
        activeOpacity={0.8}
      >
      <View style={styles.card}>
        <View style={styles.cardContent}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
              <Ionicons name={placeholderIcon} size={28} color={COLORS.textMuted} />
            </View>
          )}
          <View style={styles.cardInfo}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
              {isBuyingRequest && (
                <View style={styles.requestPill}>
                  <Text style={styles.requestPillText}>Request</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardPrice}>
              {isBuyingRequest ? `Budget ${formatPrice(getDisplayPrice(item))}` : formatPrice(getDisplayPrice(item))}
            </Text>
            <View style={styles.cardMeta}>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(displayStatus) }]}>
                <Text style={styles.statusBadgeText}>{displayStatus}</Text>
              </View>
              <Text style={styles.cardDate} numberOfLines={1}>
                {[formatDate(item.created_at), item.seller_name].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
        </View>

        {isPending && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.approveBtn]}
              onPress={() => handleApprove(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
              <Text style={styles.approveText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={() => handleReject(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="close-circle" size={18} color={COLORS.error} />
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.typeTabBar}
      >
        {TYPE_TABS.map((tab) => {
          const active = selectedTypes.includes(tab) || (tab === 'All' && selectedTypes.length === 0);
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.typeTab, active && styles.activeTypeTab]}
              onPress={() => toggleType(tab)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={active ? 'checkmark-circle-outline' : 'add-circle-outline'}
                size={14}
                color={active ? COLORS.white : COLORS.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.typeTabText, active && styles.activeTypeTabText]}>
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statusTabBar}
      >
        {STATUS_TABS.map((tab) => {
          const active = selectedStatuses.includes(tab) || (tab === 'All' && selectedStatuses.length === 0);
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.statusTab, active && styles.activeStatusTab]}
              onPress={() => toggleStatus(tab)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={active ? 'checkmark-circle-outline' : 'add-circle-outline'}
                size={14}
                color={active ? COLORS.white : COLORS.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.statusTabText, active && styles.activeStatusTabText]}>
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!loading && (
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <Text style={styles.kpiValue}>{kpi.total}</Text>
            <Text style={styles.kpiLabel}>Total</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: COLORS.warning }]}>{kpi.pending}</Text>
            <Text style={styles.kpiLabel}>Pending</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiItem}>
            <Text style={[styles.kpiValue, { color: COLORS.success }]}>{kpi.active}</Text>
            <Text style={styles.kpiLabel}>Active</Text>
          </View>
        </View>
      )}

      {loading && listings.length === 0 ? (
        <LoadingSpinner message="Loading listings..." />
      ) : (
        <FlatList
          data={listings}
          renderItem={renderListing}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="list-outline"
              title="No listings found"
              message="Try adjusting your filters."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const getStatusColor = (status) => {
  switch (status) {
    case 'active': return COLORS.success;
    case 'approved': return COLORS.success;
    case 'pending': return COLORS.warning;
    case 'expired': return COLORS.warning;
    case 'archived': return COLORS.textMuted;
    case 'sold': return COLORS.info;
    case 'deleted': return COLORS.textMuted;
    case 'rejected': return COLORS.error;
    default: return COLORS.textMuted;
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  typeTabBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    gap: 8,
  },
  typeTab: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  activeTypeTab: {
    backgroundColor: COLORS.accent,
  },
  typeTabText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeTypeTabText: {
    color: COLORS.white,
  },
  statusTabBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 6,
  },
  statusTab: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  activeStatusTab: {
    backgroundColor: COLORS.accent,
  },
  statusTabText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeStatusTabText: {
    color: COLORS.white,
  },
  kpiRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiItem: {
    flex: 1,
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.white,
  },
  kpiLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  kpiDivider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.borderLight,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  cardContent: {
    flexDirection: 'row',
    padding: SPACING.md,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceHigher,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: SPACING.md,
    justifyContent: 'center',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  requestPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: 'rgba(76,175,80,0.18)',
  },
  requestPillText: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cardPrice: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.accent,
    marginBottom: 6,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.white,
    textTransform: 'capitalize',
  },
  cardDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  sellerName: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 20,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  approveBtn: {},
  rejectBtn: {},
  approveText: {
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
