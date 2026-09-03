import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, Dimensions, Linking, Alert, ScrollView } from 'react-native';
import Text from '../../components/ui/AppText';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { ListingDetailSkeleton } from '../../components/ui/ListingSkeleton';
import { getCachedListing } from '../../utils/listingCache';
import PressableScale from '../../components/ui/PressableScale';
import UAEPlate from '../../components/ui/UAEPlate';
import RedditSourcePanel, { isRedditSourced } from '../../components/RedditSourcePanel';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatPriceUSD } from '../../utils/formatters';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { useSavedListings } from '../../context/SavedListingsContext';
import { useAuth } from '../../context/AuthContext';
import { trackLeadEvent } from '../../utils/leadTracking';
import { openWhatsapp, formatWhatsappNumber } from '../../utils/whatsapp';
import { ensureContactAccess } from '../../utils/contactAccess';
import { useAuthPrompt } from '../../components/ui/RequireAuth';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import ReportButton from '../../components/ui/ReportButton';
import Button from '../../components/ui/Button';
import RecommendedListings from '../../components/RecommendedListings';
import PriceHistory from '../../components/ui/PriceHistory';
import ListingMap from '../../components/ui/ListingMap';
import { resolveMediaUrl } from '../../utils/media';
import ImageLightbox from '../../components/ImageLightbox';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

