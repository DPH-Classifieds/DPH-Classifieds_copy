// Native Privacy Policy screen for DPH Classifieds. Content is inlined as
// React Native (no WebView, no external page loads) so the mobile profile
// section exposes only app-native surfaces. Section structure mirrors the
// public web privacy policy so users get the same information in both surfaces.

import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Text from '../../components/ui/AppText';
import { SPACING, FONT_SIZES, BORDER_RADIUS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const SECTIONS = [
  { title: '1. Scope of This Privacy Policy', body: 'This Privacy Policy applies to all information collected through our website, mobile application, communications via chat/email/call features, and third-party integrations connected to the Platform. It does not cover third-party websites or services linked from DPH Classifieds.' },
  { title: '2. Who We Are & How to Contact Us', body: 'DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES is the operator. Registered Address: Dubai, United Arab Emirates. Email: privacy@dphclassifieds.com. We are the data controller responsible for handling your personal data when you use the Platform.' },
  { title: '3. Information We Collect', body: 'Identity Data (name, username, profile photo, identity documents), Vehicle Registration Documents (mulkiya / registration cards, OCR-extracted VIN/make/model/year), Contact Data (email, phone), Location Data (approximate location if enabled), Listing Data (ads, photos, viewed vehicles, offers, purchase history), Chat & Call Data (messages, recorded calls), Technical Data (IP, device, OS, login), Behavioral Data, and Marketing Preferences. We do not intentionally collect sensitive personal data; if you volunteer it, you consent to processing.' },
  { title: '4. How We Collect Information', body: 'Directly from you (account creation, listings, communications), automatically (cookies, analytics, tracking technologies), and from third-party sources (social media, analytics providers, advertising partners).' },
  { title: '5. Why We Use Your Data', body: 'Account registration and management (contractual necessity), identity verification and fraud prevention (legal compliance), enabling buying/selling/messaging (contractual necessity), customer support and dispute resolution (contractual necessity), service improvement via analytics (legitimate interest), OCR document scanning to pre-fill listing fields (legitimate interest + consent), marketing communications (consent), platform security (legal compliance), and listing moderation (contractual necessity + legitimate interest).' },
  { title: '6. User Listings and Uploaded Images', body: 'When you upload listing content (car photos, videos, descriptions, related media), we process that content to host, display, moderate, improve, advertise the Platform, train and test our systems, and prevent abuse. Listing media may be visible to other users and may be retained in caches, logs, backups, or archives for operational, legal, security, evidentiary, product, analytics, or commercial purposes. Registration documents uploaded for OCR are stored privately and are not shown to other users. Listing prices may be analysed for market pricing insights and price-drop alerts.' },
  { title: '7. Sharing Your Data', body: 'We only share your personal data with trusted parties when necessary: service providers (hosting, payments, OCR), legal and regulatory authorities when required, business partners in case of merger or acquisition, and any party with your explicit consent. We do not sell personal data.' },
  { title: '8. International Data Transfers', body: 'Your data may be transferred to and processed in countries other than your country of residence. Where this occurs, we use appropriate safeguards (such as Standard Contractual Clauses) to protect your data to the same standard as required in your jurisdiction.' },
  { title: '9. Data Security', body: 'We use industry-standard technical and organisational measures (encryption in transit, access controls, regular security reviews) to protect your data. No system is completely secure; please use a strong password and keep your account credentials private.' },
  { title: '10. Data Retention', body: 'We retain personal data only as long as necessary to provide the Platform, comply with legal obligations, resolve disputes, and enforce agreements. Account deletion requests remove active data within 30 days; some data may persist in encrypted backups for up to 12 months before permanent deletion.' },
  { title: '11. Your Privacy Rights', body: 'Depending on your jurisdiction, you may have the right to access, correct, delete, restrict processing of, object to processing of, port your data, withdraw consent, and lodge a complaint with a supervisory authority. To exercise these rights, contact privacy@dphclassifieds.com.' },
  { title: '12. Marketing Preferences', body: 'You can opt out of marketing communications at any time via your account settings or the unsubscribe link in any marketing email. Transactional notices (account, listings, security) are always sent regardless of marketing preferences.' },
  { title: '13. Use by Minors', body: 'The Platform is not directed at children under 18. We do not knowingly collect personal data from minors. If you believe we have collected data from a minor, contact privacy@dphclassifieds.com for prompt deletion.' },
  { title: '14. Third-Party Links', body: 'The Platform may contain links to third-party websites or services. We are not responsible for the privacy practices of those external services; review their policies before sharing personal data.' },
  { title: '15. Changes to This Privacy Policy', body: 'We may update this Privacy Policy from time to time. Material changes will be communicated via in-app notice or email. Continued use of the Platform after changes constitutes acceptance.' },
  { title: '16. Contact Information', body: 'For any privacy questions or to exercise your rights, email privacy@dphclassifieds.com. We aim to respond within 30 days.' },
];

export default function PrivacyPolicyScreen() {
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
          <Text style={styles.title}>Privacy Policy</Text>
          <Text style={styles.effective}>Effective Date: 25 May 2026</Text>
        </View>

        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Summary</Text>
          <Text style={styles.summaryBody}>
            DPH Classifieds is operated by DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES.
            We collect identity, contact, vehicle, listing, and technical data to run the Platform,
            verify users, prevent fraud, and improve the marketplace. We do not sell personal data.
            Email privacy@dphclassifieds.com to exercise your rights.
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
