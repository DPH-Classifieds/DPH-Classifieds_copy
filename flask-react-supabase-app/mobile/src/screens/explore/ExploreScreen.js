import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Keyboard,
  Platform,
  UIManager,
  ActivityIndicator,
} from 'react-native';
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
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, TAB_BAR_CLEARANCE } from '../../constants/theme';
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
import BottomSheet from '../../components/ui/BottomSheet';
import { useSavedListings } from '../../context/SavedListingsContext';
import { resolveMediaUrl } from '../../utils/media';
import { swrGet, swrSet } from '../../utils/swrCache';

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
  { key: 'wanted', label: 'Wanted', icon: 'search-outline' },
];

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest', icon: 'time-outline' },
  { key: 'price_low', label: 'Price: Low', icon: 'trending-down-outline' },
  { key: 'price_high', label: 'Price: High', icon: 'trending-up-outline' },
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

const CATEGORY_COLORS = {
  cars: COLORS.accent,
  bikes: '#2196f3',
  plates: '#ff9800',
  parts: '#9c27b0',
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
      subtitle: `${item.make_year || ''} ${item.kilometer_driven ? formatNumber(item.kilometer_driven) + ' km' : ''} ${item.fuel_type || ''}`.trim(),
      price: item.expected_selling_price,
      location: item.car_city || item.area || '',
      image: getImageUri(item),
      is_featured: item.is_featured,
      raw: item,
    };
  }
  if (category === 'bikes') {
    return {
      id: item.id,
      category: 'bikes',
      title: `${item.bike_brand || ''} ${item.bike_model || ''}`.trim() || 'Untitled Bike',
      subtitle: `${item.make_year || ''} ${item.engine_capacity || ''} ${item.bike_category || ''}`.trim(),
      price: item.expected_selling_price,
      location: item.car_city || item.area || '',
      image: getImageUri(item),
      is_featured: item.featured,
      raw: item,
    };
  }
  if (category === 'plates') {
    const plateNum = [item.city, item.code, item.number || item.digits].filter(Boolean).join(' ');
    return {
      id: item.id,
      category: 'plates',
      title: plateNum || 'Untitled Plate',
      subtitle: item.plate_format || '',
      price: item.price,
      location: item.city || '',
      image: getImageUri(item),
      is_featured: item.featured,
      raw: item,
    };
  }
  if (category === 'parts') {
    return {
      id: item.id,
      category: 'parts',
      title: item.part_type || item.brand || 'Untitled Part',
      subtitle: [item.condition, item.brand].filter(Boolean).join(' · '),
      price: item.price,
      location: item.city || '',
      image: getImageUri(item),
      is_featured: item.featured,
      raw: item,
    };
  }
  return { id: item.id, category, title: 'Unknown', subtitle: '', price: 0, location: '', image: null, raw: item };
};

const DETAIL_SCREENS = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };
const LIST_SCREENS = { cars: 'CarList', bikes: 'BikeList', plates: 'PlateList', parts: 'PartList', wanted: 'BuyingRequests' };
const LISTING_PAGE_SIZE = 18;

function PickerContent({ options, onSelect, onClose, selectedValue }) {
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
        {isSelected && <Ionicons name="checkmark" size={18} color={COLORS.accent} />}
      </TouchableOpacity>
    );
  }, [onSelect, onClose, selectedValue]);

  return (
    <>
      <View style={pkStyles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textMuted} />
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
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
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

const pkStyles = StyleSheet.create({
  list: { paddingHorizontal: SPACING.md },
  option: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: BORDER_RADIUS.md,
  },
  optionSelected: { backgroundColor: COLORS.primary },
  optionText: { color: COLORS.white, fontSize: FONT_SIZES.md, flex: 1 },
  optionTextSelected: { color: COLORS.accent, fontWeight: '600' },
  separator: { height: 0.5, backgroundColor: COLORS.borderLight },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  searchInput: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.md, padding: 0 },
  empty: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, textAlign: 'center', paddingVertical: SPACING.lg },
});

