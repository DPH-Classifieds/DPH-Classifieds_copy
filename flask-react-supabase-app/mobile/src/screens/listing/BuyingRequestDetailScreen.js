import React, { useState, useEffect, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Linking, ActivityIndicator, Alert } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { toastApiError } from '../../utils/toast';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { formatPrice } from '../../utils/formatters';
import { trackLeadEvent } from '../../utils/leadTracking';

export default function BuyingRequestDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const { requestId } = route.params;
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: SPACING.md, paddingBottom: 40 },
    categoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
    badge: { backgroundColor: colors.primary, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 12, paddingVertical: 4 },
    badgeText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: colors.chipActiveText },
    date: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: colors.textMuted },
    title: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: colors.textPrimary, marginBottom: SPACING.sm },
    description: { ...FONTS.regular, fontSize: FONT_SIZES.md, color: colors.textSecondary, lineHeight: 22, marginBottom: SPACING.md },
    specsCard: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: colors.borderLight },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    rowLabel: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: colors.textMuted },
    rowValue: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: colors.textPrimary },
    actions: { flexDirection: 'row', gap: SPACING.sm },
    actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14 },
    whatsappBtn: { backgroundColor: '#25D366' },
    callBtn: { backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.accent },
    actionBtnText: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: '#fff' },
  }), [colors]);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiClient.get(`/api/buying-requests/${requestId}`);
        setRequest(data?.request || data);
      } catch (err) {
        toastApiError(err);
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [requestId]);

  const handleWhatsApp = async () => {
    if (!request) return;
    try {
      const data = await apiClient.post(`/api/buying-requests/${requestId}/reveal-whatsapp`, {});
      const phone = data?.whatsapp_number || request.contact_phone;
      if (phone) {
        await trackLeadEvent('buying_request', requestId, 'whatsapp_click');
        Linking.openURL(`https://wa.me/${phone.replace(/\D/g, '')}`);
      }
    } catch (err) {
      toastApiError(err);
    }
  };

  const handleCall = async () => {
    if (!request?.contact_phone) return;
    await trackLeadEvent('buying_request', requestId, 'call_click');
    Linking.openURL(`tel:${request.contact_phone}`).catch(() => Alert.alert('Call failed', 'Unable to open the phone dialer.'));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator color={colors.accent} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!request) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.categoryRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{request.category || 'Any category'}</Text>
            </View>
            <Text style={styles.date}>{request.created_at ? new Date(request.created_at).toLocaleDateString() : ''}</Text>
          </View>

          <Text style={styles.title}>{request.title || request.description}</Text>

          {request.description && request.title && (
            <Text style={styles.description}>{request.description}</Text>
          )}

          <View style={styles.specsCard}>
            {request.make && (
              <Row styles={styles} label="Make/Model" value={`${request.make}${request.model ? ` ${request.model}` : ''}`} />
            )}
            {(request.budget_min || request.budget_max) && (
              <Row styles={styles} label="Budget" value={`${request.budget_min ? formatPrice(request.budget_min) : '—'} – ${request.budget_max ? formatPrice(request.budget_max) : 'Open'}`} />
            )}
            {request.year_from && (
              <Row styles={styles} label="Year" value={`${request.year_from}${request.year_to ? ` – ${request.year_to}` : '+'}`} />
            )}
          </View>

          <View style={styles.actions}>
            <PressableScale onPress={handleWhatsApp} haptic="medium" style={[styles.actionBtn, styles.whatsappBtn]}>
              <Ionicons name="logo-whatsapp" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>WhatsApp</Text>
            </PressableScale>
            {request.contact_phone && (
              <PressableScale onPress={handleCall} haptic="medium" style={[styles.actionBtn, styles.callBtn]}>
                <Ionicons name="call" size={20} color="#fff" />
                <Text style={styles.actionBtnText}>Call</Text>
              </PressableScale>
            )}
          </View>
        </ScrollView>
      </ScreenEntrance>
    </SafeAreaView>
  );
}

function Row({ label, value, styles }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}
