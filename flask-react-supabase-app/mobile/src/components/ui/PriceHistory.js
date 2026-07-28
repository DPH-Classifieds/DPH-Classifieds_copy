import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatPrice } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

// Compact price-analysis card. Only renders when a listing has actually changed
// price (more than one point); otherwise it stays out of the way. Data comes
// from /api/<type>/<id>/price-history (falls back to current price server-side).
export default function PriceHistory({ listingType, listingId }) {
  const [analysis, setAnalysis] = useState(null);
  const [points, setPoints] = useState([]);

  useEffect(() => {
    if (!listingType || !listingId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiClient.get(`/api/${listingType}/${listingId}/price-history`);
        if (cancelled) return;
        setAnalysis(data?.analysis || null);
        setPoints(Array.isArray(data?.points) ? data.points : []);
      } catch {
        /* price history is non-critical — stay silent */
      }
    })();
    return () => { cancelled = true; };
  }, [listingType, listingId]);

  if (!analysis || analysis.points < 2) return null;

  const dropped = analysis.change < 0;
  const flat = analysis.change === 0;
  const changeColor = flat ? COLORS.textSecondary : dropped ? '#22c55e' : '#ef4444';
  const changeIcon = flat ? 'remove' : dropped ? 'arrow-down' : 'arrow-up';

  // Normalise bar heights across the observed range.
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const barHeight = (v) => 12 + ((v - min) / span) * 40; // 12–52px

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="trending-down" size={16} color={COLORS.accent} />
        <Text style={styles.title}>Price History</Text>
      </View>

      <View style={styles.summaryRow}>
        <View>
          <Text style={styles.currentLabel}>Current</Text>
          <Text style={styles.current}>{formatPrice(analysis.current)}</Text>
        </View>
        <View style={[styles.changeBadge, { backgroundColor: changeColor + '22' }]}>
          <Ionicons name={changeIcon} size={14} color={changeColor} />
          <Text style={[styles.changeText, { color: changeColor }]}>
            {formatPrice(Math.abs(analysis.change))} ({Math.abs(analysis.change_pct)}%)
          </Text>
        </View>
      </View>

      <View style={styles.sparkline}>
        {points.map((p, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: barHeight(p.price) },
              i === points.length - 1 && styles.barActive,
            ]}
          />
        ))}
      </View>

      <View style={styles.rangeRow}>
        <Text style={styles.rangeText}>Listed at {formatPrice(analysis.first)}</Text>
        <Text style={styles.rangeText}>
          Low {formatPrice(analysis.min)} · High {formatPrice(analysis.max)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  title: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  currentLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginBottom: 2 },
  current: { color: COLORS.white, fontSize: FONT_SIZES.xl, fontWeight: '800' },
  changeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: BORDER_RADIUS.pill },
  changeText: { fontSize: FONT_SIZES.sm, fontWeight: '700' },
  sparkline: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 52, marginBottom: 10 },
  bar: { flex: 1, backgroundColor: COLORS.border, borderRadius: 3, minWidth: 4 },
  barActive: { backgroundColor: COLORS.accent },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
});