function FilterContent({ activeTab, carFilters, setCarFilters, bikeFilters, setBikeFilters,
  plateFilters, setPlateFilters, partFilters, setPartFilters, onReset, openPicker, yearOptions }) {

  const renderCar = () => (
    <>
      <FilterRow label="Make" value={carFilters.manufacturer} onPress={() =>
        openPicker('manufacturer', 'Manufacturer', CAR_MAKES, (v) => setCarFilters(p => ({ ...p, manufacturer: v, model: '' })), carFilters.manufacturer)
      } />
      <FilterRow label="Model" value={carFilters.model} onPress={() => {
        const models = carFilters.manufacturer && CAR_MODELS[carFilters.manufacturer] ? CAR_MODELS[carFilters.manufacturer] : [];
        if (models.length === 0) return;
        openPicker('model', 'Model', models, (v) => setCarFilters(p => ({ ...p, model: v })), carFilters.model);
      }} />
      <FilterRow label="City" value={carFilters.city} onPress={() =>
        openPicker('city', 'City', EMIRATES, (v) => setCarFilters(p => ({ ...p, city: v })), carFilters.city)
      } />
      <PriceRange min={carFilters.min_price} max={carFilters.max_price}
        onMin={(v) => setCarFilters(p => ({ ...p, min_price: v }))}
        onMax={(v) => setCarFilters(p => ({ ...p, max_price: v }))} />
    </>
  );

  const renderBike = () => (
    <>
      <FilterRow label="Type" value={bikeFilters.type} onPress={() =>
        openPicker('type', 'Bike Type', BIKE_TYPES, (v) => setBikeFilters(p => ({ ...p, type: v })), bikeFilters.type)
      } />
      <FilterRow label="Brand" value={bikeFilters.brand} onPress={() =>
        openPicker('brand', 'Brand', BIKE_BRANDS, (v) => setBikeFilters(p => ({ ...p, brand: v })), bikeFilters.brand)
      } />
      <FilterRow label="City" value={bikeFilters.city} onPress={() =>
        openPicker('city', 'City', EMIRATES, (v) => setBikeFilters(p => ({ ...p, city: v })), bikeFilters.city)
      } />
      <PriceRange min={bikeFilters.min_price} max={bikeFilters.max_price}
        onMin={(v) => setBikeFilters(p => ({ ...p, min_price: v }))}
        onMax={(v) => setBikeFilters(p => ({ ...p, max_price: v }))} />
      <FilterRow label="Min Year" value={bikeFilters.min_year} onPress={() =>
        openPicker('min_year', 'Min Year', yearOptions, (v) => setBikeFilters(p => ({ ...p, min_year: v })), bikeFilters.min_year)
      } />
      <FilterRow label="Max Year" value={bikeFilters.max_year} onPress={() =>
        openPicker('max_year', 'Max Year', yearOptions, (v) => setBikeFilters(p => ({ ...p, max_year: v })), bikeFilters.max_year)
      } />
    </>
  );

  const renderPlate = () => (
    <>
      <FilterRow label="City" value={plateFilters.city} onPress={() =>
        openPicker('city', 'City', EMIRATES, (v) => setPlateFilters(p => ({ ...p, city: v })), plateFilters.city)
      } />
      <FilterRow label="Code" value={plateFilters.code} onPress={() =>
        openPicker('code', 'Code', PLATE_CODES, (v) => setPlateFilters(p => ({ ...p, code: v })), plateFilters.code)
      } />
      <PriceRange min={plateFilters.min_price} max={plateFilters.max_price}
        onMin={(v) => setPlateFilters(p => ({ ...p, min_price: v }))}
        onMax={(v) => setPlateFilters(p => ({ ...p, max_price: v }))} />
    </>
  );

  const renderPart = () => (
    <>
      <FilterRow label="Category" value={partFilters.category} onPress={() =>
        openPicker('category', 'Part Category', PART_CATEGORIES, (v) => setPartFilters(p => ({ ...p, category: v })), partFilters.category)
      } />
      <PriceRange min={partFilters.min_price} max={partFilters.max_price}
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
      {activeTab === 'cars' && renderCar()}
      {activeTab === 'bikes' && renderBike()}
      {activeTab === 'plates' && renderPlate()}
      {activeTab === 'parts' && renderPart()}
    </View>
  );
}