export default function PlateDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { listing: routeListing, listingId } = route.params || {};
  const initialPlate = (routeListing && typeof routeListing === 'object' ? routeListing : null)
    || getCachedListing('plates', listingId) || null;
  const [plate, setPlate] = useState(initialPlate);
  const [loading, setLoading] = useState(!initialPlate);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const { toggleSaveListing, isSaved } = useSavedListings();
  const { user } = useAuth();
  const isOwner = user && (user.id === plate?.user_id || user.id === plate?.seller_id);

  const plateId = plate?.id || listingId;
  const saved = isSaved('plate', plateId);

  useEffect(() => {
    const id = listingId || routeListing?.id;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.get(`/api/plates/${id}`);
        if (!cancelled && data) setPlate((prev) => ({ ...(prev || {}), ...data }));
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 404) setPlate(null);
        else if (!initialPlate) Alert.alert('Error', 'Failed to load plate details.');
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
      Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Call failed', 'Unable to open the phone dialer.'));
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

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    imageSection: { height: 280, backgroundColor: colors.surfaceDark },
    imageSlide: { width: SCREEN_WIDTH, height: 280 },
    image: { width: '100%', height: '100%' },
    imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceDark },
    plateVisualContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.lg },
    plateHero: { width: '100%' },
    plateFill: { width: '100%' },
    paginationDots: { flexDirection: 'row', position: 'absolute', bottom: 12, alignSelf: 'center', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
    dotActive: { backgroundColor: colors.accent, width: 10, height: 10, borderRadius: 5 },
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
    price: { color: colors.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: 4 },
    usdPrice: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 8 },
    cityLabel: { color: colors.textSecondary, fontSize: FONT_SIZES.md, marginBottom: 16 },
    section: { marginBottom: 16 },
    sectionTitle: { color: colors.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '600', marginBottom: 10 },
    description: { color: colors.textSecondary, fontSize: FONT_SIZES.md, lineHeight: 22 },
    locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    locationText: { color: colors.textSecondary, fontSize: FONT_SIZES.md },
    sellerCard: {
      backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginTop: 8,
    },
    sellerInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    sellerAvatar: {
      width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center', marginRight: 12,
    },
    sellerInitial: { color: colors.accent, fontSize: 20, fontWeight: '700' },
    sellerName: { color: colors.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '600' },
    sellerActions: { flexDirection: 'row', gap: 10 },
    callButton: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.primary, paddingVertical: 12, borderRadius: BORDER_RADIUS.pill, gap: 6,
    },
    callButtonText: { color: colors.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
    whatsappButton: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#25D366', paddingVertical: 12, borderRadius: BORDER_RADIUS.pill, gap: 6,
    },
    whatsappButtonText: { color: colors.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
    lightboxContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
    lightboxPage: { width: SCREEN_WIDTH, height: '100%', justifyContent: 'center', alignItems: 'center' },
    lightboxImage: { width: '92%', height: '82%' },
    lightboxClose: { position: 'absolute', top: 50, right: 20, padding: 8, zIndex: 10 },
    lightboxCounter: { position: 'absolute', top: 55, alignSelf: 'center', color: '#fff', fontSize: 14, fontWeight: '600', zIndex: 10 },
    lightboxPrev: { position: 'absolute', left: 10, top: 0, bottom: 0, justifyContent: 'center', padding: 12, zIndex: 20 },
    lightboxNext: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center', padding: 12, zIndex: 20 },
  }), [colors]);

  if (loading && !plate) return <ListingDetailSkeleton />;
  if (!plate) return <LoadingSpinner message="Plate not found" />;

  const images = plate.images || [];
  const imageUris = images
    .map((img) => resolveMediaUrl(img?.url || img?.image_url || img?.display_url))
    .filter(Boolean);
  const plateSold = plate.status === 'sold';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
                        <Image source={{ uri }} style={styles.image} contentFit="cover" />
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
              <UAEPlate
                city={plate.city}
                code={plate.code}
                number={plate.number || plate.digits}
                sold={plateSold}
                height={130}
                style={styles.plateHero}
              />
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
            <Ionicons name={saved ? 'heart' : 'heart-outline'} size={24} color={saved ? colors.accent : colors.white} />
          </TouchableOpacity>
          <View style={styles.reportButtonWrap}>
            <ReportButton listingType="plate" listingId={plateId} />
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.plateDisplay}>
            <UAEPlate
              city={plate.city}
              code={plate.code}
              number={plate.number || plate.digits}
              sold={plateSold}
              height={130}
              style={styles.plateFill}
            />
          </View>

          <Text style={styles.price}>{formatPrice(plate.price)}</Text>
          <Text style={styles.usdPrice}>{formatPriceUSD(plate.price)}</Text>
          <Text style={styles.cityLabel}>{plate.city || 'Unknown City'}</Text>
          {plate.plate_format ? (
            <Text style={styles.cityLabel}>Format: {plate.plate_format}</Text>
          ) : null}

          {(plate.description || plate.plate_description) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{plate.description || plate.plate_description}</Text>
            </View>
          ) : null}

          {(plate.city || plate.emirate || plate.latitude || plate.longitude) && (
            <View style={styles.section}>
              <View style={styles.locationRow}>
                <Ionicons name="location" size={16} color={colors.textSecondary} />
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

          <PriceHistory listingType="plates" listingId={plateId} />

          <View style={styles.sellerCard}>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerInitial}>
                  {(plate.seller_name || 'S')[0]?.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.sellerName}>{isRedditSourced(plate) ? 'DPH Classifieds' : (plate.seller_name || 'Seller')}</Text>
              </View>
            </View>
            {isRedditSourced(plate) ? (
              <RedditSourcePanel item={plate} />
            ) : (
              <View style={styles.sellerActions}>
                <PressableScale onPress={handleCall} haptic="medium" style={styles.callButton}>
                  <Ionicons name="call" size={18} color={colors.textPrimary} />
                  <Text style={styles.callButtonText}>Call Now</Text>
                </PressableScale>
                <PressableScale onPress={handleWhatsApp} haptic="medium" style={styles.whatsappButton}>
                  <Ionicons name="logo-whatsapp" size={18} color={colors.textPrimary} />
                  <Text style={styles.whatsappButtonText}>WhatsApp</Text>
                </PressableScale>
              </View>
            )}
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

      <ImageLightbox
        images={imageUris}
        visible={!!previewImage}
        initialIndex={previewImageIndex}
        onClose={() => setPreviewImage(null)}
      />
      <AuthPromptModal />
    </SafeAreaView>
  );
}
