import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Linking,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatPriceUSD } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useSavedListings } from '../../context/SavedListingsContext';
import { useAuth } from '../../context/AuthContext';
import { trackLeadEvent } from '../../utils/leadTracking';
import { openWhatsapp, formatWhatsappNumber } from '../../utils/whatsapp';
import { ensureContactAccess } from '../../utils/contactAccess';
import { useAuthPrompt } from '../../components/ui/RequireAuth';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import LoanCalculator from '../../components/ui/LoanCalculator';
import ReportButton from '../../components/ui/ReportButton';
import Button from '../../components/ui/Button';
import RecommendedListings from '../../components/RecommendedListings';
import ListingMap from '../../components/ui/ListingMap';
import { resolveMediaUrl } from '../../utils/media';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CITY_CODES = {
  'Abu Dhabi': 'أ',
  'Dubai': 'د',
  'Sharjah': 'ش',
  'Ajman': 'ع',
  'Umm Al Quwain': 'و',
  'Ras Al Khaimah': 'ر',
  'Fujairah': 'ف',
  'Al Ain': 'ك',
  'Other': 'م',
};

// Full Arabic emirate name shown on the plate visual, matching the web
// UAELicensePlate component (single-letter CITY_CODES above is too
// ambiguous to read as "the emirate" on its own).
const CITY_NAMES_AR = {
  'Abu Dhabi': 'أبو ظبي',
  'Dubai': 'دبي',
  'Sharjah': 'الشارقة',
  'Ajman': 'عجمان',
  'Umm Al Quwain': 'أم القيوين',
  'Ras Al Khaimah': 'رأس الخيمة',
  'Fujairah': 'الفجيرة',
  'Al Ain': 'العين',
  'Other': 'الإمارات',
};

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

