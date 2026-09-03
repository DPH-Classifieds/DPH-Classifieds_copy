import React, { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, Image, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatDate } from '../../utils/formatters';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const REJECTION_REASONS = [
  'Inappropriate content', 'Wrong category', 'Spam',
  'Duplicate listing', 'Incomplete information', 'Other',
];

const SOLD_STATUS_DISPLAY = {
  sold_on_dph:    { label: 'Sold on DPH',        color: '#4CAF50' },
  sold_elsewhere: { label: 'Sold elsewhere',       color: '#FF9800' },
  not_sold_renew: { label: 'Not sold — renewed',   color: '#2196F3' },
};

const DELETION_ROLE_ICONS = {
  admin:  'shield-outline',
  user:   'person-outline',
  system: 'settings-outline',
};

function formatDateShort(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function LifecycleTimeline({ listing, lcStyles }) {
  const now = new Date();
  const expires  = listing?.expires_at   ? new Date(listing.expires_at)   : null;
  const retEnd   = listing?.retention_expires_at ? new Date(listing.retention_expires_at) : null;
  const isDeleted  = Boolean(listing?.deleted_at);
  const isArchived = listing?.is_archived || (retEnd && now >= retEnd);

  const milestones = [
    { label: 'Created',   date: listing?.created_at,          done: true },
    { label: expires && now >= expires ? 'Expired' : 'Expires', date: listing?.expires_at, done: expires && now >= expires },
    { label: 'Retention ends', date: listing?.retention_expires_at, done: isArchived },
    { label: isDeleted ? 'Deleted' : 'Archived', date: listing?.deleted_at || (isArchived ? listing?.retention_expires_at : null), done: isDeleted || isArchived },
  ];

  return (
    <View style={lcStyles.timelineRow}>
      {milestones.map((m, i) => (
        <View key={m.label} style={lcStyles.milestone}>
          <View style={[lcStyles.dot, m.done && lcStyles.dotDone, isDeleted && i === 3 && lcStyles.dotDeleted]} />
          <Text style={[lcStyles.milestoneLabel, m.done && lcStyles.milestoneLabelDone]}>{m.label}</Text>
          <Text style={lcStyles.milestoneDate}>{formatDateShort(m.date)}</Text>
          {i < milestones.length - 1 && <View style={[lcStyles.connector, m.done && lcStyles.connectorDone]} />}
        </View>
      ))}
    </View>
  );
}

function SoldStatusCard({ listing, lcStyles }) {
  const hasExpired = Boolean(listing?.expired_at);
  const soldStatus = listing?.sold_status;
  if (!hasExpired && !soldStatus) return null;

  const now = new Date();
  const deadline = listing?.sold_response_deadline ? new Date(listing.sold_response_deadline) : null;

  let label, color;
  if (soldStatus && SOLD_STATUS_DISPLAY[soldStatus]) {
    ({ label, color } = SOLD_STATUS_DISPLAY[soldStatus]);
  } else if (deadline && now < deadline) {
    label = 'Awaiting owner response';
    color = '#9E9E9E';
  } else {
    label = 'No response recorded';
    color = '#F44336';
  }

  return (
    <View style={lcStyles.card}>
      <Text style={lcStyles.cardTitle}>Sold Status</Text>
      <View style={[lcStyles.badge, { backgroundColor: color + '26' }]}>
        <Text style={[lcStyles.badgeText, { color }]}>{label}</Text>
      </View>
      {listing?.sold_status_set_at && (
        <Text style={lcStyles.cardSub}>Set: {formatDateShort(listing.sold_status_set_at)}</Text>
      )}
      {deadline && now < deadline && (
        <Text style={lcStyles.cardSub}>Owner deadline: {formatDateShort(listing.sold_response_deadline)}</Text>
      )}
    </View>
  );
}

function RenewalNudgeCard({ listing, renewalEmails, lcStyles }) {
  const count = parseInt(listing?.renewal_nudge_count || 0, 10);
  if (count === 0) return null;

  const channels = listing?.renewal_nudge_channels || {};
  const latestEmail = (renewalEmails || []).find(e => e.email_type === 'renewal_nudge' || e.email_type === 'listing_expiry_reminder');
  const emailOpened = latestEmail?.opened_at;
  const emailClicked = latestEmail?.clicked_at;

  return (
    <View style={lcStyles.card}>
      <Text style={lcStyles.cardTitle}>Renewal Nudges</Text>
      <Text style={lcStyles.cardValue}>{count} nudge{count !== 1 ? 's' : ''} sent</Text>
      <View style={lcStyles.channelRow}>
        {channels.email  !== undefined && <Text style={[lcStyles.channelPill, { color: channels.email  ? '#4CAF50' : '#9E9E9E' }]}>✉ Email</Text>}
        {channels.sms    !== undefined && <Text style={[lcStyles.channelPill, { color: channels.sms    ? '#4CAF50' : '#9E9E9E' }]}>📱 SMS</Text>}
        {channels.whatsapp !== undefined && <Text style={[lcStyles.channelPill, { color: channels.whatsapp ? '#4CAF50' : '#9E9E9E' }]}>💬 WA</Text>}
      </View>
      {listing?.renewal_nudge_sent_at && (
        <Text style={lcStyles.cardSub}>Last sent: {formatDateShort(listing.renewal_nudge_sent_at)}</Text>
      )}
      {latestEmail && (
        <View style={lcStyles.emailRow}>
          <Ionicons
            name={emailOpened || emailClicked ? 'mail-open-outline' : 'mail-outline'}
            size={14}
            color={emailOpened || emailClicked ? '#4CAF50' : '#9E9E9E'}
          />
          <Text style={[lcStyles.emailStatus, { color: emailOpened || emailClicked ? '#4CAF50' : '#9E9E9E' }]}>
            {emailClicked ? 'Clicked link' : emailOpened ? 'Opened' : 'Not opened'}
          </Text>
        </View>
      )}
    </View>
  );
}

function DeletionTimeline({ deletionEvents, lcStyles }) {
  if (!deletionEvents || deletionEvents.length === 0) return null;
  return (
    <View style={lcStyles.card}>
      <Text style={lcStyles.cardTitle}>Deletion History</Text>
      {deletionEvents.map((ev, i) => (
        <View key={i} style={lcStyles.deletionRow}>
          <Ionicons name={DELETION_ROLE_ICONS[ev.deleted_by_role] || 'information-circle-outline'} size={16} color='rgba(255,255,255,0.6)' />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={lcStyles.deletionRole}>{(ev.deleted_by_role || 'unknown').charAt(0).toUpperCase() + (ev.deleted_by_role || 'unknown').slice(1)}</Text>
            {ev.reason ? <Text style={lcStyles.deletionReason} numberOfLines={2}>{ev.reason}</Text> : null}
            <Text style={lcStyles.cardSub}>{formatDateShort(ev.created_at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function AdminListingDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { itemType, itemId } = route.params;
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.black },
    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: colors.textSecondary, fontSize: FONT_SIZES.md },
    content: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.xs },
    image: { width: '100%', height: 200, borderRadius: BORDER_RADIUS.lg, marginBottom: SPACING.md },
    title: { color: colors.white, fontSize: FONT_SIZES.xl, fontWeight: '700', marginBottom: SPACING.xs },
    price: { color: colors.accent, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: SPACING.sm },
    statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, marginBottom: SPACING.sm },
    statusBadgeText: { color: colors.white, fontSize: FONT_SIZES.xs, fontWeight: '600', textTransform: 'capitalize' },
    detail: { color: colors.textSecondary, fontSize: FONT_SIZES.md, marginBottom: 4 },
    scanCard: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md },
    scanTitle: { color: colors.white, fontSize: FONT_SIZES.md, fontWeight: '700', marginBottom: SPACING.xs },
    actions: { gap: SPACING.sm, marginTop: SPACING.lg },
    approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, paddingHorizontal: SPACING.md, justifyContent: 'center' },
    approveBtnText: { color: colors.accent, fontSize: FONT_SIZES.md, fontWeight: '600' },
    editBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
    editBtnText: { color: colors.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
    soldBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(33,150,243,0.15)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
    soldBtnText: { color: '#2196F3', fontSize: FONT_SIZES.md, fontWeight: '600' },
    rejectBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
    rejectBtnText: { color: colors.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
    deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,59,48,0.1)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
    deleteBtnText: { color: colors.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
  }), [colors]);

  const lcStyles = useMemo(() => StyleSheet.create({
    timelineRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm, paddingHorizontal: 4 },
    milestone:         { alignItems: 'center', flex: 1, position: 'relative' },
    dot:               { width: 10, height: 10, borderRadius: 5, backgroundColor: '#333', marginBottom: 4 },
    dotDone:           { backgroundColor: colors.accent },
    dotDeleted:        { backgroundColor: '#F44336' },
    connector:         { position: 'absolute', top: 4, left: '50%', right: 0, height: 2, backgroundColor: '#333' },
    connectorDone:     { backgroundColor: colors.accent },
    milestoneLabel:    { fontSize: 9, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
    milestoneLabelDone:{ color: colors.white },
    milestoneDate:     { fontSize: 9, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 2 },
    card:              { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginTop: SPACING.sm },
    cardTitle:         { color: colors.accent, fontSize: FONT_SIZES.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SPACING.xs },
    cardValue:         { color: colors.white, fontSize: FONT_SIZES.md, fontWeight: '600', marginBottom: 4 },
    cardSub:           { color: 'rgba(255,255,255,0.45)', fontSize: FONT_SIZES.xs, marginTop: 4 },
    badge:             { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, marginBottom: 4 },
    badgeText:         { fontSize: FONT_SIZES.sm, fontWeight: '600' },
    channelRow:        { flexDirection: 'row', gap: 8, marginVertical: 4 },
    channelPill:       { fontSize: FONT_SIZES.sm },
    emailRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    emailStatus:       { fontSize: FONT_SIZES.sm },
    deletionRow:       { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a2a2a' },
    deletionRole:      { color: colors.white, fontSize: FONT_SIZES.sm, fontWeight: '600' },
    deletionReason:    { color: 'rgba(255,255,255,0.6)', fontSize: FONT_SIZES.xs, marginTop: 2 },
  }), [colors]);

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

  const listingTypeForEdit = () => {
    const t = (itemType || '').replace(/s$/, '');
    if (t === 'plate') return 'plate';
    if (t === 'part') return 'parts';
    return t;
  };

  const handleEdit = () => {
    navigation.navigate('EditListing', {
      editMode: true,
      listingType: listingTypeForEdit(),
      listingId: itemId,
    });
  };

  const handleApprove = async () => {
    try {
      await apiClient.post(`/api/admin/approve/${itemType}/${itemId}/approve`);
      Alert.alert('Approved', 'Listing has been approved.');
      navigation.goBack();
    } catch (err) { Alert.alert('Error', err?.message || 'Failed to approve.'); }
  };

  const handleReject = async () => {
    Alert.alert('Reject Listing', 'Select a reason:', [
      ...REJECTION_REASONS.map(reason => ({
        text: reason,
        onPress: async () => {
          try {
            await apiClient.post(`/api/admin/approve/${itemType}/${itemId}/reject`, { rejection_note: reason });
            Alert.alert('Rejected', 'Listing has been rejected.');
            navigation.goBack();
          } catch (err) { Alert.alert('Error', err?.message || 'Failed to reject.'); }
        },
      })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleMarkAsSold = async () => {
    Alert.alert('Mark as Sold', 'Select how this listing sold:', [
      {
        text: 'Sold on DPH',
        onPress: async () => {
          try {
            await apiClient.post(`/api/admin/listings/${itemType}/${itemId}/set-status`, { status: 'sold_on_dph' });
            Alert.alert('Marked Sold', 'Listing marked as sold on DPH.');
            navigation.goBack();
          } catch (err) { Alert.alert('Error', err?.message || 'Failed to mark as sold.'); }
        },
      },
      {
        text: 'Sold elsewhere',
        onPress: async () => {
          try {
            await apiClient.post(`/api/admin/listings/${itemType}/${itemId}/set-status`, { status: 'sold_elsewhere' });
            Alert.alert('Marked Sold', 'Listing marked as sold elsewhere.');
            navigation.goBack();
          } catch (err) { Alert.alert('Error', err?.message || 'Failed to mark as sold.'); }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleVinUnlock = async () => {
    try {
      await apiClient.post(`/api/admin/listings/${itemType}/${itemId}/vin-unlock`, {});
      const data = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
      setDetail(data);
      Alert.alert('VIN unlocked', 'VIN reveal has been unlocked for this listing.');
    } catch (err) {
      Alert.alert('Error', err?.message || 'Failed to unlock VIN.');
    }
  };

  const handleDelete = async () => {
    Alert.alert('Delete', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await apiClient.delete(`/api/admin/listings/${itemId}/delete?type=${encodeURIComponent(itemType)}`);
          navigation.goBack();
        } catch (err) { Alert.alert('Error', err?.message || 'Failed to delete.'); }
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
  const isActive = listing?.status === 'approved' || listing?.status === 'active';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {imageUri && <Image source={{ uri: imageUri }} style={styles.image} />}
        <Text style={styles.title}>{getTitle()}</Text>
        <Text style={styles.price}>
          {isBuyingRequest ? `Budget ${formatPrice(getPrice())}` : formatPrice(getPrice())}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: listing?.status === 'active' ? colors.success : colors.warning }]}>
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
          <View style={lcStyles.card}>
            <Text style={lcStyles.cardTitle}>Lifecycle</Text>
            <LifecycleTimeline listing={listing} lcStyles={lcStyles} />
          </View>
        )}

        <SoldStatusCard listing={listing} lcStyles={lcStyles} />
        <RenewalNudgeCard listing={listing} renewalEmails={detail?.renewal_emails || []} lcStyles={lcStyles} />
        <DeletionTimeline deletionEvents={detail?.deletion_events || []} lcStyles={lcStyles} />

        {!isBuyingRequest && (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.approveBtn} onPress={handleApprove} activeOpacity={0.7}>
              <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
              <Text style={styles.approveBtnText}>Approve</Text>
            </TouchableOpacity>
            {isActive && (
              <TouchableOpacity style={styles.soldBtn} onPress={handleMarkAsSold} activeOpacity={0.7}>
                <Ionicons name="pricetag-outline" size={18} color={colors.white} />
                <Text style={styles.soldBtnText}>Mark as Sold</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.editBtn} onPress={handleEdit} activeOpacity={0.7}>
              <Ionicons name="create-outline" size={18} color={colors.white} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editBtn} onPress={handleVinUnlock} activeOpacity={0.7}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.white} />
              <Text style={styles.editBtnText}>VIN Unlock</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectBtn} onPress={handleReject} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color={colors.error} />
              <Text style={styles.rejectBtnText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

