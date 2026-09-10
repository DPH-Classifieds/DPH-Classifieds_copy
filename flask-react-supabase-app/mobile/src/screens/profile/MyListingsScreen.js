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
import { formatPrice, formatDate, formatNumber } from '../../utils/formatters';
import Badge from '../../components/ui/Badge';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import AnimatedCard from '../../components/ui/AnimatedCard';
import FadeInView from '../../components/ui/FadeInView';
import FadeInImage from '../../components/ui/FadeInImage';
import RenewListingModal from '../../components/ui/RenewListingModal';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { useSavedListings } from '../../context/SavedListingsContext';
import { resolveMediaUrl } from '../../utils/media';
import { toPluralType, toSingularType } from '../../utils/listingType';
import { useResponsiveLayout } from '../../utils/responsiveLayout';

const TABS = ['Active', 'Drafts', 'Saved', 'Review', 'Sold'];

const getListingImage = (item) => {
  if (item.images && item.images.length > 0) {
    if (typeof item.images[0] === 'string') return resolveMediaUrl(item.images[0]);
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

const getListingTitle = (item) => {
  if (item.car_manufacturer) return `${item.car_manufacturer} ${item.car_model || ''}`.trim() || item.listing_title || 'Car';
  if (item.bike_brand) return `${item.bike_brand} ${item.bike_model || ''}`.trim() || 'Bike';
  if (item.city) return [item.city, item.code, item.number || item.digits].filter(Boolean).join(' ') || 'Plate';
  return item.part_type || item.name || item.listing_title || 'Listing';
};

const getListingPrice = (item) => item.expected_selling_price || item.price || 0;
const getDisplayStatus = (item, activeTabValue) => {
  const status = String(item.status || '').toLowerCase();
  if (['draft', 'pending', 'rejected'].includes(status)) return status;
  return item.listing_state || item.status || activeTabValue.toLowerCase();
};

const DETAIL_ROUTES = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };

function ListingCard({ item, index, onPress, actions, isSaved, activeTab, getDisplayStatus, getStatusVariant, styles, colors }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress}>
        <View style={styles.card}>
          <AnimatedCard
            onPress={onPress}
            style={styles.cardContent}
          >
            {getListingImage(item) ? (
              <FadeInImage source={{ uri: getListingImage(item) }} style={styles.thumbnail} resizeMode="cover" />
            ) : (
              <View style={[styles.thumbnail, { backgroundColor: colors.surfaceDark, justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="image-outline" size={24} color={colors.textMuted} />
              </View>
            )}
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle} numberOfLines={1}>{getListingTitle(item)}</Text>
              <Text style={styles.cardPrice}>{formatPrice(getListingPrice(item))}</Text>
              <View style={styles.cardMeta}>
                <Text style={styles.cardDate}>{formatDate(item.created_at || item.date_posted)}</Text>
                <View style={styles.viewsBadge}>
                  <Ionicons name="eye-outline" size={12} color={colors.textMuted} />
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
          {!isSaved && actions}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function MyListingsScreen({ navigation }) {
  const { colors } = useTheme();
  const layout = useResponsiveLayout();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    tabBar: {
      flexDirection: 'row',
      paddingHorizontal: layout.horizontalPadding,
      paddingVertical: SPACING.sm,
      gap: 6,
      maxWidth: layout.contentMaxWidth, width: '100%', alignSelf: 'center',
    },
    tab: {
      flex: layout.isCompact ? 1 : 0,
      minWidth: layout.isCompact ? 0 : 88,
      paddingVertical: 10,
      alignItems: 'center',
      borderRadius: BORDER_RADIUS.pill,
      backgroundColor: colors.surface,
    },
    activeTab: {
      backgroundColor: colors.primary,
    },
    tabText: {
      fontSize: FONT_SIZES.xs,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    activeTabText: {
      color: colors.accent,
    },
    listContent: {
      paddingHorizontal: layout.horizontalPadding,
      paddingBottom: 40,
      maxWidth: layout.contentMaxWidth, width: '100%', alignSelf: 'center',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.lg,
      marginBottom: SPACING.md,
      overflow: 'hidden',
      width: layout.isExpanded ? '48%' : '100%',
    },
    cardContent: {
      flexDirection: 'row',
      padding: SPACING.md,
    },
    thumbnail: {
      width: layout.isExpanded ? 120 : 88,
      height: layout.isExpanded ? 96 : 88,
      borderRadius: BORDER_RADIUS.md,
      backgroundColor: colors.surfaceHigher,
    },
    cardInfo: {
      flex: 1,
      marginLeft: SPACING.md,
      justifyContent: 'center',
    },
    cardTitle: {
      fontSize: FONT_SIZES.md,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    cardPrice: {
      fontSize: FONT_SIZES.md,
      fontWeight: '700',
      color: colors.accent,
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
      color: colors.textMuted,
    },
    viewsBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    viewsText: {
      fontSize: FONT_SIZES.xs,
      color: colors.textMuted,
    },
    statusBadge: {
      alignSelf: 'flex-start',
    },
    actions: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: 16,
    },
    actionBtn: {
      padding: 8,
      minWidth: 40,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    intro: {
      maxWidth: layout.contentMaxWidth, width: '100%', alignSelf: 'center',
      paddingHorizontal: layout.horizontalPadding, paddingTop: SPACING.sm, paddingBottom: SPACING.xs,
    },
    introTitle: { color: colors.textPrimary, fontSize: FONT_SIZES.xxl, fontWeight: '800' },
    introSubtitle: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, marginTop: 4 },
    inventoryPill: {
      alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: BORDER_RADIUS.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    inventoryPillText: { color: colors.accent, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  }), [colors, layout]);

  const [listings, setListings] = useState([]);
  const [activeTab, setActiveTab] = useState('Active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [renewModal, setRenewModal] = useState({ visible: false, type: null, id: null });

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
      toastApiError(err);
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
            const type = toPluralType(item.listing_type);
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
      const type = toPluralType(item.listing_type);
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
      const type = toPluralType(item.listing_type);
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
    const type = toPluralType(item.listing_type);
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
            const type = toPluralType(item.listing_type);
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

  const inventoryLabel = `${displayListings.length} ${activeTab.toLowerCase()} ${displayListings.length === 1 ? 'listing' : 'listings'}`;

  const renderListing = ({ item, index }) => {
    const pluralType = toPluralType(item.listing_type);
    const singularType = toSingularType(item.listing_type);
    const isInSavedTab = activeTab === 'Saved';
    const actionsNode = (
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('EditListing', { listingId: item.id, listingType: singularType, editMode: true })}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={18} color={colors.accent} />
        </TouchableOpacity>
        {activeTab === 'Active' ? (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleMarkSold(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="bag-check-outline" size={18} color={colors.warning} />
          </TouchableOpacity>
        ) : activeTab === 'Review' || item.status === 'expired' ? (
          <>
            {item.status === 'expired' && (
              <PressableScale
                onPress={() => setRenewModal({ visible: true, type: toPluralType(item.listing_type), id: item.id })}
                haptic="light"
                style={styles.actionBtn}
              >
                <Ionicons name="refresh" size={18} color={colors.accent} />
              </PressableScale>
            )}
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleExtend(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.warning} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleMoveToDraft(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="folder-open-outline" size={18} color={colors.info} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleOutcome(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="document-text-outline" size={18} color={colors.warning} />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleExtend(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="time-outline" size={18} color={colors.info} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => handleDelete(item)}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </TouchableOpacity>
      </View>
    );
    return (
      <ListingCard
        item={item}
        index={index}
        onPress={() => navigation.navigate(DETAIL_ROUTES[pluralType], { listingId: item.id })}
        actions={actionsNode}
        isSaved={isInSavedTab}
        activeTab={activeTab}
        getDisplayStatus={getDisplayStatus}
        getStatusVariant={getStatusVariant}
        styles={styles}
        colors={colors}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenEntrance>
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

          <View style={styles.intro}>
            <Text style={styles.introTitle}>My Listings</Text>
            <Text style={styles.introSubtitle}>Manage the same inventory you see on DPH Classifieds web.</Text>
            <View style={styles.inventoryPill}>
              <Text style={styles.inventoryPillText}>{inventoryLabel}</Text>
            </View>
          </View>

        {loading && !refreshing ? (
          <LoadingSpinner message="Loading listings..." />
        ) : (
          <FlashList
            key={`my-listings-${layout.windowClass}`}
            estimatedItemSize={layout.isExpanded ? 220 : 260}
            data={displayListings}
            numColumns={layout.columns}
            renderItem={renderListing}
            keyExtractor={(item) => `${item.listing_type || 'listing'}-${item.id}`}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
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
      </ScreenEntrance>
      <RenewListingModal
        visible={renewModal.visible}
        listingType={renewModal.type}
        listingId={renewModal.id}
        onSuccess={() => {
          setRenewModal({ visible: false, type: null, id: null });
          fetchListings();
        }}
        onCancel={() => setRenewModal({ visible: false, type: null, id: null })}
      />
    </SafeAreaView>
  );
}
