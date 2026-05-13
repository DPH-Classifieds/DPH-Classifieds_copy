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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useSavedListings } from '../../context/SavedListingsContext';
import LoadingSpinner from '../../components/ui/LoadingSpinner';

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

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return item.images[0].url || item.images[0].image_url || item.images[0].display_url;
  }
  return item.image_url || item.display_url || null;
};

export default function PlateDetailScreen({ route }) {
  const { listingId } = route.params || {};
  const [plate, setPlate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const { toggleSaveListing, isSaved } = useSavedListings();

  const plateId = plate?.id || listingId;
  const saved = isSaved('plates', plateId);

  useEffect(() => {
    const fetchPlate = async () => {
      try {
        setLoading(true);
        const data = await apiClient.get(`/api/plates/${listingId}`);
        setPlate(data);
      } catch (err) {
        Alert.alert('Error', 'Failed to load plate details.');
      } finally {
        setLoading(false);
      }
    };
    if (listingId) fetchPlate();
  }, [listingId]);

  const handleSave = useCallback(async () => {
    if (!plate) return;
    await toggleSaveListing('plates', plate);
  }, [plate, toggleSaveListing]);

  const handleCall = useCallback(() => {
    const phone = plate?.phone || plate?.seller_phone;
    if (phone) Linking.openURL(`tel:${phone}`);
  }, [plate]);

  const handleWhatsApp = useCallback(() => {
    const phone = plate?.phone || plate?.seller_phone;
    if (phone) {
      const cleaned = phone.replace(/[^0-9]/g, '');
      Linking.openURL(`whatsapp://send?phone=${cleaned}`);
    }
  }, [plate]);

  if (loading) return <LoadingSpinner message="Loading plate details..." />;
  if (!plate) return <LoadingSpinner message="Plate not found" />;

  const cityCode = CITY_CODES[plate.city] || 'م';
  const images = plate.images || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
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
                      <Image source={{ uri }} style={styles.image} resizeMode="cover" />
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
                <Text style={styles.plateCityCode}>{cityCode}</Text>
                <View style={styles.plateDivider} />
                <View style={styles.plateNumbers}>
                  <Text style={styles.plateCode}>{plate.code || ''}</Text>
                  <Text style={styles.plateDigits}>{plate.digits || plate.number || ''}</Text>
                </View>
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
          <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.7}>
            <Ionicons name={saved ? 'heart' : 'heart-outline'} size={24} color={saved ? COLORS.accent : COLORS.white} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.plateDisplay}>
            <View style={styles.plateBoxDetail}>
              <Text style={styles.plateCityCodeDetail}>{cityCode}</Text>
              <View style={styles.plateDividerDetail} />
              <View style={styles.plateNumbersDetail}>
                <Text style={styles.plateCodeDetail}>{plate.code || ''}</Text>
                <Text style={styles.plateDigitsDetail}>{plate.digits || plate.number || ''}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.price}>{formatPrice(plate.price)}</Text>
          <Text style={styles.cityLabel}>{plate.city || 'Unknown City'}</Text>

          {plate.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{plate.description}</Text>
            </View>
          ) : null}

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
              <TouchableOpacity style={styles.callButton} onPress={handleCall} activeOpacity={0.8}>
                <Ionicons name="call" size={18} color={COLORS.white} />
                <Text style={styles.callButtonText}>Call Now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.whatsappButton} onPress={handleWhatsApp} activeOpacity={0.8}>
                <Ionicons name="logo-whatsapp" size={18} color={COLORS.white} />
                <Text style={styles.whatsappButtonText}>WhatsApp</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
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
  content: { padding: SPACING.md },
  plateDisplay: { alignItems: 'center', marginBottom: SPACING.md },
  plateBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff',
    borderRadius: 12, borderWidth: 3, borderColor: '#333333',
    paddingHorizontal: 28, paddingVertical: 20, minWidth: 260,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  plateCityCode: { color: '#1a1a1a', fontSize: 36, fontWeight: '900', marginHorizontal: 10 },
  plateDivider: { width: 3, height: 44, backgroundColor: '#333333', marginHorizontal: 10 },
  plateNumbers: { flexDirection: 'row', alignItems: 'center' },
  plateCode: { color: '#1a1a1a', fontSize: 28, fontWeight: '700', marginRight: 4 },
  plateDigits: { color: '#1a1a1a', fontSize: 28, fontWeight: '700', letterSpacing: 3 },
  plateBoxDetail: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff',
    borderRadius: 12, borderWidth: 3, borderColor: '#333333',
    paddingHorizontal: 28, paddingVertical: 20, minWidth: 260,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  plateCityCodeDetail: { color: '#1a1a1a', fontSize: 36, fontWeight: '900', marginHorizontal: 10 },
  plateDividerDetail: { width: 3, height: 44, backgroundColor: '#333333', marginHorizontal: 10 },
  plateNumbersDetail: { flexDirection: 'row', alignItems: 'center' },
  plateCodeDetail: { color: '#1a1a1a', fontSize: 28, fontWeight: '700', marginRight: 4 },
  plateDigitsDetail: { color: '#1a1a1a', fontSize: 28, fontWeight: '700', letterSpacing: 3 },
  price: { color: COLORS.white, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  cityLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginBottom: 10 },
  description: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, lineHeight: 22 },
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
