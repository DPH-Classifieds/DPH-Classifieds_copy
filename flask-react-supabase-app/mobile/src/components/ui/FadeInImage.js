import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

// expo-image gives us a native cross-fade (transition) + memory/disk cache, so
// this is now a thin wrapper: same API as before (source/style/resizeMode +
// error fallback), but images fade in smoothly and are cached across launches.
export default function FadeInImage({ source, style, resizeMode = 'cover', contentFit, transition = 250, ...props }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    errorContainer: {
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }), [colors]);

  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <View style={[styles.errorContainer, style]}>
        <Ionicons name="image-outline" size={32} color={colors.textMuted} />
      </View>
    );
  }

  return (
    <Image
      source={source}
      style={style}
      contentFit={contentFit || resizeMode}
      transition={transition}
      cachePolicy="memory-disk"
      onError={() => setHasError(true)}
      {...props}
    />
  );
}
