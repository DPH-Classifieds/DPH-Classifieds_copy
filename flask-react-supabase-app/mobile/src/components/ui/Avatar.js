import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import Text from './AppText';
import { resolveMediaUrl } from '../../utils/media';

const PALETTE = [
  '#1b5e20',
  '#0d47a1',
  '#b71c1c',
  '#e65100',
  '#4a148c',
  '#006064',
  '#880e4f',
  '#33691e',
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getColor(name) {
  if (!name) return PALETTE[0];
  return PALETTE[hashString(name) % PALETTE.length];
}

export default function Avatar({ uri, name, size = 40 }) {
  // Resolve relative/storage paths to absolute URLs (passes full URLs through).
  const resolved = resolveMediaUrl(uri);
  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        style={[
          styles.image,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.placeholder,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: getColor(name),
        },
      ]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>
        {getInitials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    overflow: 'hidden',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
