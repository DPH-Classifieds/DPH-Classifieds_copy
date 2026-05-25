import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const TYPE_CONFIG = {
  error: {
    icon: 'alert-circle',
    color: COLORS.error,
  },
  success: {
    icon: 'checkmark-circle',
    color: COLORS.success,
  },
  warning: {
    icon: 'warning',
    color: COLORS.warning,
  },
  info: {
    icon: 'information-circle',
    color: COLORS.info,
  },
};

export default function ActionNoticeModal({
  visible,
  onClose,
  title,
  message,
  type = 'info',
  actionLabel,
  onAction,
}) {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.info;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={[styles.iconContainer, { backgroundColor: `${config.color}20` }]}>
            <Ionicons name={config.icon} size={40} color={config.color} />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            {actionLabel && onAction && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: config.color }]}
                onPress={onAction}
                activeOpacity={0.8}
              >
                <Text style={styles.actionButtonText}>{actionLabel}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.dismissButton, actionLabel && onAction && styles.dismissButtonSecondary]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={styles.dismissButtonText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  card: {
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  message: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.lg,
  },
  actions: {
    width: '100%',
    gap: SPACING.sm,
  },
  actionButton: {
    paddingVertical: 14,
    borderRadius: BORDER_RADIUS.pill,
    alignItems: 'center',
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  dismissButton: {
    paddingVertical: 14,
    borderRadius: BORDER_RADIUS.pill,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dismissButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  dismissButtonText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
});
