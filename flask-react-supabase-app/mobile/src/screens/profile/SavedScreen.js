import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSavedListings } from '../../context/SavedListingsContext';
import { formatPrice } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import AnimatedCard from '../../components/ui/AnimatedCard';
import FadeInView from '../../components/ui/FadeInView';
import FadeInImage from '../../components/ui/FadeInImage';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const TABS = ['Cars', 'Bikes', 'Plates', 'Parts'];
const TAB_KEYS = ['cars', 'bikes', 'plates', 'parts'];

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    if (typeof item.images[0] === 'string') return item.images[0];
    return item.images[0].url || item.images[0].image_url || item.images[0].display_url;
  }
  return item.image_url || item.display_url || null;
};

const getItemTitle = (item) => {
  if (item.listing_type === 'cars' || item.car_manufacturer) return `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim() || 'Car';
  if (item.listing_type === 'bikes' || item.bike_brand) return `${item.bike_brand || ''} ${item.bike_model || ''}`.trim() || 'Bike';
  if (item.listing_type === 'plates' || item.city) return [item.city, item.code, item.digits || item.number].filter(Boolean).join(' ') || 'Plate';
  return item.part_type || item.name || item.title || 'Listing';
};

const getItemPrice = (item) => item.expected_selling_price || item.price || 0;

const DETAIL_ROUTES = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };

export default function SavedScreen({ navigation }) {
  const { savedListings, loading, toggleSaveListing, savedCounts } = useSavedListings();
  const [activeTab, setActiveTab] = useState('Cars');

  const activeKey = TAB_KEYS[TABS.indexOf(activeTab)];
  const items = savedListings[activeKey] || [];

  const handleUnsave = async (item) => {
    const type = item.listing_type || activeKey;
    await toggleSaveListing(type, item);
  };

  const renderListing = ({ item }) => (
    <FadeInView delay={0}>
      <AnimatedCard
        onPress={() => navigation.navigate(DETAIL_ROUTES[activeKey], { listingId: item.id || item.listing_id })}
        style={styles.card}
      >
        {getImageUri(item) ? (
          <FadeInImage source={{ uri: getImageUri(item) }} style={styles.cardImage} resizeMode="cover" />
        ) : (
          <View style={[styles.cardImage, styles.imagePlaceholder]}>
            <Ionicons name="image-outline" size={32} color={COLORS.textMuted} />
          </View>
        )}
        <View style={styles.cardOverlay}>
          <TouchableOpacity
            style={styles.heartButton}
            onPress={() => handleUnsave(item)}
            activeOpacity={0.7}
          >
            <Ionicons name="heart" size={20} color={COLORS.error} />
          </TouchableOpacity>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{getItemTitle(item)}</Text>
          <Text style={styles.cardPrice}>{formatPrice(getItemPrice(item))}</Text>
        </View>
      </AnimatedCard>
    </FadeInView>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner message="Loading saved listings..." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Saved</Text>
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab, index) => {
          const key = TAB_KEYS[index];
          const count = savedCounts[key] || 0;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.activeTab]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                {tab}{count > 0 ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={items}
        renderItem={renderListing}
        keyExtractor={(item) => String(item.id || item.listing_id)}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="heart-outline"
            title={`No saved ${activeTab.toLowerCase()}`}
            message="Items you save will appear here."
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
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
  row: {
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  card: {
    width: '48.5%',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: 120,
    backgroundColor: COLORS.surfaceHigher,
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  heartButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
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
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    color: COLORS.accent,
  },
});
