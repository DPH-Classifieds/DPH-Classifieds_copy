import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, FlatList, TouchableOpacity, RefreshControl, Image, StyleSheet, SafeAreaView, Alert } from 'react-native';
import Text from '../../components/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatNumber } from '../../utils/formatters';
import SearchBar from '../../components/ui/SearchBar';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const CATEGORIES = [
  { id: 'cars', label: 'Cars', icon: 'car', screen: 'CarList' },
  { id: 'bikes', label: 'Bikes', icon: 'bicycle', screen: 'BikeList' },
  { id: 'plates', label: 'Plates', icon: 'key', screen: 'PlateList' },
  { id: 'parts', label: 'Parts', icon: 'construct', screen: 'PartList' },
];

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return item.images[0].url || item.images[0].image_url || item.images[0].display_url;
  }
  return item.image_url || item.display_url || null;
};

const getCarTitle = (item) => `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim() || 'Untitled Car';
const getBikeTitle = (item) => `${item.bike_brand || ''} ${item.bike_model || ''}`.trim() || 'Untitled Bike';
const getPlateTitle = (item) => {
  const parts = [item.city, item.code, item.number || item.digits].filter(Boolean);
  return parts.join(' ') || 'Untitled Plate';
};
const getPartTitle = (item) => item.part_type || item.brand || 'Untitled Part';

const DETAIL_SCREENS = {
  cars: 'CarDetail',
  bikes: 'BikeDetail',
  plates: 'PlateDetail',
  parts: 'PartDetail',
};

export default function HomeScreen({ navigation }) {
  const [homepageData, setHomepageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHomepageData = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/homepage/preview');
      const hasData = data?.cars?.length || data?.bikes?.length || data?.plates?.length || data?.parts?.length;
      if (hasData) {
        setHomepageData(data);
        return;
      }

      const [carsRes, bikesRes, platesRes, partsRes] = await Promise.all([
        apiClient.get('/api/cars?per_page=4'),
        apiClient.get('/api/bikes?per_page=3'),
        apiClient.get('/api/plates?per_page=3'),
        apiClient.get('/api/parts?per_page=3'),
      ]);

      setHomepageData({
        cars: Array.isArray(carsRes) ? carsRes : carsRes?.cars || [],
        bikes: Array.isArray(bikesRes) ? bikesRes : bikesRes?.bikes || [],
        plates: Array.isArray(platesRes) ? platesRes : platesRes?.plates || [],
        parts: Array.isArray(partsRes) ? partsRes : partsRes?.parts || [],
      });
    } catch (err) {
      // Failed to load homepage data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHomepageData();
  }, [fetchHomepageData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHomepageData();
  }, [fetchHomepageData]);

  const renderCategoryItem = ({ item }) => (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() => navigation.navigate(item.screen)}
      activeOpacity={0.7}
    >
      <Ionicons name={item.icon} size={28} color={COLORS.accent} />
      <Text style={styles.categoryLabel}>{item.label}</Text>
    </TouchableOpacity>
  );

  const renderHorizontalCard = (item, type) => {
    const detailScreen = DETAIL_SCREENS[type];
    let title;
    if (type === 'cars') title = getCarTitle(item);
    else if (type === 'bikes') title = getBikeTitle(item);
    else if (type === 'plates') title = getPlateTitle(item);
    else title = getPartTitle(item);

    return (
      <TouchableOpacity
        key={String(item.id)}
        style={styles.horizontalCard}
        onPress={() => navigation.navigate(detailScreen, { listingId: item.id })}
        activeOpacity={0.7}
      >
        {getImageUri(item) ? (
          <Image source={{ uri: getImageUri(item) }} style={styles.horizontalImage} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name={type === 'cars' ? 'car' : type === 'bikes' ? 'bicycle' : type === 'plates' ? 'key' : 'construct'} size={32} color={COLORS.textMuted} />
          </View>
        )}
        <View style={styles.horizontalCardContent}>
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.cardPrice}>
            {formatPrice(item.expected_selling_price || item.price)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHorizontalListing = ({ item, index }, type) => renderHorizontalCard(item, type);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner message="Loading listings..." />
      </SafeAreaView>
    );
  }

  const cars = homepageData?.cars || [];
  const bikes = homepageData?.bikes || [];
  const plates = homepageData?.plates || [];
  const parts = homepageData?.parts || [];

  const hasAnyData = cars.length > 0 || bikes.length > 0 || plates.length > 0 || parts.length > 0;

  const sections = [
    { key: 'cars', title: 'Latest Cars', data: cars, screen: 'CarList' },
    { key: 'bikes', title: 'Latest Bikes', data: bikes, screen: 'BikeList' },
    { key: 'plates', title: 'Latest Plates', data: plates, screen: 'PlateList' },
    { key: 'parts', title: 'Latest Parts', data: parts, screen: 'PartList' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Text style={styles.logoText}>DPH</Text>
          <TouchableOpacity
            style={styles.bellButton}
            onPress={() => Alert.alert('Notifications', 'No new notifications')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="notifications-outline" size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        <SearchBar
          placeholder="Search cars, bikes, plates..."
          onFocus={() => navigation.navigate('Explore')}
          style={styles.searchBar}
        />

        <View style={styles.section}>
          <FlatList
            data={CATEGORIES}
            renderItem={renderCategoryItem}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesList}
          />
        </View>

        {sections.map((section) =>
          section.data.length > 0 ? (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <TouchableOpacity onPress={() => navigation.navigate(section.screen)}>
                  <Text style={styles.seeAllText}>See All</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={section.data}
                renderItem={({ item }) => renderHorizontalCard(item, section.key)}
                keyExtractor={(item) => String(item.id)}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              />
            </View>
          ) : null
        )}

        {!loading && !hasAnyData && (
          <View style={styles.emptyState}>
            <Ionicons name="car" size={64} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No Listings Yet</Text>
            <Text style={styles.emptySubtitle}>
              Check back later for new listings in your area.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxl,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.accent,
    letterSpacing: 1,
  },
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBar: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.white,
  },
  seeAllText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.accent,
    fontWeight: '600',
  },
  categoriesList: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  categoryCard: {
    width: 100,
    height: 80,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  categoryLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    fontWeight: '500',
  },
  horizontalList: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  horizontalCard: {
    width: 180,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
  },
  horizontalImage: {
    width: '100%',
    height: 110,
  },
  imagePlaceholder: {
    width: '100%',
    height: 110,
    backgroundColor: '#1a1a1c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  horizontalCardContent: {
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
    marginBottom: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: SPACING.xxl * 2,
    paddingHorizontal: SPACING.lg,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: COLORS.white,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});
