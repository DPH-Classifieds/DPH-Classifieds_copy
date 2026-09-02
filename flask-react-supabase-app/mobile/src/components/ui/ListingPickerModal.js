import React, { useEffect, useMemo, useState } from 'react';
import { View, Modal, FlatList, TextInput, TouchableOpacity, Image, StyleSheet } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { toastApiError } from '../../utils/toast';
import LoadingSpinner from './LoadingSpinner';
import EmptyState from './EmptyState';
import { SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const PLURAL_TO_SINGULAR = { cars: 'car', bikes: 'bike', plates: 'plate', parts: 'part' };
const TYPE_LABELS = { car: 'Car', bike: 'Bike', plate: 'Plate', part: 'Part' };

const getTitle = (item) => {
  if (item.car_manufacturer) return `${item.car_manufacturer} ${item.car_model || ''}`.trim() || 'Car';
  if (item.bike_brand) return `${item.bike_brand} ${item.bike_model || ''}`.trim() || 'Bike';
  if (item.city) return [item.city, item.code, item.number || item.digits].filter(Boolean).join(' ') || 'Plate';
  return item.part_type || item.part_name || 'Part';
};

const getThumbnail = (item) => {
  const first = Array.isArray(item.images) ? item.images[0] : null;
  return first?.url || first?.image_url || item.image_url || null;
};

// Mirrors frontend/src/components/admin/ListingPicker.jsx — search-as-you-type
// over the same admin listings-search endpoint the Listings screen uses.
export default function ListingPickerModal({ visible, onClose, onSelect }) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
        sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, height: '75%' },
        header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.md },
        title: { ...FONTS.bold, fontSize: FONT_SIZES.lg, color: colors.textPrimary },
        searchWrap: {
          flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceHigher, borderRadius: BORDER_RADIUS.md,
          paddingHorizontal: 12, paddingVertical: 10, marginBottom: SPACING.md, borderWidth: 1, borderColor: colors.border,
        },
        searchInput: { flex: 1, color: colors.textPrimary, fontSize: FONT_SIZES.sm },
        list: { flex: 1 },
        row: {
          flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceVariant,
          borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, marginBottom: 6, borderWidth: 1, borderColor: colors.border,
        },
        thumb: { width: 36, height: 36, borderRadius: 6, backgroundColor: colors.surfaceHigher },
        thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
        typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: BORDER_RADIUS.sm, backgroundColor: colors.surfaceHigher },
        typeBadgeText: { ...FONTS.label, fontSize: 9, color: colors.textMuted },
        rowTitle: { flex: 1, ...FONTS.medium, fontSize: FONT_SIZES.sm, color: colors.textPrimary },
      }),
    [colors]
  );

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    apiClient
      .get('/api/admin/listings-search?types=car,bike,plate,part&statuses=approved&limit=200')
      .then((data) => {
        if (!active) return;
        setListings(Array.isArray(data) ? data : data?.listings || []);
      })
      .catch((err) => { if (active) toastApiError(err); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withTitle = listings.map((l) => ({ listing: l, title: getTitle(l) }));
    const matched = q
      ? withTitle.filter(({ listing, title }) => title.toLowerCase().includes(q) || (listing.id || '').toLowerCase().includes(q))
      : withTitle;
    return matched.slice(0, 40);
  }, [listings, query]);

  const pick = (listing, title) => {
    const singularType = PLURAL_TO_SINGULAR[listing.listing_type] || listing.listing_type;
    onSelect({ listingType: singularType, listingId: listing.id, title });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Choose a listing to feature</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              autoFocus
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search by make, model, plate number…"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          {loading ? (
            <LoadingSpinner message="Loading listings…" />
          ) : (
            <FlatList
              data={results}
              keyExtractor={({ listing }) => `${listing.listing_type}-${listing.id}`}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<EmptyState icon="search-outline" title="No matching listings" />}
              renderItem={({ item: { listing, title } }) => {
                const thumb = getThumbnail(listing);
                const singularType = PLURAL_TO_SINGULAR[listing.listing_type] || listing.listing_type;
                return (
                  <TouchableOpacity style={styles.row} onPress={() => pick(listing, title)} activeOpacity={0.7}>
                    {singularType === 'plate' ? (
                      <View style={[styles.thumb, styles.thumbPlaceholder]}>
                        <Ionicons name="key-outline" size={16} color={colors.textMuted} />
                      </View>
                    ) : thumb ? (
                      <Image source={{ uri: thumb }} style={styles.thumb} />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPlaceholder]}>
                        <Ionicons name="image-outline" size={16} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>{TYPE_LABELS[singularType] || singularType}</Text>
                    </View>
                    <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