function FilterRow({ label, value, onPress }) {
  return (
    <TouchableOpacity style={frStyles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={frStyles.label}>{label}</Text>
      <View style={frStyles.right}>
        <Text style={[frStyles.value, !value && frStyles.valueMuted]} numberOfLines={1}>
          {value || 'All'}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const frStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight,
  },
  label: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '500' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  value: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, textAlign: 'right', maxWidth: 140 },
  valueMuted: { color: COLORS.textMuted },
});

function PriceRange({ min, max, onMin, onMax }) {
  return (
    <View style={prStyles.container}>
      <View style={prStyles.field}>
        <Text style={prStyles.fieldLabel}>Min AED</Text>
        <TextInput
          style={prStyles.input} value={min} onChangeText={onMin}
          placeholder="0" placeholderTextColor={COLORS.textMuted} keyboardType="numeric"
        />
      </View>
      <View style={prStyles.divider} />
      <View style={prStyles.field}>
        <Text style={prStyles.fieldLabel}>Max AED</Text>
        <TextInput
          style={prStyles.input} value={max} onChangeText={onMax}
          placeholder="No limit" placeholderTextColor={COLORS.textMuted} keyboardType="numeric"
        />
      </View>
    </View>
  );
}

const prStyles = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md,
    paddingVertical: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight,
  },
  field: { flex: 1 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginBottom: 4, fontWeight: '500' },
  input: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    color: COLORS.white, fontSize: FONT_SIZES.sm, paddingHorizontal: 12, paddingVertical: 8,
  },
  divider: { width: 1, height: 30, backgroundColor: COLORS.borderLight },
});

const fcStyles = StyleSheet.create({
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight,
  },
  headerTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700' },
  resetText: { color: COLORS.accent, fontSize: FONT_SIZES.sm, fontWeight: '600' },
});

