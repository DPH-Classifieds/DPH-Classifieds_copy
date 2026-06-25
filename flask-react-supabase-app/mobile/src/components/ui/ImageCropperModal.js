import React, { useState } from 'react';
import { View, Text, Image, Modal, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { compressImage } from '../../utils/imageCompressor';
import PressableScale from './PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { showError } from '../../utils/toast';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_SIZE = SCREEN_WIDTH - SPACING.md * 2;

const RATIOS = [
  { label: 'Free', value: null },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '1:1', value: 1 },
];

export default function ImageCropperModal({ visible, imageUri, onConfirm, onCancel }) {
  const [ratio, setRatio] = useState(null);
  const [processing, setProcessing] = useState(false);

  const previewHeight = ratio ? PREVIEW_SIZE / ratio : PREVIEW_SIZE * 0.75;

  const handleConfirm = async () => {
    if (!imageUri) return;
    setProcessing(true);
    try {
      const result = await compressImage(imageUri);
      onConfirm(result.uri);
    } catch {
      showError('Compression failed', 'Using original image.');
      onConfirm(imageUri);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <PressableScale onPress={onCancel} haptic="light" style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </PressableScale>
          <Text style={styles.title}>Adjust Photo</Text>
          <PressableScale onPress={handleConfirm} haptic="success" style={styles.confirmBtn} disabled={processing}>
            {processing
              ? <ActivityIndicator size="small" color={COLORS.black} />
              : <Text style={styles.confirmText}>Use Photo</Text>}
          </PressableScale>
        </View>

        <View style={styles.preview}>
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={{ width: PREVIEW_SIZE, height: previewHeight, borderRadius: BORDER_RADIUS.lg }}
              resizeMode="cover"
            />
          ) : null}
        </View>

        <View style={styles.ratioRow}>
          <Text style={styles.ratioLabel}>Aspect ratio</Text>
          <View style={styles.ratioChips}>
            {RATIOS.map((r) => (
              <PressableScale
                key={r.label}
                onPress={() => setRatio(r.value)}
                haptic="light"
                style={[styles.chip, ratio === r.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, ratio === r.value && styles.chipTextActive]}>{r.label}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md, paddingTop: SPACING.lg },
  cancelBtn: { padding: 8 },
  cancelText: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: COLORS.textSecondary },
  title: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: COLORS.white },
  confirmBtn: { backgroundColor: COLORS.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 16, paddingVertical: 8 },
  confirmText: { ...FONTS.semibold, fontSize: FONT_SIZES.sm, color: COLORS.black },
  preview: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.md },
  ratioRow: { padding: SPACING.md },
  ratioLabel: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.sm },
  ratioChips: { flexDirection: 'row', gap: SPACING.sm },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.black },
});
