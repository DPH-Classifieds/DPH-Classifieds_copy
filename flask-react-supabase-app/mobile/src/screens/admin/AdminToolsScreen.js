import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

function ToolCard({ icon, title, description, running, onRun, runLabel = 'Run', toast, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={22} color={COLORS.textMuted} />
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardDescription}>{description}</Text>
        </View>
      </View>
      {children}
      {toast && (
        <Text style={[styles.toast, toast.type === 'error' && styles.toastError]}>{toast.msg}</Text>
      )}
      {onRun && (
        <TouchableOpacity style={styles.runBtn} onPress={onRun} disabled={running} activeOpacity={0.7}>
          {running ? <ActivityIndicator size="small" color={COLORS.black} /> : <Text style={styles.runBtnText}>{runLabel}</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function AdminToolsScreen() {
  const [arEnabled, setArEnabled] = useState(null);
  const [arToggleLoading, setArToggleLoading] = useState(false);
  const [autoReviewRunning, setAutoReviewRunning] = useState(false);
  const [autoReviewToast, setAutoReviewToast] = useState(null);
  const [flushRunning, setFlushRunning] = useState(false);
  const [flushToast, setFlushToast] = useState(null);

  useEffect(() => {
    apiClient.get('/api/admin/auto-review/settings')
      .then((data) => setArEnabled(Boolean(data?.enabled)))
      .catch(() => setArEnabled(false));
  }, []);

  const toggleAutoReview = useCallback(async () => {
    const newVal = !arEnabled;
    setArEnabled(newVal);
    setArToggleLoading(true);
    try {
      const res = await apiClient.patch('/api/admin/auto-review/settings', { enabled: newVal });
      setArEnabled(Boolean(res?.enabled));
    } catch (err) {
      setArEnabled(!newVal);
      setAutoReviewToast({ type: 'error', msg: `Failed: ${err.message || 'Unknown error'}` });
    } finally {
      setArToggleLoading(false);
    }
  }, [arEnabled]);

  const runAutoReview = useCallback(async () => {
    setAutoReviewRunning(true);
    setAutoReviewToast(null);
    try {
      const res = await apiClient.post('/api/admin/auto-review/run');
      setAutoReviewToast({ type: 'success', msg: `Done — ${res?.processed ?? 0} listing(s) reviewed.` });
    } catch (err) {
      setAutoReviewToast({ type: 'error', msg: `Failed: ${err.message || 'Unknown error'}` });
    } finally {
      setAutoReviewRunning(false);
    }
  }, []);

  const flushCache = useCallback(async () => {
    setFlushRunning(true);
    setFlushToast(null);
    try {
      const res = await apiClient.post('/api/admin/cache/flush', {});
      setFlushToast({ type: 'success', msg: `Flushed ${(res?.flushed || []).join(', ') || 'cache'}.` });
    } catch (err) {
      setFlushToast({ type: 'error', msg: `Failed: ${err.message || 'Unknown error'}` });
    } finally {
      setFlushRunning(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Auto Review</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="hardware-chip-outline" size={22} color={COLORS.textMuted} />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Auto-approve toggle</Text>
              <Text style={styles.cardDescription}>
                When on, new listings go to auto-review and approve instantly if they pass. When off, everything goes to the manual pending queue.
              </Text>
            </View>
          </View>
          <View style={styles.toggleRow}>
            <Switch
              value={Boolean(arEnabled)}
              onValueChange={toggleAutoReview}
              disabled={arEnabled === null || arToggleLoading}
            />
            <Text style={styles.toggleLabel}>
              {arEnabled === null ? 'Loading…' : arEnabled ? 'Enabled' : 'Disabled'}
              {arToggleLoading ? ' · Saving…' : ''}
            </Text>
          </View>
        </View>

        <ToolCard
          icon="play-outline"
          title="Run auto-review now"
          description="Process all pending_auto_review listings immediately — useful to clear the backlog or after toggling the feature on."
          running={autoReviewRunning}
          onRun={runAutoReview}
          runLabel="Run now"
          toast={autoReviewToast}
        />

        <Text style={styles.sectionLabel}>Cache</Text>
        <ToolCard
          icon="flash-outline"
          title="Flush listing cache"
          description="Clears Redis and in-memory caches for all public listing endpoints (cars, bikes, parts, plates). Use this if the live site shows stale results after approving listings."
          running={flushRunning}
          onRun={flushCache}
          runLabel="Flush cache"
          toast={flushToast}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: SPACING.md, paddingBottom: 40 },
  sectionLabel: { fontSize: FONT_SIZES.xs, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: SPACING.md, marginBottom: SPACING.sm },
  card: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
  cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.white },
  cardDescription: { fontSize: FONT_SIZES.xs, color: COLORS.textSecondary, marginTop: 4, lineHeight: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SPACING.sm },
  toggleLabel: { fontSize: FONT_SIZES.sm, color: COLORS.textSecondary, fontWeight: '500' },
  toast: { fontSize: FONT_SIZES.xs, color: '#4CAF50', marginTop: SPACING.sm },
  toastError: { color: COLORS.error },
  runBtn: { marginTop: SPACING.sm, alignSelf: 'flex-start', backgroundColor: COLORS.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 18, paddingVertical: 10 },
  runBtnText: { color: COLORS.black, fontWeight: '700', fontSize: FONT_SIZES.sm },
});
