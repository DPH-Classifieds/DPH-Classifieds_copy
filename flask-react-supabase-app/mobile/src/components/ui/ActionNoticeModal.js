import React, { useMemo } from 'react';
import { View, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const TYPE_ICONS = {
  error: 'alert-circle',
  success: 'checkmark-circle',
  warning: 'warning',
  info: 'information-circle',
};

const getTypeColor = (colors, type) => {
  if (type === 'error') return colors.error;
  if (type === 'success') return colors.success;
  if (type === 'warning') return colors.warning;
  return colors.info;
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
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: SPACING.lg,
    },
    card: {
      backgroundColor: colors.surfaceHigher,
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
      color: colors.textPrimary,
      fontSize: FONT_SIZES.xl,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: SPACING.sm,
    },
    message: {
      color: colors.textSecondary,
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
      color: colors.textPrimary,
      fontSize: FONT_SIZES.md,
      fontWeight: '700',
    },
    dismissButton: {
      paddingVertical: 14,
      borderRadius: BORDER_RADIUS.pill,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dismissButtonSecondary: {
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
    dismissButtonText: {
      color: colors.textSecondary,
      fontSize: FONT_SIZES.md,
      fontWeight: '600',
    },
  }), [colors]);

  const configIcon = TYPE_ICONS[type] || TYPE_ICONS.info;
  const configColor = getTypeColor(colors, type);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={[styles.iconContainer, { backgroundColor: `${configColor}20` }]}>
            <Ionicons name={configIcon} size={40} color={configColor} />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            {actionLabel && onAction && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: configColor }]}
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
