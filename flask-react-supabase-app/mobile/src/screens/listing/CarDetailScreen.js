import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, Dimensions, Linking, Alert, Modal, ScrollView, PanResponder } from 'react-native';
import Text from '../../components/ui/AppText';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import PressableScale from '../../components/ui/PressableScale';
import RedditSourcePanel, { isRedditSourced } from '../../components/RedditSourcePanel';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatPriceUSD, formatNumber, formatDate } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useSavedListings } from '../../context/SavedListingsContext';
import { useAuth } from '../../context/AuthContext';
import { trackLeadEvent } from '../../utils/leadTracking';
import { openWhatsapp, formatWhatsappNumber } from '../../utils/whatsapp';
import { ensureContactAccess } from '../../utils/contactAccess';
import { useAuthPrompt } from '../../components/ui/RequireAuth';
import Badge from '../../components/ui/Badge';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { ListingDetailSkeleton } from '../../components/ui/ListingSkeleton';
import { getCachedListing } from '../../utils/listingCache';
import LoanCalculator from '../../components/ui/LoanCalculator';
import PriceHistory from '../../components/ui/PriceHistory';
import ReportButton from '../../components/ui/ReportButton';
import Button from '../../components/ui/Button';
import RecommendedListings from '../../components/RecommendedListings';
import ListingMap from '../../components/ui/ListingMap';
import { resolveMediaUrl } from '../../utils/media';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CAR_EXTRAS = [
  'Sunroof', 'Leather Seats', 'Navigation System', 'Rear Camera',
  'Parking Sensors', 'Bluetooth', 'Cruise Control', 'Heated Seats',
  'Keyless Entry', 'Apple CarPlay',
];

// Mirrors the web Car Specifications card so the mobile detail shows the same
// information. Make/Model/Year live in the title; the rest render as a grid.
const SPEC_LABELS = {
  trim: 'Trim',
  body_type: 'Body Type',
  color: 'Color',
  kilometer_driven: 'Mileage',
  fuel_type: 'Fuel Type',
  transmission: 'Transmission',
  cylinders: 'Cylinders',
  horsepower: 'Horsepower',
  engine_capacity: 'Engine',
  doors: 'Doors',
  seating_capacity: 'Seats',
  steering_side: 'Steering Side',
  regional_spec: 'Regional Specs',
  warranty: 'Warranty',
  service_history: 'Service History',
};

const normalizeImages = (images = []) =>
  [
    ...(Array.isArray(images) ? images : []),
  ]
    .map((image) => (typeof image === 'string'
      ? resolveMediaUrl(image)
      : resolveMediaUrl(image?.url || image?.image_url || image?.display_url || null)))
    .filter(Boolean);

