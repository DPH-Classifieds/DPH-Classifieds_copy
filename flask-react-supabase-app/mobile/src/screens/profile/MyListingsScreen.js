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
import { formatPrice, formatDate, formatNumber } from '../../utils/formatters';
import Badge from '../../components/ui/Badge';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const TABS = ['Active', 'Expired', 'Sold'];

const getListingImage = (item) => {
  if (item.images && item.images.length > 0) {
    if (typeof item.images[0] === 'string') return item.images[0];
    return item.images[0].url || item.images[0].image_url || item.images[0].display_url;
  }
  return item.image_url || item.display_url || null;
};

const getListingTitle = (item) => {
  if (item.car_manufacturer) return `${item.car_manufacturer} ${item.car_model || ''}`.trim() || item.listing_title || 'Car';
  if (item.bike_brand) return `${item.bike_brand} ${item.bike_model || ''}`.trim() || 'Bike';
  if (item.city) return [item.city, item.code, item.digits || item.number].filter(Boolean).join(' ') || 'Plate';
  return item.part_type || item.name || item.listing_title || 'Listing';
};

const getListingPrice = (item) => item.expected_selling_price || item.price || 0;

const DETAIL_ROUTES = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };

export default function MyListingsScreen({ navigation }) {
  const [listings, setListings] = useState([]);
  const [activeTab, setActiveTab] = useState('Active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchListings();
  }, [activeTab]);

  const fetchListings = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get(`/api/user/listings?status=${activeTab.toLowerCase()}`);
      setListings(Array.isArray(data) ? data : data?.listings || []);
      } catch (err) {
        // Failed to fetch
      } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchListings();
    setRefreshing(false);
  }, [activeTab]);

  const handleDelete = (item) => {
    Alert.alert('Delete Listing', `Are you sure you want to delete "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const type = item.listing_type || 'cars';
            await apiClient.delete(`/api/user/listings/${type}/${item.id}`);
            setListings((prev) => prev.filter((l) => l.id !== item.id));
          } catch (err) {
            Alert.alert('Error', 'Failed to delete listing.');
          }
        },
      },
    ]);
  };

  const handleExtend = async (item) => {
    try {
      const type = item.listing_type || 'cars';
      await apiClient.post(`/api/user/listings/${type}/${item.id}/extend`);
      Alert.alert('Success', 'Listing extended by 30 days.');
      fetchListings();
    } catch (err) {
      Alert.alert('Error', 'Failed to extend listing.');
    }
  };

  const handleMarkSold = async (item) => {
    Alert.alert('Mark as Sold', `Mark "${item.title}" as sold?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            const type = item.listing_type || 'cars';
            await apiClient.put(`/api/user/listings/${type}/${item.id}`, { status: 'sold' });
            fetchListings();
          } catch (err) {
            Alert.alert('Error', 'Failed to mark as sold.');
          }
        },
      },
    ]);
  };

  const getDetailRoute = (type) => {
    const map = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };
    return map[type] || 'CarDetail';
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'active': return 'success';
      case 'expired': return 'warning';
      case 'sold': return 'info';
      case 'pending': return 'default';
      default: return 'default';
    }
  };

  const renderListing = ({ item }) => {
    const type = item.listing_type || 'cars';
    return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardContent}
        onPress={() => navigation.navigate(DETAIL_ROUTES[type], { listingId: item.id })}
        activeOpacity={0.7}
      >
        {getListingImage(item) ? (
          <Image source={{ uri: getListingImage(item) }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={[styles.thumbnail, { backgroundColor: COLORS.surfaceDark, justifyContent: 'center', alignItems: 'center' }]}>
            <Ionicons name="image-outline" size={24} color={COLORS.textMuted} />
          </View>
        )}
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{getListingTitle(item)}</Text>
          <Text style={styles.cardPrice}>{formatPrice(getListingPrice(item))}</Text>
          <View style={styles.cardMeta}>
            <Text style={styles.cardDate}>{formatDate(item.created_at || item.date_posted)}</Text>
            <View style={styles.viewsBadge}>
              <Ionicons name="eye-outline" size={12} color={COLORS.textMuted} />
              <Text style={styles.viewsText}>{formatNumber(item.views || item.view_count || 0)}</Text>
            </View>
          </View>
          <Badge label={item.status || activeTab.toLowerCase()} variant={getStatusVariant(item.status)} size="sm" style={styles.statusBadge} />
        </View>
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('PostListing', { listingId: item.id, listingType: item.listing_type || 'cars', editMode: true })}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={18} color={COLORS.accent} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleExtend(item)}
          activeOpacity={0.7}
        >
          <Ionicons name="time-outline" size={18} color={COLORS.info} />
        </TouchableOpacity>
        {activeTab === 'Active' && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleMarkSold(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="bag-check-outline" size={18} color={COLORS.warning} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleDelete(item)}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={18} color={COLORS.error} />
        </TouchableOpacity>
      </View>
    </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !refreshing ? (
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
              icon="folder-open-outline"
              title={`No ${activeTab.toLowerCase()} listings`}
              message="Your listings will appear here."
            />
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
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  activeTab: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeTabText: {
    color: COLORS.accent,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  cardContent: {
    flexDirection: 'row',
    padding: SPACING.md,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceHigher,
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
    marginBottom: 4,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  cardDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  viewsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewsText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  statusBadge: {
    alignSelf: 'flex-start',
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 16,
  },
  actionBtn: {
    padding: 6,
  },
});
