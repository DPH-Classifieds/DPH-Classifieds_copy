import React, { useState, useEffect, useCallback } from 'react';
import { View, TouchableOpacity, Image, Alert, StyleSheet, RefreshControl, ScrollView, Modal, TextInput } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { toastApiError } from '../../utils/toast';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const REJECTION_REASONS = [
  'Inappropriate content',
  'Wrong category',
  'Spam',
  'Duplicate listing',
  'Incomplete information',
  'Misleading information',
  'Price manipulation',
  'Other',
];

const TYPE_TABS = ['All', 'Cars', 'Bikes', 'Plates', 'Parts', 'Buying Requests'];
const STATUS_TABS = ['All', 'Pending', 'Active', 'Approved', 'Expired', 'Rejected', 'Deleted'];
const TYPE_KEYS = ['cars', 'bikes', 'plates', 'parts', 'buying_requests'];

const typeKeyMap = {
  All: null,
  Cars: 'cars',
  Bikes: 'bikes',
  Plates: 'plates',
  Parts: 'parts',
  'Buying Requests': 'buying_requests',
};

const statusKeyMap = {
  All: null,
  Pending: 'pending',
  Active: 'active',
  Approved: 'approved',
  Expired: 'expired',
  Rejected: 'rejected',
  Deleted: 'deleted',
};

const SOLD_STATUS_CONFIG = {
  sold_on_dph:    { label: 'Sold on DPH',      bg: 'rgba(76,175,80,0.2)',   text: '#4CAF50' },
  sold_elsewhere: { label: 'Sold elsewhere',    bg: 'rgba(255,193,7,0.2)',   text: '#FFC107' },
  not_sold_renew: { label: 'Not sold / Renew',  bg: 'rgba(158,158,158,0.2)', text: '#9E9E9E' },
};

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return item.images[0].url || item.images[0].image_url;
  }
  return item.image_url || null;
};

