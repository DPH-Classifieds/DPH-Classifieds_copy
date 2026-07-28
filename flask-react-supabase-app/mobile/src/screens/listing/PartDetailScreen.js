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
import { ListingDetailSkeleton } from '../../components/ui/ListingSkeleton';
import { getCachedListing } from '../../utils/listingCache';
import PressableScale from '../../components/ui/PressableScale';
import RedditSourcePanel, { isRedditSourced } from '../../components/RedditSourcePanel';
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
import Badge from '../../components/ui/Badge';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import ReportButton from '../../components/ui/ReportButton';
import Button from '../../components/ui/Button';
import RecommendedListings from '../../components/RecommendedListings';
import PriceHistory from '../../components/ui/PriceHistory';
import ListingMap from '../../components/ui/ListingMap';
import { resolveMediaUrl } from '../../utils/media';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CONDITION_VARIANT = { New: 'success', Used: 'warning', Refurbished: 'info' };

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

export default function PartDetailScreen({ route, navigation }) {
  const { listing: routeListing, listingId } = route.params || {};
  const initialPart = (routeListing && typeof routeListing === 'object' ? routeListing : null)
    || getCachedListing('parts', listingId) || null;
  const [part, setPart] = useState(initialPart);
  const [loading, setLoading] = useState(!initialPart);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const lightboxListRef = useRef(null);
  const lightboxPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && g.dy > Math.abs(g.dx) * 1.6,
      onPanResponderRelease: (_, g) => { if (g.dy > 90) setPreviewImage(null); },
    })
  ).current;
  const { toggleSaveListing, isSaved } = useSavedListings();
  const { user } = useAuth();
  const isOwner = user && (user.id === part?.user_id || user.id === part?.seller_id);

  const partId = part?.id || listingId;
  const saved = isSaved('part', partId);

  useEffect(() => {
    const id = listingId || routeListing?.id;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.get(`/api/parts/${id}`);
        if (!cancelled && data) setPart((prev) => ({ ...(prev || {}), ...data }));
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 404) setPart(null);
        else if (!initialPart) Alert.alert('Error', 'Failed to load part details.');
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
    if (!part) return;
    await toggleSaveListing('parts', part);
  }, [part, toggleSaveListing]);

  const handleCall = useCallback(() => {
    if (!ensureContactAccess(user, navigation)) return;
    const phone = part?.contact_number || part?.contact_phone;
    if (phone) {
      trackLeadEvent('parts', part.id, 'call_click');
      Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Call failed', 'Unable to open the phone dialer.'));
    }
  }, [part, user, navigation]);

  const handleWhatsApp = useCallback(() => {
    if (!ensureContactAccess(user, navigation)) return;
    const url = openWhatsapp(part, 'part');
    if (url) {
      trackLeadEvent('parts', part.id, 'whatsapp_click');
      Linking.openURL(url);
    }
  }, [part, user, navigation]);

  if (loading && !part) return <ListingDetailSkeleton />;
  if (!part) return <LoadingSpinner message="Part not found" />;

  const images = part.images || [];
  // Web/backend use `compatibility`; older data used `compatible_makes`. Accept
  // either, and split a comma-separated string into pills.
  const rawCompat = part.compatibility ?? part.compatible_makes ?? part.compatible_models ?? [];
  const compatibleVehicles = Array.isArray(rawCompat)
    ? rawCompat
    : (typeof rawCompat === 'string' ? rawCompat.split(',').map((s) => s.trim()).filter(Boolean) : []);

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
                        <Ionicons name="construct" size={60} color="rgba(255,255,255,0.2)" />
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="construct" size={60} color="rgba(255,255,255,0.2)" />
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
            <ReportButton listingType="parts" listingId={partId} />
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Text style={styles.partName}>{part.part_type || 'Part'}</Text>
            {part.condition && (
              <Badge label={part.condition} variant={CONDITION_VARIANT[part.condition] || 'default'} size="md" />
            )}
          </View>

          {part.brand ? (
            <Text style={styles.brandText}>{part.brand}{part.model ? ` ${part.model}` : ''}</Text>
          ) : null}

          <Text style={styles.price}>{formatPrice(part.price)}</Text>
          <Text style={styles.usdPrice}>{formatPriceUSD(part.price)}</Text>

          {compatibleVehicles.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Compatible Vehicles</Text>
              <View style={styles.compatRow}>
                {(Array.isArray(compatibleVehicles) ? compatibleVehicles : [compatibleVehicles]).map((v, i) => (
                  <View key={i} style={styles.compatPill}>
                    <Text style={styles.compatPillText}>{v}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {(part.description || part.part_description) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{part.description || part.part_description}</Text>
            </View>
          ) : null}

          {part.city ? (
            <View style={styles.section}>
              <View style={styles.locationRow}>
                <Ionicons name="location" size={16} color={COLORS.textSecondary} />
                <Text style={styles.locationText}>{part.city || part.area || part.emirate}</Text>
              </View>
              <ListingMap
                latitude={part.latitude}
                longitude={part.longitude}
                title={part.name}
                city={part.city}
                emirate={part.emirate}
                area={part.area}
              />
            </View>
          ) : null}

          <PriceHistory listingType="parts" listingId={partId} />

          <View style={styles.sellerCard}>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerInitial}>
                  {(part.seller_name || 'S')[0]?.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.sellerName}>{isRedditSourced(part) ? 'DPH Classifieds' : (part.seller_name || 'Seller')}</Text>
              </View>
            </View>
            {isRedditSourced(part) ? (
              <RedditSourcePanel item={part} />
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
                <Button title="Edit" onPress={() => navigation.navigate('EditListing', { editMode: true, listingType: 'parts', listingId: part.id })} variant="secondary" size="sm" />
                <Button title="Delete" onPress={() => {
                  Alert.alert('Delete', 'Are you sure?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: async () => {
                      await apiClient.delete(`/api/parts/${part.id}`);
                      navigation.goBack();
                    }},
                  ]);
                }} variant="ghost" size="sm" />
              </View>
            )}
          </View>
        </View>

        <RecommendedListings listingType="parts" listingId={part.id} navigation={navigation} />
      </Animated.ScrollView>

      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.lightboxContainer} {...lightboxPan.panHandlers}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setPreviewImage(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.lightboxCounter}>
            {previewImageIndex + 1} / {images.length}
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
          {previewImageIndex < images.length - 1 && (
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
                  <Image source={{ uri }} style={styles.lightboxImage} contentFit="contain" />
                </View>
              );
            }}
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
  imageSection: { height: 250, backgroundColor: COLORS.surfaceDark },
  imageSlide: { width: SCREEN_WIDTH, height: 250 },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceDark },
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  partName: { color: COLORS.white, fontSize: FONT_SIZES.xl, fontWeight: '700', flex: 1, marginRight: 10 },
  brandText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, marginBottom: 8 },
  price: { color: COLORS.accent, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  usdPrice: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginTop: -12, marginBottom: 16 },
  section: { marginTop: 16, marginBottom: 8 },
  sectionTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginBottom: 10 },
  compatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compatPill: {
    backgroundColor: COLORS.surface, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.border,
  },
  compatPillText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  description: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, lineHeight: 22 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md },
  sellerCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginTop: 16,
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
  lightboxPrev: { position: 'absolute', left: 10, top: 0, bottom: 0, justifyContent: 'center', padding: 12, zIndex: 20 },
  lightboxNext: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center', padding: 12, zIndex: 20 },
});
