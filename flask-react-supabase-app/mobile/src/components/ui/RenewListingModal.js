import React, { useState } from 'react';
import { View, Text, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import PressableScale from './PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RenewListingModal({ visible, listingType, listingId, onSuccess, onCancel }) {
  const [loading, setLoading] = useState(false);

  const handleRenew = async () => {
    if (!listingType || !listingId) return;
    setLoading(true);
    try {
      await apiClient.post(`/api/user/listings/${listingType}/${listingId}/outcome`, { outcome: 'renew' });
      showSuccess('Listing renewed', `Active for another 30 days — expires ${addDays(30)}.`);
      onSuccess?.();
    } catch (err) {
      toastApiError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Renew Listing</Text>
          <Text style={styles.body}>
            Your listing will be renewed for another 30 days and will expire on{' '}
            <Text style={styles.date}>{addDays(30)}</Text>.
          </Text>
          <View style={styles.actions}>
            <PressableScale onPress={onCancel} haptic="light" style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </PressableScale>
            <PressableScale onPress={handleRenew} haptic="success" style={styles.renewBtn} disabled={loading}>
              {loading
                ? <ActivityIndicator size="small" color={COLORS.black} />
                : <Text style={styles.renewText}>Renew</Text>}
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, paddingBottom: 40 },
  title: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: COLORS.white, marginBottom: SPACING.sm },
  body: { ...FONTS.regular, fontSize: FONT_SIZES.md, color: COLORS.textSecondary, lineHeight: 22, marginBottom: SPACING.lg },
  date: { ...FONTS.semibold, color: COLORS.accent },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  cancelBtn: { flex: 1, padding: SPACING.md, borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  cancelText: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: COLORS.textSecondary },
  renewBtn: { flex: 1, padding: SPACING.md, borderRadius: BORDER_RADIUS.lg, backgroundColor: COLORS.accent, alignItems: 'center' },
  renewText: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: COLORS.black },
});
