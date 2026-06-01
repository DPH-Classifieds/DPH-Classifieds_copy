import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Image, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatDate } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const REJECTION_REASONS = [
  'Inappropriate content', 'Wrong category', 'Spam',
  'Duplicate listing', 'Incomplete information', 'Other',
];

export default function AdminListingDetailScreen({ route, navigation }) {
  const { itemType, itemId } = route.params;
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadListing(); }, []);

  const loadListing = async () => {
    try {
      const data = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
      setDetail(data);
    } catch (err) {
      Alert.alert('Error', 'Failed to load listing.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    try {
      await apiClient.post(`/api/admin/approve/${itemType}/${itemId}/approve`);
      Alert.alert('Approved', 'Listing has been approved.');
      navigation.goBack();
    } catch (err) { Alert.alert('Error', err.message); }
  };

  const handleReject = async () => {
    Alert.alert('Reject Listing', 'Select a reason:', [
      ...REJECTION_REASONS.map(reason => ({
        text: reason,
        onPress: async () => {
          try {
            await apiClient.post(`/api/admin/approve/${itemType}/${itemId}/reject`, { reason });
            Alert.alert('Rejected', 'Listing has been rejected.');
            navigation.goBack();
          } catch (err) { Alert.alert('Error', err.message); }
        },
      })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleDelete = async () => {
    Alert.alert('Delete', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await apiClient.delete(`/${itemType}/${itemId}/delete`); navigation.goBack(); }
        catch (err) { Alert.alert('Error', err.message); }
      }},
    ]);
  };

  const getImageUri = () => {
    const listing = detail?.listing;
    if (!listing?.images?.[0]) return null;
    const img = detail?.images?.[0] || listing.images[0];
    return typeof img === 'string' ? img : img.url || img.image_url;
  };

  const isBuyingRequest = itemType === 'buying_requests' || itemType === 'buying_request';

  const getTitle = () => {
    const listing = detail?.listing;
    if (!listing) return 'Listing';
    if (isBuyingRequest) {
      const carPart = `${listing.car_manufacturer || ''} ${listing.car_model || ''}`.trim();
      return listing.item_name || carPart || 'Buying Request';
    }
    return listing.listing_title || listing.car_manufacturer
      ? `${listing.car_manufacturer || ''} ${listing.car_model || ''}`.trim()
      : listing.name || 'Listing';
  };

  const getPrice = () => {
    const listing = detail?.listing;
    if (!listing) return 0;
    if (isBuyingRequest) return listing.budget || 0;
    return listing.expected_selling_price || listing.price || 0;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading listing...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const imageUri = getImageUri();
  const listing = detail?.listing;
  const verification = detail?.verification_status || {};
  const verificationFields = verification.fields || {};

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {imageUri && <Image source={{ uri: imageUri }} style={styles.image} />}
        <Text style={styles.title}>{getTitle()}</Text>
        <Text style={styles.price}>
          {isBuyingRequest ? `Budget ${formatPrice(getPrice())}` : formatPrice(getPrice())}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: listing?.status === 'active' ? COLORS.success : COLORS.warning }]}>
          <Text style={styles.statusBadgeText}>{listing?.status || 'pending'}</Text>
        </View>
        <Text style={styles.detail}>Type: {isBuyingRequest ? 'Buying request' : itemType}</Text>
        {!isBuyingRequest && (
          <Text style={styles.detail}>Seller: {listing?.seller_name || 'N/A'}</Text>
        )}
        {isBuyingRequest && listing?.mileage_preference && (
          <Text style={styles.detail}>Mileage preference: {listing.mileage_preference}</Text>
        )}
        {isBuyingRequest && listing?.regional_spec && (
          <Text style={styles.detail}>Regional spec: {listing.regional_spec}</Text>
        )}
        {isBuyingRequest && listing?.reference_notes && (
          <Text style={styles.detail}>Notes: {listing.reference_notes}</Text>
        )}
        {listing?.created_at && (
          <Text style={styles.detail}>Posted: {formatDate(listing.created_at)}</Text>
        )}

        {!isBuyingRequest && (
          <View style={styles.scanCard}>
            <Text style={styles.scanTitle}>Verification Scan</Text>
            <Text style={styles.detail}>Needs review: {verification.needs_review ? 'Yes' : 'No'}</Text>
            <Text style={styles.detail}>VIN valid: {verification.vin_valid ? 'Yes' : 'No'}</Text>
            <Text style={styles.detail}>OCR confidence: {Math.round(Number(verification.confidence || 0) * 100)}%</Text>
            <Text style={styles.detail}>OCR make: {verificationFields.make || 'N/A'}</Text>
            <Text style={styles.detail}>OCR model: {verificationFields.model || 'N/A'}</Text>
            <Text style={styles.detail}>OCR year: {verificationFields.year || 'N/A'}</Text>
            <Text style={styles.detail}>OCR VIN: {verificationFields.vin || 'N/A'}</Text>
          </View>
        )}

        {!isBuyingRequest && (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.approveBtn} onPress={handleApprove} activeOpacity={0.7}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
              <Text style={styles.approveBtnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectBtn} onPress={handleReject} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color={COLORS.error} />
              <Text style={styles.rejectBtnText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={18} color={COLORS.error} />
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.xs },
  image: { width: '100%', height: 200, borderRadius: BORDER_RADIUS.lg, marginBottom: SPACING.md },
  title: { color: COLORS.white, fontSize: FONT_SIZES.xl, fontWeight: '700', marginBottom: SPACING.xs },
  price: { color: COLORS.accent, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: SPACING.sm },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, marginBottom: SPACING.sm },
  statusBadgeText: { color: COLORS.white, fontSize: FONT_SIZES.xs, fontWeight: '600', textTransform: 'capitalize' },
  detail: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, marginBottom: 4 },
  scanCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md },
  scanTitle: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '700', marginBottom: SPACING.xs },
  actions: { gap: SPACING.sm, marginTop: SPACING.lg },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, paddingHorizontal: SPACING.md, justifyContent: 'center' },
  approveBtnText: { color: COLORS.accent, fontSize: FONT_SIZES.md, fontWeight: '600' },
  rejectBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
  rejectBtnText: { color: COLORS.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,59,48,0.1)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
  deleteBtnText: { color: COLORS.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
});
