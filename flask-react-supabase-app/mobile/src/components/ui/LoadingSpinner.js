import React, { useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import Text from './AppText';
import { useTheme } from '../../context/ThemeContext';

export default function LoadingSpinner({ message, size = 'large' }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    message: {
      color: colors.textSecondary,
      fontSize: 14,
      marginTop: 12,
    },
  }), [colors]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={colors.accent} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}
