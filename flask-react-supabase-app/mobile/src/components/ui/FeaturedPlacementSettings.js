import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';

const DEFAULT_PATTERN = [{ type: 'featured', count: 1 }, { type: 'normal', count: 5 }];

const toRows = (pattern) => (pattern || []).map((seg) => (
  'featured' in seg ? { type: 'featured', count: seg.featured } : { type: 'normal', count: seg.normal }
));
const toPattern = (rows) => rows.map((r) => ({ [r.type]: Number(r.count) || 1 }));

const previewCycle = (rows, totalSlots = 24) => {
  const seq = [];
  if (!rows.length) return seq;
  let i = 0;
  while (seq.length < totalSlots) {
    const row = rows[i % rows.length];
    for (let n = 0; n < Number(row.count || 0) && seq.length < totalSlots; n++) {
      seq.push(row.type);
    }
    i++;
    if (i > rows.length * 50) break;
  }
  return seq;
};

// Mirrors frontend/src/components/admin/FeaturedPlacementSettings.jsx.
export default function FeaturedPlacementSettings() {
  const [rows, setRows] = useState(toRows(DEFAULT_PATTERN));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/admin/featured-placement/settings');
      setRows(toRows(data?.pattern) || toRows(DEFAULT_PATTERN));
    } catch (err) {
      toastApiError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateRow = (index, patch) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, { type: 'normal', count: 3 }]);
  const removeRow = (index) => setRows((prev) => prev.filter((_, i) => i !== index));

  const save = async () => {
    setSaving(true);
    try {
      const data = await apiClient.patch('/api/admin/featured-placement/settings', { pattern: toPattern(rows) });
      setRows(toRows(data?.pattern));
      showSuccess('Placement pattern saved', 'The Explore and landing pages will use it right away.');
    } catch (err) {
      toastApiError(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const preview = previewCycle(rows);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.description}>
        Controls how featured listings are woven into the normal feed on the landing page and Explore — e.g.
        3 featured, then 3 normal, then 2 featured, then 4 normal, then 1 featured, then repeat. Only affects
        the default (unfiltered, newest-first) view.
      </Text>

      {rows.map((row, i) => (
        <View key={i} style={styles.row}>
          <Text style={styles.rowIndex}>{i + 1}</Text>
          <View style={styles.typeToggle}>
            <TouchableOpacity
              style={[styles.typeBtn, row.type === 'featured' && styles.typeBtnActiveFeatured]}
              onPress={() => updateRow(i, { type: 'featured' })}
            >
              <Text style={[styles.typeBtnText, row.type === 'featured' && styles.typeBtnTextActive]}>Featured</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, row.type === 'normal' && styles.typeBtnActiveNormal]}
              onPress={() => updateRow(i, { type: 'normal' })}
            >
              <Text style={[styles.typeBtnText, row.type === 'normal' && styles.typeBtnTextActive]}>Normal</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.countInput}
            value={String(row.count)}
            onChangeText={(v) => updateRow(i, { count: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
            maxLength={2}
          />
          <TouchableOpacity onPress={() => removeRow(i)} disabled={rows.length <= 1} hitSlop={8}>
            <Ionicons name="close" size={18} color={rows.length <= 1 ? COLORS.textMuted : COLORS.error} />
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={styles.addRowBtn} onPress={addRow}>
        <Ionicons name="add" size={16} color={COLORS.accent} />
        <Text style={styles.addRowText}>Add a step</Text>
      </TouchableOpacity>

      <Text style={styles.previewLabel}>Preview (cycles forever)</Text>
      <View style={styles.previewGrid}>
        {preview.map((type, i) => (
          <View key={i} style={[styles.previewCell, type === 'featured' ? styles.previewCellFeatured : styles.previewCellNormal]}>
            <Text style={type === 'featured' ? styles.previewCellFeaturedText : styles.previewCellNormalText}>
              {type === 'featured' ? '★' : '·'}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving} activeOpacity={0.8}>
        {saving ? <ActivityIndicator size="small" color={COLORS.black} /> : <Text style={styles.saveBtnText}>Save pattern</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.md, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  description: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: COLORS.textSecondary, lineHeight: 18, marginBottom: SPACING.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border,
  },
  rowIndex: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: COLORS.textMuted, width: 16, textAlign: 'center' },
  typeToggle: { flexDirection: 'row', gap: 4, flex: 1 },
  typeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: BORDER_RADIUS.pill, backgroundColor: COLORS.surfaceHigher },
  typeBtnActiveFeatured: { backgroundColor: COLORS.warning },
  typeBtnActiveNormal: { backgroundColor: COLORS.accent },
  typeBtnText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: COLORS.textSecondary },
  typeBtnTextActive: { color: COLORS.black },
  countInput: {
    width: 44, textAlign: 'center', backgroundColor: COLORS.surfaceHigher, borderRadius: BORDER_RADIUS.sm,
    paddingVertical: 6, color: COLORS.white, fontSize: FONT_SIZES.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  addRowBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: SPACING.md },
  addRowText: { ...FONTS.semibold, fontSize: FONT_SIZES.sm, color: COLORS.accent },
  previewLabel: { ...FONTS.label, fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: 8 },
  previewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: SPACING.lg },
  previewCell: { width: 20, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  previewCellFeatured: { backgroundColor: COLORS.warning },
  previewCellNormal: { backgroundColor: COLORS.surfaceHigher },
  previewCellFeaturedText: { fontSize: 10, fontWeight: '700', color: COLORS.black },
  previewCellNormalText: { fontSize: 10, color: COLORS.textMuted },
  saveBtn: { backgroundColor: COLORS.accent, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: COLORS.black },
});
