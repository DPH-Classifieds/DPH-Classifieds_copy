import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import Button from './Button';

export default function EmptyState({
  icon = 'folder-open-outline',
  title,
  message,
  actionLabel,
  onAction,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    icon: {
      marginBottom: 16,
    },
    title: {
      color: colors.white,
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 8,
      textAlign: 'center',
    },
    message: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
    button: {
      marginTop: 20,
    },
  }), [colors]);

  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={colors.textMuted} style={styles.icon} />
      {title && <Text style={styles.title}>{title}</Text>}
      {message && <Text style={styles.message}>{message}</Text>}
      {actionLabel && onAction && (
        <Button title={actionLabel} onPress={onAction} variant="primary" style={styles.button} />
      )}
    </View>
  );
}