export default function CarDetailScreen({ route, navigation }) {
  const { listing: routeListing, listingId } = route.params || {};
  // Render instantly from the list item / prefetch cache; the network fetch
  // below only enriches (full images, seller photo, freshest fields).
  // expo-router serializes object params to strings, so only trust an object.
  const initialCar = (routeListing && typeof routeListing === 'object' ? routeListing : null)
    || getCachedListing('cars', listingId) || null;
  const [car, setCar] = useState(initialCar);
  const [loading, setLoading] = useState(!initialCar);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const lightboxListRef = useRef(null);
  // Swipe down on the full-screen photo to dismiss; horizontal swipes still page.
  const lightboxPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && g.dy > Math.abs(g.dx) * 1.6,
      onPanResponderRelease: (_, g) => { if (g.dy > 90) setPreviewImage(null); },
    })
  ).current;
  const [showFullDescription, setShowFullDescription] = useState(false);
  const { toggleSaveListing, isSaved } = useSavedListings();
  const { user } = useAuth();
  const isOwner = user && (user.id === car?.user_id || user.id === car?.seller_id);
  const canViewVin = isOwner || user?.phone_verified;
  const [vinVisible, setVinVisible] = useState(false);

  const carId = car?.id || car?.listing_id || listingId;
  const saved = isSaved('car', carId);

  // Matches the web: even eligible (owner/phone-verified) users must tap to
  // reveal — vin_open fires on every attempt, vin_reveal only once actually
  // shown, so the admin panel can tell "curious" clicks from real reveals.
  const handleVinReveal = () => {
    trackLeadEvent('car', car.id, 'vin_open');
    if (canViewVin) {
      setVinVisible(true);
      trackLeadEvent('car', car.id, 'vin_reveal');
    } else if (!user) {
      // Logged out: prompt login, not phone verification.
      Alert.alert('Login Required', 'Please log in to see the full VIN.', [
        { text: 'Log In', onPress: () => router.push('/Login') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      Alert.alert(
        'Verify to Reveal VIN',
        'Verify your phone number to see the full VIN.',
        [
          { text: 'Verify', onPress: () => router.push('/(auth)/VerifyPhone') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  };

  useEffect(() => {
    const id = listingId || routeListing?.id;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.get(`/api/cars/${id}`);
        // Merge so list-only fields survive and detail fields (images, seller) win.
        if (!cancelled && data) setCar((prev) => ({ ...(prev || {}), ...data }));
      } catch (err) {
        if (cancelled) return;
        // Sold/removed listing opened from a stale list/cache: drop it so the
        // "not found" state shows instead of leaving a phantom listing.
        if (err?.status === 404) setCar(null);
        else if (!initialCar) Alert.alert('Error', 'Failed to load car details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [listingId]);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const IMAGE_HEIGHT = 280;
  const headerOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [IMAGE_HEIGHT - 60, IMAGE_HEIGHT], [0, 1], Extrapolation.CLAMP),
  }));

  const { requireAuth, AuthPromptModal } = useAuthPrompt(navigation);

  const handleSave = useCallback(async () => {
    if (!car) return;
    await toggleSaveListing('cars', car);
  }, [car, toggleSaveListing]);

  const handleCall = useCallback(() => {
    if (!ensureContactAccess(user, navigation)) return;
    const phone = car?.car_owner_phone_number || car?.contact_phone;
    if (phone) {
      trackLeadEvent('car', car.id, 'call_click');
      Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Call failed', 'Unable to open the phone dialer.'));
    }
  }, [car, user, navigation]);

  const handleWhatsApp = useCallback(() => {
    if (!ensureContactAccess(user, navigation)) return;
    const url = openWhatsapp(car, 'car');
    if (url) {
      trackLeadEvent('car', car.id, 'whatsapp_click');
      Linking.openURL(url);
    }
  }, [car, user, navigation]);

  if (loading && !car) return <ListingDetailSkeleton />;
  if (!car) return <LoadingSpinner message="Car not found" />;

  const imageUris = normalizeImages(car.images);
  if (imageUris.length === 0) {
    const fallbackImage = car.image_url || car.display_url || null;
    if (fallbackImage) imageUris.push(fallbackImage);
  }
  const title = `${car.make_year || ''} ${car.car_manufacturer || ''} ${car.car_model || ''}${car.trim ? ' ' + car.trim : ''}`.trim() || 'Untitled Car';

  const specs = [
    { key: 'trim', value: car.trim },
    { key: 'body_type', value: car.body_type },
    { key: 'color', value: car.color || car.exterior_color },
    { key: 'kilometer_driven', value: car.kilometer_driven ? `${formatNumber(car.kilometer_driven)} km` : null },
    { key: 'fuel_type', value: car.fuel_type },
    { key: 'transmission', value: car.transmission_type || car.transmission },
    { key: 'cylinders', value: car.cylinders },
    { key: 'horsepower', value: car.horsepower ? `${car.horsepower} hp` : null },
    { key: 'engine_capacity', value: car.engine_capacity || car.engine_size },
    { key: 'doors', value: car.doors },
    { key: 'seating_capacity', value: car.seating_capacity },
    { key: 'steering_side', value: car.steering_side },
    { key: 'regional_spec', value: car.regional_spec || car.specs_type || (car.gcc_specs ? 'GCC Specs' : null) },
    { key: 'warranty', value: car.warranty },
    { key: 'service_history', value: car.service_history },
  ].filter((s) => typeof s.value === 'string' || typeof s.value === 'number');

  const extras = (() => {
    if (Array.isArray(car.extras)) return car.extras;
    if (typeof car.extras === 'string') {
      try { return JSON.parse(car.extras); } catch { return []; }
    }
    return [];
  })();

  const badges = [];
  if (car.is_featured) badges.push({ label: 'Featured', variant: 'success' });
  if (car.gcc_specs || car.gcc_specifications || car.specs_type === 'GCC' || (car.regional_spec || '').includes('GCC')) badges.push({ label: 'GCC Specs', variant: 'info' });
  if (car.is_insured) badges.push({ label: 'Insured', variant: 'warning' });
  if (car.is_imported) badges.push({ label: 'Imported', variant: 'default' });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        <View style={styles.imageSection}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              setActiveImageIndex(index);
            }}
          >
            {imageUris.length > 0 ? imageUris.map((uri, index) => (
              <View key={`${uri}-${index}`} style={styles.imageSlide}>
                <TouchableOpacity onPress={() => { setPreviewImageIndex(index); setPreviewImage(uri); }} activeOpacity={0.9}>
                  <Image source={{ uri }} style={styles.image} contentFit="cover" />
                </TouchableOpacity>
              </View>
            )) : (
              <View style={styles.imageSlide}>
                <View style={styles.imagePlaceholder}>
                  <Ionicons name="car-outline" size={60} color="rgba(255,255,255,0.2)" />
                </View>
              </View>
            )}
          </ScrollView>
          {imageUris.length > 1 && (
            <View style={styles.paginationDots}>
              {imageUris.map((_, index) => (
                <View key={index} style={[styles.dot, index === activeImageIndex && styles.dotActive]} />
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.saveButton} onPress={() => requireAuth(() => handleSave())} activeOpacity={0.7}>
            <Ionicons name={saved ? 'heart' : 'heart-outline'} size={24} color={saved ? COLORS.accent : COLORS.white} />
          </TouchableOpacity>
          <View style={styles.reportButtonWrap}>
            <ReportButton listingType="car" listingId={carId} />
          </View>
        </View>

        <View style={styles.content}>
          <Text style={styles.price}>{formatPrice(car.expected_selling_price)}</Text>
          <Text style={styles.usdPrice}>{formatPriceUSD(car.expected_selling_price || car.price)}</Text>
          {badges.length > 0 && (
            <View style={styles.badgesRow}>
              {badges.map((b, i) => <Badge key={i} label={b.label} variant={b.variant} size="sm" />)}
            </View>
          )}
          <Text style={styles.title}>{title}</Text>

          {(car.car_description || car.description) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text
                style={styles.description}
                numberOfLines={showFullDescription ? undefined : 4}
              >
                {car.car_description || car.description}
              </Text>
              {(car.car_description || car.description || '').length > 150 && (
                <TouchableOpacity onPress={() => setShowFullDescription(!showFullDescription)}>
                  <Text style={styles.viewMore}>
                    {showFullDescription ? 'View Less' : 'View More'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {specs.length > 0 && (
            <View style={styles.specsGrid}>
              {specs.map((s) => (
                <View key={s.key} style={styles.specItem}>
                  <Text style={styles.specLabel}>{SPEC_LABELS[s.key]}</Text>
                  <Text style={styles.specValue}>{s.value}</Text>
                </View>
              ))}
            </View>
          )}

          {car.vin_number && (
            <View style={styles.vinSection}>
              <Text style={styles.vinLabel}>VIN Number</Text>
              {vinVisible && canViewVin ? (
                <Text style={styles.vinValue}>{car.vin_number}</Text>
              ) : (
                <View>
                  <Text style={styles.vinMasked}>
                    {'•'.repeat(Math.max(0, car.vin_number.length - 4))}{car.vin_number.slice(-4)}
                  </Text>
                  <TouchableOpacity onPress={handleVinReveal}>
                    <Text style={styles.vinRevealBtn}>
                      {canViewVin ? 'Tap to Reveal VIN' : 'Reveal Full VIN'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {extras.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{extras.length} Extras</Text>
              <View style={styles.extrasRow}>
                {extras.map((ext, i) => (
                  <View key={i} style={styles.extraPill}>
                    <Text style={styles.extraPillText}>{ext}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {(car.city || car.location || car.emirate || car.area || car.latitude || car.longitude) && (
            <View style={styles.section}>
              <View style={styles.locationRow}>
                <Ionicons name="location" size={16} color={COLORS.textSecondary} />
                <Text style={styles.locationText}>{car.city || car.location || car.emirate || car.area}</Text>
              </View>
              <ListingMap
                latitude={car.latitude}
                longitude={car.longitude}
                title={title}
                city={car.city}
                emirate={car.emirate}
                area={car.area}
              />
            </View>
          )}

          <PriceHistory listingType="cars" listingId={carId} />

          <LoanCalculator price={car.expected_selling_price || car.price} />

          <View style={styles.sellerCard}>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerInitial}>
                  {(car.seller_name || car.seller?.name || 'S')[0]?.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.sellerName}>{isRedditSourced(car) ? 'DPH Classifieds' : (car.seller_name || car.seller?.name || 'Seller')}</Text>
                <Text style={styles.sellerMember}>
                  Member since {formatDate(car.seller?.created_at || car.created_at)}
                </Text>
              </View>
            </View>
            {isRedditSourced(car) ? (
              <RedditSourcePanel item={car} />
            ) : (
              <View style={styles.sellerActions}>
                <PressableScale onPress={handleCall} haptic="medium" style={styles.callButton}>
                  <Ionicons name="call" size={18} color={COLORS.white} />
                  <Text style={styles.callButtonText}>Call Now</Text>
                </PressableScale>
                <PressableScale onPress={handleWhatsApp} haptic="medium" style={styles.whatsappButton}>
                  <Ionicons name="logo-whatsapp" size={18} color={COLORS.white} />
                  <Text style={styles.whatsappButtonText}>WhatsApp</Text>
                </PressableScale>
              </View>
            )}
            {isOwner && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button title="Edit" onPress={() => navigation.navigate('EditListing', { editMode: true, listingType: 'car', listingId: car.id })} variant="secondary" size="sm" />
                <Button title="Delete" onPress={() => {
                  Alert.alert('Delete', 'Are you sure?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: async () => {
                      await apiClient.delete(`/api/cars/${car.id}`);
                      navigation.goBack();
                    }},
                  ]);
                }} variant="ghost" size="sm" />
              </View>
            )}
          </View>
        </View>

        <RecommendedListings listingType="car" listingId={car.id} navigation={navigation} />
      </Animated.ScrollView>

      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.lightboxContainer} {...lightboxPan.panHandlers}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setPreviewImage(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.lightboxCounter}>
            {previewImageIndex + 1} / {imageUris.length}
          </Text>
          {previewImageIndex > 0 && (
            <TouchableOpacity style={styles.lightboxPrev} onPress={() => {
              const newIndex = previewImageIndex - 1;
              lightboxListRef.current?.scrollToIndex({ index: newIndex, animated: true });
              setPreviewImageIndex(newIndex);
            }}>
              <Ionicons name="chevron-back" size={32} color="#fff" />
            </TouchableOpacity>
          )}
          {previewImageIndex < imageUris.length - 1 && (
            <TouchableOpacity style={styles.lightboxNext} onPress={() => {
              const newIndex = previewImageIndex + 1;
              lightboxListRef.current?.scrollToIndex({ index: newIndex, animated: true });
              setPreviewImageIndex(newIndex);
            }}>
              <Ionicons name="chevron-forward" size={32} color="#fff" />
            </TouchableOpacity>
          )}
          <FlatList
            ref={lightboxListRef}
            data={imageUris}
            horizontal
            pagingEnabled
            initialScrollIndex={previewImageIndex}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            keyExtractor={(uri, index) => `${uri}-${index}`}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.lightboxPage}>
                <Image source={{ uri: item }} style={styles.lightboxImage} contentFit="contain" />
              </View>
            )}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              setPreviewImageIndex(index);
            }}
          />
        </View>
      </Modal>
      <AuthPromptModal />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  imageSection: {
    position: 'relative',
  },
  imageSlide: {
    width: SCREEN_WIDTH,
    height: 320,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    backgroundColor: COLORS.surfaceHigher,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportButtonWrap: {
    position: 'absolute',
    top: 14,
    left: 14,
  },
  paginationDots: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.28)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.pill,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: {
    width: 18,
    backgroundColor: COLORS.accent,
  },
  content: { padding: SPACING.md },
  price: { color: COLORS.white, fontSize: 26, fontWeight: '800', marginBottom: 8 },
  usdPrice: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 8 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  title: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: 16 },
  specsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 0, backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg, marginBottom: 16,
  },
  specItem: { width: '50%', paddingVertical: 14, paddingHorizontal: 14, borderWidth: 0.5, borderColor: COLORS.border },
  specLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginBottom: 4 },
  specValue: { color: COLORS.white, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  section: { marginBottom: 16 },
  sectionTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginBottom: 10 },
  extrasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  extraPill: {
    backgroundColor: COLORS.surface, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.border,
  },
  extraPillText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  description: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, lineHeight: 22 },
  viewMore: { color: COLORS.accent, fontSize: FONT_SIZES.sm, fontWeight: '600', marginTop: 6 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md },
  sellerCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginTop: 8,
  },
  sellerInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sellerAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  sellerInitial: { color: COLORS.accent, fontSize: 20, fontWeight: '700' },
  sellerName: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
  sellerMember: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginTop: 2 },
  sellerActions: { flexDirection: 'row', gap: 10 },
  callButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary, paddingVertical: 12, borderRadius: BORDER_RADIUS.pill, gap: 6,
  },
  callButtonText: { color: COLORS.white, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  whatsappButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#25D366', paddingVertical: 12, borderRadius: BORDER_RADIUS.pill, gap: 6,
  },
  whatsappButtonText: { color: COLORS.white, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  vinSection: { backgroundColor: '#1c1c1e', borderRadius: 8, padding: 12, marginTop: 8 },
  vinLabel: { fontSize: 12, color: 'rgba(255,255,255,0.53)', textTransform: 'uppercase', marginBottom: 4 },
  vinValue: { fontSize: 14, fontWeight: '600', color: COLORS.white, fontFamily: 'monospace' },
  vinMasked: { fontSize: 14, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' },
  vinRevealBtn: { color: COLORS.accent, fontSize: 13, fontWeight: '600', marginTop: 6 },
  lightboxContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  lightboxPage: { width: SCREEN_WIDTH, height: '100%', justifyContent: 'center', alignItems: 'center' },
  lightboxImage: { width: '92%', height: '82%' },
  lightboxClose: { position: 'absolute', top: 50, right: 20, padding: 8, zIndex: 10 },
  lightboxCounter: { position: 'absolute', top: 55, alignSelf: 'center', color: '#fff', fontSize: 14, fontWeight: '600', zIndex: 10 },
  lightboxPrev: { position: 'absolute', left: 10, top: 0, bottom: 0, justifyContent: 'center', padding: 12, zIndex: 20 },
  lightboxNext: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center', padding: 12, zIndex: 20 },
});
