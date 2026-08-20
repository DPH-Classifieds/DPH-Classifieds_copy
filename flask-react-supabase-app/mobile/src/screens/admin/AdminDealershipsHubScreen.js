import React, { useCallback, useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import AdminDealersScreen from './AdminDealersScreen';
import AdminDealerUpgradeRequestsScreen from './AdminDealerUpgradeRequestsScreen';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';

const TABS = [
  { key: 'dealers', label: 'Dealers' },
  { key: 'limits', label: 'Limit requests' },
];

// Mirrors frontend/src/components/admin/AdminDealershipsHub.jsx — "Dealer"
// and "Dealership" used to be two separate admin tabs but admins only ever
// think of them as one thing, so this is now just Dealers (pending/approved/
// all) plus limit requests. Featured listings has its own top-level nav
// entry and isn't duplicated here.
export default function AdminDealershipsHubScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('dealers');
  const [pendingLimits, setPendingLimits] = useState(null);

  const refreshCounts = useCallback(async () => {
    try {
      const limits = await apiClient.get('/api/admin/dealer/listing-upgrade-requests?status=pending');
      setPendingLimits(Array.isArray(limits) ? limits.length : null);
    } catch {
      // Non-fatal — count stays null and just doesn't render a badge.
    }
  }, []);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = activeTab === t.key;
          const badge = t.key === 'limits' ? pendingLimits : null;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(t.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{t.label}</Text>
              {!!badge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'dealers' && (
        <View style={styles.flex}>
          <AdminDealersScreen navigation={navigation} />
        </View>
      )}
      {activeTab === 'limits' && (
        <AdminDealerUpgradeRequestsScreen onResolved={refreshCounts} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  flex: { flex: 1 },
  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.borderLight,
    paddingHorizontal: SPACING.sm,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: COLORS.accent },
  tabText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: COLORS.textSecondary },
  tabTextActive: { color: COLORS.white },
  badge: { backgroundColor: 'rgba(255,152,0,0.2)', borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { ...FONTS.bold, fontSize: 10, color: COLORS.warning },
});
