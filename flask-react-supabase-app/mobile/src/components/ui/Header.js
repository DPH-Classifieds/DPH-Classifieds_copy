import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import Text from './AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function Header({
  title,
  subtitle,
  leftAction,
  rightAction,
  showBack = false,
  onBack,
}) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: {
          backgroundColor: colors.background,
        },
        container: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: colors.background,
        },
        left: {
          flexDirection: 'row',
          alignItems: 'center',
          minWidth: 60,
        },
        center: {
          flex: 1,
          alignItems: 'center',
        },
        right: {
          flexDirection: 'row',
          alignItems: 'center',
          minWidth: 60,
          justifyContent: 'flex-end',
        },
        backButton: {
          marginRight: 8,
          padding: 4,
        },
        title: {
          color: colors.textPrimary,
          fontSize: FONT_SIZES.hero,
          fontWeight: '700',
        },
        subtitle: {
          color: colors.textSecondary,
          fontSize: FONT_SIZES.md,
          marginTop: 4,
        },
      }),
    [colors]
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.left}>
          {showBack && (
            <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          {leftAction}
        </View>

        <View style={styles.center}>
          {title && <Text style={styles.title}>{title}</Text>}
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>

        <View style={styles.right}>{rightAction}</View>
      </View>
    </SafeAreaView>
  );
}
