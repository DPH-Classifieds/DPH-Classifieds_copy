import React, { useState } from 'react';
import { View, Text, Image, Modal, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { compressImage } from '../../utils/imageCompressor';
import PressableScale from './PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { showError } from '../../utils/toast';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_SIZE = SCREEN_WIDTH - SPACING.md * 2;
const PREVIEW_HEIGHT = PREVIEW_SIZE * 0.75;

export default function ImageCropperModal({ visible, imageUri, onConfirm, onCancel, moderating = false }) {
  const [processing, setProcessing] = useState(false);
  // "Use Photo" awaits compression only — onConfirm (which also runs nudity/face
  // moderation upstream) isn't awaited, so without this the spinner disappears
  // and the modal looks idle while moderation is still silently running.
  const busy = processing || moderating;

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
          <Text style={styles.title}>{moderating ? 'Checking photo…' : 'Add Photo'}</Text>
          <PressableScale onPress={handleConfirm} haptic="success" style={styles.confirmBtn} disabled={busy}>
            {busy
              ? <ActivityIndicator size="small" color={COLORS.black} />
              : <Text style={styles.confirmText}>Use Photo</Text>}
          </PressableScale>
        </View>

        <View style={styles.preview}>
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={{ width: PREVIEW_SIZE, height: PREVIEW_HEIGHT, borderRadius: BORDER_RADIUS.lg }}
              resizeMode="cover"
            />
          ) : null}
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
});
