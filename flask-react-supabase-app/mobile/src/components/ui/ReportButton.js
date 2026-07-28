import React, { useState } from 'react';
import { View, TouchableOpacity, Modal, FlatList, StyleSheet, Alert } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const REPORT_REASONS = [
  'Spam or fake listing', 'Wrong category', 'Already sold',
  'Inappropriate content', 'Scam or fraud', 'Duplicate listing', 'Other',
];

export default function ReportButton({ listingType, listingId }) {
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleReport = async (reason) => {
    setSubmitting(true);
    try {
      await apiClient.post('/api/reports', { listing_type: listingType, listing_id: listingId, reason });
      setVisible(false);
      Alert.alert('Thank you', 'Your report has been submitted.');
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TouchableOpacity onPress={() => setVisible(true)} style={styles.trigger}>
        <Ionicons name="flag-outline" size={16} color={COLORS.textSecondary} />
        <Text style={styles.triggerText}>Report</Text>
      </TouchableOpacity>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Report Listing</Text>
            <FlatList
              data={REPORT_REASONS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.option} onPress={() => handleReport(item)} disabled={submitting}>
                  <Text style={styles.optionText}>{item}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.surfaceHigher,
  },
  triggerText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  overlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surfaceHigher, borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl, maxHeight: '60%', paddingBottom: 30,
  },
  handle: { width: 40, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 8 },
  title: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '700', paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: SPACING.md },
  optionText: { color: COLORS.white, fontSize: FONT_SIZES.md, flex: 1 },
  separator: { height: 0.5, backgroundColor: COLORS.borderLight, marginHorizontal: SPACING.md },
});
