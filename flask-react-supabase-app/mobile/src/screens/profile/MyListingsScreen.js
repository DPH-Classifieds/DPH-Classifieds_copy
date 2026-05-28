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
import { formatPrice, formatDate, formatNumber } from '../../utils/formatters';
import Badge from '../../components/ui/Badge';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import AnimatedCard from '../../components/ui/AnimatedCard';
import FadeInView from '../../components/ui/FadeInView';
import FadeInImage from '../../components/ui/FadeInImage';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useSavedListings } from '../../context/SavedListingsContext';

const TABS = ['Active', 'Drafts', 'Saved', 'Review', 'Sold'];

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
const getDisplayStatus = (item, activeTabValue) => {
  const status = String(item.status || '').toLowerCase();
  if (['draft', 'pending', 'rejected'].includes(status)) return status;
  return item.listing_state || item.status || activeTabValue.toLowerCase();
};

const DETAIL_ROUTES = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };

export default function MyListingsScreen({ navigation }) {
  const [listings, setListings] = useState([]);
  const [activeTab, setActiveTab] = useState('Active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { savedListings } = useSavedListings();

  useEffect(() => {
    fetchListings();
  }, [activeTab]);

  const fetchListings = async () => {
    if (activeTab === 'Saved') {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const statusMap = { Active: 'active', Drafts: 'draft', Review: 'expired', Sold: 'sold' };
      const status = statusMap[activeTab] || activeTab.toLowerCase();
      const data = await apiClient.get(`/api/user/listings?status=${status}`);
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
    Alert.alert('Delete Listing', `Are you sure you want to delete "${getListingTitle(item)}"?`, [
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
      await apiClient.post(`/api/user/listings/${type}/${item.id}/outcome`, {
        outcome: 'not_sold_renew',
      });
      Alert.alert('Success', 'Listing renewed for another 15 days.');
      fetchListings();
    } catch (err) {
      Alert.alert('Error', 'Failed to renew listing.');
    }
  };

  const handleMoveToDraft = async (item) => {
    try {
      const type = item.listing_type || 'cars';
      await apiClient.post(`/api/user/listings/${type}/${item.id}/outcome`, {
        outcome: 'move_to_draft',
      });
      Alert.alert('Success', 'Listing moved back to drafts for review.');
      fetchListings();
    } catch (err) {
      Alert.alert('Error', 'Failed to move listing back to drafts.');
    }
  };

  const handleOutcome = (item) => {
    const type = item.listing_type || 'cars';
    const actions = [
      {
        text: 'Sold on DPH',
        onPress: async () => {
          try {
            await apiClient.post(`/api/user/listings/${type}/${item.id}/outcome`, {
              outcome: 'sold_on_dph',
            });
            fetchListings();
          } catch (err) {
            Alert.alert('Error', 'Failed to save listing outcome.');
          }
        },
      },
      {
        text: 'Sold Elsewhere',
        onPress: async () => {
          try {
            await apiClient.post(`/api/user/listings/${type}/${item.id}/outcome`, {
              outcome: 'sold_elsewhere',
            });
            fetchListings();
          } catch (err) {
            Alert.alert('Error', 'Failed to save listing outcome.');
          }
        },
      },
      {
        text: 'Renew Listing',
        onPress: async () => {
          try {
            await apiClient.post(`/api/user/listings/${type}/${item.id}/outcome`, {
              outcome: 'not_sold_renew',
            });
            Alert.alert('Success', 'Listing renewed successfully.');
            fetchListings();
          } catch (err) {
            Alert.alert('Error', 'Failed to renew listing.');
          }
        },
      },
      {
        text: 'Move to Drafts',
        onPress: async () => {
          try {
            await apiClient.post(`/api/user/listings/${type}/${item.id}/outcome`, {
              outcome: 'move_to_draft',
            });
            Alert.alert('Success', 'Listing moved back to drafts.');
            fetchListings();
          } catch (err) {
            Alert.alert('Error', 'Failed to move listing back to drafts.');
          }
        },
      },
    ];

    Alert.alert(
      'Review Listing',
      `Choose what happened with "${getListingTitle(item)}".`,
      [
        ...actions,
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handleMarkSold = async (item) => {
    Alert.alert('Mark as Sold', `Mark "${getListingTitle(item)}" as sold?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            const type = item.listing_type || 'cars';
            await apiClient.post(`/api/user/listings/${type}/${item.id}/outcome`, { outcome: 'sold' });
            fetchListings();
          } catch (err) {
            Alert.alert('Error', 'Failed to mark as sold.');
          }
        },
      },
    ]);
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'active': return 'success';
      case 'approved': return 'success';
      case 'expired': return 'warning';
      case 'sold': return 'info';
      case 'deleted': return 'default';
      case 'pending': return 'default';
      case 'draft': return 'default';
      default: return 'default';
    }
  };

  const displayListings = activeTab === 'Saved'
    ? [
        ...(savedListings?.cars || []).map(l => ({ ...l, listing_type: 'cars' })),
        ...(savedListings?.bikes || []).map(l => ({ ...l, listing_type: 'bikes' })),
        ...(savedListings?.plates || []).map(l => ({ ...l, listing_type: 'plates' })),
        ...(savedListings?.parts || []).map(l => ({ ...l, listing_type: 'parts' })),
      ]
    : listings;

  const renderListing = ({ item }) => {
    const type = item.listing_type || 'cars';
    const isSaved = activeTab === 'Saved';
    return (
      <FadeInView delay={0}>
        <View style={styles.card}>
          <AnimatedCard
            onPress={() => navigation.navigate(DETAIL_ROUTES[type], { listingId: item.id })}
            style={styles.cardContent}
          >
            {getListingImage(item) ? (
              <FadeInImage source={{ uri: getListingImage(item) }} style={styles.thumbnail} resizeMode="cover" />
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
              <Badge
                label={activeTab === 'Review' ? 'Review' : getDisplayStatus(item, activeTab)}
                variant={activeTab === 'Review' ? 'warning' : getStatusVariant(getDisplayStatus(item, activeTab))}
                size="sm"
                style={styles.statusBadge}
              />
            </View>
          </AnimatedCard>

          {!isSaved && (
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => navigation.navigate('EditListing', { listingId: item.id, listingType: item.listing_type || 'cars', editMode: true })}
                activeOpacity={0.7}
              >
                <Ionicons name="create-outline" size={18} color={COLORS.accent} />
              </TouchableOpacity>
              {activeTab === 'Active' ? (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleMarkSold(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="bag-check-outline" size={18} color={COLORS.warning} />
                </TouchableOpacity>
              ) : activeTab === 'Review' ? (
                <>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleExtend(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="refresh-outline" size={18} color={COLORS.warning} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleMoveToDraft(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="folder-open-outline" size={18} color={COLORS.info} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleOutcome(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="document-text-outline" size={18} color={COLORS.warning} />
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleExtend(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="time-outline" size={18} color={COLORS.info} />
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
          )}
          </View>
      </FadeInView>
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
          data={displayListings}
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
    gap: 6,
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
    fontSize: FONT_SIZES.xs,
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
