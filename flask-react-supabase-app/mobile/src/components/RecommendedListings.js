import React, { useState, useEffect, useMemo } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import Text from './ui/AppText';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../utils/apiClient';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { prefetchListing } from '../utils/listingCache';
import { getMemoryRecommendations, readRecommendations, writeRecommendations } from '../utils/recommendationsCache';

// Detail screens cache by plural type; recommendations use the singular.
const CACHE_TYPE = { car: 'cars', bike: 'bikes', plate: 'plates', parts: 'parts' };

export default function RecommendedListings({ listingType, listingId, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { marginTop: SPACING.lg },
    sectionTitle: { color: colors.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: SPACING.sm },
    card: { width: 160, marginRight: 12, backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, overflow: 'hidden' },
    image: { width: 160, height: 100, backgroundColor: colors.surfaceHigher },
    placeholder: { alignItems: 'center', justifyContent: 'center' },
    price: { color: colors.accent, fontSize: FONT_SIZES.md, fontWeight: '700', paddingHorizontal: 10, paddingTop: 8 },
    title: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, paddingHorizontal: 10, paddingBottom: 8 },
  }), [colors]);

  const [items, setItems] = useState(() => getMemoryRecommendations(listingType, listingId) || []);
  const [loading, setLoading] = useState(items.length === 0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const cached = await readRecommendations(listingType, listingId);
      if (!cancelled && cached?.length) {
        setItems(cached);
        setLoading(false);
      }
      try {
        // Revalidate in the background so cached recommendations paint first
        // while shared web/mobile listing data stays fresh.
        const data = await apiClient.post('/api/recommendations', { listing_type: listingType, listing_id: listingId, limit: 6 });
        const nextItems = data?.recommendations || [];
        writeRecommendations(listingType, listingId, nextItems);
        if (!cancelled) setItems(nextItems);
      } catch (err) {
        // A cached result is still useful when the recommendation service is
        // unavailable; an empty cold state simply remains hidden.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [listingType, listingId]);

  if (items.length === 0 && !loading) return null;
  if (items.length === 0) return <View style={styles.container} accessibilityLabel="Loading similar listings" />;

  const renderItem = ({ item }) => {
    const detailRoute = { car: 'CarDetail', bike: 'BikeDetail', plate: 'PlateDetail', parts: 'PartDetail' }[listingType];
    return (
      <TouchableOpacity style={styles.card} onPress={() => { prefetchListing(CACHE_TYPE[listingType], item); navigation.push(detailRoute, { listingId: item.id }); }}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.placeholder]}><Ionicons name="image-outline" size={24} color={colors.textMuted} /></View>
        )}
        <Text style={styles.price}>{item.priceLabel}</Text>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
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