const getTitle = (item) => {
  if (item.listing_type === 'buying_requests' || item.item_type) {
    const carPart = `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim();
    return item.item_name || carPart || 'Buying Request';
  }
  if (item.car_manufacturer) return `${item.car_manufacturer} ${item.car_model || ''}`.trim() || 'Car';
  if (item.bike_brand) return `${item.bike_brand} ${item.bike_model || ''}`.trim() || 'Bike';
  if (item.city) return [item.city, item.code, item.number || item.digits].filter(Boolean).join(' ') || 'Plate';
  return item.part_type || item.part_name || 'Part';
};

const getDisplayPrice = (item) => {
  if (item.listing_type === 'buying_requests') return item.budget || 0;
  return item.price || item.expected_selling_price || 0;
};

function AdminListingCard({ item, index, onPress, onApprove, onReject, selectionMode, selected, onToggleSelect }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const imageUri = getImageUri(item);
  const title = getTitle(item);
  const displayStatus = item.listing_state || item.status || 'pending';
  const rawStatus = item._table_status || item.status || 'pending';
  const isBuyingRequest = item.listing_type === 'buying_requests';
  const isPending = rawStatus === 'pending' && !isBuyingRequest;
  const placeholderIcon = isBuyingRequest ? 'cart-outline' : 'image-outline';
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={selectionMode ? onToggleSelect : onPress}>
        <View style={styles.card}>
          <View style={styles.cardContent}>
            {selectionMode && (
              <TouchableOpacity onPress={onToggleSelect} style={styles.checkboxWrap} activeOpacity={0.7}>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={selected ? COLORS.accent : COLORS.textMuted}
                />
              </TouchableOpacity>
            )}
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.thumbnail} />
            ) : (
              <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                <Ionicons name={placeholderIcon} size={28} color={COLORS.textMuted} />
              </View>
            )}
            <View style={styles.cardInfo}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
                {isBuyingRequest && (
                  <View style={styles.requestPill}>
                    <Text style={styles.requestPillText}>Request</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardPrice}>
                {isBuyingRequest ? `Budget ${formatPrice(getDisplayPrice(item))}` : formatPrice(getDisplayPrice(item))}
              </Text>
              <View style={styles.cardMeta}>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(displayStatus) }]}>
                  <Text style={styles.statusBadgeText}>{displayStatus}</Text>
                </View>
                {item.sold_status && SOLD_STATUS_CONFIG[item.sold_status] && (
                  <View style={[styles.soldPill, { backgroundColor: SOLD_STATUS_CONFIG[item.sold_status].bg }]}>
                    <Text style={[styles.soldPillText, { color: SOLD_STATUS_CONFIG[item.sold_status].text }]}>
                      {SOLD_STATUS_CONFIG[item.sold_status].label}
                    </Text>
                  </View>
                )}
                <Text style={styles.cardDate} numberOfLines={1}>
                  {[formatDate(item.created_at), item.seller_name].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          </View>
          {isPending && (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.approveBtn]}
                onPress={onApprove}
                activeOpacity={0.7}
              >
                <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
                <Text style={styles.approveText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={onReject}
                activeOpacity={0.7}
              >
                <Ionicons name="close-circle" size={18} color={COLORS.error} />
                <Text style={styles.rejectText}>Reject</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function AdminListingsScreen({ navigation }) {
  const [listings, setListings] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState(['All']);
  const [selectedStatuses, setSelectedStatuses] = useState(['All']);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kpi, setKpi] = useState({ total: 0, pending: 0, active: 0 });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRenewModal, setBulkRenewModal] = useState(false);
  const [bulkRenewReason, setBulkRenewReason] = useState('');
  const [bulkDeleteModal, setBulkDeleteModal] = useState(false);
  const [bulkDeleteReason, setBulkDeleteReason] = useState('');

  useEffect(() => {
    fetchListings();
  }, [selectedTypes, selectedStatuses]);

  const fetchListings = async () => {
    try {
      setLoading(true);
      const selectedTypeKeys = selectedTypes.includes('All')
        ? []
        : selectedTypes.map((t) => typeKeyMap[t]).filter(Boolean);
      const types = selectedTypeKeys.join(',');
      const selectedStatusKeys = selectedStatuses.includes('All') ? [] : selectedStatuses.map((s) => statusKeyMap[s]).filter(Boolean);
      const statuses = selectedStatusKeys.join(',');
      const params = [];
      if (types) params.push(`types=${types}`);
      if (statuses) params.push(`statuses=${statuses}`);
      const query = params.length ? `?${params.join('&')}` : '';
      const data = await apiClient.get(`/api/admin/listings-search${query}`);
      const list = Array.isArray(data) ? data : data?.listings || [];
      setListings(list);

      if (data && data.metadata) {
        setKpi({
          total: data.metadata.total ?? list.length,
          pending: data.metadata.pending ?? 0,
          active: data.metadata.active ?? 0,
        });
      } else {
        setKpi({
          total: list.length,
          pending: list.filter((l) => l.status === 'pending').length,
          active: list.filter((l) => l.status === 'active').length,
        });
      }
    } catch (err) {
      setListings([]);
      setKpi({ total: 0, pending: 0, active: 0 });
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchListings();
    setRefreshing(false);
  }, [selectedTypes, selectedStatuses]);

  const toggleType = (tab) => {
    setSelectedTypes((prev) => {
      if (tab === 'All') return ['All'];
      if (prev.includes('All')) return [tab];
      if (prev.includes(tab)) {
        if (prev.length === 1) return prev;
        const next = prev.filter((t) => t !== tab);
        return next.length ? next : ['All'];
      }
      return [...prev, tab];
    });
  };

  const toggleStatus = (tab) => {
    setSelectedStatuses((prev) => {
      if (tab === 'All') return ['All'];
      if (prev.includes('All')) return [tab];
      if (prev.includes(tab)) {
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== tab);
      }
      return [...prev, tab];
    });
  };

  const handleApprove = async (item) => {
    try {
      const typeKey = item.listing_type || 'cars';
      await apiClient.post(`/api/admin/approve/${typeKey}/${item.id}/approve`);
      setListings((prev) => prev.filter((l) => l.id !== item.id));
    } catch (err) {
      Alert.alert('Error', err?.message || 'Failed to approve listing.');
    }
  };

  const handleReject = async (item) => {
    const reasonButtons = REJECTION_REASONS.map((reason) => ({
      text: reason,
      onPress: async () => {
        try {
          const typeKey = item.listing_type || 'cars';
          await apiClient.post(`/api/admin/approve/${typeKey}/${item.id}/reject`, { rejection_note: reason });
          setListings((prev) => prev.filter((l) => l.id !== item.id));
        } catch (err) {
          Alert.alert('Error', err?.message || 'Failed to reject listing.');
        }
      },
    }));

    Alert.alert(
      'Reject Listing',
      'Select a reason for rejection:',
      [
        { text: 'Cancel', style: 'cancel' },
        ...reasonButtons,
      ],
    );
  };

  // Mirrors frontend/src/components/AdminListings.js rowKey/isRenewable.
  const rowKey = (item) => `${item.listing_type || 'cars'}:${item.id}`;

  const isRenewable = (item) => {
    if (!item) return false;
    const rawStatus = String(item.status || '').toLowerCase();
    if (['sold', 'deleted', 'rejected', 'archived'].includes(rawStatus)) return false;
    if (item.deleted_at || item.is_archived) return false;
    return true;
  };

  const isRestorable = (item) => {
    const ds = String(item.listing_state || item.status || '').toLowerCase();
    const rs = String(item.status || '').toLowerCase();
    return ds === 'deleted' || rs === 'deleted' || rs === 'rejected';
  };

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  };

  const toggleRowSelected = (item) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = rowKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const selectedListings = listings.filter((l) => selectedIds.has(rowKey(l)));
  const bulkHasPending = selectedListings.some((l) => (l._table_status || l.status) === 'pending');
  const bulkHasRenewable = selectedListings.some(isRenewable);
  const bulkHasRestorable = selectedListings.some(isRestorable);

  const bulkItemsPayload = () => {
    const items = [];
    for (const key of selectedIds) {
      const [type, id] = key.split(':');
      if (type && id) items.push({ type, id });
    }
    return items;
  };

  const handleBulkApprove = async () => {
    const items = bulkItemsPayload();
    if (!items.length) return;
    setBulkBusy(true);
    try {
      const resp = await apiClient.post('/api/admin/listings/approve-bulk', { items });
      const total = Number(resp?.total ?? items.length);
      const succeeded = Number(resp?.succeeded ?? 0);
      Alert.alert('Bulk approve', `Approved ${succeeded} of ${total}.`);
      clearSelection();
      fetchListings();
    } catch (err) {
      Alert.alert('Error', err?.message || 'Bulk approve failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkRenew = async () => {
    const items = bulkItemsPayload();
    if (!items.length) return;
    setBulkBusy(true);
    try {
      const resp = await apiClient.post('/api/admin/listings/renew-bulk', {
        items,
        reason: bulkRenewReason.trim() || undefined,
      });
      const total = Number(resp?.total ?? items.length);
      const succeeded = Number(resp?.succeeded ?? 0);
      Alert.alert('Bulk renew', `Renewed ${succeeded} of ${total}.`);
      setBulkRenewModal(false);
      setBulkRenewReason('');
      clearSelection();
      fetchListings();
    } catch (err) {
      Alert.alert('Error', err?.message || 'Bulk renew failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!bulkDeleteReason.trim()) {
      Alert.alert('Reason required', 'Please enter a removal reason.');
      return;
    }
    const items = bulkItemsPayload();
    if (!items.length) return;
    setBulkBusy(true);
    try {
      const resp = await apiClient.post('/api/admin/listings/delete-bulk', {
        items,
        reason: bulkDeleteReason.trim(),
      });
      const total = Number(resp?.total ?? items.length);
      const succeeded = Number(resp?.succeeded ?? 0);
      Alert.alert('Bulk delete', `Deleted ${succeeded} of ${total}.`);
      setBulkDeleteModal(false);
      setBulkDeleteReason('');
      clearSelection();
      fetchListings();
    } catch (err) {
      Alert.alert('Error', err?.message || 'Bulk delete failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkRestore = async () => {
    const items = bulkItemsPayload();
    if (!items.length) return;
    setBulkBusy(true);
    try {
      let succeeded = 0;
      for (const { type, id } of items) {
        try {
          await apiClient.post(`/api/admin/listings/${type}/${id}/set-status`, { status: 'approved' });
          succeeded++;
        } catch {
          // Best-effort bulk op — surfaced in the summary count below.
        }
      }
      Alert.alert('Bulk restore', `Restored ${succeeded} of ${items.length}.`);
      clearSelection();
      fetchListings();
    } catch {
      Alert.alert('Error', 'Bulk restore failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'active': return 'success';
      case 'approved': return 'success';
      case 'expired': return 'warning';
      case 'pending': return 'warning';
      case 'sold': return 'info';
      case 'deleted': return 'default';
      case 'rejected': return 'error';
      default: return 'default';
    }
  };

  const renderListing = ({ item, index }) => (
    <AdminListingCard
      item={item}
      index={index}
      onPress={() => navigation.navigate('AdminListingDetail', { itemType: item.listing_type || 'cars', itemId: item.id })}
      onApprove={() => handleApprove(item)}
      onReject={() => handleReject(item)}
      selectionMode={selectionMode}
      selected={selectedIds.has(rowKey(item))}
      onToggleSelect={() => toggleRowSelected(item)}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScreenEntrance>
        <View style={styles.selectRow}>
          <TouchableOpacity onPress={toggleSelectionMode} style={styles.selectToggle} activeOpacity={0.7}>
            <Ionicons name={selectionMode ? 'close' : 'checkbox-outline'} size={16} color={COLORS.accent} />
            <Text style={styles.selectToggleText}>{selectionMode ? 'Cancel' : 'Select'}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.typeTabBar}
        >
          {TYPE_TABS.map((tab) => {
            const active = selectedTypes.includes(tab) || (tab === 'All' && selectedTypes.length === 0);
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.typeTab, active && styles.activeTypeTab]}
                onPress={() => toggleType(tab)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={active ? 'checkmark-circle-outline' : 'add-circle-outline'}
                  size={14}
                  color={active ? COLORS.background : COLORS.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.typeTabText, active && styles.activeTypeTabText]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusTabBar}
        >
          {STATUS_TABS.map((tab) => {
            const active = selectedStatuses.includes(tab) || (tab === 'All' && selectedStatuses.length === 0);
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.statusTab, active && styles.activeStatusTab]}
                onPress={() => toggleStatus(tab)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={active ? 'checkmark-circle-outline' : 'add-circle-outline'}
                  size={14}
                  color={active ? COLORS.background : COLORS.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.statusTabText, active && styles.activeStatusTabText]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {!loading && (
          <View style={styles.kpiRow}>
            <View style={styles.kpiItem}>
              <Text style={styles.kpiValue}>{kpi.total}</Text>
              <Text style={styles.kpiLabel}>Total</Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiItem}>
              <Text style={[styles.kpiValue, { color: COLORS.warning }]}>{kpi.pending}</Text>
              <Text style={styles.kpiLabel}>Pending</Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiItem}>
              <Text style={[styles.kpiValue, { color: COLORS.success }]}>{kpi.active}</Text>
              <Text style={styles.kpiLabel}>Active</Text>
            </View>
          </View>
        )}

        {loading && listings.length === 0 ? (
          <LoadingSpinner message="Loading listings..." />
        ) : (
          <FlashList
            estimatedItemSize={260}
            data={listings}
            renderItem={renderListing}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
            }
            ListEmptyComponent={
              <EmptyState
                icon="list-outline"
                title="No listings found"
                message="Try adjusting your filters."
              />
            }
          />
        )}

        {selectionMode && selectedIds.size > 0 && (
          <View style={styles.bulkBar}>
            <Text style={styles.bulkBarCount}>{selectedIds.size} selected</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bulkBarActions}>
              {bulkHasPending && (
                <TouchableOpacity style={styles.bulkApproveBtn} onPress={handleBulkApprove} disabled={bulkBusy}>
                  <Ionicons name="checkmark-circle" size={14} color={COLORS.black} />
                  <Text style={styles.bulkApproveBtnText}>Approve</Text>
                </TouchableOpacity>
              )}
              {bulkHasRenewable && (
                <TouchableOpacity style={styles.bulkRenewBtn} onPress={() => setBulkRenewModal(true)} disabled={bulkBusy}>
                  <Ionicons name="refresh" size={14} color={COLORS.accent} />
                  <Text style={styles.bulkRenewBtnText}>Renew</Text>
                </TouchableOpacity>
              )}
              {bulkHasRestorable && (
                <TouchableOpacity style={styles.bulkRestoreBtn} onPress={handleBulkRestore} disabled={bulkBusy}>
                  <Ionicons name="arrow-undo" size={14} color={COLORS.info} />
                  <Text style={styles.bulkRestoreBtnText}>Restore</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.bulkDeleteBtn} onPress={() => setBulkDeleteModal(true)} disabled={bulkBusy}>
                <Ionicons name="trash" size={14} color={COLORS.error} />
                <Text style={styles.bulkDeleteBtnText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bulkClearBtn} onPress={clearSelection}>
                <Text style={styles.bulkClearBtnText}>Clear</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </ScreenEntrance>

      <Modal visible={bulkRenewModal} transparent animationType="fade" onRequestClose={() => setBulkRenewModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setBulkRenewModal(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Renew {selectedIds.size} listing{selectedIds.size === 1 ? '' : 's'}</Text>
            <Text style={styles.modalLabel}>Reason (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={bulkRenewReason}
              onChangeText={setBulkRenewReason}
              placeholder="e.g. Requested by seller"
              placeholderTextColor={COLORS.textMuted}
            />
            <TouchableOpacity style={[styles.modalPrimaryBtn, bulkBusy && styles.modalBtnDisabled]} disabled={bulkBusy} onPress={handleBulkRenew}>
              <Text style={styles.modalPrimaryBtnText}>{bulkBusy ? 'Working…' : `Confirm renew (${selectedIds.size})`}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={bulkDeleteModal} transparent animationType="fade" onRequestClose={() => setBulkDeleteModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setBulkDeleteModal(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Delete {selectedIds.size} listing{selectedIds.size === 1 ? '' : 's'}</Text>
            <Text style={styles.modalWarning}>This permanently removes the selected listings. This cannot be undone.</Text>
            <Text style={styles.modalLabel}>Reason *</Text>
            <TextInput
              style={styles.modalInput}
              value={bulkDeleteReason}
              onChangeText={setBulkDeleteReason}
              placeholder="e.g. Spam / policy violation"
              placeholderTextColor={COLORS.textMuted}
            />
            <TouchableOpacity
              style={[styles.modalDangerBtn, (!bulkDeleteReason.trim() || bulkBusy) && styles.modalBtnDisabled]}
              disabled={!bulkDeleteReason.trim() || bulkBusy}
              onPress={handleBulkDelete}
            >
              <Text style={styles.modalDangerBtnText}>{bulkBusy ? 'Working…' : `Delete ${selectedIds.size}`}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const getStatusColor = (status) => {
  switch (status) {
    case 'active': return COLORS.success;
    case 'approved': return COLORS.success;
    case 'pending': return COLORS.warning;
    case 'expired': return COLORS.warning;
    case 'archived': return COLORS.textMuted;
    case 'sold': return COLORS.info;
    case 'deleted': return COLORS.textMuted;
    case 'rejected': return COLORS.error;
    default: return COLORS.textMuted;
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  typeTabBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    gap: 8,
  },
  typeTab: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  activeTypeTab: {
    backgroundColor: COLORS.accent,
  },
  typeTabText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeTypeTabText: {
    color: COLORS.background,
  },
  statusTabBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 6,
  },
  statusTab: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  activeStatusTab: {
    backgroundColor: COLORS.accent,
  },
  statusTabText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  activeStatusTabText: {
    color: COLORS.background,
  },
  kpiRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiItem: {
    flex: 1,
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.white,
  },
  kpiLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  kpiDivider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.borderLight,
  },
  listContent: {
    padding: SPACING.md,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  cardContent: {
    flexDirection: 'row',
    padding: SPACING.md,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceHigher,
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: SPACING.md,
    justifyContent: 'center',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  requestPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: 'rgba(76,175,80,0.18)',
  },
  requestPillText: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cardPrice: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.accent,
    marginBottom: 6,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.white,
    textTransform: 'capitalize',
  },
  soldPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  soldPillText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  cardDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  sellerName: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 20,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  approveBtn: {},
  rejectBtn: {},
  approveText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.accent,
  },
  rejectText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.error,
  },
  selectRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  selectToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectToggleText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  checkboxWrap: {
    justifyContent: 'center',
    paddingRight: SPACING.sm,
  },
  bulkBar: {
    position: 'absolute',
    bottom: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: '#0a0f14',
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  bulkBarCount: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  bulkBarActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  bulkApproveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8,
  },
  bulkApproveBtnText: { color: COLORS.black, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  bulkRenewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(139,214,180,0.15)', borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(139,214,180,0.3)',
  },
  bulkRenewBtnText: { color: COLORS.accent, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  bulkRestoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(33,150,243,0.15)', borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(33,150,243,0.3)',
  },
  bulkRestoreBtnText: { color: COLORS.info, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  bulkDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(244,67,54,0.15)', borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(244,67,54,0.3)',
  },
  bulkDeleteBtnText: { color: COLORS.error, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  bulkClearBtn: {
    backgroundColor: COLORS.surfaceHigher, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 12, paddingVertical: 8,
  },
  bulkClearBtnText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: SPACING.md },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.md },
  modalTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginBottom: SPACING.sm },
  modalWarning: { color: COLORS.warning, fontSize: FONT_SIZES.xs, marginBottom: SPACING.sm },
  modalLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginBottom: 6 },
  modalInput: {
    backgroundColor: COLORS.surfaceHigher, borderRadius: BORDER_RADIUS.md, paddingHorizontal: 12, paddingVertical: 10,
    color: COLORS.white, fontSize: FONT_SIZES.sm,
  },
  modalBtnDisabled: { opacity: 0.4 },
  modalPrimaryBtn: { marginTop: SPACING.lg, backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
  modalPrimaryBtnText: { color: COLORS.accent, fontSize: FONT_SIZES.md, fontWeight: '600' },
  modalDangerBtn: { marginTop: SPACING.lg, backgroundColor: COLORS.error, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
  modalDangerBtnText: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
});
