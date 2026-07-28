import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import Text from './AppText';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import PressableScale from './PressableScale';
import FadeInImage from './FadeInImage';
import UAEPlate from './UAEPlate';
import { formatPrice } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

// Shared listing card so the Explore and Saved screens render identically.
// Accepts both raw-listing-derived items (Explore: has `price`) and normalized
// saved cards (has `priceLabel`). `onSave` is optional (Saved passes its own).
const CATEGORY_COLORS = {
  cars: COLORS.accent,
  bikes: '#2196f3',
  plates: '#ff9800',
  parts: '#9c27b0',
};

const catLabel = (c) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Listing');

export default function ListingCard({ item, index, onPress, onSave, saved }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const category = item.category || item.listing_type || item.categoryKey;
  const catColor = CATEGORY_COLORS[category] || COLORS.accent;
  const priceText = item.priceLabel || (item.price ? formatPrice(item.price) : 'Price on request');
  // Plates have no photo — render the generated plate visual (same as web/detail)
  // instead of the gray placeholder. Explore wraps the raw plate in `raw`.
  const isPlate = category === 'plates' || category === 'plate';
  const plate = isPlate ? (item.raw || item) : null;

  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress}>
        <View style={styles.card}>
          <View style={styles.cardImageWrap}>
            {isPlate ? (
              <View style={styles.cardPlateWrap}>
                <UAEPlate
                  city={plate.city}
                  code={plate.code}
                  number={plate.number || plate.digits}
                  sold={plate.status === 'sold'}
                  height={116}
                  style={styles.cardPlate}
                />
              </View>
            ) : item.image ? (
              <FadeInImage source={{ uri: item.image }} style={styles.cardImage} resizeMode="cover" />
            ) : (
              <View style={styles.cardImagePlaceholder}>
                <Ionicons name="image-outline" size={28} color={COLORS.textMuted} />
              </View>
            )}
            {category ? (
              <View style={[styles.cardCatBadge, { backgroundColor: catColor }]}>
                <Text style={styles.cardCatText}>{catLabel(category)}</Text>
              </View>
            ) : null}
            {onSave ? (
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
            ) : null}
            {item.is_featured ? (
              <View style={styles.cardFeatured}>
                <Ionicons name="star" size={10} color={COLORS.black} />
                <Text style={styles.cardFeaturedText}>Featured</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardPrice}>{priceText}</Text>
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  cardImageWrap: { height: 210, position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  cardImagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardPlateWrap: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surfaceDark,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  cardPlate: { width: '100%' },
  cardCatBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.sm,
  },
  cardCatText: { color: COLORS.white, fontSize: 10, fontWeight: '700' },
  cardSaveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardFeatured: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.sm,
  },
  cardFeaturedText: { color: COLORS.black, fontSize: 9, fontWeight: '700' },
  cardBody: { paddingHorizontal: 14, paddingVertical: 14 },
  cardPrice: { color: COLORS.accent, fontSize: FONT_SIZES.lg, fontWeight: '800', marginBottom: 6 },
  cardTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: 6 },
  cardSubtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 8, lineHeight: 18 },
  cardLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardLocation: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
});
