import React, { useMemo, useState } from 'react';
import { View, Modal, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Switch, StyleSheet } from 'react-native';
import Text from './AppText';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import { SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const TYPE_LABELS = { car: 'Car', bike: 'Bike', plate: 'Plate', part: 'Part' };

const DURATION_PRESETS = [
  { label: '24 hours', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'Until removed', days: null },
];

// Mirrors frontend/src/components/admin/FeatureListingModal.jsx. The listing
// is already known (picked via ListingPickerModal, or the row an admin is
// already looking at) — this only collects duration + an optional note.
export default function FeatureListingModal({ visible, listingType, listingId, title, onClose, onCreated }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center' },
    sheetWrap: { flexGrow: 1, justifyContent: 'center', padding: SPACING.lg },
    sheet: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.lg, borderWidth: 1, borderColor: colors.border },
    title: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: colors.white, marginBottom: SPACING.md },
    listingCard: { backgroundColor: colors.surfaceVariant, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.md, borderWidth: 1, borderColor: colors.border },
    listingType: { ...FONTS.label, fontSize: 10, color: colors.textMuted, textTransform: 'uppercase' },
    listingTitle: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: colors.white, marginTop: 2 },
    listingId: { ...FONTS.regular, fontSize: 11, color: colors.textMuted, marginTop: 2 },
    label: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: colors.textSecondary, marginBottom: 6 },
    presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.md },
    presetChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, backgroundColor: colors.surfaceHigher, borderWidth: 1, borderColor: colors.border },
    presetChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    presetChipText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: colors.textSecondary },
    presetChipTextActive: { color: colors.black },
    input: {
      backgroundColor: colors.surfaceHigher, borderRadius: BORDER_RADIUS.md, paddingHorizontal: 12, paddingVertical: 10,
      color: colors.white, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md, borderWidth: 1, borderColor: colors.border,
    },
    highlightRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
    highlightTextWrap: { flex: 1 },
    highlightHint: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: colors.textMuted, marginTop: 2 },
    actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
    cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    cancelText: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: colors.textSecondary },
    submitBtn: { flex: 1.4, paddingVertical: 14, borderRadius: BORDER_RADIUS.lg, backgroundColor: colors.accent, alignItems: 'center' },
    submitText: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: colors.black },
  }), [colors]);

  const [duration, setDuration] = useState(7);
  // ponytail: plain "YYYY-MM-DD HH:mm" text field instead of a native date
  // picker dependency — duration presets cover the common case, this is the
  // rare exact-date override. Add @react-native-community/datetimepicker if
  // admins start using this a lot.
  const [customDate, setCustomDate] = useState('');
  const [note, setNote] = useState('');
  const [highlight, setHighlight] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setDuration(7); setCustomDate(''); setNote(''); setHighlight(true); };

  const submit = async () => {
    let featuredUntil = null;
    if (customDate.trim()) {
      const parsed = new Date(customDate.trim().replace(' ', 'T'));
      if (Number.isNaN(parsed.getTime())) {
        toastApiError({ status: 400, data: { error: 'Custom date must look like 2026-08-20 14:00' } });
        return;
      }
      featuredUntil = parsed.toISOString();
    } else if (duration) {
      const d = new Date();
      d.setDate(d.getDate() + Number(duration));
      featuredUntil = d.toISOString();
    }
    setSubmitting(true);
    try {
      const data = await apiClient.post('/api/admin/featured-listings', {
        listing_type: listingType,
        listing_id: listingId,
        featured_until: featuredUntil,
        note: note.trim() || undefined,
        highlight,
      });
      showSuccess('Listing featured', title || 'Listing is now featured.');
      reset();
      onCreated?.(data);
    } catch (err) {
      toastApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.sheetWrap} keyboardShouldPersistTaps="handled">
          <View style={styles.sheet}>
            <Text style={styles.title}>Feature listing</Text>
            <View style={styles.listingCard}>
              <Text style={styles.listingType}>{TYPE_LABELS[listingType] || listingType}</Text>
              <Text style={styles.listingTitle} numberOfLines={1}>{title}</Text>
              <Text style={styles.listingId} numberOfLines={1}>{listingId}</Text>
            </View>

            <Text style={styles.label}>Duration</Text>
            <View style={styles.presetGrid}>
              {DURATION_PRESETS.map((d) => {
                const active = customDate.trim() === '' && duration === d.days;
                return (
                  <TouchableOpacity
                    key={d.label}
                    style={[styles.presetChip, active && styles.presetChipActive]}
                    onPress={() => { setDuration(d.days); setCustomDate(''); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Or custom date (YYYY-MM-DD HH:mm)</Text>
            <TextInput
              style={styles.input}
              value={customDate}
              onChangeText={setCustomDate}
              placeholder="2026-09-01 12:00"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              maxLength={200}
              placeholder="e.g. homepage spotlight for launch week"
              placeholderTextColor={colors.textMuted}
            />

            <View style={styles.highlightRow}>
              <View style={styles.highlightTextWrap}>
                <Text style={styles.label}>Highlight</Text>
                <Text style={styles.highlightHint}>
                  {highlight
                    ? 'Yellow border + "Featured" tag on the card.'
                    : 'Silent boost — placed early, looks like a normal listing.'}
                </Text>
              </View>
              <Switch value={highlight} onValueChange={setHighlight} />
            </View>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { reset(); onClose?.(); }} disabled={submitting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
                {submitting
                  ? <ActivityIndicator size="small" color={colors.black} />
                  : <Text style={styles.submitText}>Feature listing</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
