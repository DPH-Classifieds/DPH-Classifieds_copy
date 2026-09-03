import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { toastApiError } from '../../utils/toast';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import EmptyState from '../../components/ui/EmptyState';
import ListingSkeleton from '../../components/ui/ListingSkeleton';
import SearchBar from '../../components/ui/SearchBar';
import { SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { formatPrice } from '../../utils/formatters';

const PAGE_SIZE = 20;

// Same category set as the Post Request form so list chips match what buyers pick.
const CATEGORIES = ['All', 'Cars', 'Bikes', 'Plates', 'Parts', 'Other'];
const SORTS = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
];

function RequestCard({ item, index, onPress, styles }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress} haptic="light">
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{item.category || 'Any'}</Text>
            </View>
            <Text style={styles.date}>
              {item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}
            </Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>{item.title || item.description}</Text>
          {(item.budget_min || item.budget_max) && (
            <Text style={styles.budget}>
              Budget: {item.budget_min ? formatPrice(item.budget_min) : '—'} – {item.budget_max ? formatPrice(item.budget_max) : 'open'}
            </Text>
          )}
          {item.make && (
            <Text style={styles.detail}>{item.make}{item.model ? ` ${item.model}` : ''}</Text>
          )}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function BuyingRequestsScreen({ navigation }) {
  const { colors } = useTheme();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('newest');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchRequests = useCallback(async (pageNum = 1, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      const offset = (pageNum - 1) * PAGE_SIZE;
      const data = await apiClient.get(`/api/buying-requests?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.requests || data?.data || []);
      if (pageNum === 1) setRequests(items);
      else setRequests(prev => [...prev, ...items]);
      setHasMore(items.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (err) {
      toastApiError(err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => { fetchRequests(1); }, [fetchRequests]);

  const handleRefresh = useCallback(() => fetchRequests(1, true), [fetchRequests]);
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) fetchRequests(page + 1);
  }, [loadingMore, hasMore, page, fetchRequests]);

  const visibleRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ts = (d) => (d ? new Date(d).getTime() : 0);
    const list = requests.filter((r) => {
      if (category !== 'All' && (r.category || '').toLowerCase() !== category.toLowerCase()) return false;
      if (q) {
        const haystack = [r.title, r.description, r.make, r.model]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => (
      sort === 'oldest' ? ts(a.created_at) - ts(b.created_at) : ts(b.created_at) - ts(a.created_at)
    ));
  }, [requests, search, category, sort]);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
    backBtn: { width: 32, alignItems: 'flex-start' },
    heading: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: colors.textPrimary, flex: 1 },
    postBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8 },
    postBtnText: { ...FONTS.semibold, fontSize: FONT_SIZES.sm, color: colors.onAccent },
    searchContainer: { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
    filters: { flexGrow: 0, maxHeight: 52, marginBottom: SPACING.sm },
    filtersContent: { paddingHorizontal: SPACING.md, gap: 8, alignItems: 'center' },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
    chipTextActive: { color: colors.onAccent },
    divider: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 4 },
    card: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.xl, marginHorizontal: SPACING.md, marginBottom: SPACING.sm, padding: SPACING.md, borderWidth: 1, borderColor: colors.borderLight },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
    categoryBadge: { backgroundColor: colors.primary, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3 },
    categoryText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: colors.chipActiveText },
    date: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: colors.textMuted },
    title: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: colors.textPrimary, marginBottom: SPACING.xs },
    budget: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: colors.accent, marginBottom: 2 },
    detail: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: colors.textSecondary },
  }), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.heading}>Buying Requests</Text>
          <PressableScale
            onPress={() => navigation.navigate('PostBuyingRequest')}
            haptic="medium"
            style={styles.postBtn}
          >
            <Ionicons name="add" size={20} color={colors.onAccent} />
            <Text style={styles.postBtnText}>Post Request</Text>
          </PressableScale>
        </View>

        <View style={styles.searchContainer}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search requests..." />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filtersContent}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]}>
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.divider} />
          {SORTS.map((s) => (
            <TouchableOpacity key={s.key} onPress={() => setSort(s.key)} style={[styles.chip, sort === s.key && styles.chipActive]}>
              <Text style={[styles.chipText, sort === s.key && styles.chipTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <ListingSkeleton count={4} />
        ) : (
          <FlashList
            data={visibleRequests}
            keyExtractor={(item, idx) => String(item.id ?? idx)}
            estimatedItemSize={120}
            renderItem={({ item, index }) => (
              <RequestCard
                item={item}
                index={index}
                styles={styles}
                onPress={() => navigation.navigate('BuyingRequestDetail', { requestId: item.id })}
              />
            )}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ padding: 20 }} /> : null}
            ListEmptyComponent={<EmptyState icon="search" title="No buying requests found" message="Try a different search or category — or post what you're looking for" />}
          />
        )}
      </ScreenEntrance>
    </SafeAreaView>
  );
}
