import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { timeAgo } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const InfoRow = ({ icon, label, value, colors, styles }) => {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color={colors.textMuted} style={styles.infoIcon} />
      <View style={styles.infoTextWrap}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
};

export default function AdminDealershipDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const STATUS_COLOR = { active: colors.success, suspended: colors.error };
  const { dealershipId } = route.params;
  const [dealership, setDealership] = useState(undefined); // undefined = loading, null = not found
  const [actionBusy, setActionBusy] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: SPACING.md, paddingBottom: 40 },
    header: { alignItems: 'center', marginBottom: SPACING.lg },
    avatar: { width: 64, height: 64, borderRadius: BORDER_RADIUS.xl, backgroundColor: 'rgba(139,214,180,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
    avatarText: { fontSize: 22, fontWeight: '700', color: colors.accent },
    name: { color: colors.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '700', textAlign: 'center' },
    slug: { color: colors.textMuted, fontSize: FONT_SIZES.xs, fontFamily: 'monospace', marginTop: 4 },
    statusBadge: { marginTop: SPACING.sm, paddingHorizontal: 12, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm },
    statusBadgeText: { color: colors.black, fontSize: FONT_SIZES.xs, fontWeight: '700', textTransform: 'capitalize' },
    section: { marginBottom: SPACING.lg },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
    sectionTitle: { color: colors.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SPACING.sm },
    countPill: { color: colors.textMuted, fontSize: FONT_SIZES.xs, backgroundColor: colors.surfaceHigher, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2 },
    surface: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    infoIcon: { marginTop: 3 },
    infoTextWrap: { flex: 1 },
    infoLabel: { color: colors.textMuted, fontSize: FONT_SIZES.xs, textTransform: 'uppercase' },
    infoValue: { color: colors.textPrimary, fontSize: FONT_SIZES.sm, marginTop: 2 },
    emptyText: { color: colors.textMuted, fontSize: FONT_SIZES.sm, fontStyle: 'italic' },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    memberAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceHigher, alignItems: 'center', justifyContent: 'center' },
    memberAvatarText: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '700' },
    memberInfo: { flex: 1, minWidth: 0 },
    memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    memberName: { color: colors.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600', flexShrink: 1 },
    memberEmail: { color: colors.textMuted, fontSize: FONT_SIZES.xs },
    roleBadge: { backgroundColor: colors.surfaceHigher, borderRadius: BORDER_RADIUS.sm, paddingHorizontal: 6, paddingVertical: 1 },
    roleBadgeOwner: { backgroundColor: 'rgba(255,152,0,0.15)' },
    roleBadgeText: { color: colors.textMuted, fontSize: 9, fontWeight: '700', textTransform: 'capitalize' },
    roleBadgeTextOwner: { color: colors.warning },
    memberJoined: { color: colors.textMuted, fontSize: FONT_SIZES.xs },
    actionRow: {
      flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
      backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm,
    },
    actionRowText: { flex: 1, color: colors.textPrimary, fontSize: FONT_SIZES.sm },
    actionRowChevron: { marginLeft: 'auto' },
    primaryBtn: { backgroundColor: colors.primary, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
    primaryBtnText: { color: colors.accent, fontSize: FONT_SIZES.md, fontWeight: '600' },
    dangerBtn: { backgroundColor: 'rgba(255,59,48,0.1)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
    dangerBtnText: { color: colors.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
  }), [colors]);

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/admin/dealerships/${dealershipId}`);
      setDealership(res?.dealership || null);
    } catch {
      setDealership(null);
    }
  }, [dealershipId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAction = async (action, label) => {
    setActionBusy(true);
    try {
      await apiClient.post(`/api/admin/dealerships/${dealershipId}/${action}`, {});
      await refresh();
    } catch (err) {
      Alert.alert('Error', err.message || `Failed to ${label}.`);
    } finally {
      setActionBusy(false);
    }
  };

  const confirmAction = (action, label) => {
    Alert.alert(`${label} dealership`, `Are you sure you want to ${label.toLowerCase()} this dealership?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, style: action === 'suspend' ? 'destructive' : 'default', onPress: () => handleAction(action, label) },
    ]);
  };

  if (dealership === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner message="Loading dealership..." />
      </SafeAreaView>
    );
  }

  if (dealership === null) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState icon="shield-outline" title="Dealership not found" message="This dealership may have been removed." />
      </SafeAreaView>
    );
  }

  const d = dealership;
  const ownerMember = (d.members || []).find((m) => m.role === 'owner');
  const ownerEmail = ownerMember?.user?.email || '—';
  const initial = (d.name || '?').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name}>{d.name}</Text>
          <Text style={styles.slug}>{d.slug || '—'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[d.status] || colors.warning }]}>
            <Text style={styles.statusBadgeText}>{d.status || '—'}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile</Text>
          <View style={styles.surface}>
            <InfoRow icon="call-outline" label="Phone" value={d.phone} colors={colors} styles={styles} />
            <InfoRow icon="logo-whatsapp" label="WhatsApp" value={d.whatsapp} colors={colors} styles={styles} />
            <InfoRow icon="globe-outline" label="Website" value={d.website} colors={colors} styles={styles} />
            <InfoRow icon="location-outline" label="Emirate" value={d.emirate} colors={colors} styles={styles} />
            <InfoRow icon="location-outline" label="Address" value={d.address} colors={colors} styles={styles} />
            <InfoRow icon="document-text-outline" label="Trade License" value={d.trade_license_no} colors={colors} styles={styles} />
            <InfoRow icon="business-outline" label="Owner Email" value={ownerEmail} colors={colors} styles={styles} />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Members</Text>
            {d.members?.length > 0 && <Text style={styles.countPill}>{d.members.length}</Text>}
          </View>
          <View style={styles.surface}>
            {(!d.members || d.members.length === 0) ? (
              <Text style={styles.emptyText}>No members found.</Text>
            ) : (
              d.members.map((m) => {
                const fullName = [m.user?.first_name, m.user?.last_name].filter(Boolean).join(' ') || m.user?.email || '—';
                return (
                  <View key={m.id} style={styles.memberRow}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>{(m.user?.first_name || m.user?.email || '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <View style={styles.memberNameRow}>
                        <Text style={styles.memberName} numberOfLines={1}>{fullName}</Text>
                        <View style={[styles.roleBadge, m.role === 'owner' && styles.roleBadgeOwner]}>
                          <Text style={[styles.roleBadgeText, m.role === 'owner' && styles.roleBadgeTextOwner]}>{m.role || '—'}</Text>
                        </View>
                      </View>
                      <Text style={styles.memberEmail} numberOfLines={1}>{m.user?.email || '—'}</Text>
                    </View>
                    <Text style={styles.memberJoined}>{timeAgo(m.joined_at)}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => navigation.navigate('AdminDealerAuditLog', { dealershipId: d.id })}
            activeOpacity={0.7}
          >
            <Ionicons name="clipboard-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.actionRowText}>View audit log for this dealership</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={styles.actionRowChevron} />
          </TouchableOpacity>

          {ownerMember?.user?.id && (
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => navigation.navigate('AdminDealerDetail', { dealerId: ownerMember.user.id })}
              activeOpacity={0.7}
            >
              <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.actionRowText}>Review owner documents and request more info</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={styles.actionRowChevron} />
            </TouchableOpacity>
          )}

          {d.status === 'suspended' ? (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => confirmAction('restore', 'Restore')}
              disabled={actionBusy}
              activeOpacity={0.7}
            >
              <Text style={styles.primaryBtnText}>{actionBusy ? 'Working…' : 'Restore dealership'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={() => confirmAction('suspend', 'Suspend')}
              disabled={actionBusy}
              activeOpacity={0.7}
            >
              <Text style={styles.dangerBtnText}>{actionBusy ? 'Working…' : 'Suspend dealership'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

