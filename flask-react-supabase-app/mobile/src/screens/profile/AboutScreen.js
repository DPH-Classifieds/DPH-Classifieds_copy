import React, { useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Text from '../../components/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

// Native About screen for DPH Classifieds. Content is inlined as React Native
// (no WebView, no external page loads) so the mobile profile section exposes
// only app-native surfaces. Contact Support keeps a mailto: link because it
// opens the system mail client (not a browser).

const STATS = [
  { value: '80k+', label: 'Active petrolheads' },
  { value: '25M', label: 'Annual views' },
  { value: '1000+', label: 'Listings posted' },
  { value: '5+', label: 'Years of momentum' },
];

const COMMUNITY = [
  {
    title: 'Reddit',
    copy: 'Long-form stories, ownership discussions, and transparent market conversations.',
    cta: 'Open Reddit',
    url: 'https://www.reddit.com/r/DubaiPetrolHeads/',
  },
  {
    title: 'Instagram',
    copy: 'Daily culture, featured cars, and the visual pulse of the community.',
    cta: 'Open Instagram',
    url: 'https://www.instagram.com/dubaipetrolheads',
  },
];

export default function AboutScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingBottom: SPACING.xxl },
    hero: {
      alignItems: 'center',
      paddingHorizontal: SPACING.lg,
      paddingTop: SPACING.lg,
      paddingBottom: SPACING.lg,
    },
    logo: {
      width: 88,
      height: 88,
      borderRadius: 22,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: SPACING.md,
    },
    appName: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.xxl,
      fontWeight: '800',
    },
    kicker: {
      color: colors.accent,
      fontSize: FONT_SIZES.xs,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginTop: 4,
    },
    headline: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.xl,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: SPACING.md,
      paddingHorizontal: SPACING.md,
      lineHeight: 26,
    },
    subhead: {
      color: colors.textSecondary,
      fontSize: FONT_SIZES.md,
      textAlign: 'center',
      marginTop: SPACING.sm,
      paddingHorizontal: SPACING.lg,
      lineHeight: 22,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: SPACING.md,
      marginBottom: SPACING.lg,
      gap: SPACING.sm,
    },
    statCard: {
      flexBasis: '48%',
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: 'center',
    },
    statNumber: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.xl,
      fontWeight: '800',
    },
    statLabel: {
      color: colors.textMuted,
      fontSize: FONT_SIZES.xs,
      marginTop: 2,
      textAlign: 'center',
    },
    section: {
      backgroundColor: colors.surface,
      marginHorizontal: SPACING.md,
      marginBottom: SPACING.md,
      borderRadius: BORDER_RADIUS.lg,
      padding: SPACING.md,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.lg,
      fontWeight: '700',
      marginBottom: SPACING.xs,
    },
    sectionBody: {
      color: colors.textSecondary,
      fontSize: FONT_SIZES.md,
      lineHeight: 22,
    },
    communityCard: {
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.md,
      padding: SPACING.md,
      marginHorizontal: SPACING.md,
      marginBottom: SPACING.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderLight,
    },
    communityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    communityLeft: { flex: 1 },
    communityTitle: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.md,
      fontWeight: '700',
      marginBottom: 4,
    },
    communityCopy: {
      color: colors.textSecondary,
      fontSize: FONT_SIZES.sm,
      lineHeight: 20,
      marginBottom: SPACING.sm,
    },
    communityCta: {
      color: colors.accent,
      fontSize: FONT_SIZES.sm,
      fontWeight: '600',
    },
    supportRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: 14,
    },
    supportText: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.md,
      flex: 1,
    },
    footer: {
      color: colors.textMuted,
      fontSize: FONT_SIZES.sm,
      textAlign: 'center',
      marginTop: SPACING.lg,
    },
  }), [colors]);

  const handleOpenUrl = (url) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.logo}>
            <Ionicons name="car-sport" size={48} color={colors.accent} />
          </View>
          <Text style={styles.appName}>DPH Classifieds</Text>
          <Text style={styles.kicker}>About</Text>
        </View>

        <Text style={styles.headline}>
          A classifieds platform built by the same people who care about the cars.
        </Text>
        <Text style={styles.subhead}>
          DPH Classifieds exists to make browsing, listing, and buying feel more
          transparent for the UAE market. It is designed for people who want
          cleaner listings, stronger trust, and fewer surprises when a deal gets serious.
        </Text>

        <View style={styles.statsGrid}>
          {STATS.map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <Text style={styles.statNumber}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who we are</Text>
          <Text style={styles.sectionBody}>
            DubaiPetrolHeads has grown into one of the largest enthusiast communities
            in the region. DPH Classifieds extends that culture into a marketplace
            where both buyers and sellers can expect better presentation, better
            context, and better trust signals than generic listings.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Our mission</Text>
          <Text style={styles.sectionBody}>
            Raise listing quality and reduce hidden surprises. Help sellers present
            cars properly and help buyers see the important information before they
            commit time, money, or trust. A better market starts with clearer
            listings, better photos, and a platform that does not reward vague inventory.
          </Text>
        </View>

        <View style={{ marginHorizontal: SPACING.md, marginBottom: SPACING.sm, marginTop: SPACING.sm }}>
          <Text style={[styles.sectionTitle, { marginHorizontal: 0, paddingHorizontal: 0 }]}>Community</Text>
        </View>

        {COMMUNITY.map((item) => (
          <TouchableOpacity
            key={item.title}
            style={styles.communityCard}
            onPress={() => handleOpenUrl(item.url)}
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={`${item.cta} — ${item.title}`}
          >
            <View style={styles.communityRow}>
              <View style={styles.communityLeft}>
                <Text style={styles.communityTitle}>{item.title}</Text>
                <Text style={styles.communityCopy}>{item.copy}</Text>
                <Text style={styles.communityCta}>{item.cta} →</Text>
              </View>
              <Ionicons name="open-outline" size={20} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.supportRow, { backgroundColor: colors.surface, marginHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.lg, marginTop: SPACING.sm }]}
          onPress={() => Linking.openURL('mailto:support@dphclassifieds.com').catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel="Contact support via email"
        >
          <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.supportText}>Contact Support</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <Text style={styles.footer}>Made in UAE</Text>
      </ScrollView>
    </SafeAreaView>
  );
}