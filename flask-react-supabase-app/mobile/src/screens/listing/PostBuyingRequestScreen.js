import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess, showError } from '../../utils/toast';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';

const CATEGORIES = ['Cars', 'Bikes', 'Plates', 'Parts', 'Other'];

export default function PostBuyingRequestScreen({ navigation }) {
  const [form, setForm] = useState({
    category: '',
    title: '',
    description: '',
    make: '',
    model: '',
    budget_min: '',
    budget_max: '',
    contact_phone: '',
    contact_preference: 'whatsapp',
  });
  const [submitting, setSubmitting] = useState(false);

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      showError('Missing title', 'Please describe what you are looking for.');
      return;
    }
    if (!form.contact_phone.trim()) {
      showError('Missing phone', 'Please enter a contact phone number.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        budget_min: form.budget_min ? Number(form.budget_min) : null,
        budget_max: form.budget_max ? Number(form.budget_max) : null,
      };
      await apiClient.post('/api/buying-requests', payload);
      showSuccess('Request posted!', 'Sellers will be able to contact you.');
      navigation.goBack();
    } catch (err) {
      toastApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.heading}>Post a Buying Request</Text>
            <Text style={styles.subheading}>Tell sellers what you're looking for</Text>

            <Label>Category</Label>
            <View style={styles.chipRow}>
              {CATEGORIES.map((cat) => (
                <PressableScale
                  key={cat}
                  onPress={() => update('category', cat)}
                  haptic="light"
                  style={[styles.chip, form.category === cat && styles.chipActive]}
                >
                  <Text style={[styles.chipText, form.category === cat && styles.chipTextActive]}>{cat}</Text>
                </PressableScale>
              ))}
            </View>

            <Label>What are you looking for? *</Label>
            <TextInput
              style={styles.input}
              placeholder="e.g. Toyota Camry 2020-2022 GCC spec"
              placeholderTextColor={COLORS.textMuted}
              value={form.title}
              onChangeText={(v) => update('title', v)}
            />

            <Label>Description</Label>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Any specific requirements, colour preferences, mileage range..."
              placeholderTextColor={COLORS.textMuted}
              value={form.description}
              onChangeText={(v) => update('description', v)}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Label>Make</Label>
                <TextInput style={styles.input} placeholder="Toyota" placeholderTextColor={COLORS.textMuted} value={form.make} onChangeText={(v) => update('make', v)} />
              </View>
              <View style={{ width: SPACING.sm }} />
              <View style={{ flex: 1 }}>
                <Label>Model</Label>
                <TextInput style={styles.input} placeholder="Camry" placeholderTextColor={COLORS.textMuted} value={form.model} onChangeText={(v) => update('model', v)} />
              </View>
            </View>

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Label>Budget Min (AED)</Label>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={COLORS.textMuted} value={form.budget_min} onChangeText={(v) => update('budget_min', v)} keyboardType="numeric" />
              </View>
              <View style={{ width: SPACING.sm }} />
              <View style={{ flex: 1 }}>
                <Label>Budget Max (AED)</Label>
                <TextInput style={styles.input} placeholder="Any" placeholderTextColor={COLORS.textMuted} value={form.budget_max} onChangeText={(v) => update('budget_max', v)} keyboardType="numeric" />
              </View>
            </View>

            <Label>Contact Phone *</Label>
            <TextInput
              style={styles.input}
              placeholder="+971 50 000 0000"
              placeholderTextColor={COLORS.textMuted}
              value={form.contact_phone}
              onChangeText={(v) => update('contact_phone', v)}
              keyboardType="phone-pad"
            />

            <PressableScale
              onPress={handleSubmit}
              haptic="success"
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              disabled={submitting}
            >
              <Text style={styles.submitBtnText}>{submitting ? 'Posting…' : 'Post Request'}</Text>
            </PressableScale>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenEntrance>
    </SafeAreaView>
  );
}

function Label({ children }) {
  return (
    <Text style={{ ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary, marginBottom: 6, marginTop: SPACING.md }}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.md, paddingBottom: 40 },
  heading: { ...FONTS.bold, fontSize: FONT_SIZES.xxl, color: COLORS.white, marginBottom: 4 },
  subheading: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.md },
  input: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, color: COLORS.white, fontSize: FONT_SIZES.md, borderWidth: 1, borderColor: COLORS.borderLight },
  textArea: { height: 100, paddingTop: SPACING.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.accent },
  chipText: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.accent },
  row: { flexDirection: 'row' },
  submitBtn: { backgroundColor: COLORS.accent, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.xl },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: COLORS.black },
});
