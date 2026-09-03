import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const FIXED_STATUS_COLORS = {
  quoted: '#9c27b0',
  test_drive: '#00bcd4',
};

const TIMELINE_ICON = {
  note: 'chatbox-ellipses-outline',
  status_change: 'swap-horizontal-outline',
  assignment: 'person-add-outline',
  inbound_contact: 'call-outline',
};

const timelineText = (entry) => {
  const p = entry.payload || {};
  if (entry.kind === 'note') return p.body || 'Note added';
  if (entry.kind === 'status_change') return `Status: ${p.from || '—'} → ${p.to || '—'}`;
  if (entry.kind === 'assignment') return `Assigned${p.to ? ` to ${p.to}` : ''}`;
  if (entry.kind === 'inbound_contact') return `Buyer ${p.action || 'made contact'}`;
  return entry.kind;
};

function Field({ label, value, styles }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

export default function DealerLeadDetailScreen({ route }) {
  const { colors } = useTheme();
  const STATUS_COLORS = useMemo(() => ({
    new: colors.info,
    contacted: colors.warning,
    quoted: FIXED_STATUS_COLORS.quoted,
    test_drive: FIXED_STATUS_COLORS.test_drive,
    won: colors.success,
    lost: colors.error,
  }), [colors]);
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.black },
    scrollContent: { padding: SPACING.md, paddingBottom: 40 },
    headerCard: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md },
    statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginBottom: SPACING.sm },
    statusText: { fontSize: FONT_SIZES.xs, fontWeight: '700', textTransform: 'capitalize' },
    listingTitle: { color: colors.white, fontSize: FONT_SIZES.lg, fontWeight: '700' },
    listingPrice: { color: colors.accent, fontSize: FONT_SIZES.md, fontWeight: '700', marginTop: 4 },
    surface: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md },
    field: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight, gap: 12 },
    fieldLabel: { color: colors.textMuted, fontSize: FONT_SIZES.sm },
    fieldValue: { color: colors.white, fontSize: FONT_SIZES.sm, fontWeight: '600', flexShrink: 1, textAlign: 'right', textTransform: 'capitalize' },
    sectionTitle: { color: colors.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: SPACING.sm },
    timelineRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight },
    timelineBody: { flex: 1 },
    timelineText: { color: colors.white, fontSize: FONT_SIZES.sm },
    timelineDate: { color: colors.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
    emptyText: { color: colors.textMuted, fontSize: FONT_SIZES.sm, textAlign: 'center', paddingVertical: 12 },
    footNote: { color: colors.textMuted, fontSize: FONT_SIZES.xs, textAlign: 'center', marginTop: SPACING.sm },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
    errorText: { color: colors.textSecondary, fontSize: FONT_SIZES.md, marginTop: 12, textAlign: 'center' },
    retryBtn: { marginTop: 16, backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
    retryText: { color: colors.background, fontWeight: '600' },
  }), [colors]);

  const leadId = route.params?.leadId;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await apiClient.get(`/api/dealer/leads/${leadId}`);
      setData(res);
    } catch (err) {
      setError(err.status === 404 ? 'Lead not found.' : (err.message || 'Failed to load lead'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner message="Loading lead..." />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={40} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const lead = data?.lead || {};
  const listing = data?.listing || null;
  const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
  const color = STATUS_COLORS[lead.status] || colors.textMuted;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={styles.headerCard}>
          <View style={[styles.statusBadge, { backgroundColor: `${color}22` }]}>
            <Text style={[styles.statusText, { color }]}>{lead.status || 'new'}</Text>
          </View>
          {listing && (
            <>
              <Text style={styles.listingTitle} numberOfLines={2}>{listing.title || 'Listing'}</Text>
              {listing.price != null && <Text style={styles.listingPrice}>AED {Number(listing.price).toLocaleString()}</Text>}
            </>
          )}
        </View>

        <View style={styles.surface}>
          <Field label="Source" value={lead.source} styles={styles} />
          <Field label="Interactions" value={lead.event_count != null ? String(lead.event_count) : null} styles={styles} />
          <Field label="Contact name" value={lead.contact_name} styles={styles} />
          <Field label="Contact phone" value={lead.contact_phone} styles={styles} />
          <Field label="Sale price" value={lead.sale_price != null ? `AED ${Number(lead.sale_price).toLocaleString()}` : null} styles={styles} />
          <Field label="Lost reason" value={lead.lost_reason} styles={styles} />
          <Field label="First seen" value={lead.first_event_at ? formatDate(lead.first_event_at) : null} styles={styles} />
          <Field label="Last activity" value={lead.last_event_at ? formatDate(lead.last_event_at) : null} styles={styles} />
        </View>

        <Text style={styles.sectionTitle}>Timeline</Text>
        <View style={styles.surface}>
          {timeline.length === 0 ? (
            <Text style={styles.emptyText}>No activity recorded yet.</Text>
          ) : (
            timeline.map((entry) => (
              <View key={entry.id} style={styles.timelineRow}>
                <Ionicons name={TIMELINE_ICON[entry.kind] || 'ellipse-outline'} size={16} color={colors.accent} style={{ marginTop: 2 }} />
                <View style={styles.timelineBody}>
                  <Text style={styles.timelineText}>{timelineText(entry)}</Text>
                  <Text style={styles.timelineDate}>{entry.created_at ? formatDate(entry.created_at) : ''}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <Text style={styles.footNote}>Update lead status, assign reps and add notes on the web dashboard.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
