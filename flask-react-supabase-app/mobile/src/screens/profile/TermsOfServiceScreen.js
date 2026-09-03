// Native Terms of Service screen for DPH Classifieds. Content is inlined as
// React Native (no WebView, no external page loads) so the mobile profile
// section exposes only app-native surfaces. Section structure mirrors the
// public web Terms of Use so users get the same information in both surfaces.

import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Text from '../../components/ui/AppText';
import { SPACING, FONT_SIZES, BORDER_RADIUS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const SECTIONS = [
  { title: '1) Who we are & how to reach us', body: 'DPH Classifieds is operated by DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES. Contact: legal@dphclassifieds.com. These Terms govern your access to and use of our website, mobile applications, and any services, features, or content made available through them.' },
  { title: '2) Changes to these Terms', body: 'We may revise these Terms at any time. Material changes will be communicated via in-app notice or email. Continued use of the Platform after changes constitutes acceptance of the revised Terms.' },
  { title: '3) Changes to the Platform', body: 'We may add, modify, or remove features, content, or services at any time. We may also suspend or discontinue the Platform (in whole or in part) with or without notice. Where reasonable, we will provide advance notice of material changes.' },
  { title: '4) Privacy', body: 'Your privacy is governed by our Privacy Policy. By using the Platform you agree to the Privacy Policy, which is incorporated into these Terms by reference.' },
  { title: '5) Your licence to use the Platform', body: 'Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable, revocable licence to access and use the Platform for personal, non-commercial purposes. You may not copy, modify, distribute, sell, or reverse-engineer any part of the Platform.' },
  { title: '6) Prohibited use', body: 'You agree not to use the Platform for unlawful purposes, to post false or misleading listings, to harass other users, to scrape or harvest data, to interfere with the Platform\'s operation, to upload malware or malicious code, to circumvent security measures, or to engage in any activity that could harm the Platform, other users, or third parties.' },
  { title: '7) Accounts', body: 'You are responsible for maintaining the security of your account and password. We are not liable for any loss or damage from your failure to secure your account. You must provide accurate information when registering and update it as needed. We may suspend or terminate accounts that contain false information.' },
  { title: '8) Paid services', body: 'Some features (featured listings, dealer subscriptions, premium placement) may require payment. Prices are displayed clearly before purchase. Payments are processed by third-party payment processors; by using paid services you agree to their terms as well.' },
  { title: '9) Listings & marketplace role', body: 'DPH Classifieds is a marketplace platform. We are not a party to transactions between users. We do not verify the accuracy of listings, the identity of users, or the condition of listed vehicles. Buyers and sellers are responsible for their own due diligence. We may moderate listings but are under no obligation to do so.' },
  { title: '10) Reviews & ratings', body: 'Users may post reviews and ratings of other users. Reviews must be honest, based on actual transactions, and free of defamation. We may remove reviews that violate our policies. We are not responsible for the accuracy of user-submitted reviews.' },
  { title: '11) Content you upload', body: 'You retain ownership of content you upload (photos, descriptions, listing details, messages). You grant DPH Classifieds a worldwide, non-exclusive, royalty-free licence to use, store, display, reproduce, modify, and distribute your content for the purpose of operating, promoting, and improving the Platform. You represent that you own or have the right to upload all content you post.' },
  { title: '12) Acceptable Use Policy', body: 'In addition to the prohibited uses listed in section 6, you agree not to: impersonate any person or entity, post content that infringes intellectual property rights, post listings for items you do not have the right to sell, attempt to manipulate search or ranking systems, or use the Platform to harass, threaten, or defraud other users.' },
  { title: '13) Payments', body: 'Refunds are handled on a case-by-case basis. Contact support@dphclassifieds.com to request a refund. If a dispute arises between buyer and seller, we may (but are not obligated to) mediate. Chargebacks initiated without first contacting support may result in account suspension.' },
  { title: '14) Disclaimers & limits of liability', body: 'The Platform is provided "as is" without warranties of any kind. To the maximum extent permitted by law, DPH Classifieds disclaims all warranties (express or implied) and shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Platform.' },
  { title: '15) Breach & enforcement', body: 'If you breach these Terms, we may (at our discretion) issue warnings, suspend your account, terminate your account, remove your content, or take legal action. Repeated or material breaches will result in permanent account termination. We will notify you of enforcement actions where reasonable.' },
  { title: '16) Reporting illegal or infringing content', body: 'If you believe content on the Platform infringes your rights or is illegal, contact legal@dphclassifieds.com with details. We will review and act on valid reports within a reasonable timeframe. Repeat infringers will have their accounts terminated.' },
  { title: '17) General terms', body: 'These Terms are governed by the laws of the United Arab Emirates. Any disputes shall be resolved in the courts of Dubai, UAE. If any provision of these Terms is held unenforceable, the remaining provisions remain in full effect. These Terms, together with the Privacy Policy, constitute the entire agreement between you and DPH Classifieds.' },
  { title: '18) Contact', body: 'For any questions about these Terms, contact legal@dphclassifieds.com. We aim to respond within 30 days.' },
  { title: 'Annex A — Additional Terms: Motors', body: 'Listings for motor vehicles (cars, bikes, plates, parts) are subject to additional verification requirements. Sellers must own or have the right to sell the listed item. We may request documentation (mulkiya / registration card) to verify ownership. Listings for stolen vehicles are strictly prohibited and will be reported to authorities. We may charge a small listing fee for premium placements in motor vehicle categories.' },
];

export default function TermsOfServiceScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingBottom: SPACING.xxl },
    header: {
      paddingHorizontal: SPACING.lg,
      paddingTop: SPACING.lg,
      paddingBottom: SPACING.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    kicker: {
      color: colors.accent,
      fontSize: FONT_SIZES.xs,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.xxl,
      fontWeight: '800',
      marginTop: 4,
    },
    effective: {
      color: colors.textMuted,
      fontSize: FONT_SIZES.sm,
      marginTop: SPACING.xs,
    },
    section: {
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.lg,
      fontWeight: '700',
      marginBottom: SPACING.sm,
    },
    sectionBody: {
      color: colors.textSecondary,
      fontSize: FONT_SIZES.md,
      lineHeight: 22,
    },
    summary: {
      backgroundColor: colors.surface,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      padding: SPACING.md,
      borderRadius: BORDER_RADIUS.md,
    },
    summaryTitle: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.lg,
      fontWeight: '700',
      marginBottom: SPACING.sm,
    },
    summaryBody: {
      color: colors.textSecondary,
      fontSize: FONT_SIZES.md,
      lineHeight: 22,
    },
  }), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Legal</Text>
          <Text style={styles.title}>Terms of Use</Text>
          <Text style={styles.effective}>Effective date: 25 May 2026</Text>
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Summary</Text>
          <Text style={styles.summaryBody}>
            DPH Classifieds is a marketplace operated by DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY
            AND NETWORK SERVICES. By using the Platform you agree to be bound by these Terms. We are
            not a party to transactions between users. Listings, reviews, and other content you post
            must comply with these Terms and applicable law. Contact legal@dphclassifieds.com with
            any questions.
          </Text>
        </View>

        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
