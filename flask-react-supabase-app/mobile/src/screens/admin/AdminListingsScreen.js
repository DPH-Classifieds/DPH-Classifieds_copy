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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const TYPE_TABS = ['Cars', 'Bikes', 'Plates', 'Parts'];
const STATUS_TABS = ['Pending', 'Active', 'All'];
const TYPE_KEYS = ['cars', 'bikes', 'plates', 'parts'];

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return item.images[0].url || item.images[0].image_url;
  }
  return item.image_url || null;
};

const getTitle = (item, typeKey) => {
  if (typeKey === 'cars') return `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim() || 'Untitled Car';
  if (typeKey === 'bikes') return `${item.bike_manufacturer || ''} ${item.bike_model || ''}`.trim() || 'Untitled Bike';
  if (typeKey === 'plates') return item.plate_number || 'Untitled Plate';
  if (typeKey === 'parts') return item.part_name || 'Untitled Part';
  return item.title || 'Untitled';
};

export default function AdminListingsScreen({ navigation }) {
  const [listings, setListings] = useState([]);
  const [activeType, setActiveType] = useState('Cars');
  const [activeStatus, setActiveStatus] = useState('Pending');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchListings();
  }, [activeType, activeStatus]);

  const fetchListings = async () => {
    try {
      setLoading(true);
      const typeKey = TYPE_KEYS[TYPE_TABS.indexOf(activeType)];
      const status = activeStatus.toLowerCase();
      const params = status === 'all' ? '' : `?status=${status}`;
      const data = await apiClient.get(`/api/admin/${typeKey}${params}`);
      setListings(Array.isArray(data) ? data : data?.listings || []);
    } catch (err) {
      setListings([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchListings();
    setRefreshing(false);
  }, [activeType, activeStatus]);

  const handleApprove = async (item) => {
    try {
      const typeKey = TYPE_KEYS[TYPE_TABS.indexOf(activeType)];
      await apiClient.post(`/api/${typeKey}/${item.id}/approve`);
      setListings((prev) => prev.filter((l) => l.id !== item.id));
    } catch (err) {
      Alert.alert('Error', 'Failed to approve listing.');
    }
  };

  const handleReject = async (item) => {
    Alert.alert('Reject Listing', `Reject this listing?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          try {
            const typeKey = TYPE_KEYS[TYPE_TABS.indexOf(activeType)];
            await apiClient.post(`/api/${typeKey}/${item.id}/reject`);
            setListings((prev) => prev.filter((l) => l.id !== item.id));
          } catch (err) {
            Alert.alert('Error', 'Failed to reject listing.');
          }
        },
      },
    ]);
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'active': return 'success';
      case 'pending': return 'warning';
      case 'sold': return 'info';
      case 'rejected': return 'error';
      default: return 'default';
    }
  };

  const renderListing = ({ item }) => {
    const typeKey = TYPE_KEYS[TYPE_TABS.indexOf(activeType)];
    const imageUri = getImageUri(item);
    const title = getTitle(item, typeKey);

    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('AdminListingDetail', { itemType: typeKey, itemId: item.id })}
        activeOpacity={0.8}
      >
      <View style={styles.card}>
        <View style={styles.cardContent}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
              <Ionicons name="image-outline" size={28} color={COLORS.textMuted} />
            </View>
          )}
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>
            <View style={styles.cardMeta}>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                <Text style={styles.statusBadgeText}>{item.status || 'pending'}</Text>
              </View>
              <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
            </View>
            {item.seller_name && (
              <Text style={styles.sellerName} numberOfLines={1}>
                by {item.seller_name}
              </Text>
            )}
          </View>
        </View>

        {activeStatus === 'Pending' && (
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
      <View style={styles.typeTabBar}>
        {TYPE_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.typeTab, activeType === tab && styles.activeTypeTab]}
            onPress={() => setActiveType(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.typeTabText, activeType === tab && styles.activeTypeTabText]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.statusTabBar}>
        {STATUS_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.statusTab, activeStatus === tab && styles.activeStatusTab]}
            onPress={() => setActiveStatus(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.statusTabText, activeStatus === tab && styles.activeStatusTabText]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
              title={`No ${activeStatus.toLowerCase()} ${activeType.toLowerCase()}`}
              message="No listings found."
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
    case 'pending': return COLORS.warning;
    case 'sold': return COLORS.info;
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
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  activeTypeTab: {
    backgroundColor: COLORS.primary,
  },
  typeTabText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeTypeTabText: {
    color: COLORS.accent,
  },
  statusTabBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 8,
  },
  statusTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surfaceHigher,
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
  cardTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 4,
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
