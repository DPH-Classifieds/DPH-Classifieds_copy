import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
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
import { SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { formatPrice } from '../../utils/formatters';

const PAGE_SIZE = 20;

function RequestCard({ item, index, onPress }) {
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

  useEffect(() => { fetchRequests(1); }, []);

  const handleRefresh = useCallback(() => fetchRequests(1, true), [fetchRequests]);
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) fetchRequests(page + 1);
  }, [loadingMore, hasMore, page, fetchRequests]);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md },
    heading: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: colors.white },
    postBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8 },
    postBtnText: { ...FONTS.semibold, fontSize: FONT_SIZES.sm, color: colors.black },
    card: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.xl, marginHorizontal: SPACING.md, marginBottom: SPACING.sm, padding: SPACING.md, borderWidth: 1, borderColor: colors.borderLight },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
    categoryBadge: { backgroundColor: colors.primary, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3 },
    categoryText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: colors.accent },
    date: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: colors.textMuted },
    title: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: colors.white, marginBottom: SPACING.xs },
    budget: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: colors.accent, marginBottom: 2 },
    detail: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: colors.textSecondary },
  }), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <View style={styles.header}>
          <Text style={styles.heading}>Buying Requests</Text>
          <PressableScale
            onPress={() => navigation.navigate('PostBuyingRequest')}
            haptic="medium"
            style={styles.postBtn}
          >
            <Ionicons name="add" size={20} color={colors.black} />
            <Text style={styles.postBtnText}>Post Request</Text>
          </PressableScale>
        </View>

        {loading ? (
          <ListingSkeleton count={4} />
        ) : (
          <FlashList
            data={requests}
            keyExtractor={(item) => item.id}
            estimatedItemSize={120}
            renderItem={({ item, index }) => (
              <RequestCard
                item={item}
                index={index}
                onPress={() => navigation.navigate('BuyingRequestDetail', { requestId: item.id })}
              />
            )}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ padding: 20 }} /> : null}
            ListEmptyComponent={<EmptyState icon="search" title="No buying requests yet" message="Be the first to post what you're looking for" />}
          />
        )}
      </ScreenEntrance>
    </SafeAreaView>
  );
}
