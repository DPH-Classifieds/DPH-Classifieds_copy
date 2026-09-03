import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Keyboard, Platform, UIManager, ActivityIndicator, ScrollView, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Text from '../../components/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { router } from 'expo-router';
import { toastApiError, showSuccess, showInfo } from '../../utils/toast';
import apiClient from '../../utils/apiClient';
import { useAuthPrompt } from '../../components/ui/RequireAuth';
import { formatPrice, formatNumber } from '../../utils/formatters';
import { SPACING, BORDER_RADIUS, FONT_SIZES, TAB_BAR_CLEARANCE } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import {
  CAR_MAKES,
  CAR_MODELS,
  BIKE_BRANDS,
  BIKE_TYPES,
  getYearOptions,
} from '../../utils/listingConstants';
import ListingSkeleton from '../../components/ui/ListingSkeleton';
import AnimatedCard from '../../components/ui/AnimatedCard';
import FadeInView from '../../components/ui/FadeInView';
import FadeInImage from '../../components/ui/FadeInImage';
import UAEPlate from '../../components/ui/UAEPlate';
import BottomSheet from '../../components/ui/BottomSheet';
import { useSavedListings } from '../../context/SavedListingsContext';
import { useAuth } from '../../context/AuthContext';
import { useGridColumns } from '../../hooks/useGridColumns';
import { LayoutToggleButton } from '../../components/ui/ListHeader';
import CoachMarks from '../../components/ui/CoachMarks';
import { resolveMediaUrl } from '../../utils/media';
import { prefetchListing } from '../../utils/listingCache';
import { swrGet, swrSet } from '../../utils/swrCache';
import useListingCounts from '../../hooks/useListingCounts';
import useFeaturedPattern from '../../hooks/useFeaturedPattern';
import { applyFeaturedPlacement } from '../../utils/featuredPlacement';

// Cache key for the no-filter initial Explore payload.
const EXPLORE_INITIAL_CACHE_KEY = 'explore:initial:v1';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CATEGORIES = [
  { key: 'all', label: 'All', icon: 'grid-outline' },
  { key: 'cars', label: 'Cars', icon: 'car-outline' },
  { key: 'bikes', label: 'Bikes', icon: 'bicycle-outline' },
  { key: 'plates', label: 'Plates', icon: 'key-outline' },
  { key: 'parts', label: 'Parts', icon: 'construct-outline' },
  { key: 'reddit', label: 'Reddit', icon: 'logo-reddit' },
  { key: 'wanted', label: 'Wanted', icon: 'search-outline' },
];

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest', icon: 'time-outline' },
  { key: 'oldest', label: 'Oldest', icon: 'hourglass-outline' },
  { key: 'price_low', label: 'Price: Low to High', icon: 'trending-down-outline' },
  { key: 'price_high', label: 'Price: High to Low', icon: 'trending-up-outline' },
  { key: 'featured', label: 'Featured first', icon: 'star-outline' },
];

const EMIRATES = [
  'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman',
  'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah', 'Al Ain',
];

const PLATE_CODES = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];

const PART_CATEGORIES = [
  'Engine', 'Body', 'Electrical', 'Interior', 'Exterior',
  'Brakes', 'Suspension', 'Transmission', 'Wheels', 'Accessories',
];

const INITIAL_CAR_FILTERS = { manufacturer: '', model: '', city: '', min_price: '', max_price: '' };
const INITIAL_BIKE_FILTERS = { type: '', brand: '', city: '', min_price: '', max_price: '', min_year: '', max_year: '' };
const INITIAL_PLATE_FILTERS = { city: '', code: '', min_price: '', max_price: '' };
const INITIAL_PART_FILTERS = { category: '', min_price: '', max_price: '' };

const FIXED_CATEGORY_COLORS = {
  bikes: '#2196f3',
  plates: '#ff9800',
  parts: '#9c27b0',
  reddit: '#ff4500',
};

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

