import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

export default function AdminDealerDetailScreen({ route, navigation }) {
  const { dealerId } = route.params;
  const [dealer, setDealer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadDealer(); }, []);

  const loadDealer = async () => {
    try {
      const data = await apiClient.get(`/api/admin/dealers/${dealerId}/overview`);
      setDealer(data);
    } catch (err) {
      Alert.alert('Error', 'Failed to load dealer.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    try {
      await apiClient.post(`/api/admin/dealers/${dealerId}/verify`);
      Alert.alert('Verified', 'Dealer has been verified.');
      loadDealer();
    } catch (err) { Alert.alert('Error', err.message); }
  };

  const handleReject = async () => {
    try {
      await apiClient.post(`/api/admin/dealers/${dealerId}/reject`);
      Alert.alert('Rejected', 'Dealer has been rejected.');
      loadDealer();
    } catch (err) { Alert.alert('Error', err.message); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading dealer...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.name}>{dealer?.company_name || dealer?.business_name || 'Dealer'}</Text>
        <View style={[styles.verificationBadge, { backgroundColor: dealer?.verification_status === 'verified' || dealer?.dealer_verified ? COLORS.success : COLORS.warning }]}>
          <Text style={styles.verificationText}>
            {dealer?.verification_status || (dealer?.dealer_verified ? 'verified' : 'pending')}
          </Text>
        </View>
        <Text style={styles.detail}>User: {dealer?.user_email || dealer?.email || 'N/A'}</Text>
        <Text style={styles.detail}>Listings: {dealer?.listing_count || 0}</Text>
        {dealer?.created_at && (
          <Text style={styles.detail}>Joined: {formatDate(dealer.created_at)}</Text>
        )}

        <View style={styles.actions}>
          {!dealer?.dealer_verified && dealer?.verification_status !== 'verified' && (
            <>
              <TouchableOpacity style={styles.approveBtn} onPress={handleVerify} activeOpacity={0.7}>
                <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
                <Text style={styles.approveBtnText}>Verify</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rejectBtn} onPress={handleReject} activeOpacity={0.7}>
                <Ionicons name="close-circle" size={18} color={COLORS.error} />
                <Text style={styles.rejectBtnText}>Reject</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md },
  content: { padding: SPACING.md },
  name: { color: COLORS.white, fontSize: FONT_SIZES.xl, fontWeight: '700', marginBottom: SPACING.sm },
  verificationBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, marginBottom: SPACING.sm },
  verificationText: { color: COLORS.white, fontSize: FONT_SIZES.xs, fontWeight: '600', textTransform: 'capitalize' },
  detail: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, marginBottom: 4 },
  actions: { gap: SPACING.sm, marginTop: SPACING.lg },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
  approveBtnText: { color: COLORS.accent, fontSize: FONT_SIZES.md, fontWeight: '600' },
  rejectBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
  rejectBtnText: { color: COLORS.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
});
