import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity, Image, Linking, Modal, TextInput } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

// Mirrors frontend/src/components/AdminDealerDetail.jsx DOC_TYPES.
const DOC_TYPES = [
  { key: 'trade_license', label: 'Trade License', icon: 'document-text-outline' },
  { key: 'tax_registration', label: 'Tax Registration (TRN)', icon: 'receipt-outline' },
];

const STATUS_LABEL = { approved: 'Approved', denied: 'Denied', pending: 'Pending', missing: 'Missing' };
const STATUS_COLOR = { approved: COLORS.success, denied: COLORS.error, pending: COLORS.warning, missing: COLORS.textMuted };

const isPdf = (doc) => doc?.file_type === 'application/pdf' || doc?.filename?.toLowerCase().endsWith('.pdf');

function DenyModal({ doc, docLabel, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState(doc?.denial_reason || '');
  const [fix, setFix] = useState(doc?.denial_fix || '');
  if (!doc) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Deny {docLabel}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalLabel}>Reason for denial *</Text>
          <TextInput
            style={styles.modalInput}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Document is expired or unclear"
            placeholderTextColor={COLORS.textMuted}
          />
          <Text style={styles.modalLabel}>How to fix it *</Text>
          <TextInput
            style={[styles.modalInput, styles.modalTextarea]}
            value={fix}
            onChangeText={setFix}
            placeholder="e.g. Upload a clear photo of your current trade license"
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={3}
          />
          <TouchableOpacity
            style={[styles.modalDenyBtn, (!reason.trim() || !fix.trim() || busy) && styles.modalBtnDisabled]}
            disabled={!reason.trim() || !fix.trim() || busy}
            onPress={() => onConfirm(doc.id, 'deny', reason.trim(), fix.trim())}
          >
            <Text style={styles.modalDenyBtnText}>{busy ? 'Working…' : 'Confirm denial'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

export default function AdminDealerDetailScreen({ route, navigation }) {
  const { dealerId } = route.params;
  const [dealer, setDealer] = useState(null);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewingDocId, setReviewingDocId] = useState(null);
  const [denyModalDoc, setDenyModalDoc] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadDealer = useCallback(async () => {
    try {
      const [overview, docsResp] = await Promise.all([
        apiClient.get(`/api/admin/dealers/${dealerId}/overview`),
        apiClient.get(`/api/admin/dealers/${dealerId}/documents`).catch(() => ({ documents: [] })),
      ]);
      setDealer(overview);
      setDocs(docsResp?.documents || []);
    } catch {
      Alert.alert('Error', 'Failed to load dealer.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [dealerId, navigation]);

  useEffect(() => { loadDealer(); }, [loadDealer]);

  const activeDocs = docs.filter((d) => !d.replaced_at);
  const getDocByType = (key) => activeDocs.find((d) => d.document_type === key);
  const allDocsApproved = DOC_TYPES.every((t) => getDocByType(t.key)?.status === 'approved');

  const handleReviewDocument = async (docId, action, denialReason = '', denialFix = '') => {
    setReviewingDocId(docId);
    try {
      await apiClient.post(`/api/admin/dealer-documents/${docId}/review`, {
        action,
        denial_reason: denialReason,
        denial_fix: denialFix,
      });
      await loadDealer();
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to review document.');
    } finally {
      setReviewingDocId(null);
      setDenyModalDoc(null);
    }
  };

  const handleForceApprove = () => {
    if (Alert.prompt) {
      Alert.prompt(
        'Force approve dealer',
        'Reason (required for audit log):',
        (reason) => {
          const trimmed = (reason || '').trim();
          if (!trimmed) {
            return;
          }
          submitForceApprove(trimmed);
        },
      );
      return;
    }
    Alert.alert(
      'Force approve dealer',
      'Provide a reason via web admin — this screen requires iOS Alert.prompt support.',
      [{ text: 'OK' }],
    );
  };

  const submitForceApprove = async (reason) => {
    setActionLoading(true);
    try {
      await apiClient.post(`/api/admin/dealers/${dealerId}/verify`, { reason });
      Alert.alert('Force-approved', 'Dealer has been force-approved.');
      await loadDealer();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const submitReject = async (note) => {
    setActionLoading(true);
    try {
      await apiClient.post(`/api/admin/dealers/${dealerId}/reject`, { rejection_note: note || 'Rejected by admin' });
      Alert.alert('Rejected', 'Dealer has been rejected.');
      await loadDealer();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = () => {
    // Alert.prompt is iOS-only; Android falls back to a plain confirm.
    if (Alert.prompt) {
      Alert.prompt('Reject dealer', 'Reason (optional):', (note) => submitReject(note));
      return;
    }
    Alert.alert('Reject dealer', 'Reject this dealer application?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => submitReject('') },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner message="Loading dealer..." />
      </SafeAreaView>
    );
  }

  const isVerified = dealer?.dealer_verified || dealer?.verification_status === 'verified';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.name}>{dealer?.company_name || dealer?.business_name || 'Dealer'}</Text>
        <View style={[styles.verificationBadge, { backgroundColor: isVerified ? COLORS.success : COLORS.warning }]}>
          <Text style={styles.verificationText}>{isVerified ? 'verified' : (dealer?.verification_status || 'pending')}</Text>
        </View>
        <Text style={styles.detail}>User: {dealer?.user_email || dealer?.email || 'N/A'}</Text>
        <Text style={styles.detail}>Listings: {dealer?.listing_count || 0}</Text>
        {dealer?.created_at && <Text style={styles.detail}>Joined: {formatDate(dealer.created_at)}</Text>}

        <Text style={styles.sectionTitle}>Documents</Text>
        {DOC_TYPES.map((type) => {
          const doc = getDocByType(type.key);
          const status = doc?.status || 'missing';
          return (
            <View key={type.key} style={styles.docCard}>
              <View style={styles.docHeader}>
                <Ionicons name={type.icon} size={16} color={COLORS.textMuted} />
                <Text style={styles.docLabel}>{type.label}</Text>
                <View style={[styles.docStatusBadge, { backgroundColor: STATUS_COLOR[status] }]}>
                  <Text style={styles.docStatusText}>{STATUS_LABEL[status]}</Text>
                </View>
              </View>

              {doc ? (
                <View>
                  {isPdf(doc) ? (
                    <TouchableOpacity style={styles.pdfPreview} onPress={() => Linking.openURL(doc.download_url)}>
                      <Ionicons name="document-text" size={32} color={COLORS.textMuted} />
                      <Text style={styles.pdfLinkText}>Open PDF</Text>
                      <Text style={styles.filenameText} numberOfLines={1}>{doc.filename}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => Linking.openURL(doc.download_url)}>
                      <Image source={{ uri: doc.download_url }} style={styles.imagePreview} />
                    </TouchableOpacity>
                  )}

                  {type.key === 'trade_license' && (
                    <View style={styles.ocrBox}>
                      <Text style={styles.ocrTitle}>PaddleOCR expiry check</Text>
                      <Text style={styles.ocrText}>
                        {doc.ocr_expires_at ? `Detected: ${doc.ocr_expires_at}` : 'No expiry date detected — verify manually.'}
                      </Text>
                      {doc.ocr_confidence != null && (
                        <Text style={styles.ocrConfidence}>Confidence: {Math.round(Number(doc.ocr_confidence) * 100)}%</Text>
                      )}
                    </View>
                  )}

                  {status === 'denied' && doc.denial_reason && (
                    <View style={styles.denialBox}>
                      <Text style={styles.denialTitle}>Denial reason</Text>
                      <Text style={styles.denialText}>{doc.denial_reason}</Text>
                      {doc.denial_fix ? <Text style={styles.denialFix}>Fix: {doc.denial_fix}</Text> : null}
                    </View>
                  )}

                  {status === 'pending' && (
                    <View style={styles.docActions}>
                      <TouchableOpacity
                        style={styles.docApproveBtn}
                        disabled={reviewingDocId === doc.id}
                        onPress={() => handleReviewDocument(doc.id, 'approve')}
                      >
                        <Text style={styles.docApproveBtnText}>{reviewingDocId === doc.id ? 'Working…' : 'Approve'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.docDenyBtn}
                        disabled={reviewingDocId === doc.id}
                        onPress={() => setDenyModalDoc(doc)}
                      >
                        <Text style={styles.docDenyBtnText}>Deny</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {status === 'approved' && (
                    <TouchableOpacity
                      style={styles.reReviewBtn}
                      disabled={reviewingDocId === doc.id}
                      onPress={() => handleReviewDocument(doc.id, 'pending')}
                    >
                      <Text style={styles.reReviewBtnText}>Re-review</Text>
                    </TouchableOpacity>
                  )}

                  {status === 'denied' && (
                    <View style={styles.docActions}>
                      <TouchableOpacity style={styles.docDenyBtn} disabled={reviewingDocId === doc.id} onPress={() => setDenyModalDoc(doc)}>
                        <Text style={styles.docDenyBtnText}>Update denial</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.reReviewBtn} disabled={reviewingDocId === doc.id} onPress={() => handleReviewDocument(doc.id, 'pending')}>
                        <Text style={styles.reReviewBtnText}>Re-review</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ) : (
                <Text style={styles.notSubmittedText}>No {type.label.toLowerCase()} has been uploaded yet.</Text>
              )}
            </View>
          );
        })}

        {!isVerified && (
          <View style={styles.actions}>
            {!allDocsApproved && docs.length > 0 && (
              <Text style={styles.gateWarning}>Both required documents must be approved before the dealer can be verified.</Text>
            )}
            <TouchableOpacity
              style={[styles.approveBtn, !allDocsApproved && styles.modalBtnDisabled]}
              onPress={handleForceApprove}
              disabled={!allDocsApproved || actionLoading}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
              <Text style={styles.approveBtnText}>{actionLoading ? 'Working…' : 'Force approve (OCR override)'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectBtn} onPress={handleReject} disabled={actionLoading} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color={COLORS.error} />
              <Text style={styles.rejectBtnText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <DenyModal
        doc={denyModalDoc}
        docLabel={DOC_TYPES.find((t) => t.key === denyModalDoc?.document_type)?.label || ''}
        onClose={() => setDenyModalDoc(null)}
        onConfirm={handleReviewDocument}
        busy={reviewingDocId === denyModalDoc?.id}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: SPACING.md, paddingBottom: 40 },
  name: { color: COLORS.white, fontSize: FONT_SIZES.xl, fontWeight: '700', marginBottom: SPACING.sm },
  verificationBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, marginBottom: SPACING.sm },
  verificationText: { color: COLORS.white, fontSize: FONT_SIZES.xs, fontWeight: '600', textTransform: 'capitalize' },
  detail: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, marginBottom: 4 },
  sectionTitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  docCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
  docHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  docLabel: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  docStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BORDER_RADIUS.sm },
  docStatusText: { color: COLORS.black, fontSize: 10, fontWeight: '700' },
  imagePreview: { width: '100%', height: 180, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.surfaceHigher },
  pdfPreview: { height: 140, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.surfaceHigher, alignItems: 'center', justifyContent: 'center', gap: 4 },
  pdfLinkText: { color: COLORS.accent, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  filenameText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, maxWidth: '80%' },
  ocrBox: { marginTop: SPACING.sm, backgroundColor: 'rgba(33,150,243,0.08)', borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, borderWidth: 1, borderColor: 'rgba(33,150,243,0.2)' },
  ocrTitle: { color: COLORS.info, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  ocrText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
  ocrConfidence: { color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  denialBox: { marginTop: SPACING.sm, backgroundColor: 'rgba(244,67,54,0.08)', borderRadius: BORDER_RADIUS.md, padding: SPACING.sm },
  denialTitle: { color: COLORS.error, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  denialText: { color: COLORS.white, fontSize: FONT_SIZES.sm, marginTop: 2 },
  denialFix: { color: COLORS.warning, fontSize: FONT_SIZES.xs, marginTop: 2 },
  notSubmittedText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, fontStyle: 'italic' },
  docActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  docApproveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  docApproveBtnText: { color: COLORS.accent, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  docDenyBtn: { flex: 1, backgroundColor: 'rgba(244,67,54,0.1)', borderRadius: BORDER_RADIUS.md, paddingVertical: 10, alignItems: 'center' },
  docDenyBtnText: { color: COLORS.error, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  reReviewBtn: { marginTop: SPACING.sm, backgroundColor: COLORS.surfaceHigher, borderRadius: BORDER_RADIUS.md, paddingVertical: 10, alignItems: 'center', flex: 1 },
  reReviewBtnText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  gateWarning: { color: COLORS.warning, fontSize: FONT_SIZES.xs, marginBottom: SPACING.sm },
  actions: { gap: SPACING.sm, marginTop: SPACING.lg },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
  approveBtnText: { color: COLORS.accent, fontSize: FONT_SIZES.md, fontWeight: '600' },
  rejectBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, justifyContent: 'center' },
  rejectBtnText: { color: COLORS.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
  modalBtnDisabled: { opacity: 0.4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: SPACING.md },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  modalTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600' },
  modalLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginBottom: 6, marginTop: SPACING.sm },
  modalInput: {
    backgroundColor: COLORS.surfaceHigher, borderRadius: BORDER_RADIUS.md, paddingHorizontal: 12, paddingVertical: 10,
    color: COLORS.white, fontSize: FONT_SIZES.sm,
  },
  modalTextarea: { minHeight: 70, textAlignVertical: 'top' },
  modalDenyBtn: { marginTop: SPACING.lg, backgroundColor: COLORS.error, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center' },
  modalDenyBtnText: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
});
