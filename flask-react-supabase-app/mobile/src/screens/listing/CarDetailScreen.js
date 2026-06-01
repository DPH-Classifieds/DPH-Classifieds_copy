import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  Dimensions,
  Linking,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import LoanCalculator from '../../components/ui/LoanCalculator';
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

const SPEC_LABELS = {
  fuel_type: 'Fuel Type',
  transmission: 'Transmission',
  kilometer_driven: 'Mileage',
  color: 'Color',
  exterior_color: 'Exterior Color',
  interior_color: 'Interior Color',
  body_type: 'Body Type',
  horsepower: 'Horsepower',
  engine_size: 'Engine',
  engine_capacity: 'Engine Capacity',
  cylinders: 'Cylinders',
  doors: 'Doors',
  seats: 'Seats',
  warranty: 'Warranty',
  service_history: 'Service History',
  number_of_owners: 'Owners',
  registration_status: 'Registration',
  gcc_specs: 'GCC Specs',
  specs_type: 'Specs Type',
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
  const [car, setCar] = useState(routeListing || null);
  const [loading, setLoading] = useState(!routeListing);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const { toggleSaveListing, isSaved } = useSavedListings();
  const { user } = useAuth();
  const isOwner = user && (user.id === car?.user_id || user.id === car?.seller_id);

  const carId = car?.id || car?.listing_id || listingId;
  const saved = isSaved('car', carId);

  useEffect(() => {
    if (routeListing) {
      setCar(routeListing);
      setLoading(false);
    }
    const fetchCar = async () => {
      try {
        if (!routeListing) setLoading(true);
        const data = await apiClient.get(`/api/cars/${listingId}`);
        setCar(data);
      } catch (err) {
        Alert.alert('Error', 'Failed to load car details.');
      } finally {
        if (!routeListing) setLoading(false);
      }
    };
    if (listingId) fetchCar();
  }, [listingId, routeListing]);

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
      Linking.openURL(`tel:${phone}`);
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

  if (loading) return <LoadingSpinner message="Loading car details..." />;
  if (!car) return <LoadingSpinner message="Car not found" />;

  const imageUris = normalizeImages(car.images);
  if (imageUris.length === 0) {
    const fallbackImage = car.image_url || car.display_url || null;
    if (fallbackImage) imageUris.push(fallbackImage);
  }
  const title = `${car.make_year || ''} ${car.car_manufacturer || ''} ${car.car_model || ''}${car.trim ? ' ' + car.trim : ''}`.trim() || 'Untitled Car';

  const specs = [
    { key: 'fuel_type', value: car.fuel_type },
    { key: 'transmission', value: car.transmission },
    { key: 'kilometer_driven', value: car.kilometer_driven ? `${formatNumber(car.kilometer_driven)} km` : null },
    { key: 'color', value: car.color || car.exterior_color },
    { key: 'body_type', value: car.body_type },
    { key: 'horsepower', value: car.horsepower ? `${car.horsepower} hp` : null },
    { key: 'engine_size', value: car.engine_size },
    { key: 'engine_capacity', value: car.engine_capacity },
    { key: 'number_of_owners', value: car.number_of_owners },
    { key: 'registration_status', value: car.registration_status },
    { key: 'specs_type', value: car.specs_type || (car.gcc_specs ? 'GCC Specs' : null) },
  ].filter(s => s.value);

  const extras = (() => {
    if (Array.isArray(car.extras)) return car.extras;
    if (typeof car.extras === 'string') {
      try { return JSON.parse(car.extras); } catch { return []; }
    }
    return [];
  })();

  const badges = [];
  if (car.is_featured) badges.push({ label: 'Featured', variant: 'success' });
  if (car.gcc_specs || car.gcc_specifications || car.specs_type === 'GCC') badges.push({ label: 'GCC Specs', variant: 'info' });
  if (car.is_insured) badges.push({ label: 'Insured', variant: 'warning' });
  if (car.is_imported) badges.push({ label: 'Imported', variant: 'default' });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
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
                  <Image source={{ uri }} style={styles.image} resizeMode="cover" />
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
              {user?.phone_verified ? (
                <Text style={styles.vinValue}>{car.vin_number}</Text>
              ) : (
                <View>
                  <Text style={styles.vinMasked}>
                    {'•'.repeat(Math.max(0, car.vin_number.length - 4))}{car.vin_number.slice(-4)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        'Verify to Reveal VIN',
                        'Verify your phone number to see the full VIN.',
                        [
                          { text: 'Verify', onPress: () => navigation.navigate('Profile', { screen: 'VerifyPhone' }) },
                          { text: 'Cancel', style: 'cancel' },
                        ]
                      );
                    }}
                  >
                    <Text style={styles.vinRevealBtn}>Reveal Full VIN</Text>
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

          <LoanCalculator price={car.expected_selling_price || car.price} />

          <View style={styles.sellerCard}>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerInitial}>
                  {(car.seller_name || car.seller?.name || 'S')[0]?.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.sellerName}>{car.seller_name || car.seller?.name || 'Seller'}</Text>
                <Text style={styles.sellerMember}>
                  Member since {formatDate(car.seller?.created_at || car.created_at)}
                </Text>
              </View>
            </View>
            <View style={styles.sellerActions}>
              <TouchableOpacity style={styles.callButton} onPress={handleCall} activeOpacity={0.8}>
                <Ionicons name="call" size={18} color={COLORS.white} />
                <Text style={styles.callButtonText}>Call Now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.whatsappButton} onPress={handleWhatsApp} activeOpacity={0.8}>
                <Ionicons name="logo-whatsapp" size={18} color={COLORS.white} />
                <Text style={styles.whatsappButtonText}>WhatsApp</Text>
              </TouchableOpacity>
            </View>
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
      </ScrollView>

      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.lightboxContainer}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setPreviewImage(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.lightboxCounter}>
            {previewImageIndex + 1} / {imageUris.length}
          </Text>
          {previewImageIndex > 0 && (
            <TouchableOpacity style={styles.lightboxPrev} onPress={() => {
              const newIndex = previewImageIndex - 1;
              const uri = imageUris[newIndex];
              setPreviewImageIndex(newIndex);
              setPreviewImage(uri);
            }}>
              <Ionicons name="chevron-back" size={32} color="#fff" />
            </TouchableOpacity>
          )}
          {previewImageIndex < imageUris.length - 1 && (
            <TouchableOpacity style={styles.lightboxNext} onPress={() => {
              const newIndex = previewImageIndex + 1;
              const uri = imageUris[newIndex];
              setPreviewImageIndex(newIndex);
              setPreviewImage(uri);
            }}>
              <Ionicons name="chevron-forward" size={32} color="#fff" />
            </TouchableOpacity>
          )}
          <FlatList
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
                <Image source={{ uri: item }} style={styles.lightboxImage} resizeMode="contain" />
              </View>
            )}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              setPreviewImageIndex(index);
              setPreviewImage(imageUris[index]);
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
  lightboxPrev: { position: 'absolute', left: 10, padding: 12, zIndex: 10 },
  lightboxNext: { position: 'absolute', right: 10, padding: 12, zIndex: 10 },
});
