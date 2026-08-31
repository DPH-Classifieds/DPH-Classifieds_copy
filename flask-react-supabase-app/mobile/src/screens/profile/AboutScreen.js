import React from 'react';
import { View, TouchableOpacity, ScrollView, Linking, StyleSheet } from 'react-native';
import Text from '../../components/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const LINKS = [
  {
    label: 'Visit Website',
    url: 'https://www.dphclassifieds.com',
    icon: 'globe-outline',
  },
  {
    label: 'Contact Support',
    url: 'mailto:support@dphclassifieds.com',
    icon: 'mail-outline',
  },
  {
    label: 'Privacy Policy',
    url: 'https://www.dphclassifieds.com/privacy',
    icon: 'document-text-outline',
  },
  {
    label: 'Terms of Service',
    url: 'https://www.dphclassifieds.com/terms',
    icon: 'reader-outline',
  },
];

export default function AboutScreen() {
  const handleOpenLink = (url) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Ionicons name="car-sport" size={48} color={COLORS.accent} />
        </View>
        <Text style={styles.appName}>DPH Classifieds</Text>
        <Text style={styles.version}>v1.0.0</Text>
      </View>

      <Text style={styles.description}>
        UAE&apos;s premier marketplace for cars, bikes, plates, and parts.
      </Text>

      <View style={styles.linksSection}>
        {LINKS.map((link) => (
          <TouchableOpacity
            key={link.label}
            style={styles.linkRow}
            onPress={() => handleOpenLink(link.url)}
            activeOpacity={0.7}
          >
            <View style={styles.linkLeft}>
              <Ionicons name={link.icon} size={20} color={COLORS.textSecondary} />
              <Text style={styles.linkLabel}>{link.label}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.footer}>Made in UAE</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingVertical: SPACING.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  logoContainer: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  appName: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
  },
  version: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    marginTop: 4,
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
    lineHeight: 22,
    marginBottom: SPACING.xl,
  },
  linksSection: {
    backgroundColor: COLORS.surface,
    marginHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  linkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  linkLabel: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '500',
  },
  footer: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
    marginTop: SPACING.xxl,
  },
});
