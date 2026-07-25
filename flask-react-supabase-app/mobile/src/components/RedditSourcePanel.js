import React from 'react';
import { View, Text, StyleSheet, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from './ui/PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../constants/theme';

// A listing is a safely-renderable Reddit import only when it declares reddit
// as its source AND its source_url resolves to reddit's own host. Never trust
// an arbitrary source_url.
export function isRedditSourced(item) {
  const url = item?.source_url;
  if (!item || item.source_platform !== 'reddit' || !url) return false;
  return /^https:\/\/(www\.)?reddit\.com\//i.test(String(url));
}

// Mirrors the web RedditSourcePanel: attribution to DPH Classifieds (no reddit
// seller) + the single outbound "View original Reddit post" link. Renders null
// for non-reddit listings so callers can drop it in unconditionally.
export default function RedditSourcePanel({ item }) {
  if (!isRedditSourced(item)) return null;
  const open = () => {
    Linking.openURL(item.source_url).catch(() =>
      Alert.alert('Could not open link', 'Unable to open the original Reddit post.')
    );
  };
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.badge}>
          <Ionicons name="logo-reddit" size={13} color="#ff4500" />
          <Text style={styles.badgeText}>Reddit</Text>
        </View>
        <Text style={styles.attr}>Posted by DPH Classifieds · imported from r/DubaiPetrolHeads</Text>
      </View>
      <Text style={styles.disclaimer}>
        Listing details are supplied by the original Reddit post; see the linked post for full details.
      </Text>
      <PressableScale onPress={open} haptic="medium" style={styles.button}>
        <Ionicons name="open-outline" size={18} color={COLORS.white} />
        <Text style={styles.buttonText}>View original Reddit post</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: 'rgba(255,69,0,0.28)',
    backgroundColor: 'rgba(255,69,0,0.08)',
    borderRadius: BORDER_RADIUS.lg || 14,
    padding: SPACING.md || 14,
    gap: 10,
  },
  head: { gap: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeText: { color: '#ff6a33', fontWeight: '700', fontSize: FONT_SIZES.sm || 13 },
  attr: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs || 12 },
  disclaimer: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs || 12, lineHeight: 17 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ff4500',
    borderRadius: BORDER_RADIUS.md || 12,
    paddingVertical: 12,
  },
  buttonText: { color: COLORS.white, fontWeight: '700', fontSize: FONT_SIZES.md || 15 },
});
