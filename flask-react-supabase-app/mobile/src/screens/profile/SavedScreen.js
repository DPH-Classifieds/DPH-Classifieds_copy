import React, { useState, useCallback, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, RefreshControl, Alert, ScrollView } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated from 'react-native-reanimated';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { toastApiError } from '../../utils/toast';
import apiClient from '../../utils/apiClient';
import { useSavedListings } from '../../context/SavedListingsContext';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import ListingCard from '../../components/ui/ListingCard';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, TAB_BAR_CLEARANCE } from '../../constants/theme';
import { resolveMediaUrl } from '../../utils/media';

const TABS = ['Cars', 'Bikes', 'Plates', 'Parts', 'Searches'];
const TAB_KEYS = ['cars', 'bikes', 'plates', 'parts', 'searches'];
// Per-tab accent icon so the segmented control reads at a glance, not just text.
const TAB_ICONS = ['car-sport', 'bicycle', 'pricetag', 'construct', 'search'];

const buildSearchTitle = (search) => {
  if (search?.name) return search.name;
  if (search?.query_text) return search.query_text;
  if (search?.category) return `${search.category} search`;
  return 'Saved search';
};

const buildSearchSubtitle = (search) => {
  const parts = [];
  if (search?.category) parts.push(search.category);
  if (search?.query_text) parts.push(`"${search.query_text}"`);
  const filterCount = search?.filters && typeof search.filters === 'object' ? Object.keys(search.filters).length : 0;
  if (filterCount) parts.push(`${filterCount} filter${filterCount === 1 ? '' : 's'}`);
  return parts.join(' • ') || 'Saved from Explore';
};

