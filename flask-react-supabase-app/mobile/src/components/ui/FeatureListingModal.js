import React, { useState } from 'react';
import { View, Modal, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import Text from './AppText';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';

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
  const [duration, setDuration] = useState(7);
  // ponytail: plain "YYYY-MM-DD HH:mm" text field instead of a native date
  // picker dependency — duration presets cover the common case, this is the
  // rare exact-date override. Add @react-native-community/datetimepicker if
  // admins start using this a lot.
  const [customDate, setCustomDate] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setDuration(7); setCustomDate(''); setNote(''); };

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
              placeholderTextColor={COLORS.textMuted}
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
              placeholderTextColor={COLORS.textMuted}
            />

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { reset(); onClose?.(); }} disabled={submitting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
                {submitting
                  ? <ActivityIndicator size="small" color={COLORS.black} />
                  : <Text style={styles.submitText}>Feature listing</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center' },
  sheetWrap: { flexGrow: 1, justifyContent: 'center', padding: SPACING.lg },
  sheet: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: COLORS.white, marginBottom: SPACING.md },
  listingCard: { backgroundColor: COLORS.surfaceVariant, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  listingType: { ...FONTS.label, fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase' },
  listingTitle: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: COLORS.white, marginTop: 2 },
  listingId: { ...FONTS.regular, fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  label: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary, marginBottom: 6 },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.md },
  presetChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, backgroundColor: COLORS.surfaceHigher, borderWidth: 1, borderColor: COLORS.border },
  presetChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  presetChipText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: COLORS.textSecondary },
  presetChipTextActive: { color: COLORS.black },
  input: {
    backgroundColor: COLORS.surfaceHigher, borderRadius: BORDER_RADIUS.md, paddingHorizontal: 12, paddingVertical: 10,
    color: COLORS.white, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  cancelText: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: COLORS.textSecondary },
  submitBtn: { flex: 1.4, paddingVertical: 14, borderRadius: BORDER_RADIUS.lg, backgroundColor: COLORS.accent, alignItems: 'center' },
  submitText: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: COLORS.black },
});