const normalizeItem = (category, item) => {
  if (category === 'cars') {
    return {
      id: item.id,
      category: 'cars',
      title: `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim() || item.listing_title || 'Untitled Car',
      specs: [item.make_year, item.fuel_type, item.kilometer_driven ? `${formatNumber(item.kilometer_driven)} km` : null].filter(Boolean),
      price: item.expected_selling_price,
      location: item.car_city || item.area || '',
      image: getImageUri(item),
      is_featured: item.is_featured,
      created_at: item.created_at,
      raw: item,
    };
  }
  if (category === 'bikes') {
    return {
      id: item.id,
      category: 'bikes',
      title: `${item.bike_brand || ''} ${item.bike_model || ''}`.trim() || 'Untitled Bike',
      specs: [item.make_year, item.engine_capacity, item.bike_category].filter(Boolean),
      // Bikes' real column is `price` — `expected_selling_price` is cars-only
      // and won't be present on a bike row (see _normalize_bike_record).
      price: item.price ?? item.expected_selling_price,
      location: item.area || '',
      image: getImageUri(item),
      is_featured: item.featured,
      created_at: item.created_at,
      raw: item,
    };
  }
  if (category === 'plates') {
    const plateNum = [item.city, item.code, item.number || item.digits].filter(Boolean).join(' ');
    return {
      id: item.id,
      category: 'plates',
      title: plateNum || 'Untitled Plate',
      specs: item.plate_format ? [item.plate_format] : [],
      price: item.price,
      location: item.city || '',
      image: getImageUri(item),
      is_featured: item.featured,
      created_at: item.created_at,
      raw: item,
    };
  }
  if (category === 'parts') {
    return {
      id: item.id,
      category: 'parts',
      title: item.part_type || item.brand || 'Untitled Part',
      specs: [item.condition, item.brand].filter(Boolean),
      price: item.price,
      location: item.city || '',
      image: getImageUri(item),
      is_featured: item.featured,
      created_at: item.created_at,
      raw: item,
    };
  }
  return { id: item.id, category, title: 'Unknown', specs: [], price: 0, location: '', image: null, raw: item };
};

const DETAIL_SCREENS = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };
const LIST_SCREENS = { cars: 'CarList', bikes: 'BikeList', plates: 'PlateList', parts: 'PartList', reddit: 'RedditList', wanted: 'BuyingRequests' };
const LISTING_PAGE_SIZE = 18;
// Keep the client-side inventory buffer bounded as feeds grow — otherwise a
// long scroll session accumulates every page ever fetched with no ceiling.
// FlashList already virtualizes rendering; this bounds parsed-object memory.
const MAX_LOADED_ITEMS_PER_CATEGORY = 240;

function PickerContent({ options, onSelect, onClose, selectedValue, colors }) {
  const pkStyles = pkStylesFor(colors);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!selectedValue) setSearch('');
  }, [selectedValue]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((item) => {
      const label = typeof item === 'object' ? item.name || item.label : item;
      return String(label).toLowerCase().includes(q);
    });
  }, [options, search]);

  const renderItem = useCallback(({ item }) => {
    const label = typeof item === 'object' ? item.name || item.label : item;
    const value = typeof item === 'object' ? item.name || item.label : item;
    const isSelected = selectedValue === value || selectedValue === label;
    return (
      <TouchableOpacity
        style={[pkStyles.option, isSelected && pkStyles.optionSelected]}
        onPress={() => { onSelect(value); onClose(); }}
        activeOpacity={0.7}
      >
        <Text style={[pkStyles.optionText, isSelected && pkStyles.optionTextSelected]}>
          {label}
        </Text>
        {isSelected && <Ionicons name="checkmark" size={18} color={colors.accent} />}
      </TouchableOpacity>
    );
  }, [onSelect, onClose, selectedValue, colors]);

  return (
    <>
      <View style={pkStyles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={pkStyles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={filteredOptions}
        renderItem={renderItem}
        keyExtractor={(item, i) => {
          const label = typeof item === 'object' ? item.name || item.label : item;
          return `${label}-${i}`;
        }}
        ItemSeparatorComponent={() => <View style={pkStyles.separator} />}
        contentContainerStyle={pkStyles.list}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={false}
        ListEmptyComponent={
          <Text style={pkStyles.empty}>No results found</Text>
        }
      />
    </>
  );
}

const pkStylesFor = (colors) => StyleSheet.create({
  list: { paddingHorizontal: SPACING.md },
  option: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: BORDER_RADIUS.md,
  },
  optionSelected: { backgroundColor: colors.primary },
  optionText: { color: colors.textPrimary, fontSize: FONT_SIZES.md, flex: 1 },
  optionTextSelected: { color: colors.accent, fontWeight: '600' },
  separator: { height: 0.5, backgroundColor: colors.borderLight },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: colors.border,
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: FONT_SIZES.md, padding: 0 },
  empty: { color: colors.textMuted, fontSize: FONT_SIZES.sm, textAlign: 'center', paddingVertical: SPACING.lg },
});

// Categories selectable inside the sheet. `wanted` has no inline filter rows
// (buying requests live on their own screen), so it navigates instead.
const SHEET_CATEGORIES = [
  { key: 'all', label: 'All', icon: 'grid-outline' },
  { key: 'cars', label: 'Cars', icon: 'car-outline' },
  { key: 'bikes', label: 'Bikes', icon: 'bicycle-outline' },
  { key: 'plates', label: 'Plates', icon: 'key-outline' },
  { key: 'parts', label: 'Parts', icon: 'construct-outline' },
  { key: 'wanted', label: 'Wanted', icon: 'search-outline' },
];

function FilterContent({ activeTab, onSelectTab, carFilters, setCarFilters, bikeFilters, setBikeFilters,
  plateFilters, setPlateFilters, partFilters, setPartFilters, hideReddit, setHideReddit,
  onReset, openPicker, yearOptions, colors }) {

  const fcStyles = fcStylesFor(colors);

  const renderCar = () => (
    <>
      <FilterRow label="Make" value={carFilters.manufacturer} colors={colors} onPress={() =>
        openPicker('manufacturer', 'Manufacturer', CAR_MAKES, (v) => setCarFilters(p => ({ ...p, manufacturer: v, model: '' })), carFilters.manufacturer)
      } />
      <FilterRow label="Model" value={carFilters.model} colors={colors} onPress={() => {
        const models = carFilters.manufacturer && CAR_MODELS[carFilters.manufacturer] ? CAR_MODELS[carFilters.manufacturer] : [];
        if (models.length === 0) return;
        openPicker('model', 'Model', models, (v) => setCarFilters(p => ({ ...p, model: v })), carFilters.model);
      }} />
      <FilterRow label="City" value={carFilters.city} colors={colors} onPress={() =>
        openPicker('city', 'City', EMIRATES, (v) => setCarFilters(p => ({ ...p, city: v })), carFilters.city)
      } />
      <PriceRange min={carFilters.min_price} max={carFilters.max_price} colors={colors}
        onMin={(v) => setCarFilters(p => ({ ...p, min_price: v }))}
        onMax={(v) => setCarFilters(p => ({ ...p, max_price: v }))} />
    </>
  );

  const renderBike = () => (
    <>
      <FilterRow label="Type" value={bikeFilters.type} colors={colors} onPress={() =>
        openPicker('type', 'Bike Type', BIKE_TYPES, (v) => setBikeFilters(p => ({ ...p, type: v })), bikeFilters.type)
      } />
      <FilterRow label="Brand" value={bikeFilters.brand} colors={colors} onPress={() =>
        openPicker('brand', 'Brand', BIKE_BRANDS, (v) => setBikeFilters(p => ({ ...p, brand: v })), bikeFilters.brand)
      } />
      <FilterRow label="City" value={bikeFilters.city} colors={colors} onPress={() =>
        openPicker('city', 'City', EMIRATES, (v) => setBikeFilters(p => ({ ...p, city: v })), bikeFilters.city)
      } />
      <PriceRange min={bikeFilters.min_price} max={bikeFilters.max_price} colors={colors}
        onMin={(v) => setBikeFilters(p => ({ ...p, min_price: v }))}
        onMax={(v) => setBikeFilters(p => ({ ...p, max_price: v }))} />
      <FilterRow label="Min Year" value={bikeFilters.min_year} colors={colors} onPress={() =>
        openPicker('min_year', 'Min Year', yearOptions, (v) => setBikeFilters(p => ({ ...p, min_year: v })), bikeFilters.min_year)
      } />
      <FilterRow label="Max Year" value={bikeFilters.max_year} colors={colors} onPress={() =>
        openPicker('max_year', 'Max Year', yearOptions, (v) => setBikeFilters(p => ({ ...p, max_year: v })), bikeFilters.max_year)
      } />
    </>
  );

  const renderPlate = () => (
    <>
      <FilterRow label="City" value={plateFilters.city} colors={colors} onPress={() =>
        openPicker('city', 'City', EMIRATES, (v) => setPlateFilters(p => ({ ...p, city: v })), plateFilters.city)
      } />
      <FilterRow label="Code" value={plateFilters.code} colors={colors} onPress={() =>
        openPicker('code', 'Code', PLATE_CODES, (v) => setPlateFilters(p => ({ ...p, code: v })), plateFilters.code)
      } />
      <PriceRange min={plateFilters.min_price} max={plateFilters.max_price} colors={colors}
        onMin={(v) => setPlateFilters(p => ({ ...p, min_price: v }))}
        onMax={(v) => setPlateFilters(p => ({ ...p, max_price: v }))} />
    </>
  );

  const renderPart = () => (
    <>
      <FilterRow label="Category" value={partFilters.category} colors={colors} onPress={() =>
        openPicker('category', 'Part Category', PART_CATEGORIES, (v) => setPartFilters(p => ({ ...p, category: v })), partFilters.category)
      } />
      <PriceRange min={partFilters.min_price} max={partFilters.max_price} colors={colors}
        onMin={(v) => setPartFilters(p => ({ ...p, min_price: v }))}
        onMax={(v) => setPartFilters(p => ({ ...p, max_price: v }))} />
    </>
  );

  return (
    <View>
      <View style={fcStyles.header}>
        <Text style={fcStyles.headerTitle}>Filters</Text>
        <TouchableOpacity onPress={onReset} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={fcStyles.resetText}>Reset</Text>
        </TouchableOpacity>
      </View>
      <Text style={fcStyles.sectionLabel}>Category</Text>
      <View style={fcStyles.catChipsRow}>
        {SHEET_CATEGORIES.map((cat) => {
          const selected = activeTab === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[fcStyles.catChip, selected && fcStyles.catChipActive]}
              onPress={() => onSelectTab(cat.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={cat.icon}
                size={14}
                color={selected ? colors.chipActiveText : colors.textSecondary}
              />
              <Text style={[fcStyles.catChipText, selected && fcStyles.catChipTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {(activeTab === 'cars' || activeTab === 'all') && renderCar()}
      {activeTab === 'bikes' && renderBike()}
      {activeTab === 'plates' && renderPlate()}
      {activeTab === 'parts' && renderPart()}
      <View style={fcStyles.switchRow}>
        <View style={fcStyles.switchTextWrap}>
          <Text style={fcStyles.switchLabel}>Hide Reddit</Text>
          <Text style={fcStyles.switchSub}>Hide Reddit-sourced listings</Text>
        </View>
        <Switch
          value={hideReddit}
          onValueChange={setHideReddit}
          trackColor={{ false: colors.surfaceHigher, true: colors.primaryLight }}
          thumbColor={hideReddit ? colors.accent : colors.textMuted}
        />
      </View>
    </View>
  );
}

function FilterRow({ label, value, onPress, colors }) {
  const frStyles = frStylesFor(colors);
  return (
    <TouchableOpacity style={frStyles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={frStyles.label}>{label}</Text>
      <View style={frStyles.right}>
        <Text style={[frStyles.value, !value && frStyles.valueMuted]} numberOfLines={1}>
          {value || 'All'}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const frStylesFor = (colors) => StyleSheet.create({
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight,
  },
  label: { color: colors.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '500' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  value: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, textAlign: 'right', maxWidth: 140 },
  valueMuted: { color: colors.textMuted },
});

function PriceRange({ min, max, onMin, onMax, colors }) {
  const prStyles = prStylesFor(colors);
  return (
    <View style={prStyles.container}>
      <View style={prStyles.field}>
        <Text style={prStyles.fieldLabel}>Min AED</Text>
        <TextInput
          style={prStyles.input} value={min} onChangeText={onMin}
          placeholder="0" placeholderTextColor={colors.textMuted} keyboardType="numeric"
        />
      </View>
      <View style={prStyles.divider} />
      <View style={prStyles.field}>
        <Text style={prStyles.fieldLabel}>Max AED</Text>
        <TextInput
          style={prStyles.input} value={max} onChangeText={onMax}
          placeholder="No limit" placeholderTextColor={colors.textMuted} keyboardType="numeric"
        />
      </View>
    </View>
  );
}

const prStylesFor = (colors) => StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md,
    paddingVertical: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight,
  },
  field: { flex: 1 },
  fieldLabel: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, marginBottom: 4, fontWeight: '500' },
  input: {
    backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: colors.border,
    color: colors.textPrimary, fontSize: FONT_SIZES.sm, paddingHorizontal: 12, paddingVertical: 8,
  },
  divider: { width: 1, height: 30, backgroundColor: colors.borderLight },
});

const fcStylesFor = (colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight,
  },
  headerTitle: { color: colors.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700' },
  resetText: { color: colors.accent, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  sectionLabel: {
    color: colors.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '700',
    letterSpacing: 0.5, textTransform: 'uppercase',
    paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm,
  },
  catChipsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight,
  },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  catChipActive: { backgroundColor: colors.primary, borderColor: colors.accent + '40' },
  catChipText: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '500' },
  catChipTextActive: { color: colors.chipActiveText },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: SPACING.md,
  },
  switchTextWrap: { flex: 1, paddingRight: SPACING.sm },
  switchLabel: { color: colors.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '500' },
  switchSub: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
});

function ExploreCard({ item, index, onPress, onSave, saved, columns, colors, styles }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const catColor = FIXED_CATEGORY_COLORS[item.category] || colors.accent;
  const grid = columns === 2;
  // Plates have no photo — render the generated plate graphic (same as the
  // dedicated plate list / detail) instead of the gray placeholder.
  const isPlate = item.category === 'plates' || item.category === 'plate';
  const plate = isPlate ? (item.raw || item) : null;
  const isHighlighted = item.is_featured && item.featured_highlight !== false;
  return (
    <Animated.View style={[animatedStyle, grid && styles.cardOuterGrid]}>
      <PressableScale onPress={onPress}>
        <View style={[styles.card, grid && styles.cardGrid, isHighlighted && styles.cardHighlighted]}>
          <View style={[styles.cardImageWrap, grid && styles.cardImageWrapGrid]}>
            {isPlate ? (
              <View style={styles.cardPlateWrap}>
                <UAEPlate
                  city={plate.city}
                  code={plate.code}
                  number={plate.number || plate.digits}
                  sold={plate.status === 'sold'}
                  style={{ width: '100%' }}
                />
              </View>
            ) : item.image ? (
              <FadeInImage source={{ uri: item.image }} style={styles.cardImage} resizeMode="cover" />
            ) : (
              <View style={styles.cardImagePlaceholder}>
                <Ionicons name="image-outline" size={28} color={colors.textMuted} />
              </View>
            )}
            <View style={[styles.cardCatBadge, { backgroundColor: catColor }]}>
              <Text style={styles.cardCatText}>{item.category.charAt(0).toUpperCase() + item.category.slice(1)}</Text>
            </View>
            <TouchableOpacity
              style={styles.cardSaveBtn}
              onPress={onSave}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={saved ? 'heart' : 'heart-outline'}
                size={18}
                color={saved ? colors.error : colors.white}
              />
            </TouchableOpacity>
            {isHighlighted && (
              <View style={styles.cardFeatured}>
                <Ionicons name="star" size={10} color={colors.black} />
                <Text style={styles.cardFeaturedText}>Featured</Text>
              </View>
            )}
          </View>
          <View style={[styles.cardBody, grid && styles.cardBodyGrid]}>
            <Text style={styles.cardPrice}>
              {item.price ? formatPrice(item.price) : 'Price on request'}
            </Text>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            {item.specs && item.specs.length > 0 ? (
              <View style={styles.cardSpecsRow}>
                {item.specs.map((spec, i) => (
                  <Text key={i} style={styles.cardSubtitle} numberOfLines={1}>
                    {spec}
                  </Text>
                ))}
              </View>
            ) : null}
            {item.location ? (
              <View style={styles.cardLocationRow}>
                <Ionicons name="location-outline" size={11} color={colors.textMuted} />
                <Text style={styles.cardLocation} numberOfLines={1}>{item.location}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function ExploreScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    hero: {
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.sm,
    },
    heroKicker: {
      color: colors.accent,
      fontSize: FONT_SIZES.xs,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 1.5,
      marginBottom: 4,
    },
    heroTitle: {
      color: colors.textPrimary,
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: -0.5,
    },

    searchWrap: { paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 16, paddingVertical: 11, gap: 10,
      borderWidth: 1, borderColor: colors.borderLight,
    },
    searchInput: { flex: 1, color: colors.textPrimary, fontSize: FONT_SIZES.md },

    catRowWrap: { marginBottom: SPACING.md },
    catRow: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, gap: 8,
    },
    catPill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 8,
      borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: colors.borderLight,
    },
    catPillActive: { backgroundColor: colors.primary, borderColor: colors.accent + '40' },
    catPillLabel: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '500' },
    catPillLabelActive: { color: colors.chipActiveText },
    catPillCount: { color: colors.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '600' },

    controlsRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: SPACING.md, marginBottom: SPACING.md,
    },
    controlsRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    filterBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 7,
      borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: colors.borderLight,
    },
    filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.accent + '40' },
    filterBtnText: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '600' },
    filterBtnTextActive: { color: colors.chipActiveText },
    resultCount: { color: colors.textMuted, fontSize: FONT_SIZES.sm },
    sortBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 7,
      borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: colors.borderLight,
    },
    sortBtnText: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '500' },

    activeChips: { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
    clearAllChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
      backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: BORDER_RADIUS.pill,
    },
    clearAllText: { color: colors.chipActiveText, fontSize: FONT_SIZES.xs, fontWeight: '600' },
    saveSearchBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
      marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: BORDER_RADIUS.pill,
      borderWidth: 1, borderColor: colors.borderLight,
    },
    saveSearchText: { color: colors.accent, fontSize: FONT_SIZES.xs, fontWeight: '600' },

    listContent: { paddingBottom: TAB_BAR_CLEARANCE },
    listContentGrid: { paddingBottom: TAB_BAR_CLEARANCE, paddingHorizontal: SPACING.md - SPACING.xs },

    card: {
      backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.xl,
      overflow: 'hidden', marginHorizontal: SPACING.md, marginBottom: SPACING.md,
      borderWidth: 1, borderColor: colors.borderLight,
    },
    cardOuterGrid: { flex: 1, marginHorizontal: SPACING.xs },
    cardGrid: { marginHorizontal: 0 },
    cardHighlighted: { borderWidth: 2, borderColor: colors.warning },
    cardImageWrap: { height: 210, position: 'relative' },
    cardPlateWrap: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.surfaceDark,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: SPACING.lg,
    },
    cardImageWrapGrid: { height: 130 },
    cardImage: { width: '100%', height: '100%' },
    cardImagePlaceholder: {
      width: '100%', height: '100%', backgroundColor: colors.surfaceDark,
      justifyContent: 'center', alignItems: 'center',
    },
    cardCatBadge: {
      position: 'absolute', top: 8, left: 8,
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: BORDER_RADIUS.sm,
    },
    cardCatText: { color: colors.textPrimary, fontSize: 10, fontWeight: '700' },
    cardSaveBtn: {
      position: 'absolute', top: 8, right: 8,
      width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center', justifyContent: 'center',
    },
    cardFeatured: {
      position: 'absolute', bottom: 8, left: 8,
      flexDirection: 'row', alignItems: 'center', gap: 3,
      backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3,
      borderRadius: BORDER_RADIUS.sm,
    },
    cardFeaturedText: { color: colors.black, fontSize: 9, fontWeight: '700' },

    cardBody: { paddingHorizontal: 14, paddingVertical: 14 },
    cardBodyGrid: { height: 148, overflow: 'hidden' },
    cardPrice: {
      color: colors.accent, fontSize: FONT_SIZES.lg, fontWeight: '800', marginBottom: 6,
    },
    cardTitle: { color: colors.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: 6 },
    cardSpecsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
    cardSubtitle: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, lineHeight: 18 },
    cardLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    cardLocation: { color: colors.textMuted, fontSize: FONT_SIZES.xs },

    loadMoreWrap: { paddingVertical: SPACING.md, alignItems: 'center' },
    ctaCard: {
      marginHorizontal: SPACING.md, marginTop: SPACING.sm, marginBottom: SPACING.md,
      backgroundColor: colors.primary, borderRadius: BORDER_RADIUS.lg, overflow: 'hidden',
      borderWidth: 1, borderColor: colors.accent + '30',
    },
    ctaContent: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      padding: SPACING.md,
    },
    ctaLeft: { flex: 1 },
    ctaTitle: { color: colors.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: 2 },
    ctaSubtitle: { color: colors.textSecondary, fontSize: FONT_SIZES.sm },
    ctaIconWrap: { marginLeft: SPACING.md },

    emptyContainer: { alignItems: 'center', paddingTop: SPACING.xxl * 2, paddingHorizontal: SPACING.lg },
    emptyTitle: { color: colors.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '600', marginTop: SPACING.md, marginBottom: SPACING.xs },
    emptySubtitle: { color: colors.textSecondary, fontSize: FONT_SIZES.md, textAlign: 'center' },
    clearSearchBtn: {
      marginTop: SPACING.md, backgroundColor: colors.surface,
      paddingHorizontal: 20, paddingVertical: 10, borderRadius: BORDER_RADIUS.pill,
    },
    clearSearchText: { color: colors.accent, fontWeight: '600' },
  }), [colors]);

  const totalCounts = useListingCounts();
  const featuredPattern = useFeaturedPattern();
  const [featuredByCategory, setFeaturedByCategory] = useState({ cars: [], bikes: [], plates: [], parts: [] });
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [allItems, setAllItems] = useState({ cars: [], bikes: [], plates: [], parts: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pages, setPages] = useState({
    cars: { offset: 0, hasMore: true },
    bikes: { offset: 0, hasMore: true },
    plates: { offset: 0, hasMore: true },
    parts: { offset: 0, hasMore: true },
  });
  const pagesRef = useRef(pages);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  const mountedRef = useRef(true);

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [carFilters, setCarFilters] = useState(INITIAL_CAR_FILTERS);
  const [bikeFilters, setBikeFilters] = useState(INITIAL_BIKE_FILTERS);
  const [plateFilters, setPlateFilters] = useState(INITIAL_PLATE_FILTERS);
  const [partFilters, setPartFilters] = useState(INITIAL_PART_FILTERS);
  // "Hide Reddit" lives in the Filters sheet (switch row) and mirrors the
  // per-category chip on Car/Bike/Plate/PartListScreen.
  const [hideReddit, setHideReddit] = useState(false);

  const [pickerState, setPickerState] = useState({ visible: false, title: '', options: [], onSelect: () => {}, selectedValue: '' });

  const { isSaved, toggleSaveListing } = useSavedListings();
  const { requireAuth, AuthPromptModal } = useAuthPrompt(navigation);
  const { user } = useAuth();
  const { columns, toggleColumns } = useGridColumns();

  // First-login guided tour: spotlight the search, categories and the
  // filter/sort/layout controls once, then remember it's been seen.
  const searchRef = useRef(null);
  const catRef = useRef(null);
  const controlsRef = useRef(null);
  const [tourVisible, setTourVisible] = useState(false);
  const tourScheduledRef = useRef(false);
  useEffect(() => {
    if (!user || loading || tourScheduledRef.current) return;
    let cancelled = false;
    let timer;
    AsyncStorage.getItem('onboarding_tour_seen_v1').then((seen) => {
      if (cancelled || seen) return;
      tourScheduledRef.current = true;
      timer = setTimeout(() => { if (!cancelled) setTourVisible(true); }, 800);
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [user, loading]);
  const finishTour = useCallback(() => {
    setTourVisible(false);
    AsyncStorage.setItem('onboarding_tour_seen_v1', '1');
  }, []);
  const tourSteps = useMemo(() => [
    { ref: searchRef, title: 'Search everything', text: 'Find cars, bikes, plates and parts from one search box.' },
    { ref: catRef, title: 'Browse by category', text: 'Tap a category to jump straight to those listings.' },
    { ref: controlsRef, title: 'Filter, sort & layout', text: 'Narrow and reorder results — and tap the grid icon to switch between one or two listings per row.' },
    { title: 'Sell, save & manage', text: 'Use the tabs below to post a listing, view your saved favourites, and manage your profile.' },
  ], []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Re-apply filters when arriving from a saved search (SavedScreen's
  // Searches tab navigates here with these params).
  useEffect(() => {
    const raw = route?.params?.savedSearch;
    if (!raw) return;
    // Expo Router serializes params to strings, so a saved search arrives as JSON.
    let saved = raw;
    if (typeof raw === 'string') { try { saved = JSON.parse(raw); } catch { saved = null; } }
    if (!saved) return;
    if (saved.category) setActiveTab(saved.category);
    setSearch(saved.query || '');
    const filters = saved.filters || {};
    if (saved.category === 'cars') setCarFilters(prev => ({ ...prev, ...filters }));
    else if (saved.category === 'bikes') setBikeFilters(prev => ({ ...prev, ...filters }));
    else if (saved.category === 'plates') setPlateFilters(prev => ({ ...prev, ...filters }));
    else if (saved.category === 'parts') setPartFilters(prev => ({ ...prev, ...filters }));
    navigation.setParams({ savedSearch: undefined });
  }, [route?.params?.savedSearch, navigation]);

  const openPicker = useCallback((type, title, options, onSelect, selectedValue) => {
    setPickerState({ visible: true, title, options, onSelect, selectedValue });
  }, []);

  const closePicker = useCallback(() => {
    setPickerState(prev => ({ ...prev, visible: false }));
  }, []);

  const buildFilterParams = useCallback(() => {
    const params = {};
    if (activeTab === 'cars' || activeTab === 'all') {
      // Use the backend's actual car filter param names (get_cars allowed_filters).
      // These keys are car-specific, so they're harmlessly ignored by the
      // bike/plate/part endpoints that share this query string.
      if (carFilters.manufacturer) params.car_manufacturer = carFilters.manufacturer;
      if (carFilters.model) params.car_model = carFilters.model;
      if (carFilters.city) params.car_city = carFilters.city;
      if (carFilters.min_price) params.price_from = carFilters.min_price;
      if (carFilters.max_price) params.price_to = carFilters.max_price;
    }
    if (activeTab === 'bikes' || activeTab === 'all') {
      if (bikeFilters.type) params.bike_type = bikeFilters.type;
      if (bikeFilters.brand) params.bike_brand = bikeFilters.brand;
      // Bikes has no `city` column — the closest real filter is `area`
      // (see backend get_bikes' _collect_listing_filter_pairs whitelist).
      if (bikeFilters.city) params.area = bikeFilters.city;
      if (bikeFilters.min_price) params.price_from = bikeFilters.min_price;
      if (bikeFilters.max_price) params.price_to = bikeFilters.max_price;
      if (bikeFilters.min_year) params.year_from = bikeFilters.min_year;
      if (bikeFilters.max_year) params.year_to = bikeFilters.max_year;
    }
    if (activeTab === 'plates' || activeTab === 'all') {
      if (plateFilters.city) params.city = plateFilters.city;
      if (plateFilters.code) params.code = plateFilters.code;
      if (plateFilters.min_price) params.price_from = plateFilters.min_price;
      if (plateFilters.max_price) params.price_to = plateFilters.max_price;
    }
    if (activeTab === 'parts' || activeTab === 'all') {
      if (partFilters.category) params.part_type = partFilters.category;
      if (partFilters.min_price) params.price_from = partFilters.min_price;
      if (partFilters.max_price) params.price_to = partFilters.max_price;
    }
    // Shared across every category endpoint (mirrors the per-list-screen chip).
    if (hideReddit) params.exclude_reddit = 'true';
    return params;
  }, [activeTab, carFilters, bikeFilters, plateFilters, partFilters, hideReddit]);

  const fetchAllListings = useCallback(async () => {
    try {
      const filterParams = buildFilterParams();
      const qs = new URLSearchParams(filterParams).toString();
      const buildUrl = (base) => {
        const pageQs = `limit=${LISTING_PAGE_SIZE}&offset=0`;
        return qs ? `${base}?${pageQs}&${qs}` : `${base}?${pageQs}`;
      };

      const [carsRes, bikesRes, platesRes, partsRes] = await Promise.all([
        apiClient.get(buildUrl('/api/cars')).catch(() => []),
        apiClient.get(buildUrl('/api/bikes')).catch(() => []),
        apiClient.get(buildUrl('/api/plates')).catch(() => []),
        apiClient.get(buildUrl('/api/parts')).catch(() => []),
      ]);

      if (!mountedRef.current) return;

      const cars = Array.isArray(carsRes) ? carsRes : carsRes?.cars || [];
      const bikes = Array.isArray(bikesRes) ? bikesRes : bikesRes?.bikes || [];
      const plates = Array.isArray(platesRes) ? platesRes : platesRes?.plates || [];
      const parts = Array.isArray(partsRes) ? partsRes : partsRes?.parts || [];

      setAllItems({ cars, bikes, plates, parts });
      setPages({
        cars: { offset: 0, hasMore: cars.length === LISTING_PAGE_SIZE },
        bikes: { offset: 0, hasMore: bikes.length === LISTING_PAGE_SIZE },
        plates: { offset: 0, hasMore: plates.length === LISTING_PAGE_SIZE },
        parts: { offset: 0, hasMore: parts.length === LISTING_PAGE_SIZE },
      });

      // Persist the no-filter payload so the next cold start / tab switch
      // can paint listings before the network responds.
      if (!qs) {
        swrSet(EXPLORE_INITIAL_CACHE_KEY, { cars, bikes, plates, parts });
      }
    } catch (err) {
      toastApiError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildFilterParams]);

  // Appends the next page for whichever categories the active tab covers.
  // Guards on a ref (not just loadingMore state) so a second onEndReached
  // fired before the first setState commits can't race a duplicate fetch.
  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || loading || refreshing) return;
    const categories = activeTab === 'all' ? ['cars', 'bikes', 'plates', 'parts'] : [activeTab];
    const targets = categories.filter((cat) => pagesRef.current[cat]?.hasMore);
    if (!targets.length) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const filterParams = buildFilterParams();
      const qs = new URLSearchParams(filterParams).toString();
      const endpointFor = { cars: '/api/cars', bikes: '/api/bikes', plates: '/api/plates', parts: '/api/parts' };

      const results = await Promise.all(targets.map((cat) => {
        const nextOffset = pagesRef.current[cat].offset + LISTING_PAGE_SIZE;
        const pageQs = `limit=${LISTING_PAGE_SIZE}&offset=${nextOffset}`;
        const url = qs ? `${endpointFor[cat]}?${pageQs}&${qs}` : `${endpointFor[cat]}?${pageQs}`;
        return apiClient.get(url).catch(() => []).then((res) => ({
          cat,
          nextOffset,
          items: Array.isArray(res) ? res : res?.[cat] || [],
        }));
      }));

      if (!mountedRef.current) return;

      setAllItems((prev) => {
        const next = { ...prev };
        results.forEach(({ cat, items }) => {
          next[cat] = [...prev[cat], ...items].slice(0, MAX_LOADED_ITEMS_PER_CATEGORY);
        });
        return next;
      });
      setPages((prev) => {
        const next = { ...prev };
        results.forEach(({ cat, nextOffset, items }) => {
          next[cat] = { offset: nextOffset, hasMore: items.length === LISTING_PAGE_SIZE };
        });
        return next;
      });
    } catch (err) {
      toastApiError(err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [activeTab, buildFilterParams, loading, refreshing]);

  // Hydrate from cache before the network resolves. Skeleton only shows on
  // a true cold first-ever load (no cache and no fetch result yet).
  useEffect(() => {
    let cancelled = false;
    swrGet(EXPLORE_INITIAL_CACHE_KEY).then((hit) => {
      if (cancelled || !hit?.value) return;
      const { cars = [], bikes = [], plates = [], parts = [] } = hit.value;
      if (cars.length || bikes.length || plates.length || parts.length) {
        setAllItems({ cars, bikes, plates, parts });
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { fetchAllListings(); }, [fetchAllListings]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAllListings();
  }, [fetchAllListings]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    Object.values(carFilters).forEach(v => { if (v) count++; });
    Object.values(bikeFilters).forEach(v => { if (v) count++; });
    Object.values(plateFilters).forEach(v => { if (v) count++; });
    Object.values(partFilters).forEach(v => { if (v) count++; });
    if (hideReddit) count++;
    return count;
  }, [carFilters, bikeFilters, plateFilters, partFilters, hideReddit]);

  const resetFilters = useCallback(() => {
    setCarFilters(INITIAL_CAR_FILTERS);
    setBikeFilters(INITIAL_BIKE_FILTERS);
    setPlateFilters(INITIAL_PLATE_FILTERS);
    setPartFilters(INITIAL_PART_FILTERS);
    setHideReddit(false);
  }, []);

  const currentFiltersForTab = () => {
    if (activeTab === 'cars') return carFilters;
    if (activeTab === 'bikes') return bikeFilters;
    if (activeTab === 'plates') return plateFilters;
    if (activeTab === 'parts') return partFilters;
    return {};
  };

  const handleSaveSearch = () => {
    if (!search.trim() && activeTab === 'all' && activeFilterCount === 0) {
      showInfo('Nothing to save', 'Add a query or choose a category first.');
      return;
    }
    requireAuth(async () => {
      try {
        await apiClient.post('/api/user/saved-searches', {
          category: activeTab,
          route_path: '/explore',
          query: search.trim(),
          filters: currentFiltersForTab(),
          result_count: normalizedItems.length,
        });
        showSuccess('Search saved', 'Find it under Saved → Searches.');
      } catch (err) {
        toastApiError(err);
      }
    });
  };

  // Featured listings for placement — one fetch per relevant category,
  // whenever the active tab changes.
  useEffect(() => {
    const targets = activeTab === 'all'
      ? ['cars', 'bikes', 'plates', 'parts']
      : ['cars', 'bikes', 'plates', 'parts'].includes(activeTab) ? [activeTab] : [];
    if (!targets.length) return undefined;
    const singular = { cars: 'car', bikes: 'bike', plates: 'plate', parts: 'part' };
    let mounted = true;
    Promise.allSettled(
      targets.map((cat) => apiClient.get(`/api/featured-listings?type=${singular[cat]}`))
    ).then((results) => {
      if (!mounted) return;
      setFeaturedByCategory((prev) => {
        const next = { ...prev };
        targets.forEach((cat, i) => {
          next[cat] = results[i].status === 'fulfilled' && Array.isArray(results[i].value) ? results[i].value : [];
        });
        return next;
      });
    });
    return () => { mounted = false; };
  }, [activeTab]);

  const normalizedFeatured = useMemo(() => {
    const toItems = (rows, category) => (rows || [])
      .filter((row) => row.listing)
      .map((row) => ({ ...normalizeItem(category, row.listing), is_featured: true, featured_highlight: row.highlight !== false }));
    return {
      cars: toItems(featuredByCategory.cars, 'cars'),
      bikes: toItems(featuredByCategory.bikes, 'bikes'),
      plates: toItems(featuredByCategory.plates, 'plates'),
      parts: toItems(featuredByCategory.parts, 'parts'),
    };
  }, [featuredByCategory]);

  const normalizedItems = useMemo(() => {
    let items = [];
    if (activeTab === 'all') {
      items = [
        ...allItems.cars.map(i => normalizeItem('cars', i)),
        ...allItems.bikes.map(i => normalizeItem('bikes', i)),
        ...allItems.plates.map(i => normalizeItem('plates', i)),
        ...allItems.parts.map(i => normalizeItem('parts', i)),
      ];
    } else {
      items = allItems[activeTab]?.map(i => normalizeItem(activeTab, i)) || [];
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(item =>
        item.title.toLowerCase().includes(q) ||
        (item.specs || []).some(s => s.toLowerCase().includes(q)) ||
        item.location.toLowerCase().includes(q)
      );
    }

    const ts = (d) => (d ? new Date(d).getTime() : 0);
    if (sortBy === 'price_low') {
      items.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sortBy === 'price_high') {
      items.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else if (sortBy === 'oldest') {
      items.sort((a, b) => ts(a.created_at) - ts(b.created_at));
    } else if (sortBy === 'featured') {
      items.sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0));
    } else {
      // newest
      items.sort((a, b) => ts(b.created_at) - ts(a.created_at));
    }

    return items;
  }, [allItems, activeTab, search, sortBy]);

  // True server-side total for the active tab (unfiltered) — falls back to
  // the loaded/matching count while totals are still in flight, once a
  // search/filter narrows the results, or for reddit/wanted (not tracked by
  // the counts endpoint). Doesn't touch loading/pagination — display only.
  const isUnfiltered = !search.trim() && activeFilterCount === 0;

  // Featured placement only reorders the default, unfiltered/unsorted view —
  // matches web's ExplorePage gating exactly.
  const displayedItems = useMemo(() => {
    if (!isUnfiltered || sortBy !== 'newest') return normalizedItems;
    const featuredPool = activeTab === 'all'
      ? [...normalizedFeatured.cars, ...normalizedFeatured.bikes, ...normalizedFeatured.plates, ...normalizedFeatured.parts]
      : normalizedFeatured[activeTab] || [];
    return applyFeaturedPlacement(normalizedItems, featuredPool, featuredPattern, (item) => `${item.category}-${item.id}`);
  }, [normalizedItems, normalizedFeatured, featuredPattern, isUnfiltered, sortBy, activeTab]);

  const totalKey = activeTab === 'all' ? 'all' : activeTab;
  const activeTotal = isUnfiltered && totalCounts && totalCounts[totalKey] !== undefined
    ? totalCounts[totalKey]
    : null;
  const yearOptions = useMemo(() => getYearOptions(), []);
  const currentSort = SORT_OPTIONS.find(o => o.key === sortBy);

  const handleCategoryPress = useCallback((key) => {
    if (key === 'all') {
      setActiveTab('all');
    } else {
      navigation.navigate(LIST_SCREENS[key]);
    }
  }, [navigation]);

  // Category picked inside the Filters sheet: filter the Explore feed in
  // place for the four vehicle categories; Wanted has no inline rows, so it
  // jumps to its own screen (same destination as the main category row).
  const handleSheetCategorySelect = useCallback((key) => {
    if (key === 'wanted') {
      setFilterSheetOpen(false);
      navigation.navigate('BuyingRequests');
    } else {
      setActiveTab(key);
    }
  }, [navigation]);

  const renderItem = useCallback(({ item, index }) => {
    const detailScreen = DETAIL_SCREENS[item.category];
    const saved = isSaved(item.category, item.id);
    return (
      <ExploreCard
        item={item}
        index={index}
        columns={columns}
        colors={colors}
        styles={styles}
        onPress={() => { prefetchListing(item.category, item.raw); navigation.navigate(detailScreen, { listingId: item.id }); }}
        onSave={() => toggleSaveListing(item.category, item.raw)}
        saved={saved}
      />
    );
  }, [navigation, isSaved, toggleSaveListing, columns, colors, styles]);

  // Warm the images of the landing feed's visible cards (first ~5-6 on app open,
  // then a sliding window as the user scrolls) so opening any of them is instant.
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    viewableItems.forEach((v) => {
      if (v.item?.category && v.item?.raw) prefetchListing(v.item.category, v.item.raw);
    });
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;

  const sortStyles = sortStylesFor(colors);

  const renderCTA = useCallback(() => (
    <>
      {loadingMore && (
        <View style={styles.loadMoreWrap}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      )}
      <TouchableOpacity
        style={styles.ctaCard}
        activeOpacity={0.8}
        onPress={() => router.push('/(post)')}
      >
        <View style={styles.ctaContent}>
          <View style={styles.ctaLeft}>
            <Text style={styles.ctaTitle}>List Your Vehicle</Text>
            <Text style={styles.ctaSubtitle}>It&apos;s free to post your listing</Text>
          </View>
          <View style={styles.ctaIconWrap}>
            <Ionicons name="add-circle" size={36} color={colors.accent} />
          </View>
        </View>
      </TouchableOpacity>
    </>
  ), [navigation, loadingMore]);

  const renderHeader = useCallback(() => (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroKicker}>DPH Classifieds</Text>
        <Text style={styles.heroTitle}>Find Your Next Ride</Text>
      </View>

      <View style={styles.searchWrap} ref={searchRef} collapsable={false}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search cars, bikes, plates..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.catRowWrap} ref={catRef} collapsable={false}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
          keyboardShouldPersistTaps="handled"
        >
          {CATEGORIES.map(cat => {
            const isActive = activeTab === cat.key;
            const total = totalCounts && totalCounts[cat.key] !== undefined ? totalCounts[cat.key] : null;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[styles.catPill, isActive && styles.catPillActive]}
                onPress={() => handleCategoryPress(cat.key)}
                activeOpacity={0.7}
              >
                <Ionicons name={cat.icon} size={14} color={isActive ? colors.chipActiveText : colors.textSecondary} />
                <Text style={[styles.catPillLabel, isActive && styles.catPillLabelActive]}>
                  {cat.label}
                </Text>
                {total !== null && (
                  <Text style={[styles.catPillCount, isActive && styles.catPillLabelActive]}>
                    {total.toLocaleString()}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.controlsRow} ref={controlsRef} collapsable={false}>
        <TouchableOpacity
          style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          onPress={() => setFilterSheetOpen(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="filter" size={14} color={activeFilterCount > 0 ? colors.chipActiveText : colors.textSecondary} />
          <Text style={[styles.filterBtnText, activeFilterCount > 0 && styles.filterBtnTextActive]}>
            {activeFilterCount > 0 ? `${activeFilterCount} Active` : 'Filters'}
          </Text>
        </TouchableOpacity>

        <View style={styles.controlsRight}>
          <Text style={styles.resultCount}>
            {(activeTotal ?? normalizedItems.length).toLocaleString()} {(activeTotal ?? normalizedItems.length) === 1 ? 'result' : 'results'}
          </Text>

          <TouchableOpacity style={styles.sortBtn} onPress={() => setSortSheetOpen(true)} activeOpacity={0.7}>
            <Ionicons name={currentSort?.icon || 'swap-vertical'} size={14} color={colors.textSecondary} />
            <Text style={styles.sortBtnText}>{currentSort?.label || 'Sort'}</Text>
            <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
          </TouchableOpacity>

          <LayoutToggleButton columns={columns} onToggle={toggleColumns} />
        </View>
      </View>

      {activeFilterCount > 0 && activeTab !== 'all' && (
        <View style={styles.activeChips}>
          <TouchableOpacity style={styles.clearAllChip} onPress={resetFilters}>
            <Ionicons name="close-circle" size={14} color={colors.chipActiveText} />
            <Text style={styles.clearAllText}>Clear all</Text>
          </TouchableOpacity>
        </View>
      )}

      {(search.trim() || activeTab !== 'all' || activeFilterCount > 0) && (
        <TouchableOpacity style={styles.saveSearchBtn} onPress={handleSaveSearch} activeOpacity={0.7}>
          <Ionicons name="bookmark-outline" size={14} color={colors.accent} />
          <Text style={styles.saveSearchText}>Save this search</Text>
        </TouchableOpacity>
      )}
    </View>
  ), [activeTab, search, sortBy, normalizedItems.length, activeFilterCount, currentSort, handleCategoryPress, resetFilters, handleSaveSearch, columns, toggleColumns, activeTotal, totalCounts]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
      {loading && !refreshing ? (
        <ListingSkeleton />
      ) : (
        <FlashList
          key={`cols-${columns}`}
          estimatedItemSize={columns === 2 ? 294 : 260}
          data={displayedItems}
          renderItem={renderItem}
          keyExtractor={(item, idx) => `${item.category || 'listing'}-${item.id || idx}`}
          numColumns={columns}
          contentContainerStyle={columns === 2 ? styles.listContentGrid : styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={renderHeader}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListFooterComponent={renderCTA}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No listings found</Text>
              <Text style={styles.emptySubtitle}>
                {search ? 'Try a different search term' : 'Check back later for new listings'}
              </Text>
              {search ? (
                <TouchableOpacity style={styles.clearSearchBtn} onPress={() => setSearch('')}>
                  <Text style={styles.clearSearchText}>Clear Search</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
        />
      )}
      </ScreenEntrance>
      <BottomSheet visible={pickerState.visible} onClose={closePicker} title={pickerState.title}>
        <PickerContent
          options={pickerState.options}
          onSelect={pickerState.onSelect}
          onClose={closePicker}
          selectedValue={pickerState.selectedValue}
          colors={colors}
        />
      </BottomSheet>

      <BottomSheet visible={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filters">
        <FilterContent
          activeTab={activeTab}
          onSelectTab={handleSheetCategorySelect}
          carFilters={carFilters} setCarFilters={setCarFilters}
          bikeFilters={bikeFilters} setBikeFilters={setBikeFilters}
          plateFilters={plateFilters} setPlateFilters={setPlateFilters}
          partFilters={partFilters} setPartFilters={setPartFilters}
          hideReddit={hideReddit} setHideReddit={setHideReddit}
          onReset={resetFilters}
          openPicker={openPicker}
          yearOptions={yearOptions}
          colors={colors}
        />
      </BottomSheet>

      <BottomSheet visible={sortSheetOpen} onClose={() => setSortSheetOpen(false)} title="Sort By">
        {SORT_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[sortStyles.option, sortBy === opt.key && sortStyles.optionActive]}
            onPress={() => { setSortBy(opt.key); setSortSheetOpen(false); }}
            activeOpacity={0.7}
          >
            <Ionicons name={opt.icon} size={18} color={sortBy === opt.key ? colors.chipActiveText : colors.textSecondary} />
            <Text style={[sortStyles.optionText, sortBy === opt.key && sortStyles.optionTextActive]}>
              {opt.label}
            </Text>
            {sortBy === opt.key && <Ionicons name="checkmark" size={18} color={colors.chipActiveText} />}
          </TouchableOpacity>
        ))}
      </BottomSheet>
      <AuthPromptModal />
      <CoachMarks visible={tourVisible} steps={tourSteps} onDone={finishTour} />
    </SafeAreaView>
  );
}

const sortStylesFor = (colors) => StyleSheet.create({
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight,
  },
  optionActive: { backgroundColor: colors.primary },
  optionText: { color: colors.textPrimary, fontSize: FONT_SIZES.md, flex: 1 },
  optionTextActive: { color: colors.chipActiveText, fontWeight: '600' },
});