function SavedSearchCard({ search, index, onPress, onDelete }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress}>
        <View style={styles.searchCard}>
          <View style={styles.searchCardIcon}>
            <Ionicons name="search" size={18} color={COLORS.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.searchCardTitle} numberOfLines={1}>{buildSearchTitle(search)}</Text>
            <Text style={styles.searchCardSubtitle} numberOfLines={1}>{buildSearchSubtitle(search)}</Text>
          </View>
          <TouchableOpacity onPress={onDelete} style={styles.searchDeleteBtn} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const getImageUri = (item) => {
  // Backend saved cards expose a normalized `image`; raw listing objects use
  // images[]/image_url. Support both.
  if (item.image) return resolveMediaUrl(item.image);
  if (item.images && item.images.length > 0) {
    if (typeof item.images[0] === 'string') return resolveMediaUrl(item.images[0]);
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

const getItemTitle = (item) => {
  // Saved cards already carry a display title; prefer it over raw-field guessing.
  if (item.title) return item.title;
  if (item.listing_type === 'cars' || item.car_manufacturer) return `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim() || 'Car';
  if (item.listing_type === 'bikes' || item.bike_brand) return `${item.bike_brand || ''} ${item.bike_model || ''}`.trim() || 'Bike';
  if (item.listing_type === 'plates' || item.city) return [item.city, item.code, item.number || item.digits].filter(Boolean).join(' ') || 'Plate';
  return item.part_type || item.name || 'Listing';
};

const DETAIL_ROUTES = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };

// Saved listings now render with the shared ListingCard (same look as Explore).

// Horizontally-scrolling row of category chips. Each chip is sized to its
// content with comfortable padding/spacing; the active chip is highlighted.
function SegmentedTabs({ tabs, activeIndex, counts, onSelect }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
      contentContainerStyle={styles.chipRow}
    >
      {tabs.map((tab, index) => {
        const active = index === activeIndex;
        return (
          <TouchableOpacity
            key={tab}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(index)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={TAB_ICONS[index]}
              size={15}
              color={active ? COLORS.accent : COLORS.textMuted}
            />
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
              {tab}
            </Text>
            {counts[index] > 0 && (
              <View style={[styles.segmentBadge, active && styles.segmentBadgeActive]}>
                <Text style={[styles.segmentBadgeText, active && styles.segmentBadgeTextActive]}>
                  {counts[index]}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default function SavedScreen({ navigation }) {
  const { savedListings, loading, toggleSaveListing, savedCounts, loadSavedListings } = useSavedListings();
  const [activeTab, setActiveTab] = useState('Cars');
  const [refreshing, setRefreshing] = useState(false);
  const [savedSearches, setSavedSearches] = useState([]);
  const [searchesLoading, setSearchesLoading] = useState(false);

  const fetchSavedSearches = useCallback(async () => {
    try {
      setSearchesLoading(true);
      const data = await apiClient.get('/api/user/saved-searches');
      setSavedSearches(Array.isArray(data?.searches) ? data.searches : []);
    } catch (err) {
      toastApiError(err);
    } finally {
      setSearchesLoading(false);
    }
  }, []);

  useEffect(() => { fetchSavedSearches(); }, [fetchSavedSearches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (activeTab === 'Searches') await fetchSavedSearches();
      else if (loadSavedListings) await loadSavedListings();
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, loadSavedListings, fetchSavedSearches]);

  const activeIndex = TABS.indexOf(activeTab);
  const activeKey = TAB_KEYS[activeIndex];
  const items = savedListings[activeKey] || [];
  const counts = TAB_KEYS.map((key) => (key === 'searches' ? savedSearches.length : (savedCounts[key] || 0)));
  const totalSaved = TAB_KEYS.slice(0, 4).reduce((sum, key) => sum + (savedCounts[key] || 0), 0);

  const selectTab = (index) => {
    Haptics.selectionAsync();
    setActiveTab(TABS[index]);
  };

  const handleUnsave = async (item) => {
    const type = item.listing_type || activeKey;
    await toggleSaveListing(type, item);
  };

  const renderListing = ({ item, index }) => (
    <ListingCard
      item={{ ...item, image: getImageUri(item), title: getItemTitle(item) }}
      index={index}
      saved
      onPress={() => navigation.navigate(DETAIL_ROUTES[activeKey], { listingId: item.id || item.listing_id })}
      onSave={() => handleUnsave(item)}
    />
  );

  const handleDeleteSearch = (search) => {
    Alert.alert('Delete saved search?', buildSearchTitle(search), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const identifier = search.id ?? search.search_key;
            await apiClient.delete(`/api/user/saved-searches/${identifier}`);
            setSavedSearches((prev) => prev.filter((s) => s !== search));
          } catch (err) {
            toastApiError(err);
          }
        },
      },
    ]);
  };

  const handleOpenSearch = (search) => {
    // Switch to the Explore tab and apply the saved search. Params must be
    // primitive under Expo Router, so the search is passed as a JSON string.
    router.push({
      pathname: '/(tabs)/(explore)',
      params: {
        savedSearch: JSON.stringify({
          category: search.category,
          query: search.query_text,
          filters: search.filters || {},
        }),
      },
    });
  };

  const renderSearch = ({ item, index }) => (
    <SavedSearchCard
      search={item}
      index={index}
      onPress={() => handleOpenSearch(item)}
      onDelete={() => handleDeleteSearch(item)}
    />
  );

  if (activeTab !== 'Searches' && loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <LoadingSpinner message="Loading saved listings..." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Saved</Text>
            <Text style={styles.subtitle}>
              {totalSaved > 0 ? `${totalSaved} listing${totalSaved === 1 ? '' : 's'} saved` : 'Tap the heart on any listing'}
            </Text>
          </View>
          <View style={styles.headerBadge}>
            <Ionicons name="heart" size={16} color={COLORS.accent} />
          </View>
        </View>

        <SegmentedTabs tabs={TABS} activeIndex={activeIndex} counts={counts} onSelect={selectTab} />

        {activeTab === 'Searches' && searchesLoading ? (
          <LoadingSpinner message="Loading saved searches..." size="small" />
        ) : (
          <FlashList
            estimatedItemSize={activeTab === 'Searches' ? 72 : 300}
            data={activeTab === 'Searches' ? savedSearches : items}
            renderItem={activeTab === 'Searches' ? renderSearch : renderListing}
            keyExtractor={(item, index) => activeTab === 'Searches'
              ? String(item.id || item.search_key || index)
              : String(item.id || item.listing_id)}
            numColumns={1}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} colors={[COLORS.accent]} />
            }
            ListEmptyComponent={
              activeTab === 'Searches' ? (
                <EmptyState
                  icon="search-outline"
                  title="No saved searches"
                  message="Save a search from Explore to get back to it quickly."
                />
              ) : (
                <EmptyState
                  icon="heart-outline"
                  title={`No saved ${activeTab.toLowerCase()}`}
                  message="Items you save will appear here."
                />
              )
            }
          />
        )}
      </ScreenEntrance>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  title: {
    fontSize: FONT_SIZES.hero,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  headerBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // flexGrow:0 stops the horizontal ScrollView from stretching vertically and
  // pushing the chips down; it now hugs its content right under the header.
  chipScroll: {
    flexGrow: 0,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.accent,
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  chipTextActive: {
    color: COLORS.accent,
  },
  segmentBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: COLORS.surfaceHigher,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBadgeActive: {
    backgroundColor: COLORS.accent,
  },
  segmentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  segmentBadgeTextActive: {
    color: COLORS.black,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  cardWrap: {
    flex: 1,
    maxWidth: '50%',
    padding: 5,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: 130,
    backgroundColor: COLORS.surfaceHigher,
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  heartButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    padding: SPACING.sm,
  },
  cardTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 4,
  },
  cardPrice: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.accent,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  searchCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCardTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
    textTransform: 'capitalize',
  },
  searchCardSubtitle: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  searchDeleteBtn: {
    padding: 6,
  },
});