export default function PlateDetailScreen({ route, navigation }) {
  const { listing: routeListing, listingId } = route.params || {};
  const [plate, setPlate] = useState(routeListing || null);
  const [loading, setLoading] = useState(!routeListing);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const { toggleSaveListing, isSaved } = useSavedListings();
  const { user } = useAuth();
  const isOwner = user && (user.id === plate?.user_id || user.id === plate?.seller_id);

  const plateId = plate?.id || listingId;
  const saved = isSaved('plate', plateId);

  useEffect(() => {
    if (routeListing) {
      setPlate(routeListing);
      setLoading(false);
    }
    const fetchPlate = async () => {
      try {
        if (!routeListing) setLoading(true);
        const data = await apiClient.get(`/api/plates/${listingId}`);
        setPlate(data);
      } catch (err) {
        Alert.alert('Error', 'Failed to load plate details.');
      } finally {
        if (!routeListing) setLoading(false);
      }
    };
    if (listingId) fetchPlate();
  }, [listingId, routeListing]);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const IMAGE_HEIGHT = 200;
  const headerOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [IMAGE_HEIGHT - 60, IMAGE_HEIGHT], [0, 1], Extrapolation.CLAMP),
  }));

  const { requireAuth, AuthPromptModal } = useAuthPrompt(navigation);

  const handleSave = useCallback(async () => {
    if (!plate) return;
    await toggleSaveListing('plates', plate);
  }, [plate, toggleSaveListing]);

  const handleCall = useCallback(() => {
    if (!ensureContactAccess(user, navigation)) return;
    const phone = plate?.contact_phone || plate?.phone;
    if (phone) {
      trackLeadEvent('plate', plate.id, 'call_click');
      Linking.openURL(`tel:${phone}`);
    }
  }, [plate, user, navigation]);

  const handleWhatsApp = useCallback(() => {
    if (!ensureContactAccess(user, navigation)) return;
    const url = openWhatsapp(plate, 'plate');
    if (url) {
      trackLeadEvent('plate', plate.id, 'whatsapp_click');
      Linking.openURL(url);
    }
  }, [plate, user, navigation]);

  if (loading) return <LoadingSpinner message="Loading plate details..." />;
  if (!plate) return <LoadingSpinner message="Plate not found" />;

  const cityNameAr = CITY_NAMES_AR[plate.city] || CITY_CODES[plate.city] || 'الإمارات';
  const images = plate.images || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
      <Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        <View style={styles.imageSection}>
          {images.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                setActiveImageIndex(index);
              }}
            >
              {images.map((img, i) => {
                const uri = img.url || img.image_url || img.display_url;
                return (
                  <View key={i} style={styles.imageSlide}>
                    {uri ? (
                      <TouchableOpacity onPress={() => { setPreviewImageIndex(i); setPreviewImage(uri); }} activeOpacity={0.9}>
                        <Image source={{ uri }} style={styles.image} resizeMode="cover" />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.imagePlaceholder}>
                        <Ionicons name="key" size={60} color="rgba(255,255,255,0.2)" />
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.plateVisualContainer}>
              <View style={styles.plateBox}>
                {!!plate.code && <Text style={styles.plateCode}>{plate.code}</Text>}
                <View style={styles.plateMiddle}>
                  <Text style={styles.plateUae}>U.A.E</Text>
                  <Text style={styles.plateCityArabic} numberOfLines={1} adjustsFontSizeToFit>{cityNameAr}</Text>
                </View>
                <Text style={styles.plateDigits} numberOfLines={1} adjustsFontSizeToFit>{plate.number || plate.digits || ''}</Text>
              </View>
            </View>
          )}
          {images.length > 1 && (
            <View style={styles.paginationDots}>
              {images.map((_, i) => (
                <View key={i} style={[styles.dot, i === activeImageIndex && styles.dotActive]} />
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.saveButton} onPress={() => requireAuth(() => handleSave())} activeOpacity={0.7}>
            <Ionicons name={saved ? 'heart' : 'heart-outline'} size={24} color={saved ? COLORS.accent : COLORS.white} />
          </TouchableOpacity>
          <View style={styles.reportButtonWrap}>
            <ReportButton listingType="plate" listingId={plateId} />
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.plateDisplay}>
            <View style={styles.plateBoxDetail}>
              {!!plate.code && <Text style={styles.plateCodeDetail}>{plate.code}</Text>}
              <View style={styles.plateMiddleDetail}>
                <Text style={styles.plateUaeDetail}>U.A.E</Text>
                <Text style={styles.plateCityArabicDetail} numberOfLines={1} adjustsFontSizeToFit>{cityNameAr}</Text>
              </View>
              <Text style={styles.plateDigitsDetail} numberOfLines={1} adjustsFontSizeToFit>{plate.number || plate.digits || ''}</Text>
            </View>
          </View>

          <Text style={styles.price}>{formatPrice(plate.price)}</Text>
          <Text style={styles.usdPrice}>{formatPriceUSD(plate.price)}</Text>
          <Text style={styles.cityLabel}>{plate.city || 'Unknown City'}</Text>

          {(plate.description || plate.plate_description) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{plate.description || plate.plate_description}</Text>
            </View>
          ) : null}

          {(plate.city || plate.emirate || plate.latitude || plate.longitude) && (
            <View style={styles.section}>
              <View style={styles.locationRow}>
                <Ionicons name="location" size={16} color={COLORS.textSecondary} />
                <Text style={styles.locationText}>{plate.city || plate.emirate || 'UAE'}</Text>
              </View>
              <ListingMap
                latitude={plate.latitude}
                longitude={plate.longitude}
                title={`${plate.code || ''} ${plate.number || ''}`.trim()}
                city={plate.city}
                emirate={plate.emirate}
              />
            </View>
          )}

          <LoanCalculator price={plate.price} />

          <View style={styles.sellerCard}>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerInitial}>
                  {(plate.seller_name || 'S')[0]?.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.sellerName}>{plate.seller_name || 'Seller'}</Text>
              </View>
            </View>
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
            {isOwner && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button title="Edit" onPress={() => navigation.navigate('EditListing', { editMode: true, listingType: 'plate', listingId: plate.id })} variant="secondary" size="sm" />
                <Button title="Delete" onPress={() => {
                  Alert.alert('Delete', 'Are you sure?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: async () => {
                      await apiClient.delete(`/api/plates/${plate.id}`);
                      navigation.goBack();
                    }},
                  ]);
                }} variant="ghost" size="sm" />
              </View>
            )}
          </View>
        </View>

        <RecommendedListings listingType="plate" listingId={plate.id} navigation={navigation} />
      </Animated.ScrollView>

      </ScreenEntrance>
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.lightboxContainer}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setPreviewImage(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.lightboxCounter}>
            {previewImageIndex + 1} / {images.length}
          </Text>
          {previewImageIndex > 0 && (
            <TouchableOpacity style={styles.lightboxPrev} onPress={() => {
              const newIndex = previewImageIndex - 1;
              const uri = resolveMediaUrl(images[newIndex]?.url || images[newIndex]?.image_url || images[newIndex]?.display_url) || images[newIndex]?.url || images[newIndex]?.image_url || images[newIndex]?.display_url;
              setPreviewImageIndex(newIndex);
              setPreviewImage(uri);
            }}>
              <Ionicons name="chevron-back" size={32} color="#fff" />
            </TouchableOpacity>
          )}
          {previewImageIndex < images.length - 1 && (
            <TouchableOpacity style={styles.lightboxNext} onPress={() => {
              const newIndex = previewImageIndex + 1;
              const uri = resolveMediaUrl(images[newIndex]?.url || images[newIndex]?.image_url || images[newIndex]?.display_url) || images[newIndex]?.url || images[newIndex]?.image_url || images[newIndex]?.display_url;
              setPreviewImageIndex(newIndex);
              setPreviewImage(uri);
            }}>
              <Ionicons name="chevron-forward" size={32} color="#fff" />
            </TouchableOpacity>
          )}
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            initialScrollIndex={previewImageIndex}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            keyExtractor={(item, index) => `${item.url || item.image_url || item.display_url || index}-${index}`}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const uri = resolveMediaUrl(item.url || item.image_url || item.display_url) || item.url || item.image_url || item.display_url;
              return (
                <View style={styles.lightboxPage}>
                  <Image source={{ uri }} style={styles.lightboxImage} resizeMode="contain" />
                </View>
              );
            }}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              setPreviewImageIndex(index);
              const item = images[index];
              setPreviewImage(resolveMediaUrl(item?.url || item?.image_url || item?.display_url) || item?.url || item?.image_url || item?.display_url || null);
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
  imageSection: { height: 280, backgroundColor: COLORS.surfaceDark },
  imageSlide: { width: SCREEN_WIDTH, height: 280 },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceDark },
  plateVisualContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  paginationDots: { flexDirection: 'row', position: 'absolute', bottom: 12, alignSelf: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: COLORS.accent, width: 10, height: 10, borderRadius: 5 },
  saveButton: {
    position: 'absolute', top: 12, right: 12,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  reportButtonWrap: {
    position: 'absolute', top: 12, right: 60,
  },
  content: { padding: SPACING.md },
  plateDisplay: { alignItems: 'center', marginBottom: SPACING.md },
  plateBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff',
    borderRadius: 12, borderWidth: 3, borderColor: '#333333',
    paddingHorizontal: 18, paddingVertical: 18, minWidth: 260, maxWidth: '100%', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  plateCode: { color: '#1a1a1a', fontSize: 30, fontWeight: '900' },
  plateMiddle: { alignItems: 'center', paddingHorizontal: 8, borderLeftWidth: 2, borderRightWidth: 2, borderColor: '#333333' },
  plateUae: { color: '#1a1a1a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  plateCityArabic: { color: '#1a1a1a', fontSize: 18, fontWeight: '700', maxWidth: 90 },
  plateDigits: { color: '#1a1a1a', fontSize: 28, fontWeight: '700', letterSpacing: 3, flexShrink: 1 },
  plateBoxDetail: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff',
    borderRadius: 12, borderWidth: 3, borderColor: '#333333',
    paddingHorizontal: 18, paddingVertical: 18, minWidth: 260, maxWidth: '100%', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  plateCodeDetail: { color: '#1a1a1a', fontSize: 30, fontWeight: '900' },
  plateMiddleDetail: { alignItems: 'center', paddingHorizontal: 8, borderLeftWidth: 2, borderRightWidth: 2, borderColor: '#333333' },
  plateUaeDetail: { color: '#1a1a1a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  plateCityArabicDetail: { color: '#1a1a1a', fontSize: 18, fontWeight: '700', maxWidth: 90 },
  plateDigitsDetail: { color: '#1a1a1a', fontSize: 28, fontWeight: '700', letterSpacing: 3, flexShrink: 1 },
  price: { color: COLORS.white, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  usdPrice: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 8 },
  cityLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginBottom: 10 },
  description: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, lineHeight: 22 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
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
  lightboxContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  lightboxPage: { width: SCREEN_WIDTH, height: '100%', justifyContent: 'center', alignItems: 'center' },
  lightboxImage: { width: '92%', height: '82%' },
  lightboxClose: { position: 'absolute', top: 50, right: 20, padding: 8, zIndex: 10 },
  lightboxCounter: { position: 'absolute', top: 55, alignSelf: 'center', color: '#fff', fontSize: 14, fontWeight: '600', zIndex: 10 },
  lightboxPrev: { position: 'absolute', left: 10, padding: 12, zIndex: 10 },
  lightboxNext: { position: 'absolute', right: 10, padding: 12, zIndex: 10 },
});
