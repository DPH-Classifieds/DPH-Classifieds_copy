import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../utils/apiClient';
import { formatPrice } from '../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../constants/theme';
import { resolveMediaUrl } from '../utils/media';
import { prefetchListing } from '../utils/listingCache';
import UAEPlate from './ui/UAEPlate';

// Detail screens cache by plural type; recommendations use the singular.
const CACHE_TYPE = { car: 'cars', bike: 'bikes', plate: 'plates', parts: 'parts' };

export default function RecommendedListings({ listingType, listingId, navigation }) {
  const [items, setItems] = useState([]);

  useEffect(() => { loadRecommendations(); }, [listingType, listingId]);

  const loadRecommendations = async () => {
    try {
      const data = await apiClient.post('/api/recommendations', { listing_type: listingType, listing_id: listingId, limit: 6 });
      setItems(data?.recommendations || []);
    } catch (err) { /* silent */ }
  };

  if (items.length === 0) return null;

  const renderItem = ({ item }) => {
    const detailRoute = { car: 'CarDetail', bike: 'BikeDetail', plate: 'PlateDetail', parts: 'PartDetail' }[listingType];
    return (
      <TouchableOpacity style={styles.card} onPress={() => { prefetchListing(CACHE_TYPE[listingType], item); navigation.push(detailRoute, { listingId: item.id }); }}>
        {listingType === 'plate' ? (
          <View style={[styles.image, styles.platePlaceholder]}>
            <UAEPlate city={item.city} code={item.code} number={item.number || item.digits} height={70} style={styles.recPlate} />
          </View>
        ) : item.images?.[0] ? (
          <Image
            source={{
              uri: resolveMediaUrl(
                typeof item.images[0] === 'string'
                  ? item.images[0]
                  : item.images[0].url || item.images[0].image_url || item.images[0].display_url
              ),
            }}
            style={styles.image}
          />
        ) : (
          <View style={[styles.image, styles.placeholder]}><Ionicons name="image-outline" size={24} color={COLORS.textMuted} /></View>
        )}
        <Text style={styles.price}>{formatPrice(item.expected_selling_price || item.price)}</Text>
        <Text style={styles.title} numberOfLines={1}>{item.listing_title || item.name || 'Listing'}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Similar Listings</Text>
      <FlatList data={items} renderItem={renderItem} keyExtractor={(item) => String(item.id)} horizontal showsHorizontalScrollIndicator={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: SPACING.lg },
  sectionTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: SPACING.sm },
  card: { width: 160, marginRight: 12, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, overflow: 'hidden' },
  image: { width: 160, height: 100, backgroundColor: COLORS.surfaceHigher },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  platePlaceholder: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  recPlate: { width: '100%' },
  price: { color: COLORS.accent, fontSize: FONT_SIZES.md, fontWeight: '700', paddingHorizontal: 10, paddingTop: 8 },
  title: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, paddingHorizontal: 10, paddingBottom: 8 },
});
