import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { COLORS } from '../../constants/theme';

export default function LoadingSpinner({ message, size = 'large' }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={COLORS.accent} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  message: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: 12,
  },
});
