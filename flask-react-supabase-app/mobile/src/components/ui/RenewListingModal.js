import React, { useMemo, useState } from 'react';
import { View, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import Text from './AppText';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import PressableScale from './PressableScale';
import { SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RenewListingModal({ visible, listingType, listingId, onSuccess, onCancel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, paddingBottom: 40 },
    title: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: colors.textPrimary, marginBottom: SPACING.sm },
    body: { ...FONTS.regular, fontSize: FONT_SIZES.md, color: colors.textSecondary, lineHeight: 22, marginBottom: SPACING.lg },
    date: { ...FONTS.semibold, color: colors.accent },
    actions: { flexDirection: 'row', gap: SPACING.sm },
    cancelBtn: { flex: 1, padding: SPACING.md, borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    cancelText: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: colors.textSecondary },
    renewBtn: { flex: 1, padding: SPACING.md, borderRadius: BORDER_RADIUS.lg, backgroundColor: colors.accent, alignItems: 'center' },
    renewText: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: colors.black },
  }), [colors]);

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
                ? <ActivityIndicator size="small" color={colors.black} />
                : <Text style={styles.renewText}>Renew</Text>}
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}
