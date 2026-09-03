import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

function ToolCard({ icon, title, description, running, onRun, runLabel = 'Run', toast, children, colors, styles }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={22} color={colors.textMuted} />
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
          {running ? <ActivityIndicator size="small" color={colors.black} /> : <Text style={styles.runBtnText}>{runLabel}</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function AdminToolsScreen() {
  const { colors } = useTheme();
  const [arEnabled, setArEnabled] = useState(null);
  const [arToggleLoading, setArToggleLoading] = useState(false);
  const [autoReviewRunning, setAutoReviewRunning] = useState(false);
  const [autoReviewToast, setAutoReviewToast] = useState(null);
  const [flushRunning, setFlushRunning] = useState(false);
  const [flushToast, setFlushToast] = useState(null);
  const [roeEnabled, setRoeEnabled] = useState(null);
  const [roeToggleLoading, setRoeToggleLoading] = useState(false);
  const [roeToast, setRoeToast] = useState(null);
  const [redditEnabled, setRedditEnabled] = useState(null);
  const [redditToggleLoading, setRedditToggleLoading] = useState(false);
  const [redditToast, setRedditToast] = useState(null);
  const [googleEnabled, setGoogleEnabled] = useState(null);
  const [googleToggleLoading, setGoogleToggleLoading] = useState(false);
  const [googleToast, setGoogleToast] = useState(null);

  useEffect(() => {
    apiClient.get('/api/admin/auto-review/settings')
      .then((data) => setArEnabled(Boolean(data?.enabled)))
      .catch(() => setArEnabled(false));
  }, []);

  useEffect(() => {
    apiClient.get('/api/admin/reddit-explore/settings')
      .then((data) => setRoeEnabled(Boolean(data?.enabled)))
      .catch(() => setRoeEnabled(false));
  }, []);

  useEffect(() => {
    apiClient.get('/api/admin/reddit-listings/settings')
      .then((data) => setRedditEnabled(Boolean(data?.enabled)))
      .catch(() => setRedditEnabled(false));
  }, []);

  useEffect(() => {
    apiClient.get('/api/admin/google-signin/settings')
      .then((data) => setGoogleEnabled(Boolean(data?.enabled)))
      .catch(() => setGoogleEnabled(false));
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

  const toggleRedditOnExplore = useCallback(async () => {
    const newVal = !roeEnabled;
    setRoeEnabled(newVal);
    setRoeToggleLoading(true);
    try {
      const res = await apiClient.patch('/api/admin/reddit-explore/settings', { enabled: newVal });
      setRoeEnabled(Boolean(res?.enabled));
    } catch (err) {
      setRoeEnabled(!newVal);
      setRoeToast({ type: 'error', msg: `Failed: ${err.message || 'Unknown error'}` });
    } finally {
      setRoeToggleLoading(false);
    }
  }, [roeEnabled]);

  const toggleReddit = useCallback(async () => {
    const newVal = !redditEnabled;
    setRedditEnabled(newVal);
    setRedditToggleLoading(true);
    try {
      const res = await apiClient.patch('/api/admin/reddit-listings/settings', { enabled: newVal });
      setRedditEnabled(Boolean(res?.enabled));
    } catch (err) {
      setRedditEnabled(!newVal);
      setRedditToast({ type: 'error', msg: `Failed: ${err.message || 'Unknown error'}` });
    } finally {
      setRedditToggleLoading(false);
    }
  }, [redditEnabled]);

  const toggleGoogleSignin = useCallback(async () => {
    const newVal = !googleEnabled;
    setGoogleEnabled(newVal);
    setGoogleToggleLoading(true);
    try {
      const res = await apiClient.patch('/api/admin/google-signin/settings', { enabled: newVal });
      setGoogleEnabled(Boolean(res?.enabled));
    } catch (err) {
      setGoogleEnabled(!newVal);
      setGoogleToast({ type: 'error', msg: `Failed: ${err.message || 'Unknown error'}` });
    } finally {
      setGoogleToggleLoading(false);
    }
  }, [googleEnabled]);

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

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.black },
    content: { padding: SPACING.md, paddingBottom: 40 },
    sectionLabel: { fontSize: FONT_SIZES.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: SPACING.md, marginBottom: SPACING.sm },
    card: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
    cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    cardHeaderText: { flex: 1 },
    cardTitle: { fontSize: FONT_SIZES.md, fontWeight: '600', color: colors.white },
    cardDescription: { fontSize: FONT_SIZES.xs, color: colors.textSecondary, marginTop: 4, lineHeight: 16 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SPACING.sm },
    toggleLabel: { fontSize: FONT_SIZES.sm, color: colors.textSecondary, fontWeight: '500' },
    toast: { fontSize: FONT_SIZES.xs, color: '#4CAF50', marginTop: SPACING.sm },
    toastError: { color: colors.error },
    runBtn: { marginTop: SPACING.sm, alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 18, paddingVertical: 10 },
    runBtnText: { color: colors.black, fontWeight: '700', fontSize: FONT_SIZES.sm },
  }), [colors]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Auto Review</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="hardware-chip-outline" size={22} color={colors.textMuted} />
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
          colors={colors}
          styles={styles}
        />

        <Text style={styles.sectionLabel}>Reddit imported listings</Text>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="logo-reddit" size={22} color={colors.textMuted} />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Show Reddit listings on site</Text>
              <Text style={styles.cardDescription}>
                Master switch for Reddit-imported listings. When off, they&apos;re hidden everywhere on the site regardless of the Explore-feed setting below.
              </Text>
            </View>
          </View>
          <View style={styles.toggleRow}>
            <Switch
              value={Boolean(redditEnabled)}
              onValueChange={toggleReddit}
              disabled={redditEnabled === null || redditToggleLoading}
            />
            <Text style={styles.toggleLabel}>
              {redditEnabled === null ? 'Loading…' : redditEnabled ? 'Visible' : 'Hidden'}
              {redditToggleLoading ? ' · Saving…' : ''}
            </Text>
          </View>
          {redditToast && (
            <Text style={[styles.toast, redditToast.type === 'error' && styles.toastError]}>{redditToast.msg}</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="logo-reddit" size={22} color={colors.textMuted} />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Show Reddit on Explore</Text>
              <Text style={styles.cardDescription}>
                When on, Reddit-imported listings are mixed into the main Explore feed. When off, they stay in the Reddit tab only. (Requires Reddit listings to be visible on the site.)
              </Text>
            </View>
          </View>
          <View style={styles.toggleRow}>
            <Switch
              value={Boolean(roeEnabled)}
              onValueChange={toggleRedditOnExplore}
              disabled={roeEnabled === null || roeToggleLoading}
            />
            <Text style={styles.toggleLabel}>
              {roeEnabled === null ? 'Loading…' : roeEnabled ? 'On Explore feed' : 'Reddit tab only'}
              {roeToggleLoading ? ' · Saving…' : ''}
            </Text>
          </View>
          {roeToast && (
            <Text style={[styles.toast, roeToast.type === 'error' && styles.toastError]}>{roeToast.msg}</Text>
          )}
        </View>

        <Text style={styles.sectionLabel}>Sign-in methods</Text>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="logo-google" size={22} color={colors.textMuted} />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Google sign-in</Text>
              <Text style={styles.cardDescription}>
                When off, the &ldquo;Continue with Google&rdquo; button is hidden from login/signup and existing Google sessions are rejected.
              </Text>
            </View>
          </View>
          <View style={styles.toggleRow}>
            <Switch
              value={Boolean(googleEnabled)}
              onValueChange={toggleGoogleSignin}
              disabled={googleEnabled === null || googleToggleLoading}
            />
            <Text style={styles.toggleLabel}>
              {googleEnabled === null ? 'Loading…' : googleEnabled ? 'Enabled' : 'Disabled'}
              {googleToggleLoading ? ' · Saving…' : ''}
            </Text>
          </View>
          {googleToast && (
            <Text style={[styles.toast, googleToast.type === 'error' && styles.toastError]}>{googleToast.msg}</Text>
          )}
        </View>

        <Text style={styles.sectionLabel}>Cache</Text>
        <ToolCard
          icon="flash-outline"
          title="Flush listing cache"
          description="Clears Redis and in-memory caches for all public listing endpoints (cars, bikes, parts, plates). Use this if the live site shows stale results after approving listings."
          running={flushRunning}
          onRun={flushCache}
          runLabel="Flush cache"
          toast={flushToast}
          colors={colors}
          styles={styles}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