function ExploreCard({ item, index, onPress, onSave, saved }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const catColor = CATEGORY_COLORS[item.category] || COLORS.accent;
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress}>
        <View style={styles.card}>
          <View style={styles.cardImageWrap}>
            {item.image ? (
              <FadeInImage source={{ uri: item.image }} style={styles.cardImage} resizeMode="cover" />
            ) : (
              <View style={styles.cardImagePlaceholder}>
                <Ionicons name="image-outline" size={28} color={COLORS.textMuted} />
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
                color={saved ? COLORS.error : COLORS.white}
              />
            </TouchableOpacity>
            {item.is_featured && (
              <View style={styles.cardFeatured}>
                <Ionicons name="star" size={10} color={COLORS.black} />
                <Text style={styles.cardFeaturedText}>Featured</Text>
              </View>
            )}
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardPrice}>
              {item.price ? formatPrice(item.price) : 'Price on request'}
            </Text>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            {item.subtitle ? (
              <Text style={styles.cardSubtitle} numberOfLines={2}>{item.subtitle}</Text>
            ) : null}
            {item.location ? (
              <View style={styles.cardLocationRow}>
                <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
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
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [allItems, setAllItems] = useState({ cars: [], bikes: [], plates: [], parts: [] });
  const [counts, setCounts] = useState({ cars: 0, bikes: 0, plates: 0, parts: 0 });
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

  const [pickerState, setPickerState] = useState({ visible: false, title: '', options: [], onSelect: () => {}, selectedValue: '' });

  const { isSaved, toggleSaveListing } = useSavedListings();
  const { requireAuth, AuthPromptModal } = useAuthPrompt(navigation);

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
      if (carFilters.manufacturer) params.manufacturer = carFilters.manufacturer;
      if (carFilters.model) params.model = carFilters.model;
      if (carFilters.city) params.city = carFilters.city;
      if (carFilters.min_price) params.min_price = carFilters.min_price;
      if (carFilters.max_price) params.max_price = carFilters.max_price;
    }
    if (activeTab === 'bikes' || activeTab === 'all') {
      if (bikeFilters.type) params.bike_type = bikeFilters.type;
      if (bikeFilters.brand) params.bike_brand = bikeFilters.brand;
      if (bikeFilters.city) params.city = bikeFilters.city;
      if (bikeFilters.min_price) params.min_price = bikeFilters.min_price;
      if (bikeFilters.max_price) params.max_price = bikeFilters.max_price;
      if (bikeFilters.min_year) params.min_year = bikeFilters.min_year;
      if (bikeFilters.max_year) params.max_year = bikeFilters.max_year;
    }
    if (activeTab === 'plates' || activeTab === 'all') {
      if (plateFilters.city) params.city = plateFilters.city;
      if (plateFilters.code) params.code = plateFilters.code;
      if (plateFilters.min_price) params.min_price = plateFilters.min_price;
      if (plateFilters.max_price) params.max_price = plateFilters.max_price;
    }
    if (activeTab === 'parts' || activeTab === 'all') {
      if (partFilters.category) params.part_type = partFilters.category;
      if (partFilters.min_price) params.min_price = partFilters.min_price;
      if (partFilters.max_price) params.max_price = partFilters.max_price;
    }
    return params;
  }, [activeTab, carFilters, bikeFilters, plateFilters, partFilters]);

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
      setCounts({ cars: cars.length, bikes: bikes.length, plates: plates.length, parts: parts.length });
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
        results.forEach(({ cat, items }) => { next[cat] = [...prev[cat], ...items]; });
        return next;
      });
      setCounts((prev) => {
        const next = { ...prev };
        results.forEach(({ cat, items }) => { next[cat] = prev[cat] + items.length; });
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
        setCounts({ cars: cars.length, bikes: bikes.length, plates: plates.length, parts: parts.length });
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
    return count;
  }, [carFilters, bikeFilters, plateFilters, partFilters]);

  const resetFilters = useCallback(() => {
    setCarFilters(INITIAL_CAR_FILTERS);
    setBikeFilters(INITIAL_BIKE_FILTERS);
    setPlateFilters(INITIAL_PLATE_FILTERS);
    setPartFilters(INITIAL_PART_FILTERS);
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
        item.subtitle.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q)
      );
    }

    if (sortBy === 'price_low') {
      items.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sortBy === 'price_high') {
      items.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else {
      items.sort((a, b) => {
        if (a.is_featured && !b.is_featured) return -1;
        if (!a.is_featured && b.is_featured) return 1;
        return 0;
      });
    }

    return items;
  }, [allItems, activeTab, search, sortBy]);

  const totalCount = counts.cars + counts.bikes + counts.plates + counts.parts;
  const yearOptions = useMemo(() => getYearOptions(), []);
  const currentSort = SORT_OPTIONS.find(o => o.key === sortBy);

  const handleCategoryPress = useCallback((key) => {
    if (key === 'all') {
      setActiveTab('all');
    } else {
      navigation.navigate(LIST_SCREENS[key]);
    }
  }, [navigation]);

  const renderItem = useCallback(({ item, index }) => {
    const detailScreen = DETAIL_SCREENS[item.category];
    const saved = isSaved(item.category, item.id);
    return (
      <ExploreCard
        item={item}
        index={index}
        onPress={() => navigation.navigate(detailScreen, { listingId: item.id, listing: item.raw })}
        onSave={() => toggleSaveListing(item.category, item.raw)}
        saved={saved}
      />
    );
  }, [navigation, isSaved, toggleSaveListing]);

  const renderCTA = useCallback(() => (
    <>
      {loadingMore && (
        <View style={styles.loadMoreWrap}>
          <ActivityIndicator size="small" color={COLORS.accent} />
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
            <Text style={styles.ctaSubtitle}>It's free to post your listing</Text>
          </View>
          <View style={styles.ctaIconWrap}>
            <Ionicons name="add-circle" size={36} color={COLORS.accent} />
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

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search cars, bikes, plates..."
            placeholderTextColor={COLORS.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.catRow}>
        {CATEGORIES.map(cat => {
          const isActive = activeTab === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[styles.catPill, isActive && styles.catPillActive]}
              onPress={() => handleCategoryPress(cat.key)}
              activeOpacity={0.7}
            >
              <Ionicons name={cat.icon} size={14} color={isActive ? COLORS.accent : COLORS.textSecondary} />
              <Text style={[styles.catPillLabel, isActive && styles.catPillLabelActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          onPress={() => activeTab !== 'all' ? setFilterSheetOpen(true) : null}
          activeOpacity={activeTab === 'all' ? 1 : 0.7}
        >
          <Ionicons name="filter" size={14} color={activeFilterCount > 0 ? COLORS.accent : COLORS.textSecondary} />
          <Text style={[styles.filterBtnText, activeFilterCount > 0 && styles.filterBtnTextActive]}>
            {activeFilterCount > 0 ? `${activeFilterCount} Active` : 'Filters'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.resultCount}>
          {normalizedItems.length} {normalizedItems.length === 1 ? 'result' : 'results'}
        </Text>

        <TouchableOpacity style={styles.sortBtn} onPress={() => setSortSheetOpen(true)} activeOpacity={0.7}>
          <Ionicons name={currentSort?.icon || 'swap-vertical'} size={14} color={COLORS.textSecondary} />
          <Text style={styles.sortBtnText}>{currentSort?.label || 'Sort'}</Text>
          <Ionicons name="chevron-down" size={12} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {activeFilterCount > 0 && activeTab !== 'all' && (
        <View style={styles.activeChips}>
          <TouchableOpacity style={styles.clearAllChip} onPress={resetFilters}>
            <Ionicons name="close-circle" size={14} color={COLORS.accent} />
            <Text style={styles.clearAllText}>Clear all</Text>
          </TouchableOpacity>
        </View>
      )}

      {(search.trim() || activeTab !== 'all' || activeFilterCount > 0) && (
        <TouchableOpacity style={styles.saveSearchBtn} onPress={handleSaveSearch} activeOpacity={0.7}>
          <Ionicons name="bookmark-outline" size={14} color={COLORS.accent} />
          <Text style={styles.saveSearchText}>Save this search</Text>
        </TouchableOpacity>
      )}
    </View>
  ), [activeTab, search, sortBy, normalizedItems.length, activeFilterCount, currentSort, handleCategoryPress, resetFilters, handleSaveSearch]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
      {loading && !refreshing ? (
        <ListingSkeleton />
      ) : (
        <FlashList
          estimatedItemSize={260}
          data={normalizedItems}
          renderItem={renderItem}
          keyExtractor={(item, idx) => `${item.category || 'listing'}-${item.id || idx}`}
          numColumns={1}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={renderHeader}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} colors={[COLORS.accent]} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderCTA}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={44} color={COLORS.textMuted} />
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
        />
      </BottomSheet>

      <BottomSheet visible={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filters">
        <FilterContent
          activeTab={activeTab}
          carFilters={carFilters} setCarFilters={setCarFilters}
          bikeFilters={bikeFilters} setBikeFilters={setBikeFilters}
          plateFilters={plateFilters} setPlateFilters={setPlateFilters}
          partFilters={partFilters} setPartFilters={setPartFilters}
          onReset={resetFilters}
          openPicker={openPicker}
          yearOptions={yearOptions}
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
            <Ionicons name={opt.icon} size={18} color={sortBy === opt.key ? COLORS.accent : COLORS.textSecondary} />
            <Text style={[sortStyles.optionText, sortBy === opt.key && sortStyles.optionTextActive]}>
              {opt.label}
            </Text>
            {sortBy === opt.key && <Ionicons name="checkmark" size={18} color={COLORS.accent} />}
          </TouchableOpacity>
        ))}
      </BottomSheet>
      <AuthPromptModal />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  hero: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  heroKicker: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  heroTitle: {
    color: COLORS.white,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  searchWrap: { paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 16, paddingVertical: 11, gap: 10,
    borderWidth: 1, borderColor: COLORS.borderLight,
  },
  searchInput: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.md },

  catRow: {
    flexDirection: 'row', paddingHorizontal: SPACING.md, gap: 8, marginBottom: SPACING.md,
  },
  catPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.borderLight,
  },
  catPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.accent + '40' },
  catPillLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '500' },
  catPillLabelActive: { color: COLORS.accent },

  controlsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.md, marginBottom: SPACING.md,
  },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.borderLight,
  },
  filterBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.accent + '40' },
  filterBtnText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  filterBtnTextActive: { color: COLORS.accent },
  resultCount: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.borderLight,
  },
  sortBtnText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '500' },

  activeChips: { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  clearAllChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: COLORS.primary, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: BORDER_RADIUS.pill,
  },
  clearAllText: { color: COLORS.accent, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  saveSearchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: BORDER_RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.borderLight,
  },
  saveSearchText: { color: COLORS.accent, fontSize: FONT_SIZES.xs, fontWeight: '600' },

  listContent: { paddingBottom: TAB_BAR_CLEARANCE },

  card: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden', marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    borderWidth: 1, borderColor: COLORS.borderLight,
  },
  cardImageWrap: { height: 210, position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  cardImagePlaceholder: {
    width: '100%', height: '100%', backgroundColor: COLORS.surfaceDark,
    justifyContent: 'center', alignItems: 'center',
  },
  cardCatBadge: {
    position: 'absolute', top: 8, left: 8,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: BORDER_RADIUS.sm,
  },
  cardCatText: { color: COLORS.white, fontSize: 10, fontWeight: '700' },
  cardSaveBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardFeatured: {
    position: 'absolute', bottom: 8, left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.accent, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: BORDER_RADIUS.sm,
  },
  cardFeaturedText: { color: COLORS.black, fontSize: 9, fontWeight: '700' },

  cardBody: { paddingHorizontal: 14, paddingVertical: 14 },
  cardPrice: {
    color: COLORS.accent, fontSize: FONT_SIZES.lg, fontWeight: '800', marginBottom: 6,
  },
  cardTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: 6 },
  cardSubtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 8, lineHeight: 18 },
  cardLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardLocation: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },

  loadMoreWrap: { paddingVertical: SPACING.md, alignItems: 'center' },
  ctaCard: {
    marginHorizontal: SPACING.md, marginTop: SPACING.sm, marginBottom: SPACING.md,
    backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.accent + '30',
  },
  ctaContent: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: SPACING.md,
  },
  ctaLeft: { flex: 1 },
  ctaTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: 2 },
  ctaSubtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  ctaIconWrap: { marginLeft: SPACING.md },

  emptyContainer: { alignItems: 'center', paddingTop: SPACING.xxl * 2, paddingHorizontal: SPACING.lg },
  emptyTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginTop: SPACING.md, marginBottom: SPACING.xs },
  emptySubtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, textAlign: 'center' },
  clearSearchBtn: {
    marginTop: SPACING.md, backgroundColor: COLORS.surface,
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: BORDER_RADIUS.pill,
  },
  clearSearchText: { color: COLORS.accent, fontWeight: '600' },
});

const sortStyles = StyleSheet.create({
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.borderLight,
  },
  optionActive: { backgroundColor: COLORS.primary },
  optionText: { color: COLORS.white, fontSize: FONT_SIZES.md, flex: 1 },
  optionTextActive: { color: COLORS.accent, fontWeight: '600' },
});
