import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Linking,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatPriceUSD } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useSavedListings } from '../../context/SavedListingsContext';
import { useAuth } from '../../context/AuthContext';
import { trackLeadEvent } from '../../utils/leadTracking';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import LoanCalculator from '../../components/ui/LoanCalculator';
import ReportButton from '../../components/ui/ReportButton';
import Button from '../../components/ui/Button';
import RecommendedListings from '../../components/RecommendedListings';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return item.images[0].url || item.images[0].image_url || item.images[0].display_url;
  }
  return item.image_url || item.display_url || null;
};

export default function BikeDetailScreen({ route, navigation }) {
  const { listingId } = route.params || {};
  const [bike, setBike] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState(null);
  const { toggleSaveListing, isSaved } = useSavedListings();
  const { user } = useAuth();
  const isOwner = user && (user.id === bike?.user_id || user.id === bike?.seller_id);

  const bikeId = bike?.id || listingId;
  const saved = isSaved('bike', bikeId);

  useEffect(() => {
    const fetchBike = async () => {
      try {
        setLoading(true);
        const data = await apiClient.get(`/api/bikes/${listingId}`);
        setBike(data);
      } catch (err) {
        Alert.alert('Error', 'Failed to load bike details.');
      } finally {
        setLoading(false);
      }
    };
    if (listingId) fetchBike();
  }, [listingId]);

  const handleSave = useCallback(async () => {
    if (!bike) return;
    await toggleSaveListing('bikes', bike);
  }, [bike, toggleSaveListing]);

  const handleCall = useCallback(() => {
    const phone = bike?.car_owner_phone_number || bike?.whatsapp_number;
    if (phone) {
      trackLeadEvent('bike', bike.id, 'call_click');
      Linking.openURL(`tel:${phone}`);
    }
  }, [bike]);

  const handleWhatsApp = useCallback(() => {
    const phone = bike?.whatsapp_number || bike?.car_owner_phone_number;
    if (phone) {
      trackLeadEvent('bike', bike.id, 'whatsapp_click');
      const cleaned = phone.replace(/[^0-9]/g, '');
      Linking.openURL(`whatsapp://send?phone=${cleaned}`);
    }
  }, [bike]);

  if (loading) return <LoadingSpinner message="Loading bike details..." />;
  if (!bike) return <LoadingSpinner message="Bike not found" />;

  const images = bike.images || [];

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
            {images.length > 0 ? images.map((img, i) => {
              const uri = img.url || img.image_url || img.display_url;
              return (
                <View key={i} style={styles.imageSlide}>
                  {uri ? (
                    <TouchableOpacity onPress={() => setPreviewImage(uri)} activeOpacity={0.9}>
                      <Image source={{ uri }} style={styles.image} resizeMode="cover" />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Ionicons name="bicycle" size={60} color="rgba(255,255,255,0.2)" />
                    </View>
                  )}
                </View>
              );
            }) : (
              <View style={styles.imageSlide}>
                <View style={styles.imagePlaceholder}>
                  <Ionicons name="bicycle" size={60} color="rgba(255,255,255,0.2)" />
                </View>
              </View>
            )}
          </ScrollView>
          {images.length > 1 && (
            <View style={styles.paginationDots}>
              {images.map((_, i) => (
                <View key={i} style={[styles.dot, i === activeImageIndex && styles.dotActive]} />
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.7}>
            <Ionicons name={saved ? 'heart' : 'heart-outline'} size={24} color={saved ? COLORS.accent : COLORS.white} />
          </TouchableOpacity>
          <View style={styles.reportButtonWrap}>
            <ReportButton listingType="bike" listingId={bikeId} />
          </View>
        </View>

        <View style={styles.content}>
          <Text style={styles.price}>{formatPrice(bike.expected_selling_price)}</Text>
          <Text style={styles.usdPrice}>{formatPriceUSD(bike.expected_selling_price || bike.price)}</Text>
          <Text style={styles.title}>
            {bike.make_year} {bike.bike_brand} {bike.bike_model}
          </Text>

          <View style={styles.specsGrid}>
            {bike.engine_capacity ? (
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Engine</Text>
                <Text style={styles.specValue}>{bike.engine_capacity}</Text>
              </View>
            ) : null}
            {bike.bike_category ? (
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Type</Text>
                <Text style={styles.specValue}>{bike.bike_category}</Text>
              </View>
            ) : null}
            {bike.color ? (
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Color</Text>
                <Text style={styles.specValue}>{bike.color}</Text>
              </View>
            ) : null}
            {bike.transmission ? (
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Transmission</Text>
                <Text style={styles.specValue}>{bike.transmission}</Text>
              </View>
            ) : null}
            {bike.kilometer_driven ? (
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Kilometers</Text>
                <Text style={styles.specValue}>{bike.kilometer_driven} km</Text>
              </View>
            ) : null}
            {bike.fuel_type ? (
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Fuel Type</Text>
                <Text style={styles.specValue}>{bike.fuel_type}</Text>
              </View>
            ) : null}
          </View>

          {bike.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{bike.description}</Text>
            </View>
          ) : null}

          {bike.city ? (
            <View style={styles.section}>
              <View style={styles.locationRow}>
                <Ionicons name="location" size={16} color={COLORS.textSecondary} />
                <Text style={styles.locationText}>{bike.city}</Text>
              </View>
            </View>
          ) : null}

          <LoanCalculator price={bike.expected_selling_price || bike.price} />

          <View style={styles.sellerCard}>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerInitial}>
                  {(bike.seller_name || 'S')[0]?.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.sellerName}>{bike.seller_name || 'Seller'}</Text>
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
                <Button title="Edit" onPress={() => navigation.navigate('PostListing', { editMode: true, listingType: 'bike', listingId: bike.id })} variant="secondary" size="sm" />
                <Button title="Delete" onPress={() => {
                  Alert.alert('Delete', 'Are you sure?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: async () => {
                      await apiClient.delete(`/api/bikes/${bike.id}`);
                      navigation.goBack();
                    }},
                  ]);
                }} variant="ghost" size="sm" />
              </View>
            )}
          </View>
        </View>

        <RecommendedListings listingType="bike" listingId={bike.id} navigation={navigation} />
      </ScrollView>

      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setPreviewImage(null)} activeOpacity={1}>
          <Image source={{ uri: previewImage }} style={{ width: '90%', height: '80%' }} resizeMode="contain" />
          <TouchableOpacity style={{ position: 'absolute', top: 50, right: 20, padding: 8 }} onPress={() => setPreviewImage(null)}>
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  imageSection: { height: 280, backgroundColor: COLORS.surfaceDark },
  imageSlide: { width: SCREEN_WIDTH, height: 280 },
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
  price: { color: COLORS.white, fontSize: 24, fontWeight: '700', marginBottom: 8 },
  usdPrice: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 8 },
  title: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginBottom: 16 },
  specsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg, marginBottom: 16,
  },
  specItem: { width: '50%', paddingVertical: 14, paddingHorizontal: 14, borderWidth: 0.5, borderColor: COLORS.border },
  specLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginBottom: 4 },
  specValue: { color: COLORS.white, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  section: { marginBottom: 16 },
  sectionTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginBottom: 10 },
  description: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, lineHeight: 22 },
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
});
