import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

export default function AdminMetricsScreen() {
  const [metrics, setMetrics] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadMetrics(); }, []);

  const loadMetrics = async () => {
    try {
      const [metricsData, healthData] = await Promise.all([
        apiClient.get('/api/admin/metrics/overview?days=30'),
        apiClient.get('/api/admin/health'),
      ]);
      setMetrics(metricsData);
      setHealth(healthData);
    } catch (err) { /* silent */ }
    finally { setLoading(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading metrics...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Platform Health</Text>
        <View style={styles.healthCard}>
          <Ionicons
            name={health?.status === 'healthy' ? 'checkmark-circle' : 'warning'}
            size={20}
            color={health?.status === 'healthy' ? COLORS.success : COLORS.error}
          />
          <View style={styles.healthInfo}>
            <Text style={styles.healthLabel}>Status</Text>
            <Text style={[styles.healthValue, { color: health?.status === 'healthy' ? COLORS.success : COLORS.error }]}>
              {health?.status || 'Unknown'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>30-Day Metrics</Text>
        <View style={styles.grid}>
          {metrics && Object.entries(metrics).map(([key, value]) => (
            <View key={key} style={styles.metricCard}>
              <Text style={styles.metricLabel}>{key.replace(/_/g, ' ')}</Text>
              <Text style={styles.metricValue}>{typeof value === 'number' ? value.toLocaleString() : String(value)}</Text>
            </View>
          ))}
          {!metrics && (
            <Text style={styles.emptyText}>No metrics data available.</Text>
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
  sectionTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginBottom: SPACING.sm, marginTop: SPACING.md },
  healthCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, gap: 12 },
  healthInfo: { flex: 1 },
  healthLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  healthValue: { fontSize: FONT_SIZES.xl, fontWeight: '700', marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, width: '47%' },
  metricLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, textTransform: 'capitalize' },
  metricValue: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', marginTop: 4 },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
});
